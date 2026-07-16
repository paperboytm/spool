import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { computeIdentity, type IdentityFs } from '../projects/identity.js'
import { realFs } from '../projects/fs.js'
import { runAgentSearchCleanup } from '../migrations/agent-search-cleanup.js'
import { upgradeWorktreeIdentities } from '../migrations/worktree-identity-upgrade.js'

export const SPOOL_DIR = process.env['SPOOL_DATA_DIR'] ?? join(homedir(), '.spool')
export const DB_PATH = join(SPOOL_DIR, 'spool.db')

/**
 * Latest schema version the running build knows how to migrate to.
 * Bump in lockstep with the last `db.pragma('user_version = N')` in runMigrations.
 */
export const LATEST_SCHEMA_VERSION = 15

let _db: Database.Database | null = null
let _wasNewDb = false
let _initialUserVersion: number | null = null

export interface OpenOptions {
  /** Worker-thread callers should pass `false` — the main process has
   *  already run migrations on the shared DB file before spawning, and
   *  two threads racing through the migration script trip over each
   *  other on the `CREATE TRIGGER` / index steps (DROP IF EXISTS +
   *  CREATE is not atomic across connections). Default `true`. */
  runMigrations?: boolean
}

export function getDB(arg?: boolean | OpenOptions): Database.Database {
  if (_db) return _db
  const opts: OpenOptions =
    typeof arg === 'object' && arg !== null ? arg : {}
  const shouldRunMigrations = opts.runMigrations !== false
  mkdirSync(SPOOL_DIR, { recursive: true })
  // Capture pre-open state before better-sqlite3 creates the file. These two
  // signals together let callers tell apart "fresh install" from "upgrade":
  //   - wasNewDb=true  → DB file did not exist; this is a first-time install
  //   - wasNewDb=false → upgrade path, and initialUserVersion tells you from where
  _wasNewDb = !existsSync(DB_PATH)
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  _initialUserVersion = (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version ?? 0
  if (shouldRunMigrations) {
    runMigrations(db)
  }
  _db = db
  return db
}

/** True if the DB file did not exist before this process opened it. */
export function wasNewDb(): boolean { return _wasNewDb }

/** user_version of the DB before any migrations ran this process. Null if getDB() hasn't been called. */
export function getInitialUserVersion(): number | null { return _initialUserVersion }

export function getDBSize(): number {
  try {
    return statSync(DB_PATH).size
  } catch {
    return 0
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      base_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO sources (name, base_path) VALUES
      ('claude', '~/.claude/projects'),
      ('codex',  '~/.codex/sessions'),
      ('gemini', '~/.gemini/tmp'),
      ('antigravity', '~/.gemini/antigravity-cli/brain'),
      ('opencode', '~/.local/share/opencode/opencode.db');

    CREATE TABLE IF NOT EXISTS projects (
      id           INTEGER PRIMARY KEY,
      source_id    INTEGER NOT NULL REFERENCES sources(id),
      slug         TEXT NOT NULL,
      display_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      last_synced  TEXT,
      UNIQUE (source_id, slug)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id             INTEGER PRIMARY KEY,
      project_id     INTEGER NOT NULL REFERENCES projects(id),
      source_id      INTEGER NOT NULL REFERENCES sources(id),
      session_uuid   TEXT NOT NULL UNIQUE,
      file_path      TEXT NOT NULL UNIQUE,
      title          TEXT,
      title_source   TEXT NOT NULL DEFAULT 'derived',
      started_at     TEXT NOT NULL,
      ended_at       TEXT NOT NULL,
      message_count  INTEGER NOT NULL DEFAULT 0,
      has_tool_use   INTEGER NOT NULL DEFAULT 0,
      cwd            TEXT,
      model          TEXT,
      raw_file_mtime TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_source   ON sessions(source_id);

    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY,
      session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      source_id    INTEGER NOT NULL REFERENCES sources(id),
      msg_uuid     TEXT,
      parent_uuid  TEXT,
      role         TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      timestamp    TEXT NOT NULL,
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      tool_names   TEXT NOT NULL DEFAULT '[]',
      seq          INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content_text,
      content='messages',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(
      content_text,
      content='messages',
      content_rowid='id',
      tokenize='trigram'
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id        INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES sources(id),
      file_path TEXT NOT NULL,
      status    TEXT NOT NULL,
      message   TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_search (
      session_id      INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      title           TEXT NOT NULL DEFAULT '',
      user_text       TEXT NOT NULL DEFAULT '',
      assistant_text  TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts USING fts5(
      title,
      user_text,
      assistant_text,
      content='session_search',
      content_rowid='session_id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts_trigram USING fts5(
      title,
      user_text,
      assistant_text,
      content='session_search',
      content_rowid='session_id',
      tokenize='trigram'
    );

    -- ── Stars ─────────────────────────────────────────────────────────────
    -- Star table keyed by session_uuid (natural id, stable across re-index).
    -- No FK — queries filter orphans at read time via JOIN, so transient
    -- referent absence (e.g. transcript file removed then restored) doesn't
    -- destroy the star. CHECK constraint guards against typos in item_type.
    CREATE TABLE IF NOT EXISTS stars (
      item_type  TEXT NOT NULL CHECK (item_type = 'session'),
      item_uuid  TEXT NOT NULL,
      starred_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (item_type, item_uuid)
    );

    CREATE INDEX IF NOT EXISTS idx_stars_starred_at ON stars(starred_at DESC);
  `)

  db.exec(`
    DROP TRIGGER IF EXISTS messages_fts_insert;
    DROP TRIGGER IF EXISTS messages_fts_update;
    DROP TRIGGER IF EXISTS messages_fts_delete;
    DROP TRIGGER IF EXISTS session_search_fts_insert;
    DROP TRIGGER IF EXISTS session_search_fts_update;
    DROP TRIGGER IF EXISTS session_search_fts_delete;

    CREATE TRIGGER messages_fts_insert
    AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
      INSERT INTO messages_fts_trigram(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
    END;

    -- Security Scan's Purge action UPDATEs messages.content_text in
    -- place. FTS external-content tables don't auto-sync on UPDATE —
    -- we issue the 'delete' command for the old text and re-insert
    -- the new. Without this trigger the FTS index keeps matching the
    -- raw value after Purge, defeating the threat-model goal.
    CREATE TRIGGER messages_fts_update
    AFTER UPDATE OF content_text ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_text)
        VALUES('delete', OLD.id, OLD.content_text);
      INSERT INTO messages_fts(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
      INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content_text)
        VALUES('delete', OLD.id, OLD.content_text);
      INSERT INTO messages_fts_trigram(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
    END;

    CREATE TRIGGER messages_fts_delete
    AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_text)
        VALUES('delete', OLD.id, OLD.content_text);
      INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content_text)
        VALUES('delete', OLD.id, OLD.content_text);
    END;

    CREATE TRIGGER session_search_fts_insert
    AFTER INSERT ON session_search BEGIN
      INSERT INTO session_search_fts(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
      INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    END;

    CREATE TRIGGER session_search_fts_update
    AFTER UPDATE ON session_search BEGIN
      INSERT INTO session_search_fts(session_search_fts, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
      INSERT INTO session_search_fts_trigram(session_search_fts_trigram, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    END;

    CREATE TRIGGER session_search_fts_delete
    AFTER DELETE ON session_search BEGIN
      INSERT INTO session_search_fts(session_search_fts, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts_trigram(session_search_fts_trigram, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
    END;
  `)

  // ── Incremental migrations ──────────────────────────────────────────────
  // Use SQLite's built-in user_version pragma to track schema version.
  // Each migration runs exactly once. Add new migrations at the end with
  // the next sequential version number.
  const version = (db.pragma('user_version') as [{ user_version: number }])[0].user_version

  // Historical connector migrations (v1-v3): all operate on tables that v5
  // dropped (connector_sync_state, captures, capture_connectors,
  // captures_fts*). Guard each on the relevant table existing — fresh
  // installs (post-v5 schema) skip these without ever touching the SQL.
  if (version < 1) {
    if (tableExists(db, 'connector_sync_state')) {
      db.exec('ALTER TABLE connector_sync_state ADD COLUMN last_error_at TEXT')
    }
    db.pragma('user_version = 1')
  }

  if (version < 2) {
    if (tableExists(db, 'captures_fts')) {
      db.exec("INSERT INTO captures_fts(captures_fts) VALUES('rebuild')")
    }
    if (tableExists(db, 'captures_fts_trigram')) {
      db.exec("INSERT INTO captures_fts_trigram(captures_fts_trigram) VALUES('rebuild')")
    }
    db.pragma('user_version = 2')
  }

  if (version < 3) {
    if (tableExists(db, 'captures') && tableExists(db, 'capture_connectors')) {
      db.transaction(() => {
        db.exec(`
          INSERT OR IGNORE INTO capture_connectors (capture_id, connector_id)
          SELECT id, json_extract(metadata, '$.connectorId')
          FROM captures
          WHERE json_extract(metadata, '$.connectorId') IS NOT NULL
        `)
        db.exec(`
          UPDATE captures
          SET metadata = json_remove(metadata, '$.connectorId')
          WHERE json_extract(metadata, '$.connectorId') IS NOT NULL
        `)
        db.exec(`
          UPDATE captures
          SET source_id = (SELECT id FROM sources WHERE name = 'connector')
          WHERE id IN (SELECT capture_id FROM capture_connectors)
        `)
        db.exec(`DROP INDEX IF EXISTS idx_captures_source`)
      })()
    }
    db.pragma('user_version = 3')
  }

  if (version < 4) {
    // v4: stars table. Created with the historical wide CHECK; v5 narrows it.
    db.exec(`
      DROP TABLE IF EXISTS session_stars;
      CREATE TABLE IF NOT EXISTS stars (
        item_type  TEXT NOT NULL CHECK (item_type IN ('session', 'capture')),
        item_uuid  TEXT NOT NULL,
        starred_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_type, item_uuid)
      );
      CREATE INDEX IF NOT EXISTS idx_stars_starred_at ON stars(starred_at DESC);
    `)
    db.pragma('user_version = 4')
  }

  if (version < 5) {
    // v5: connector subsystem removed. Drop captures + connector_sync_state
    // tables, narrow stars CHECK to session-only.
    //
    // SQLite can't ALTER a CHECK constraint, so we rebuild the stars table.
    // For users who never had the wide CHECK (fresh install on post-v5
    // schema), the rebuild is a no-op rename round-trip — safe and cheap.
    // Captures data is dropped here; users were directed to Spool Daemon for
    // connector functionality. We snapshot first so the data is recoverable.
    backupBeforeDestructive(db, 4)
    db.transaction(() => {
      db.exec(`DROP TRIGGER IF EXISTS captures_fts_insert`)
      db.exec(`DROP TRIGGER IF EXISTS captures_fts_delete`)
      db.exec(`DROP TABLE IF EXISTS captures_fts_trigram`)
      db.exec(`DROP TABLE IF EXISTS captures_fts`)
      db.exec(`DROP TABLE IF EXISTS capture_connectors`)
      db.exec(`DROP TABLE IF EXISTS captures`)
      db.exec(`DROP TABLE IF EXISTS connector_sync_state`)

      db.exec(`DELETE FROM stars WHERE item_type = 'capture'`)
      db.exec(`
        CREATE TABLE stars_new (
          item_type  TEXT NOT NULL CHECK (item_type = 'session'),
          item_uuid  TEXT NOT NULL,
          starred_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (item_type, item_uuid)
        );
        INSERT INTO stars_new (item_type, item_uuid, starred_at)
          SELECT item_type, item_uuid, starred_at FROM stars;
        DROP TABLE stars;
        ALTER TABLE stars_new RENAME TO stars;
        CREATE INDEX IF NOT EXISTS idx_stars_starred_at ON stars(starred_at DESC);
      `)

      db.exec(`DELETE FROM sources WHERE name = 'connector'`)
    })()
    db.pragma('user_version = 5')
  }

  if (version < 6) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE projects ADD COLUMN identity_kind TEXT;
        ALTER TABLE projects ADD COLUMN identity_key  TEXT;
        CREATE INDEX IF NOT EXISTS idx_projects_identity
          ON projects (identity_kind, identity_key);

        CREATE VIEW IF NOT EXISTS project_groups_v AS
        SELECT
          p.identity_kind,
          p.identity_key,
          MIN(p.display_name)              AS display_name,
          GROUP_CONCAT(DISTINCT s.name)    AS sources_csv,
          COALESCE(SUM(c.session_count),0) AS session_count,
          MAX(c.last_session_at)           AS last_session_at
        FROM projects p
        JOIN sources s ON s.id = p.source_id
        LEFT JOIN (
          SELECT project_id,
                 COUNT(*)         AS session_count,
                 MAX(started_at)  AS last_session_at
          FROM sessions
          WHERE message_count > 0
          GROUP BY project_id
        ) c ON c.project_id = p.id
        WHERE p.identity_kind IS NOT NULL
        GROUP BY p.identity_kind, p.identity_key;
      `)
    })()
    db.pragma('user_version = 6')
    backfillProjectIdentities(db, realFs)
  }

  if (version < 7) {
    backupBeforeDestructive(db, 6)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE pins (
          session_uuid TEXT PRIMARY KEY,
          pinned_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_pins_pinned_at ON pins (pinned_at DESC);
        INSERT OR IGNORE INTO pins (session_uuid, pinned_at)
          SELECT item_uuid, starred_at FROM stars WHERE item_type = 'session';
        DROP TABLE stars;
      `)
    })()
    db.pragma('user_version = 7')
  }

  if (version < 8) {
    // v8: title_source column distinguishes title authority. 'derived' = parsed
    // from source JSONL (default; sync may overwrite). 'spool' = written by
    // Spool itself (e.g. agent-search session created in-app). 'user' = user
    // edited in Spool. Sync only overwrites 'derived' rows.
    if (!columnExists(db, 'sessions', 'title_source')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'derived'`)
    }
    db.pragma('user_version = 8')
  }

  // Schema sanity runs BEFORE any data migration that depends on these
  // columns. Repairs DBs where a version pragma was bumped (by experimental
  // code, a manual upgrade, or a half-finished migration) without the
  // corresponding column being added. Each check is a fast no-op when the
  // column already exists.
  ensureSchemaSanity(db)

  if (version < 9) {
    // v9: one-time data cleanup of historical agent-search sessions indexed
    // before #150-#153. Detection is gated on the Spool buildPrompt blob in
    // a user message (Spool-unique signal) so it can never sweep up real
    // coding sessions whose first message happened to be Claude Code's
    // injected <local-command-caveat>. See migrations/agent-search-cleanup.ts
    // for the full rationale.
    backupBeforeDestructive(db, 8)
    db.transaction(() => {
      runAgentSearchCleanup(db)
    })()
    db.pragma('user_version = 9')
  }

  if (version < 10) {
    // v10: re-classify path-kind projects that are stranded worktree cwds.
    // Before the worktree resolvers landed, a session synced after its
    // worktree was deleted couldn't reach the upstream git remote and was
    // bucketed as its own path-kind project. The resolver now reads the
    // worktree tool's persistent registry (e.g. ~/.superset/local.db) and
    // recovers the real identity. See migrations/worktree-identity-upgrade.ts.
    db.transaction(() => {
      upgradeWorktreeIdentities(db, realFs)
    })()
    db.pragma('user_version = 10')
  }

  if (version < 11) {
    // v11: share_drafts table — locally-persisted in-progress shares
    // managed by Spool Share's editor. Independent of the sessions index;
    // a draft can survive its source session being deleted because the
    // full snapshot is captured at compose time and stored as JSON.
    //
    // Two JSON payloads per row:
    //   - snapshot_json: the complete SpoolDocument (full conversation +
    //     opts). Used when opening the editor. Can be hundreds of KB on
    //     long sessions.
    //   - preview_json: a slim subset used by the Shares grid card —
    //     opts + title + source + word count + the first handful of
    //     turns. Kept under a few KB so listShareDrafts can SELECT it
    //     across hundreds of rows without shipping multi-MB IPC payloads
    //     to the renderer.
    db.exec(`
      CREATE TABLE IF NOT EXISTS share_drafts (
        draft_id        TEXT PRIMARY KEY,
        source_kind     TEXT NOT NULL CHECK (source_kind IN (
          'spool-session', 'pasted-url', 'imported-file', 'imported-jsonl'
        )),
        source_origin   TEXT,
        title           TEXT NOT NULL DEFAULT '',
        snapshot_json   TEXT NOT NULL,
        preview_json    TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_share_drafts_updated_at
        ON share_drafts(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_share_drafts_source_origin
        ON share_drafts(source_origin);
    `)
    db.pragma('user_version = 11')
  }

  if (version < 12) {
    // v12: Security Scan — sidecar findings + allowlists. The five
    // scan_* columns on sessions are denormalised counters
    // maintained by the scan worker; findings stores (kind,
    // value_hash, offsets) only — never the raw value. Purge mutates
    // messages.content_text and flips the row to state='purged'; the
    // row remains as an audit record. scan_purged_count is the
    // lifetime tally of purged findings per session, used by the
    // Library row's "all-resolved ✓" badge to distinguish "never
    // had findings" from "was clean after I cleaned it up".
    //
    // Wrapped in a transaction so a mid-migration failure (process
    // killed, disk full, etc.) doesn't leave the DB half-altered.
    // Without this, a partial v12 — say two ALTER TABLEs landed
    // but the third failed — would auto-commit the first two and
    // leave user_version at 11; the next launch would retry from
    // the first ALTER and trip a "duplicate column" error,
    // bricking the app on every subsequent startup.
    db.transaction(() => {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN scan_profile        TEXT;
        ALTER TABLE sessions ADD COLUMN scan_completed_at   TEXT;
        ALTER TABLE sessions ADD COLUMN scan_finding_count  INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN scan_high_count     INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN scan_purged_count   INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS findings (
          id                INTEGER PRIMARY KEY,
          session_id        INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          message_id        INTEGER REFERENCES messages(id) ON DELETE CASCADE,
          kind              TEXT NOT NULL,
          value_hash        TEXT NOT NULL,
          confidence        REAL NOT NULL,
          provider          TEXT NOT NULL,
          start_offset      INTEGER NOT NULL,
          end_offset        INTEGER NOT NULL,
          state             TEXT NOT NULL DEFAULT 'active'
                            CHECK (state IN ('active','dismissed','purged')),
          detected_at       TEXT NOT NULL DEFAULT (datetime('now')),
          state_changed_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_findings_session    ON findings(session_id);
        CREATE INDEX IF NOT EXISTS idx_findings_state      ON findings(state);
        CREATE INDEX IF NOT EXISTS idx_findings_kind_hash  ON findings(kind, value_hash);

        CREATE TABLE IF NOT EXISTS allowlist_session (
          session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          kind         TEXT NOT NULL,
          value_hash   TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, kind, value_hash)
        );

        CREATE TABLE IF NOT EXISTS allowlist_global (
          kind         TEXT NOT NULL,
          value_hash   TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (kind, value_hash)
        );
      `)
      db.pragma('user_version = 12')
    })()
  }

  if (version < 13) {
    // v13: purge subagent jsonl rows that hijacked their parent's session_uuid.
    // Claude code writes subagent transcripts to <slug>/<uuid>/subagents/agent-*.jsonl;
    // every record inside carries sessionId = parent uuid, so the indexer used to
    // upsert these on top of the parent row via UNIQUE(session_uuid) — clobbering
    // file_path and zeroing message_count (all messages are isSidechain). The
    // matching read-side fix in source-paths.ts excludes the files going forward;
    // here we delete the orphan rows so the next sync re-indexes the real parent.
    // Cascades cover messages / session_search / findings / allowlist_session;
    // pins survives (keyed by session_uuid TEXT, no FK) and re-attaches on re-sync.
    db.transaction(() => {
      const claudeSourceId = (db.prepare(
        "SELECT id FROM sources WHERE name = 'claude'"
      ).get() as { id: number } | undefined)?.id
      if (claudeSourceId !== undefined) {
        db.prepare(
          `DELETE FROM sessions
             WHERE source_id = ?
               AND file_path LIKE '%/subagents/agent-%'`
        ).run(claudeSourceId)
        db.prepare(
          `DELETE FROM sync_log
             WHERE source_id = ?
               AND file_path LIKE '%/subagents/agent-%'`
        ).run(claudeSourceId)
      }
      db.pragma('user_version = 13')
    })()
  }

  if (version < 14) {
    // v14: dedupe (session_id, msg_uuid) and add a partial UNIQUE index.
    //
    // Why: append-only sync needs INSERT OR IGNORE on (session_id,
    // msg_uuid) as the dedupe key. Today there is no UNIQUE constraint
    // and the claude source emits some records twice (tool-use shadow
    // entries — identical content, same uuid, different seq), which the
    // pre-fix DELETE+INSERT sync silently re-doubled on every re-sync.
    // Audit on a real archive showed 118 such pairs (all content-
    // identical, 94 empty tool-only + 24 with text, 0 mixed). Cascade-
    // delete on findings makes the dedupe loss-free: the redundant
    // finding rows pointed at the redundant message rows, both go.
    //
    // After dropping the redundant rows we recompute the denormalised
    // counts on the affected sessions so the Library badge and the
    // Security risk numbers don't show a half-cent of drift until the
    // next sync touches them.
    db.transaction(() => {
      const affected = db.prepare(
        `SELECT DISTINCT session_id FROM messages
          WHERE msg_uuid IS NOT NULL
          GROUP BY session_id, msg_uuid HAVING COUNT(*) > 1`,
      ).all() as Array<{ session_id: number }>

      db.prepare(
        `DELETE FROM messages
          WHERE msg_uuid IS NOT NULL
            AND id NOT IN (
              SELECT MIN(id) FROM messages
               WHERE msg_uuid IS NOT NULL
               GROUP BY session_id, msg_uuid
            )`,
      ).run()

      const recountMsg = db.prepare(
        `UPDATE sessions SET message_count = (
            SELECT COUNT(*) FROM messages
             WHERE session_id = sessions.id AND is_sidechain = 0
          ) WHERE id = ?`,
      )
      // Inline scan-count recompute mirrors security/repo.ts'
      // updateSessionCounts; the kind lists below must match
      // @spool-lab/redact's INFO_SEVERITY_KINDS / HIGH_SEVERITY_KINDS
      // at the time this migration was authored. They are inlined (not
      // imported) so the schema-migration layer can stay free of a
      // detection-vocabulary dependency — a redact-side rename must
      // never break opening a legacy DB.
      const recountScan = db.prepare(
        `UPDATE sessions SET
            scan_finding_count = (
              SELECT COUNT(*) FROM findings
               WHERE session_id = sessions.id AND state = 'active'
                 AND kind NOT IN ('absolute-path','ip','internal-host')
            ),
            scan_high_count = (
              SELECT COUNT(*) FROM findings
               WHERE session_id = sessions.id AND state = 'active'
                 AND kind IN (
                   'private-key','ssh-key','cloud-cred-ini',
                   'kubeconfig-token','netrc','connection-string',
                   'url-creds','api-key','jwt','bearer',
                   'basic-auth','env-var','generic-secret'
                 )
            ),
            scan_purged_count = (
              SELECT COUNT(*) FROM findings
               WHERE session_id = sessions.id AND state = 'purged'
            )
          WHERE id = ?`,
      )
      for (const row of affected) {
        recountMsg.run(row.session_id)
        recountScan.run(row.session_id)
      }

      // Partial index: allow NULL msg_uuid for forward-compat even
      // though no current parser ever emits NULL — we don't want the
      // schema to lock that behaviour in.
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_uuid
           ON messages(session_id, msg_uuid)
         WHERE msg_uuid IS NOT NULL`,
      )

      db.pragma('user_version = 14')
    })()
  }

  if (version < 15) {
    // v15: published_shares_cache — local mirror of /api/me/shares so the
    // Published tab in SharesPage renders instantly on cold start and
    // remains readable when the user is offline. This is NOT the source
    // of truth — the canonical published index lives in the share backend's
    // D1. Rows are upserted whenever myShares() succeeds; entries that
    // disappear from the remote response are cleared via clearAll +
    // upsertMany on each successful fetch.
    //
    // `draft_id` mirrors the same column on the backend's published_shares
    // and is the link from a share back to its editable source in
    // share_drafts. The Share popover queries this index to decide
    // between the publish form and the manage view when an editor mounts
    // for a given draft. Nullable only to accommodate pre-v0.5.0 rows
    // published before the column existed; every new publish writes a
    // non-null value.
    // `client_request_id` mirrors the backend's `published_shares
    // .client_request_id` — the content hash that drove the publish.
    // The editor recomputes the same hash on the live draft and
    // compares; a mismatch surfaces the "Unpublished edits" badge in
    // the manage view so the user knows their next Republish click
    // will actually change something on spool.pro.
    db.exec(`
      CREATE TABLE IF NOT EXISTS published_shares_cache (
        id                 TEXT PRIMARY KEY,
        title              TEXT NOT NULL DEFAULT '',
        visibility         TEXT NOT NULL,
        version            INTEGER NOT NULL DEFAULT 1,
        published_at       INTEGER NOT NULL,
        revoked_at         INTEGER,
        draft_id           TEXT,
        client_request_id  TEXT,
        updated_at         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_published_shares_cache_published_at
        ON published_shares_cache(published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_published_shares_cache_draft_id
        ON published_shares_cache(draft_id) WHERE draft_id IS NOT NULL;
    `)
    db.pragma('user_version = 15')
  }

  rebuildFtsTableIfEmpty(db, 'messages', 'messages_fts_trigram')
  rebuildFtsTableIfEmpty(db, 'session_search', 'session_search_fts')
  rebuildFtsTableIfEmpty(db, 'session_search', 'session_search_fts_trigram')

  recreateProjectGroupsView(db)
}

/**
 * project_groups_v is the single definition of cross-source project grouping
 * (consumed by projects/groups.ts). It holds no data, so instead of being
 * frozen at its migration-time definition (v6) it is dropped and recreated on
 * every launch — old and new installs always run the definition below.
 *
 * The path/cwd aggregates use JSON_GROUP_ARRAY rather than GROUP_CONCAT so
 * paths containing commas survive round-tripping (e.g. "/Users/me/foo,bar").
 */
function recreateProjectGroupsView(db: Database.Database): void {
  db.exec(`
    DROP VIEW IF EXISTS project_groups_v;
    CREATE VIEW project_groups_v AS
    SELECT
      p.identity_kind,
      p.identity_key,
      MIN(p.display_name)             AS display_name,
      GROUP_CONCAT(DISTINCT src.name) AS sources_csv,
      JSON_GROUP_ARRAY(DISTINCT p.display_path) FILTER (WHERE p.display_path IS NOT NULL AND p.display_path <> '') AS display_paths_json,
      JSON_GROUP_ARRAY(DISTINCT s.cwd)          FILTER (WHERE s.cwd IS NOT NULL AND s.cwd <> '')                   AS cwds_json,
      COUNT(s.id)                     AS session_count,
      MAX(s.started_at)               AS last_session_at
    FROM projects p
    JOIN sources src ON src.id = p.source_id
    LEFT JOIN sessions s ON s.project_id = p.id AND s.message_count > 0
    WHERE p.identity_kind IS NOT NULL
    GROUP BY p.identity_kind, p.identity_key;
  `)
}

export function backfillProjectIdentities(db: Database.Database, fs: IdentityFs) {
  const rows = db.prepare(
    `SELECT id, display_path FROM projects WHERE identity_kind IS NULL`
  ).all() as { id: number; display_path: string }[]
  if (rows.length === 0) return
  const update = db.prepare(
    `UPDATE projects
     SET identity_kind = ?, identity_key = ?, display_name = COALESCE(?, display_name)
     WHERE id = ?`,
  )
  db.transaction(() => {
    for (const r of rows) {
      const id = computeIdentity(r.display_path, fs)
      update.run(id.kind, id.key, id.displayName, r.id)
    }
  })()
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type IN ('table','virtual') AND name = ?`,
  ).get(name) as { name: string } | undefined
  return row !== undefined
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some(r => r.name === column)
}

function ensureSchemaSanity(db: Database.Database): void {
  // Backfill columns the head schema requires but historical DBs (or test
  // fixtures that seed an intentionally-minimal table) may be missing.
  // Each ALTER is a fast no-op when the column already exists.
  const ensureCol = (table: string, col: string, ddl: string): void => {
    if (!columnExists(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
  }
  ensureCol('sessions', 'title', 'TEXT')
  ensureCol('sessions', 'title_source', `TEXT NOT NULL DEFAULT 'derived'`)
  ensureCol('sessions', 'message_count', 'INTEGER NOT NULL DEFAULT 0')
  // v14 (and forward) reads messages.msg_uuid; legacy DBs predating
  // its introduction (some test fixtures, very old installs) won't have
  // the column. ALTER ADD is a no-op when present.
  ensureCol('messages', 'msg_uuid', 'TEXT')
}

/**
 * Snapshot the DB to `<dbDir>/backups/spool-pre-v{fromVersion+1}-<ts>.db`
 * via VACUUM INTO, before a destructive migration runs.
 *
 * Returns the backup file path on success, or null when a backup is skipped:
 *   - in-memory DBs (db.memory)
 *   - fresh-install / no-data DBs (sessions table empty or missing)
 *
 * Each call writes to a distinct path; v5 and v7 produce separate files.
 */
export function backupBeforeDestructive(
  db: Database.Database,
  fromVersion: number,
): string | null {
  if (db.memory) return null
  const dbPath = db.name
  if (!dbPath) return null
  if (!tableExists(db, 'sessions')) return null

  const sessions = db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number }
  if (sessions.c === 0) return null

  const backupDir = join(dirname(dbPath), 'backups')
  mkdirSync(backupDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDir, `spool-pre-v${fromVersion + 1}-${ts}.db`)
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
  return backupPath
}

function rebuildFtsTableIfEmpty(
  db: Database.Database,
  contentTable: 'messages' | 'session_search',
  ftsTable:
    | 'messages_fts_trigram'
    | 'session_search_fts'
    | 'session_search_fts_trigram',
): void {
  const sourceCount = (db.prepare(`SELECT COUNT(*) AS count FROM ${contentTable}`).get() as { count: number }).count
  if (sourceCount === 0) return

  const indexCount = (db.prepare(`SELECT COUNT(*) AS count FROM ${ftsTable}`).get() as { count: number }).count
  if (indexCount > 0) return

  db.exec(`INSERT INTO ${ftsTable}(${ftsTable}) VALUES('rebuild')`)
}
