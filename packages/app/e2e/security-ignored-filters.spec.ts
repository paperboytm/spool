import { test, expect, type Page } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Exercises the "Ignored items" modal toolbar end-to-end: the scope
// dropdown, the type dropdown, the free-text filter, and the
// "Stop ignoring" row action. The modal is a flat recency list, so each
// of these has to actually narrow / mutate the rendered rows.
//
// Setup seeds one session carrying two distinct, high-confidence
// findings (an AWS key + an email), then ignores the key everywhere and
// the email in this session — giving us two rows that differ by both
// scope and kind so every filter is observable.

const FAKE_AKIA = 'AKIA' + 'IGNOREDFILTER01Z'
const FAKE_EMAIL = 'leaked.person@ignored-filter.test'
const SID = 'ignored-filter-session'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      // Give the session a clean custom title so it does NOT echo the
      // secrets — otherwise the title (which falls back to first-message
      // text) would itself match the value text filter.
      writeFileSync(join(claudeDir, 'test-project', 'ignored-filter.jsonl'), [
        JSON.stringify({ type: 'custom-title', sessionId: SID, cwd: '/tmp/test-project', customTitle: 'Credentials review' }),
        JSON.stringify({ type: 'user', sessionId: SID, cwd: '/tmp/test-project', uuid: 'if-1', timestamp: '2026-05-21T10:00:00Z', message: { role: 'user', content: `key ${FAKE_AKIA} and contact ${FAKE_EMAIL}` } }),
        JSON.stringify({ type: 'assistant', uuid: 'if-2', timestamp: '2026-05-21T10:00:05Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'noted' } }),
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

test('Ignored items modal: scope / type / text filters narrow the list and Stop ignoring removes a row', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  // Ignore the api-key everywhere and the email in this session.
  await window.evaluate(async () => {
    const api = (globalThis as { spool?: { security?: {
      listFindings: (f: unknown) => Promise<Array<{ id: number; kind: string }>>
      dismissFinding: (id: number, scope: string) => Promise<unknown>
    } } }).spool
    const rows = await api!.security!.listFindings({ state: 'active' })
    const key = rows.find((r) => r.kind === 'api-key')
    const email = rows.find((r) => r.kind === 'email')
    if (key) await api!.security!.dismissFinding(key.id, 'global')
    if (email) await api!.security!.dismissFinding(email.id, 'session')
  })

  // Open the modal from the Security page entry.
  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()
  const entry = window.locator('[data-testid="security-ignored-open"]')
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await entry.click()

  const modal = window.locator('[data-testid="ignored-manage"]')
  await expect(modal).toBeVisible()
  const rows = modal.locator('[data-testid="ignored-row"]')
  await expect(rows).toHaveCount(2)

  // --- Scope filter: "Everywhere" leaves only the global api-key row.
  // (Scope labels are i18n'd; the e2e harness runs in English.)
  await modal.locator('[data-testid="ignored-scope-filter"]').click()
  await window.getByRole('menuitem', { name: 'Everywhere' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first().locator('[data-testid="ignored-value"]')).toContainText('AKIA')

  // Reset scope back to all.
  await modal.locator('[data-testid="ignored-scope-filter"]').click()
  await window.getByRole('menuitem', { name: 'All scopes' }).click()
  await expect(rows).toHaveCount(2)

  // --- Type filter: pick the Email kind → only the email row.
  // (Kind labels come from SENSITIVE_KIND_LABEL and are always English.)
  await modal.locator('[data-testid="ignored-kind-filter"]').click()
  await window.getByRole('menuitem', { name: 'Email', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first().locator('[data-testid="ignored-value"]')).toContainText('@ignored-filter.test')

  // Reset type back to all.
  await modal.locator('[data-testid="ignored-kind-filter"]').click()
  await window.getByRole('menuitem', { name: 'All types' }).click()
  await expect(rows).toHaveCount(2)

  // --- Text filter: "AKIA" leaves only the key row.
  const textFilter = modal.locator('[data-testid="ignored-filter"]')
  await textFilter.click()
  await textFilter.fill('AKIA')
  await expect(textFilter).toHaveValue('AKIA')
  await expect(rows).toHaveCount(1)
  await expect(rows.first().locator('[data-testid="ignored-value"]')).toContainText('AKIA')
  await textFilter.fill('')
  await expect(rows).toHaveCount(2)

  // --- Stop ignoring: click-twice in-place confirm removes the row.
  const firstRow = rows.first()
  await firstRow.hover()
  const stopBtn = firstRow.locator('[data-testid="stop-ignoring-button"]')
  await stopBtn.click() // arms the confirm
  await stopBtn.click() // confirms
  await expect(rows).toHaveCount(1)
})
