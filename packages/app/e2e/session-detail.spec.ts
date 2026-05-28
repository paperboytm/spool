import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

const LARGE_FIXTURE = join(
  __dirname,
  'fixtures/claude-projects/test-project/test-session-large.jsonl',
)
const LARGE_SESSION_UUID = 'large-session-uuid-001'

function generateLargeFixture() {
  if (existsSync(LARGE_FIXTURE)) return
  mkdirSync(dirname(LARGE_FIXTURE), { recursive: true })
  const lines: string[] = []
  let prevUuid: string | null = null
  for (let i = 0; i < 1500; i += 1) {
    const role = i % 2 === 0 ? 'user' : 'assistant'
    const uuid = `large-msg-${i.toString().padStart(4, '0')}`
    const timestamp = new Date(Date.UTC(2026, 0, 20, 10, 0, i)).toISOString()
    const text = i === 1490 ? `Marker line: SPOOLDEEPMARKER token ${i}` : `Message ${i}`
    const obj: Record<string, unknown> = {
      type: role,
      uuid,
      timestamp,
      message:
        role === 'user'
          ? { role, content: text }
          : { role, model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text }] },
    }
    if (i === 0) {
      obj['sessionId'] = LARGE_SESSION_UUID
      obj['cwd'] = '/tmp/test-project'
    }
    if (prevUuid != null) {
      obj['parentUuid'] = prevUuid
    }
    lines.push(JSON.stringify(obj))
    prevUuid = uuid
  }
  writeFileSync(LARGE_FIXTURE, lines.join('\n') + '\n')
}

generateLargeFixture()

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('session detail shows Pin, action menu (Copy ID + Copy command), Resume', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  await expect(window.locator('[data-testid="pin-button"]')).toBeVisible()
  await expect(window.locator('[data-testid="detail-resume"]')).toBeVisible()

  await window.locator('[data-testid="detail-actions-menu"] button').first().click()
  await expect(window.getByRole('menuitem', { name: 'Copy session ID' })).toBeVisible()
  await expect(window.getByRole('menuitem', { name: /Copy resume command/ })).toBeVisible()
})

test('pinning from session detail persists', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  const pinButton = window.locator('[data-testid="session-detail"] [data-testid="pin-button"]')
  const initialState = await pinButton.getAttribute('data-pinned')
  await pinButton.click()
  await expect(pinButton).toHaveAttribute('data-pinned', initialState === '1' ? '0' : '1', { timeout: 2000 })
})

test('renders markdown: bold, headings, code blocks', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator('[data-testid="session-row"][data-session-uuid="test-session-uuid-001"]')
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  const detail = window.locator('[data-testid="session-detail"]')

  await expect(detail.locator('strong', { hasText: 'XYZMARKDOWN' })).toBeVisible()
  await expect(detail.getByText('**XYZMARKDOWN**')).toHaveCount(0)

  await expect(detail.locator('h1', { hasText: 'Heading line' })).toBeVisible()

  await expect(detail.locator('pre code').first()).toBeVisible()
})

test('find-in-page matches rendered text, not markdown source', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator('[data-testid="session-row"][data-session-uuid="test-session-uuid-001"]')
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  const isMac = process.platform === 'darwin'
  await window.keyboard.press(isMac ? 'Meta+f' : 'Control+f')

  await window.locator('[data-testid="session-find-input"]').fill('XYZMARKDOWN')
  await expect(window.locator('[data-testid="session-find-status"]')).toContainText(/^\d+ of \d+$/)
  await expect(window.locator('[data-testid="session-find-active-match"]')).toHaveCount(1)

  await window.locator('[data-testid="session-find-input"]').fill('**XYZMARKDOWN**')
  await expect(window.locator('[data-testid="session-find-status"]')).toContainText('No matches')
})

test('shows replay timeline from session detail', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator('[data-testid="session-row"][data-session-uuid="test-session-uuid-001"]')
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  await window.locator('[data-testid="session-panel-replay"]').click()
  await expect(window.locator('[data-testid="session-replay-view"]')).toBeVisible()
  const firstReplayNode = window.locator('[data-testid="session-replay-node"]').first()
  await expect(firstReplayNode).toBeVisible()
  await firstReplayNode.getByRole('button').click()
  await expect(firstReplayNode.locator('[data-testid="session-replay-node-detail"]')).toBeVisible()

  await window.locator('[data-testid="session-panel-messages"]').click()
  await expect(window.locator('[data-testid="message-list-scroll"]')).toBeVisible()
})

test('handles 1500-message session: virtualization + deep find', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()

  await window
    .locator(`[data-testid="session-row"][data-session-uuid="${LARGE_SESSION_UUID}"]`)
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 10000 })

  // Expected steady state: viewport-visible (~5-9) + overscan 6 each side ≈ 17-21.
  // 40 catches regressions (any leak past ~2x overscan) while riding out
  // macOS CI runners that occasionally land at 36 due to slower culling.
  // Polled to absorb the post-mount transient.
  await expect
    .poll(
      async () =>
        window.locator('[data-testid="message-list-scroll"] [data-index]').count(),
      { timeout: 3000 },
    )
    .toBeLessThan(40)

  const isMac = process.platform === 'darwin'
  await window.keyboard.press(isMac ? 'Meta+f' : 'Control+f')
  await window.locator('[data-testid="session-find-input"]').fill('SPOOLDEEPMARKER')
  await expect(window.locator('[data-testid="session-find-status"]')).toContainText('1 of 1', {
    timeout: 5000,
  })
  await expect(window.locator('[data-testid="session-find-active-match"]')).toHaveCount(1)
})
