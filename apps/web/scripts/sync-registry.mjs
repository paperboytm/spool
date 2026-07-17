#!/usr/bin/env node
// Fetches the connector registry from spool-daemon's main branch and writes it
// to data/registry.json. Source of truth lives in spool-lab/spool-daemon —
// this keeps the SSG-baked copy fresh on every build. Falls back silently to
// the committed file on network failure so offline dev / CI hiccups don't
// break the build.

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const URL =
  "https://raw.githubusercontent.com/spool-lab/spool-daemon/main/registry/registry.json";
const TIMEOUT_MS = 5000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, "..", "data", "registry.json");

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

try {
  const res = await fetch(URL, { signal: ctrl.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.connectors)) {
    throw new Error("unexpected shape: missing connectors[]");
  }

  const existing = (() => {
    try {
      return readFileSync(TARGET, "utf-8");
    } catch {
      return null;
    }
  })();

  // Re-serialize with stable 2-space indent + trailing newline so the file
  // matches whatever upstream ships, not whatever fetch() returned raw.
  const next = JSON.stringify(data, null, 2) + "\n";

  if (existing === next) {
    console.log(`[sync-registry] up to date (${data.connectors.length} connectors)`);
  } else {
    writeFileSync(TARGET, next);
    console.log(
      `[sync-registry] updated → ${data.connectors.length} connectors`,
    );
  }
} catch (err) {
  console.warn(
    `[sync-registry] fetch failed (${err.message}); using committed copy`,
  );
} finally {
  clearTimeout(timer);
}
