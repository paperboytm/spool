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

test('custom session scrollbar thumb follows pointer while dragging long sessions', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator(`[data-testid="session-row"][data-session-uuid="${LARGE_SESSION_UUID}"]`)
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 10000 })

  const scroller = window.locator('[data-testid="message-list-scroll"]')
  const thumb = window.locator('[data-testid="message-scrollbar-thumb"]')
  await expect
    .poll(
      async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight),
      { timeout: 3000 },
    )
    .toBeGreaterThan(0)
  await expect(thumb).toBeVisible()

  const before = await scroller.evaluate((el) => ({
    scrollTop: el.scrollTop,
    maxScrollTop: el.scrollHeight - el.clientHeight,
  }))
  expect(before.maxScrollTop).toBeGreaterThan(0)

  const thumbBox = await thumb.boundingBox()
  if (!thumbBox) throw new Error('missing scrollbar thumb box')
  const trackBox = await window.locator('[data-testid="message-scrollbar-track"]').boundingBox()
  if (!trackBox) throw new Error('missing scrollbar track box')

  const startX = thumbBox.x + thumbBox.width / 2
  const startY = thumbBox.y + thumbBox.height / 2
  const targetY = Math.min(trackBox.y + trackBox.height - thumbBox.height / 2 - 8, startY + 120)

  await window.mouse.move(startX, startY)
  await window.mouse.down()
  await window.mouse.move(startX, targetY, { steps: 12 })

  await expect
    .poll(async () => {
      const draggingThumbBox = await thumb.boundingBox()
      if (!draggingThumbBox) return Number.POSITIVE_INFINITY
      const draggingThumbCenter = draggingThumbBox.y + draggingThumbBox.height / 2
      return Math.abs(draggingThumbCenter - targetY)
    })
    .toBeLessThan(16)

  await window.mouse.up()

  const after = await scroller.evaluate((el) => el.scrollTop)
  expect(after).toBeGreaterThan(before.scrollTop)
})

test('clicking the scrollbar track jumps the message list to that position', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator(`[data-testid="session-row"][data-session-uuid="${LARGE_SESSION_UUID}"]`)
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 10000 })

  const scroller = window.locator('[data-testid="message-list-scroll"]')
  const track = window.locator('[data-testid="message-scrollbar-track"]')
  await expect
    .poll(
      async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight),
      { timeout: 3000 },
    )
    .toBeGreaterThan(0)
  await expect(track).toBeVisible()

  const before = await scroller.evaluate((el) => el.scrollTop)

  const trackBox = await track.boundingBox()
  if (!trackBox) throw new Error('missing scrollbar track box')

  await window.mouse.click(
    trackBox.x + trackBox.width / 2,
    trackBox.y + trackBox.height * 0.75,
  )

  await expect
    .poll(async () => scroller.evaluate((el) => el.scrollTop), { timeout: 3000 })
    .toBeGreaterThan(before + 200)
})

test('dragging the scrollbar thumb to the bottom reaches the actual list end', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator(`[data-testid="session-row"][data-session-uuid="${LARGE_SESSION_UUID}"]`)
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 10000 })

  const scroller = window.locator('[data-testid="message-list-scroll"]')
  const thumb = window.locator('[data-testid="message-scrollbar-thumb"]')
  await expect
    .poll(
      async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight),
      { timeout: 3000 },
    )
    .toBeGreaterThan(0)
  await expect(thumb).toBeVisible()

  const thumbBox = await thumb.boundingBox()
  if (!thumbBox) throw new Error('missing scrollbar thumb box')
  const trackBox = await window.locator('[data-testid="message-scrollbar-track"]').boundingBox()
  if (!trackBox) throw new Error('missing scrollbar track box')

  const startX = thumbBox.x + thumbBox.width / 2
  const startY = thumbBox.y + thumbBox.height / 2
  const bottomY = trackBox.y + trackBox.height - 2

  await window.mouse.move(startX, startY)
  await window.mouse.down()
  await window.mouse.move(startX, bottomY, { steps: 30 })
  await window.mouse.up()

  // The bug being regressed: pixel-ratio scrollTop math couldn't reach the
  // true bottom because Virtuoso's scrollHeight estimate (1500 × 64) is
  // smaller than the real measured total once markdown rows expand. With
  // scrollToIndex(rowCount - 1), the scroller must land at the true max.
  await expect
    .poll(
      async () =>
        scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
      { timeout: 5000 },
    )
    .toBeLessThan(16)
})
