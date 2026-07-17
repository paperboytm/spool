import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, restartApp, waitForSync, type AppContext } from './helpers/launch'

test('historical Orca and Codex worktrees collapse into one sidebar project after restart', async () => {
  test.setTimeout(45_000)

  const testHome = mkdtempSync(join(tmpdir(), 'spool-worktree-grouping-home-'))
  const repoPath = join(testHome, 'work', 'paperboy')
  mkdirSync(repoPath, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync(
    'git',
    ['remote', 'add', 'origin', 'git@github.com:paperboytm/paperboy.git'],
    { cwd: repoPath, stdio: 'ignore' },
  )

  let ctx: AppContext | null = null
  try {
    const stalePaperboyCwds = [
      join(testHome, '.codex', 'worktrees', '42fa', 'paperboy'),
      join(testHome, '.codex', 'worktrees', '1da1', 'paperboy'),
    ]
    const staleImCwds = [
      join(testHome, 'work', 'im'),
      join(testHome, '.codex', 'worktrees', '6ae2', 'im'),
    ]

    // First launch has no Orca registry. Both already-deleted worktrees must
    // therefore reproduce the historical bad state: two path identities and
    // two visually duplicated "paperboy" rows in the sidebar.
    ctx = await launchApp({
      extraEnv: { HOME: testHome },
      extraFixtures: ({ codexDir }) => {
        const sessionDir = join(codexDir, '2026', '07', '17')
        mkdirSync(sessionDir, { recursive: true })
        const writeSession = (cwd: string, index: number, repositoryUrl?: string) => {
          const uuid = `10000000-0000-4000-8000-00000000000${index}`
          const lines = [
            {
              timestamp: `2026-07-17T10:0${index}:00Z`,
              type: 'session_meta',
              payload: {
                id: uuid,
                cwd,
                ...(repositoryUrl ? { git: { repository_url: repositoryUrl } } : {}),
              },
            },
            { timestamp: `2026-07-17T10:0${index}:01Z`, type: 'event_msg', payload: { type: 'user_message', message: `worktree ${index}` } },
            { timestamp: `2026-07-17T10:0${index}:02Z`, type: 'event_msg', payload: { type: 'agent_message', message: 'done' } },
          ]
          writeFileSync(
            join(sessionDir, `rollout-2026-07-17T10-0${index}-00-${uuid}.jsonl`),
            lines.map(line => JSON.stringify(line)).join('\n') + '\n',
          )
        }
        stalePaperboyCwds.forEach((cwd, index) => writeSession(cwd, index))
        staleImCwds.forEach((cwd, index) => {
          writeSession(cwd, index + 2, 'git@github.com:paperboytm/im.git')
        })
      },
    })

    await waitForSync(ctx.window)
    // Codex records repository_url in session_meta. That durable source hint
    // must group a deleted main checkout and deleted worktree immediately,
    // even before any external worktree registry exists.
    const sourceHintRows = ctx.window
      .locator('[data-testid="sidebar-project-row"]')
      .filter({ hasText: /^im/ })
    await expect(sourceHintRows).toHaveCount(1)
    await expect(sourceHintRows).toHaveAttribute('data-identity-key', 'github.com/paperboytm/im')

    const duplicatedRows = ctx.window
      .locator('[data-testid="sidebar-project-row"]')
      .filter({ hasText: 'paperboy' })
    await expect(duplicatedRows).toHaveCount(2)

    // Orca is installed/configured later and supplies the durable mapping from
    // deleted worktree paths to the live main repository. Restarting Spool is
    // the production path that reopens the DB and reconciles old path rows.
    const orcaDir = join(testHome, 'Library', 'Application Support', 'orca')
    mkdirSync(orcaDir, { recursive: true })
    writeFileSync(join(orcaDir, 'orca-data.json'), JSON.stringify({
      repos: [{ id: 'repo-paperboy', path: repoPath, displayName: 'paperboy' }],
      worktreeMeta: {},
    }))

    ctx = await restartApp(ctx)
    await waitForSync(ctx.window)

    const groupedRows = ctx.window
      .locator('[data-testid="sidebar-project-row"]')
      .filter({ hasText: 'paperboy' })
    await expect(groupedRows).toHaveCount(1)
    await expect(groupedRows).toHaveAttribute('data-identity-key', 'github.com/paperboytm/paperboy')
  } finally {
    await ctx?.cleanup()
    rmSync(testHome, { recursive: true, force: true })
  }
})
