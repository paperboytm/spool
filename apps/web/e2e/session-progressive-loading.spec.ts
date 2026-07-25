import { expect, test, type Page, type TestInfo } from '@playwright/test'

const SID = 'codex_00000000-0000-7000-8000-000000000001'
const TOTAL_RECORDS = 2_726
const VIEWER = {
  id: 'user-test-reader',
  email: 'reader@example.test',
  name: 'Test Reader',
  display_name: 'Test Reader',
  display_name_override: null,
  avatar_url: null,
  custom_avatar_id: null,
  avatar_visible: true,
  handle: 'test-reader',
  deletion_pending_until: null,
}

function record(index: number) {
  const payload =
    index % 100 === 0
      ? {
          type: index % 200 === 0 ? 'user_message' : 'agent_message',
          message: `Checkpoint ${index}`,
        }
      : { type: 'token_count', info: null }
  return {
    i: index,
    oid: `oid-${index}`,
    data: JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(Date.UTC(2026, 6, 24, 8, 0, index)).toISOString(),
      payload,
    }),
  }
}

async function installSessionApi(
  page: Page,
  {
    authenticated = true,
    failFirstStarMutation = false,
  }: { authenticated?: boolean; failFirstStarMutation?: boolean } = {},
) {
  const recordRequests: Array<{ from: number; to: number }> = []
  let starCount = 17
  let viewerStarred = false
  let failNextStarMutation = failFirstStarMutation

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const sessionBase = `/api/hub/v1/sessions/${SID}`

    if (url.pathname === `/api/discovery/v1/sessions/${SID}/social`) {
      const method = route.request().method()
      if (method !== 'GET' && !authenticated) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
        return
      }
      if (method !== 'GET' && failNextStarMutation) {
        failNextStarMutation = false
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        return
      }
      if (method === 'PUT' && !viewerStarred) {
        viewerStarred = true
        starCount += 1
      } else if (method === 'DELETE' && viewerStarred) {
        viewerStarred = false
        starCount -= 1
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          starCount,
          forkCount: 4,
          viewerStarred,
          canStar: authenticated,
        }),
      })
      return
    }

    if (url.pathname === `${sessionBase}/records`) {
      const from = Number(url.searchParams.get('from'))
      const to = Number(url.searchParams.get('to'))
      recordRequests.push({ from, to })
      // Keep each response visible long enough for React and the accessibility
      // tree to expose monotonic progress, as a real network would.
      // Hold the second response briefly so the first completed 100-record
      // page is observable instead of being a one-frame test artifact.
      await new Promise((resolve) => setTimeout(resolve, from === 100 ? 250 : 30))
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body:
          Array.from({ length: to - from }, (_, offset) =>
            JSON.stringify(record(from + offset)),
          ).join('\n') + '\n',
      })
      return
    }

    if (url.pathname === `${sessionBase}/view`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          v: 1,
          index: [],
          files: [
            {
              path: 'apps/web/src/pages/session-reader.tsx',
              events: [120],
              adds: 82,
              dels: 31,
            },
          ],
          outline: [],
          firstPrompt: 'Make long Session reading start immediately',
          lastReply: 'Implemented progressive loading.',
          diffstat: { files: 1, adds: 82, dels: 31 },
        }),
      })
      return
    }

    if (url.pathname === sessionBase) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sid: SID,
          root: 'root',
          count: TOTAL_RECORDS,
          sig: null,
          summaryMd:
            '---\ntitle: Make long Session reading start immediately\ntitle_zh: 让长 Session 立即可读\n---\n\n## Outcome\nThe Summary is readable before the full source history is requested.',
          cardJson: JSON.stringify({
            remotes: ['origin: git@github.com:paperboytm/spool.git'],
            branch: 'main',
            head: 'abc123',
            dirty: [],
            observed: '2026-07-24T08:00:00.000Z',
          }),
          lineageJson: null,
          viewOid: 'view-oid',
          spoolFileOid: null,
          createdAt: Date.UTC(2026, 6, 24, 8),
          updatedAt: Date.UTC(2026, 6, 24, 9),
          visibility: 'public',
          author: { handle: 'test-reader', displayName: 'Test Reader', avatarUrl: null },
        }),
      })
      return
    }

    if (url.pathname === '/api/me') {
      await route.fulfill({
        status: authenticated ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(authenticated ? VIEWER : {}),
      })
      return
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{}',
    })
  })

  return recordRequests
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true)
}

test('renders Summary first, then loads 2,726 records in visible bounded pages', async ({
  page,
}, testInfo: TestInfo) => {
  const recordRequests = await installSessionApi(page, { failFirstStarMutation: true })
  await page.goto(`/session/${SID}`)

  await expect(
    page.getByRole('heading', { name: 'Make long Session reading start immediately' }),
  ).toBeVisible()
  await expect(
    page.getByText('The Summary is readable before the full source history is requested.'),
  ).toBeVisible()
  await expect(page.getByTestId('session-history-idle')).toBeVisible()
  await expect(page.getByText('Load 2,726 source records')).toBeVisible()
  await expect(page.getByText('2,726 records', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Star' })).toBeVisible()
  await expect(page.getByLabel('17 stars')).toBeVisible()
  await expect(page.getByLabel('4 published forks')).toBeVisible()
  expect((await page.getByTestId('session-history-idle').boundingBox())?.width).toBeGreaterThan(500)
  expect(recordRequests).toEqual([])

  await page.screenshot({ path: testInfo.outputPath('summary-first.png'), fullPage: true })

  await page.getByRole('button', { name: 'Star' }).click()
  await expect(page.getByText('Couldn’t update Star.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByLabel('17 stars')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('star-error-retry.png'), fullPage: true })
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('button', { name: 'Starred' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('18 stars')).toBeVisible()
  await page.getByRole('button', { name: 'Starred' }).click()
  await expect(page.getByRole('button', { name: 'Star' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('17 stars')).toBeVisible()

  await page.evaluate(() => {
    const values: number[] = []
    Object.assign(window, { __sessionProgressValues: values })
    const read = () => {
      const progress = document.querySelector('[role="progressbar"]')
      if (!progress) return
      const value = Number(progress.getAttribute('aria-valuenow'))
      if (Number.isFinite(value) && values.at(-1) !== value) values.push(value)
    }
    new MutationObserver(read).observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['aria-valuenow'],
    })
    read()
  })

  await page.getByRole('button', { name: 'Load full session' }).click()
  await expect(page.getByRole('progressbar', { name: 'Session records loaded' })).toBeVisible()
  await expect(page.getByTestId('session-history-loading').getByText('100 / 2,726')).toBeVisible()
  await expect(page.getByTestId('virtuoso-item-list').getByText('Checkpoint 0')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('records-progress.png'), fullPage: true })
  await expect(page.getByTestId('session-history-loading')).toBeHidden({ timeout: 20_000 })

  expect(recordRequests).toHaveLength(28)
  expect(recordRequests[0]).toEqual({ from: 0, to: 100 })
  expect(recordRequests.at(-1)).toEqual({ from: 2_700, to: 2_726 })
  expect(recordRequests.every(({ from, to }) => to - from <= 100)).toBe(true)

  const progressValues = await page.evaluate(
    () => (window as typeof window & { __sessionProgressValues: number[] }).__sessionProgressValues,
  )
  expect(progressValues.length).toBeGreaterThan(10)
  expect(progressValues[0]).toBeLessThanOrEqual(100)
  expect(
    progressValues
      .slice(1)
      .every(
        (value, index) => value > progressValues[index]! && value - progressValues[index]! <= 100,
      ),
  ).toBe(true)
})

test('sends an anonymous Star attempt through sign-in with the Session URL preserved', async ({
  page,
}) => {
  await installSessionApi(page, { authenticated: false })
  await page.goto(`/session/${SID}`)

  await expect(page.getByRole('button', { name: 'Star' })).toBeVisible()
  await page.getByRole('button', { name: 'Star' }).click()
  await expect(page).toHaveURL((url) => {
    return url.pathname === '/sign-in' && url.searchParams.get('next') === `/session/${SID}`
  })
})

test('keeps the Summary-first state inside a 320px reader viewport', async ({
  page,
}, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const recordRequests = await installSessionApi(page)
  await page.goto(`/session/${SID}`)

  await expect(page.getByTestId('session-history-idle')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load full session' })).toHaveCSS('height', '48px')
  await expectNoHorizontalOverflow(page)
  expect(recordRequests).toEqual([])

  await page.screenshot({ path: testInfo.outputPath('summary-first-320.png'), fullPage: true })
})

test('auto-loads and resolves a record-addressed deep link', async ({ page }) => {
  const recordRequests = await installSessionApi(page)
  await page.goto(`/session/${SID}#r/200`)

  await expect(page.getByTestId('session-history-loading')).toBeVisible()
  await expect(page.getByTestId('virtuoso-item-list').getByText('Checkpoint 200')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load full session' })).toHaveCount(0)
  expect(recordRequests.length).toBeGreaterThanOrEqual(3)
  expect(recordRequests.slice(0, 3)).toEqual([
    { from: 0, to: 100 },
    { from: 100, to: 200 },
    { from: 200, to: 300 },
  ])
})
