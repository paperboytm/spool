import { expect, test, type Page, type TestInfo } from '@playwright/test'

const owner = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Example Owner',
  display_name: 'Example Owner',
  display_name_override: null,
  avatar_url: null,
  custom_avatar_id: null,
  avatar_visible: true,
  handle: 'example-owner',
  deletion_pending_until: null,
}

const teams = [
  {
    id: 'team-paperboy',
    name: 'Paperboy',
    slug: 'paperboy',
    role: 'owner',
    permissions: [
      'team:update',
      'team:archive',
      'members:invite',
      'members:manage',
      'sessions:manage',
    ],
    member_count: 4,
    archived_at: null,
  },
  {
    id: 'team-research',
    name: 'Research guild',
    slug: 'research-guild',
    role: 'member',
    permissions: [],
    member_count: 8,
    archived_at: null,
  },
]

const personalSession = {
  sid: 'codex_22222222-2222-4222-8222-222222222222',
  title: 'Audit the release pipeline',
  summary: 'Verified the release train and documented the production checks.',
  provider: 'codex',
  created_at: Date.UTC(2026, 6, 23, 8),
  updated_at: Date.UTC(2026, 6, 24, 9),
  visibility: 'public',
  team_id: null,
  team_name: null,
  can_manage_visibility: true,
  author: {
    handle: 'example-owner',
    display_name: 'Example Owner',
    avatar_url: null,
  },
}

async function installWorkspaceApi(
  page: Page,
  { personalSessions = [personalSession] }: { personalSessions?: (typeof personalSession)[] } = {},
) {
  const currentTeams = teams.map((team) => ({ ...team }))

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const activeTeam = currentTeams.find((team) => `/api/teams/${team.id}` === path)

    if (request.method() === 'PATCH' && activeTeam) {
      const payload = request.postDataJSON() as { name: string }
      const updatedTeam = { ...activeTeam, name: payload.name }
      currentTeams.splice(currentTeams.indexOf(activeTeam), 1, updatedTeam)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ team: updatedTeam }),
      })
      return
    }

    if (request.method() !== 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }

    const body =
      path === '/api/me'
        ? owner
        : path === '/api/teams'
          ? { teams: currentTeams }
          : path === '/api/me/sessions'
            ? { sessions: personalSessions, next_cursor: null }
            : path === '/api/discovery/v1/sessions'
              ? { version: 1, items: [], nextCursor: null }
              : activeTeam
                ? { team: activeTeam }
                : path.endsWith('/sessions')
                  ? { sessions: [], next_cursor: null }
                  : path.endsWith('/members')
                    ? { members: [] }
                    : path.endsWith('/invitations')
                      ? { invitations: [] }
                      : null

    await route.fulfill({
      status: body === null ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(body ?? { detail: `Unhandled E2E route: ${path}` }),
    })
  })
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1)
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  })
}

test('workspace navigation opens Team details directly without a list-page hop', async ({
  page,
}, testInfo) => {
  await installWorkspaceApi(page)
  await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
  await page.setViewportSize({ width: 1024, height: 900 })

  await page.goto('/my-sessions')
  await expect(page.getByRole('heading', { name: personalSession.title })).toBeVisible()
  await expect(page.getByText('Manage who can read each uploaded Session.')).toHaveCount(0)
  await expect(page.locator('#sessions-heading')).toHaveCount(0)
  await capture(page, testInfo, 'my-sessions-feed-desktop')

  const wordmark = page.locator('.workspace-sidebar').getByRole('link', {
    name: 'Spool home',
  })
  await expect(wordmark).toHaveAttribute('href', '/')
  const documents: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'document') {
      documents.push(new URL(request.url()).pathname)
    }
  })
  const homeIdentity = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/me',
  )
  await wordmark.click()
  await homeIdentity
  await page.waitForTimeout(750)
  await expect(page).toHaveURL('/')
  await expect(page.locator('.home-page')).toBeVisible()
  expect(documents).toContain('/')
  expect(documents).not.toContain('/sessions')

  await page.goto('/sessions')
  const sidebar = page.locator('.workspace-sidebar')
  const teamsDisclosure = sidebar.getByRole('button', { name: 'Teams' })
  await expect(teamsDisclosure).toHaveAttribute('aria-expanded', 'false')
  await teamsDisclosure.click()
  await expect(teamsDisclosure).toHaveAttribute('aria-expanded', 'true')
  await expect(sidebar.getByRole('link', { name: 'Paperboy' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Research guild' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Create team' })).toBeVisible()
  await capture(page, testInfo, 'sessions-expanded-teams-desktop')

  await sidebar.getByRole('link', { name: 'Paperboy' }).click()
  await expect(page).toHaveURL('/teams/team-paperboy')
  await expect(page.getByRole('heading', { name: 'Paperboy', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Paperboy' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(sidebar.getByRole('button', { name: 'Teams' })).not.toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.getByRole('tab', { name: 'Settings' }).click()
  const inputBox = await page.getByLabel('Team name').boundingBox()
  const saveBox = await page.getByRole('button', { name: 'Save name' }).boundingBox()
  expect(inputBox?.height).toBe(48)
  expect(saveBox?.height).toBe(inputBox?.height)
  expect((await page.locator('.sw-team-panel').boundingBox())?.height).toBeLessThan(400)
  await page.getByLabel('Team name').fill('Paperboy Studio')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('heading', { name: 'Paperboy Studio', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Paperboy Studio' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(sidebar.getByRole('link', { name: 'Paperboy', exact: true })).toHaveCount(0)
  await capture(page, testInfo, 'team-settings-compact-panel')

  await page.goto('/teams')
  await expect(page.getByRole('heading', { name: 'Create a Team' })).toBeVisible()
  await expect(page.locator('.sw-teams-list')).toHaveCount(0)
})

test('Team disclosure stays touchable and overflow-safe in the compact menu', async ({
  page,
}, testInfo) => {
  await installWorkspaceApi(page)
  await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/my-sessions')

  await page.getByRole('button', { name: 'Open navigation' }).click()
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile workspace navigation' })
  const teamsLink = mobileNavigation.getByRole('link', { name: 'Teams' })
  const paperboy = mobileNavigation.getByRole('link', { name: 'Paperboy' })
  const research = mobileNavigation.getByRole('link', { name: 'Research guild' })
  await expect(paperboy).toBeVisible()
  await expect(research).toBeVisible()
  expect((await teamsLink.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  expect((await paperboy.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await expectNoHorizontalOverflow(page)
  await capture(page, testInfo, 'my-sessions-expanded-teams-phone-320')
})

test('My Sessions empty state keeps the same unboxed feed geometry', async ({ page }, testInfo) => {
  await installWorkspaceApi(page, { personalSessions: [] })
  await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/my-sessions')

  const emptyState = page.locator('.session-feed-state')
  await expect(page.getByRole('heading', { name: 'No uploaded Sessions yet' })).toBeVisible()
  await expect(emptyState).toBeVisible()
  await expect(page.locator('.sw-team-empty')).toHaveCount(0)
  await expect(page.locator('.workspace-page-header')).toHaveCount(0)
  await expect(page.locator('#sessions-heading')).toHaveCount(0)
  expect(await emptyState.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe(
    '0px',
  )
  await expectNoHorizontalOverflow(page)
  await capture(page, testInfo, 'my-sessions-empty-feed-desktop')
})
