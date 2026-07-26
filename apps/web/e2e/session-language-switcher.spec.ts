import { expect, test, type Page, type TestInfo } from '@playwright/test'

const SID = 'codex_00000000-0000-7000-8000-000000000099'
const EN_TITLE = 'Make long Sessions readable before loading their history'
const ZH_TITLE = '无需加载完整历史即可阅读超长 Session'
const EN_SUMMARY =
  'Spool turns coding-agent histories into readable artifacts. This Session separated its Summary from the full record download so readers can understand the result immediately.'
const ZH_SUMMARY =
  'Spool 会把编程 Agent 的历史记录整理成可阅读的内容。这个 Session 将摘要与完整记录下载分离，让读者无需等待即可先理解结果。'
const EN_EXCERPT = 'Readers can understand the outcome before downloading the complete history.'
const ZH_EXCERPT = '读者无需下载完整历史，就能先理解这个 Session 的结果。'
const TEAM_EN_TITLE = 'Align the Team Session feed'
const TEAM_ZH_TITLE = '统一团队 Session 信息流'
const TEAM_EN_SUMMARY = 'The Team feed now follows the same reading hierarchy as Public Sessions.'
const TEAM_ZH_SUMMARY = '团队信息流现在与公开 Session 使用同一套阅读层级。'
const MINE_EN_TITLE = 'Audit personal Session visibility'
const MINE_ZH_TITLE = '梳理个人 Session 可见性'
const MINE_EN_SUMMARY = 'Personal uploads now state exactly who can read each Session.'
const MINE_ZH_SUMMARY = '个人上传的 Session 现在会明确说明谁可以阅读。'

const viewer = {
  id: 'user-language-reader',
  email: 'reader@example.test',
  name: 'Language Reader',
  display_name: 'Language Reader',
  display_name_override: null,
  avatar_url: null,
  custom_avatar_id: null,
  avatar_visible: true,
  handle: 'language-reader',
  deletion_pending_until: null,
}

const team = {
  id: 'team-language',
  name: 'Paperboy',
  slug: 'paperboy',
  role: 'owner',
  permissions: ['team:update', 'sessions:manage'],
  member_count: 4,
  archived_at: null,
}

function managedSession({
  sid,
  title,
  titleZh,
  summary,
  summaryZh,
  visibility,
}: {
  sid: string
  title: string
  titleZh: string
  summary: string
  summaryZh: string
  visibility: 'public' | 'team'
}) {
  return {
    sid,
    title,
    titles: { en: title, zh: titleZh },
    summary,
    summaries: { en: summary, zh: summaryZh },
    cost: { usd: 0.31, totalTokens: 120_000 },
    star_count: 2,
    provider: 'codex',
    created_at: Date.UTC(2026, 6, 24, 8),
    updated_at: Date.UTC(2026, 6, 25, 9),
    visibility,
    team_id: visibility === 'team' ? team.id : null,
    team_name: visibility === 'team' ? team.name : null,
    can_manage_visibility: true,
    author: {
      handle: viewer.handle,
      display_name: viewer.display_name,
      avatar_url: null,
    },
  }
}

const teamSession = managedSession({
  sid: 'codex_00000000-0000-7000-8000-000000000091',
  title: TEAM_EN_TITLE,
  titleZh: TEAM_ZH_TITLE,
  summary: TEAM_EN_SUMMARY,
  summaryZh: TEAM_ZH_SUMMARY,
  visibility: 'team',
})

const mineSession = managedSession({
  sid: 'codex_00000000-0000-7000-8000-000000000092',
  title: MINE_EN_TITLE,
  titleZh: MINE_ZH_TITLE,
  summary: MINE_EN_SUMMARY,
  summaryZh: MINE_ZH_SUMMARY,
  visibility: 'public',
})

const summaryMd = [
  '---',
  `title: ${EN_TITLE}`,
  `title_zh: ${ZH_TITLE}`,
  '---',
  '',
  '<!-- spool:summary:en -->',
  '## Background',
  EN_SUMMARY,
  '<!-- /spool:summary -->',
  '',
  '<!-- spool:summary:zh -->',
  '## 背景',
  ZH_SUMMARY,
  '<!-- /spool:summary -->',
].join('\n')

async function installLanguageApi(page: Page) {
  const recordRequests: string[] = []

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const sessionBase = `/api/hub/v1/sessions/${SID}`

    if (url.pathname === `${sessionBase}/records`) {
      recordRequests.push(url.search)
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: '',
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
          files: [],
          outline: [],
          firstPrompt: 'Make long Session reading start immediately',
          lastReply: 'Implemented Summary-first reading.',
          diffstat: { files: 0, adds: 0, dels: 0 },
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
          count: 2_726,
          sig: null,
          summaryMd,
          cardJson: JSON.stringify({
            remotes: ['origin: git@github.com:paperboytm/spool.git'],
            branch: 'main',
            head: 'abc123',
            dirty: [],
            observed: '2026-07-25T08:00:00.000Z',
          }),
          lineageJson: null,
          viewOid: 'view-oid',
          spoolFileOid: null,
          createdAt: Date.UTC(2026, 6, 25, 8),
          updatedAt: Date.UTC(2026, 6, 25, 9),
          visibility: 'public',
          author: {
            handle: viewer.handle,
            displayName: viewer.display_name,
            avatarUrl: null,
          },
        }),
      })
      return
    }

    if (url.pathname === `/api/discovery/v1/sessions/${SID}/social`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          starCount: 4,
          forkCount: 1,
          viewerStarred: false,
          canStar: true,
        }),
      })
      return
    }

    if (url.pathname === '/api/discovery/v1/sessions') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          items: [
            {
              sid: SID,
              title: EN_TITLE,
              titles: { en: EN_TITLE, zh: ZH_TITLE },
              summaryExcerpt: EN_EXCERPT,
              summaryExcerpts: { en: EN_EXCERPT, zh: ZH_EXCERPT },
              cost: { usd: 0.42, totalTokens: 180_000 },
              starCount: 4,
              agent: 'codex',
              author: {
                handle: viewer.handle,
                displayName: viewer.display_name,
                avatarUrl: null,
              },
              evidence: {
                records: 2_726,
                messages: 38,
                toolCalls: 71,
                files: 3,
                additions: 84,
                deletions: 22,
              },
              lineage: null,
              publishedAt: Date.UTC(2026, 6, 25, 8),
              updatedAt: Date.UTC(2026, 6, 25, 9),
            },
          ],
          nextCursor: null,
        }),
      })
      return
    }

    if (url.pathname === '/api/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(viewer),
      })
      return
    }

    if (url.pathname === '/api/teams') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ teams: [team] }),
      })
      return
    }

    if (url.pathname === `/api/teams/${team.id}/sessions`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [teamSession], next_cursor: null }),
      })
      return
    }

    if (url.pathname === '/api/me/sessions') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [mineSession, teamSession], next_cursor: null }),
      })
      return
    }

    if (url.pathname === '/api/me/shares') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shares: [] }),
      })
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  return recordRequests
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(dimensions.root, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
}

async function expectEnglishSession(page: Page) {
  await expect(page.getByRole('heading', { name: EN_TITLE })).toBeVisible()
  await expect(page.getByText(EN_SUMMARY, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: ZH_TITLE })).toHaveCount(0)
  await expect(page.getByText(ZH_SUMMARY, { exact: true })).toHaveCount(0)
  await expect(page.locator('#sw-workbench-title')).toHaveAttribute('lang', 'en')
}

async function expectChineseSession(page: Page) {
  await expect(page.getByRole('heading', { name: ZH_TITLE })).toBeVisible()
  await expect(page.getByText(ZH_SUMMARY, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: EN_TITLE })).toHaveCount(0)
  await expect(page.getByText(EN_SUMMARY, { exact: true })).toHaveCount(0)
  await expect(page.locator('#sw-workbench-title')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('spool-theme', 'light')
  })
})

test('switches title, Summary, and feed excerpt together and persists the choice', async ({
  page,
}, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const recordRequests = await installLanguageApi(page)
  const runtimeErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  await page.goto(`/session/${SID}`)
  await expectEnglishSession(page)
  await expect(
    page.getByRole('button', { name: 'Show Sessions in English' }).filter({ visible: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(recordRequests).toEqual([])

  await page.getByRole('button', { name: '用中文显示 Session' }).filter({ visible: true }).click()
  await expectChineseSession(page)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spool-session-language')))
    .toBe('zh')
  expect(recordRequests).toEqual([])
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: testInfo.outputPath('session-language-zh-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await page.reload()
  await expectChineseSession(page)
  expect(recordRequests).toEqual([])

  await page.goto('/sessions?sort=recommended')
  await expect(page.getByRole('heading', { name: ZH_TITLE })).toBeVisible()
  await expect(page.getByText(ZH_EXCERPT, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: EN_TITLE })).toHaveCount(0)
  await expect(page.getByText(EN_EXCERPT, { exact: true })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: testInfo.outputPath('sessions-language-zh-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await page.getByRole('tab', { name: 'Team · Paperboy' }).click()
  await expect(page.getByRole('heading', { name: TEAM_ZH_TITLE })).toBeVisible()
  await expect(page.getByText(TEAM_ZH_SUMMARY, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: TEAM_EN_TITLE })).toHaveCount(0)
  await expect(page.getByText(TEAM_EN_SUMMARY, { exact: true })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Mine' }).click()
  await expect(page.getByRole('heading', { name: MINE_ZH_TITLE })).toBeVisible()
  await expect(page.getByText(MINE_ZH_SUMMARY, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: MINE_EN_TITLE })).toHaveCount(0)
  await expect(page.getByText(MINE_EN_SUMMARY, { exact: true })).toHaveCount(0)

  await page
    .getByRole('button', { name: 'Show Sessions in English' })
    .filter({ visible: true })
    .click()
  await expect(page.getByRole('heading', { name: MINE_EN_TITLE })).toBeVisible()
  await expect(page.getByText(MINE_EN_SUMMARY, { exact: true })).toBeVisible()
  await page.goto(`/session/${SID}`)
  await expectEnglishSession(page)
  expect(recordRequests).toEqual([])
  expect(
    runtimeErrors.filter((message) => /hydration|did not match|server rendered/i.test(message)),
  ).toEqual([])
})

test('keeps the language control reachable and overflow-safe at 320px', async ({
  page,
}, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const recordRequests = await installLanguageApi(page)
  await page.goto(`/session/${SID}`)
  await expectEnglishSession(page)

  const displayPreferences = page.locator(
    '.session-language-toolbar[aria-label="Session display preferences"]',
  )
  const languageGroup = displayPreferences.getByRole('group', { name: 'Session language' })
  await expect(displayPreferences).toBeVisible()
  await expect(languageGroup).toBeVisible()
  for (const name of ['Show Sessions in English', '用中文显示 Session']) {
    const box = await languageGroup.getByRole('button', { name }).boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
  await page.screenshot({
    path: testInfo.outputPath('session-language-toolbar-320.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await languageGroup.getByRole('button', { name: '用中文显示 Session' }).click()
  await expectChineseSession(page)
  await page.screenshot({
    path: testInfo.outputPath('session-language-toolbar-zh-320.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await page.getByRole('button', { name: 'Open navigation' }).click()
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(navigation).toBeVisible()
  await expect(navigation.getByRole('group', { name: 'Session language' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expectNoHorizontalOverflow(page)
  expect(recordRequests).toEqual([])

  await page.screenshot({
    path: testInfo.outputPath('session-language-zh-320.png'),
    fullPage: true,
    animations: 'disabled',
  })

  await page.reload()
  await expectChineseSession(page)
  await expectNoHorizontalOverflow(page)
  expect(recordRequests).toEqual([])
})
