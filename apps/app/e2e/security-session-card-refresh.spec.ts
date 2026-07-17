import { test, expect, type Page } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression: SessionCard inside SecurityPage must refetch its
// findings list when EVT_FINDINGS_CHANGED arrives for this session
// (background rescan after a profile version bump, a programmatic
// dismiss, an allowlist toggle, …). Pre-fix the card mounted, loaded
// its findings once, and never resubscribed — the parent SecurityPage
// refreshed its session-level aggregates but the card's `findings`
// state stayed pinned to the initial fetch until the user navigated
// away and back.
//
// security-mute-refresh.spec.ts covers the parent-page refresh path;
// this file is specifically about the card's inner row list.

const FAKE_AKIA = 'AKIA' + 'V3QFKW72ZDLNP4XR'
const SID = 'card-refresh-session'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      // Two findings, different kinds, so dismissing one leaves the
      // session present on the page (with the other finding still
      // active). If both findings shared a kind the parent's
      // listSessionsWithFindings filter could unmount the card and
      // confound the test.
      const file = join(claudeDir, 'test-project', 'card-refresh.jsonl')
      writeFileSync(file, [
        JSON.stringify({
          type: 'user',
          sessionId: SID,
          cwd: '/tmp/test-project',
          uuid: 'cr-1',
          timestamp: '2026-05-22T10:00:00Z',
          message: { role: 'user', content: `rotate ${FAKE_AKIA} and email dev@fly.io` },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'cr-2',
          timestamp: '2026-05-22T10:00:05Z',
          message: { role: 'assistant', model: 'claude-sonnet-4', content: 'ok' },
        }),
      ].join('\n'))
    },
  })
})

test.afterAll(async () => { await ctx?.cleanup() })

async function waitForWorkerIdle(window: Page): Promise<void> {
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { getScanStatus: () => Promise<{ queued: number; scanning: number | null; backfillRemaining: number }> } } }).spool
    if (!api?.security) return false
    const s = await api.security.getScanStatus()
    return s.queued === 0 && s.scanning === null && s.backfillRemaining === 0
  }, { timeout: 30_000, polling: 250 })
}

test('SessionCard refetches findings when EVT_FINDINGS_CHANGED arrives for this session', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  const card = window.locator(`[data-testid="security-session-row"][data-session-uuid="${SID}"]`)
  await expect(card).toBeVisible({ timeout: 10_000 })

  // Baseline: card should render both findings (api-key + email).
  const rows = card.locator('[data-testid="finding-row"]')
  await expect(rows).toHaveCount(2)

  // Dismiss the email via IPC. This publishes EVT_FINDINGS_CHANGED
  // with `{ sessionId }`. The card's new subscription is the only
  // thing that turns the IPC event into a reload — without it the
  // row stays put forever.
  await window.evaluate(async (sid: string) => {
    const api = (globalThis as { spool: {
      security: {
        listFindings: (f: { sessionId?: number; state?: string; limit?: number }) => Promise<Array<{ id: number; kind: string }>>
        dismissFinding: (id: number, scope: 'session' | 'global') => Promise<void>
      }
      listSessions: () => Promise<{ sessions: Array<{ id: number; sessionUuid: string }> }>
    } }).spool
    const page = await api.listSessions()
    const sessionId = page.sessions.find((s) => s.sessionUuid === sid)?.id
    if (sessionId === undefined) throw new Error(`session ${sid} not synced`)
    const findings = await api.security.listFindings({ sessionId, state: 'active', limit: 10 })
    const email = findings.find((f) => f.kind === 'email')
    if (!email) throw new Error('expected an active email finding')
    await api.security.dismissFinding(email.id, 'session')
  }, SID)

  // Without any navigation: row count drops from 2 to 1 within the
  // subscribe debounce window (300ms) plus refetch latency. Pre-fix
  // this never resolves and the test times out.
  await expect(rows).toHaveCount(1, { timeout: 5_000 })
})
