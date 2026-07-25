import { expect, test, type Page, type TestInfo } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 720 },
  { name: 'phone-451', width: 451, height: 732 },
  { name: 'compact-768', width: 768, height: 900 },
  { name: 'desktop-1024', width: 1024, height: 900 },
] as const

const SESSION_VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 720 },
  { name: 'desktop-1440', width: 1440, height: 960 },
] as const

const me = {
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

const team = {
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
}

const members = [
  {
    user_id: 'user-owner',
    email: 'owner@example.com',
    display_name: 'Example Owner',
    avatar_url: null,
    role: 'owner',
    joined_at: Date.UTC(2026, 6, 22),
    permissions: [],
  },
  {
    user_id: 'user-alice',
    email: 'alice@example.com',
    display_name: 'Alice Chen',
    avatar_url: null,
    role: 'admin',
    joined_at: Date.UTC(2026, 6, 23),
    permissions: ['role:update', 'remove'],
  },
  {
    user_id: 'user-bob',
    email: 'bob@example.com',
    display_name: 'Bob Li',
    avatar_url: null,
    role: 'admin',
    joined_at: Date.UTC(2026, 6, 23),
    permissions: ['role:update', 'remove'],
  },
  {
    user_id: 'user-carol',
    email: 'carol@example.com',
    display_name: 'Carol Wang',
    avatar_url: null,
    role: 'member',
    joined_at: Date.UTC(2026, 6, 23),
    permissions: ['role:update', 'remove'],
  },
]

const invitations = [
  {
    id: 'invite-design',
    email: 'designer@paperboytm.com',
    role: 'member',
    status: 'pending',
    expires_at: Date.UTC(2026, 7, 1),
  },
]

const publicSessions = [
  {
    sid: 'codex_11111111-1111-4111-8111-111111111111',
    title: 'Unify the Sessions workspace',
    summaryExcerpt:
      'Aligned Public, Team, and Mine around one readable Session feed and one information hierarchy.',
    cost: { usd: 1.25, totalTokens: 800_000 },
    starCount: 3,
    agent: 'codex',
    author: {
      handle: 'example-owner',
      displayName: 'Example Owner',
      avatarUrl: null,
    },
    evidence: {
      records: 42,
      messages: 28,
      toolCalls: 17,
      files: 6,
      additions: 184,
      deletions: 63,
    },
    lineage: null,
    publishedAt: Date.UTC(2026, 6, 24, 10),
    updatedAt: Date.UTC(2026, 6, 24, 11),
  },
]

const personalSession = {
  sid: 'codex_22222222-2222-4222-8222-222222222222',
  title: 'Audit the release pipeline',
  summary: 'Verified the release train and documented the production checks.',
  summaries: null,
  cost: { usd: 0.84, totalTokens: 520_000 },
  star_count: 2,
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

const teamSession = {
  sid: 'claude_33333333-3333-4333-8333-333333333333',
  title: 'Plan the Paperboy launch',
  summary: 'Turned the launch requirements into a staged, reviewable rollout.',
  summaries: null,
  cost: { usd: 2.15, totalTokens: 1_100_000 },
  star_count: 0,
  provider: 'claude',
  created_at: Date.UTC(2026, 6, 22, 8),
  updated_at: Date.UTC(2026, 6, 24, 8),
  visibility: 'team',
  team_id: team.id,
  team_name: team.name,
  can_manage_visibility: true,
  author: {
    handle: 'alice',
    display_name: 'Alice Chen',
    avatar_url: null,
  },
}

interface AccountApiOptions {
  teamName?: string
  teamAuthorHandle?: string
  teamSessions?: 'default' | 'empty'
}

async function installAccountApi(page: Page, options: AccountApiOptions = {}) {
  const activeTeam = {
    ...team,
    name: options.teamName ?? team.name,
  }
  const activeTeamSession = {
    ...teamSession,
    team_name: activeTeam.name,
    author: {
      ...teamSession.author,
      handle: options.teamAuthorHandle ?? teamSession.author.handle,
    },
  }
  const activeTeamSessions = options.teamSessions === 'empty' ? [] : [activeTeamSession]

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }

    const body =
      path === '/api/me'
        ? me
        : path === '/api/me/shares'
          ? { shares: [] }
          : path === '/api/me/sessions'
            ? { sessions: [personalSession, ...activeTeamSessions], next_cursor: null }
            : path === '/api/discovery/v1/sessions'
              ? { version: 1, items: publicSessions, nextCursor: null }
              : path === '/api/teams'
                ? { teams: [activeTeam] }
                : path === '/api/teams/team-paperboy'
                  ? { team: activeTeam }
                  : path === '/api/teams/team-paperboy/sessions'
                    ? { sessions: activeTeamSessions, next_cursor: null }
                    : path === '/api/teams/team-paperboy/members'
                      ? { members }
                      : path === '/api/teams/team-paperboy/invitations'
                        ? { invitations }
                        : null

    if (body === null) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: `Unhandled E2E route: ${path}` }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  return { team: activeTeam, teamSession: activeTeamSession }
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left < -1 || rect.right > viewport + 1
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      }))
    const card = document.querySelector<HTMLElement>('.sw-me-card')
    const chain: Array<Record<string, string | number>> = []
    let current: HTMLElement | null = card
    while (current && chain.length < 6) {
      const rect = current.getBoundingClientRect()
      const style = getComputedStyle(current)
      chain.push({
        tag: current.tagName.toLowerCase(),
        className: current.className,
        width: rect.width,
        cssWidth: style.width,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        display: style.display,
        alignItems: style.alignItems,
      })
      current = current.parentElement
    }
    const sessionSelectors = [
      '.managed-session-item',
      '.session-feed-row',
      '.sp-list-row__content',
      '.sp-list-row__attribution',
      '.sp-list-row__metadata',
      '.session-feed-row-meta',
      '.managed-session-visibility-badge',
    ]
    const sessionLayout = sessionSelectors.flatMap((selector) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return []
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return [
        {
          selector,
          width: rect.width,
          right: rect.right,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          cssWidth: style.width,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          display: style.display,
          overflow: style.overflow,
        },
      ]
    })
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders,
      chain,
      sessionLayout,
    }
  })

  expect(overflow.documentWidth, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(
    overflow.viewport + 1,
  )
  expect(overflow.bodyWidth, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(
    overflow.viewport + 1,
  )
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  })
}

async function contrastRatio(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => {
    const rgb = (value: string) => {
      const values = value
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number)
      if (!values || values.length !== 3) throw new Error(`Cannot parse CSS color: ${value}`)
      return values.map((component) => component / 255)
    }
    const luminance = (value: string) =>
      rgb(value)
        .map((component) =>
          component <= 0.04045 ? component / 12.92 : Math.pow((component + 0.055) / 1.055, 2.4),
        )
        .reduce(
          (total, component, index) => total + component * [0.2126, 0.7152, 0.0722][index]!,
          0,
        )
    const style = getComputedStyle(element)
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
}

test('public OG metadata resolves to the fingerprinted 1200 × 630 brand card', async ({ page }) => {
  await page.goto('/')

  const ogImage = page.locator('meta[property="og:image"]')
  await expect(ogImage).toHaveAttribute(
    'content',
    /^https:\/\/spool\.new\/assets\/site-og-[\w-]+\.png$/,
  )
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200')
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630')
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    'content',
    await ogImage.getAttribute('content'),
  )

  const imagePath = new URL((await ogImage.getAttribute('content'))!).pathname
  const dimensions = await page.evaluate(async (path) => {
    const image = new Image()
    image.src = path
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  }, imagePath)
  expect(dimensions).toEqual({ width: 1200, height: 630 })
})

for (const viewport of VIEWPORTS) {
  test(`public chrome is responsive at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await expect(page.locator('.brand')).toBeVisible()

    const mobileTrigger = page.getByRole('button', { name: 'Open navigation' })
    if (viewport.width <= 768) {
      await expect(mobileTrigger).toBeVisible()
      const box = await mobileTrigger.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
      await expect(page.locator('.site-main-nav')).toBeHidden()
      await mobileTrigger.click()
      const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' })
      await expect(mobileNavigation).toBeVisible()
      await expect(mobileNavigation.getByRole('link', { name: 'Publish' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(mobileTrigger).toBeFocused()
    } else {
      await expect(mobileTrigger).toBeHidden()
      await expect(page.locator('.site-main-nav')).toBeVisible()
    }

    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `home-${viewport.name}`)
  })

  test(`account and Team surfaces fit ${viewport.width}px`, async ({ page }, testInfo) => {
    await installAccountApi(page)
    await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/me')
    await expect(page.locator('#sessions-heading')).toContainText('Sessions')
    await expect(page.locator('#teams-heading')).toContainText('Teams')
    await expect(page.getByText('Paperboy', { exact: true })).toBeVisible()

    const accountMobileTrigger = page.getByRole('button', { name: 'Open navigation' })
    if (viewport.width <= 768) {
      await expect(accountMobileTrigger).toBeVisible()
      await accountMobileTrigger.click()
      const accountNavigation = page.getByRole('navigation', { name: 'Mobile navigation' })
      await expect(accountNavigation.getByRole('link', { name: 'Teams' })).toBeVisible()
      await page.keyboard.press('Escape')
    } else {
      await expect(accountMobileTrigger).toBeHidden()
      await expect(page.locator('.sw-header-nav')).toBeVisible()
    }

    if (viewport.width === 320) {
      const createTeam = page.getByRole('button', { name: 'Create team' })
      const sectionBox = await page.locator('#teams').boundingBox()
      const createBox = await createTeam.boundingBox()
      expect(createBox?.width).toBeGreaterThanOrEqual((sectionBox?.width ?? 0) - 1)
    }

    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `account-${viewport.name}`)

    await page.goto('/teams/team-paperboy')
    await expect(page.getByRole('heading', { name: 'Paperboy', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Members' }).click()
    await expect(page.getByRole('heading', { name: 'Invite a teammate' })).toBeVisible()

    const sendInvite = page.locator('.sw-team-invite-controls .sp-button--accent')
    await expect(sendInvite).toContainText('Send invite')
    await expect(sendInvite).toBeDisabled()
    const disabledBackground = await sendInvite.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    expect(disabledBackground).not.toBe('rgb(19, 135, 255)')

    await page.getByPlaceholder('teammate@example.com').fill('new-member@example.com')
    await expect(sendInvite).toBeEnabled()
    await expect
      .poll(() => sendInvite.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toMatch(/^rgb\((?:11, 107, 219|91, 177, 240)\)$/)
    expect(
      await contrastRatio(page, '.sw-team-invite-controls .sp-button--accent'),
    ).toBeGreaterThanOrEqual(4.5)
    const inviteBox = await sendInvite.boundingBox()
    expect(inviteBox?.height).toBeGreaterThanOrEqual(44)

    if (viewport.width === 320) {
      let releaseInvite!: () => void
      const inviteGate = new Promise<void>((resolve) => {
        releaseInvite = resolve
      })
      await page.route('**/api/teams/team-paperboy/invitations', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        await inviteGate
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ invitation: invitations[0] }),
        })
      })
      await sendInvite.click()
      await expect(sendInvite).toHaveAttribute('aria-busy', 'true')
      await expect(sendInvite).toHaveAttribute('data-state', 'loading')
      await expect(sendInvite).toBeDisabled()
      await expect(sendInvite).toContainText('Sending…')
      releaseInvite()
      await expect(sendInvite).not.toHaveAttribute('aria-busy', 'true')
    }

    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `team-members-${viewport.name}`)

    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Team details' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled()
    const archiveTeam = page.getByRole('button', { name: 'Archive team' })
    await expect(archiveTeam).toHaveAttribute('data-variant', 'danger')
    if (viewport.width <= 768) {
      const archiveBox = await archiveTeam.boundingBox()
      expect(archiveBox?.height).toBeGreaterThanOrEqual(48)
    }
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `team-settings-${viewport.name}`)
  })
}

for (const viewport of SESSION_VIEWPORTS) {
  test(`Session scopes share one feed layout at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await installAccountApi(page)
    await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/sessions?sort=recommended')
    const publicScopeTab = page.getByRole('tab', { name: 'Public' })
    await expect(publicScopeTab).toBeVisible()
    await expect(publicScopeTab).toHaveAttribute('aria-controls', 'sessions-scope-public-panel')
    await expect(page.locator('#sessions-scope-public-panel')).toHaveAttribute('role', 'tabpanel')
    await expect(page.getByRole('tab', { name: 'Team · Paperboy' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Mine' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Top' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Recent' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'For you' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Trending' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: publicSessions[0]!.title })).toBeVisible()
    await capture(page, testInfo, `sessions-public-${viewport.name}`)

    const publicMain = await page.locator('.workspace-main').boundingBox()
    await expect(page.locator('.explore-right')).toHaveCount(0)
    await expect(page.locator('.workspace-shell')).toHaveClass('workspace-shell')

    await page.getByRole('tab', { name: 'Team · Paperboy' }).click()
    await expect(page).toHaveURL(/scope=team/)
    await expect(page.getByRole('heading', { name: teamSession.title })).toBeVisible()
    await expect(page.getByText('Newest activity first.', { exact: false })).toHaveCount(0)
    await expect(page.locator('.session-feed-row')).toHaveCount(1)
    await expect(page.getByLabel(`Visibility for ${teamSession.title}`)).toHaveCount(0)
    const manageTeamSession = page.getByRole('button', { name: `Manage ${teamSession.title}` })
    await expect(manageTeamSession).toBeVisible()
    await expect(page.getByText('Recent', { exact: true })).toBeVisible()
    const teamMain = await page.locator('.workspace-main').boundingBox()
    expect(teamMain?.width).toBeCloseTo(publicMain?.width ?? 0, 0)
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `sessions-team-${viewport.name}`)

    if (viewport.width === 320) {
      const manageBox = await manageTeamSession.boundingBox()
      expect(manageBox?.width).toBeGreaterThanOrEqual(44)
      expect(manageBox?.height).toBeGreaterThanOrEqual(44)
    }
    await manageTeamSession.click()
    const teamVisibility = page.getByLabel(`Visibility for ${teamSession.title}`)
    await expect(teamVisibility).toBeVisible()
    await expect(teamVisibility).toBeFocused()
    await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible()
    await capture(page, testInfo, `sessions-team-menu-${viewport.name}`)
    await page.keyboard.press('Escape')
    await expect(page.getByLabel(`Visibility for ${teamSession.title}`)).toHaveCount(0)
    await expect(manageTeamSession).toBeFocused()

    await page.getByRole('tab', { name: 'Mine' }).click()
    await expect(page).toHaveURL(/scope=mine/)
    await expect(page.getByRole('heading', { name: personalSession.title })).toBeVisible()
    await expect(page.locator('.session-feed-row')).toHaveCount(2)
    await expect(page.getByText('Manage who can read each uploaded Session.')).toHaveCount(0)
    const mineMain = await page.locator('.workspace-main').boundingBox()
    expect(mineMain?.width).toBeCloseTo(publicMain?.width ?? 0, 0)
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `sessions-mine-${viewport.name}`)

    const managePersonalSession = page.getByRole('button', {
      name: `Manage ${personalSession.title}`,
    })
    await managePersonalSession.click()
    await expect(page.getByLabel(`Visibility for ${personalSession.title}`)).toBeFocused()
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: 'Withdraw' }).click()
    await expect(page.getByRole('heading', { name: personalSession.title })).toHaveCount(0)
    await expect(page.getByRole('link', { name: teamSession.title })).toBeFocused()

    await page.goto('/sessions?scope=team&team=team-no-longer-visible')
    await expect(page).not.toHaveURL(/team=team-no-longer-visible/)
    await expect(publicScopeTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: publicSessions[0]!.title })).toBeVisible()
  })
}

test('Session feed contains long Team and author identities without overflow', async ({
  page,
}, testInfo) => {
  const longTeamName = `Team${'W'.repeat(90)}`
  const longHandle = 'h'.repeat(64)
  const fixtures = await installAccountApi(page, {
    teamName: longTeamName,
    teamAuthorHandle: longHandle,
  })
  await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/sessions?sort=recent&scope=team&team=team-paperboy')
    await expect(
      page.getByRole('heading', { name: fixtures.teamSession.title, exact: true }),
    ).toBeVisible()
    await expect(page.getByText(`@${longHandle}`, { exact: true })).toBeVisible()
    await expect(page.locator('.managed-session-visibility-badge')).toHaveAttribute(
      'title',
      `Team · ${longTeamName}`,
    )
    await expectNoHorizontalOverflow(page)

    if (viewport.width === 320 || viewport.width === 768) {
      await capture(page, testInfo, `sessions-long-identities-${viewport.name}`)
    }
  }
})

test('Session feed empty state fits inside a long Team scope without overflow', async ({
  page,
}, testInfo) => {
  const longTeamName = `Team${'W'.repeat(90)}`
  await installAccountApi(page, { teamName: longTeamName, teamSessions: 'empty' })
  await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/sessions?sort=recent&scope=team&team=team-paperboy')
    await expect(page.getByRole('heading', { name: 'No Sessions in this Team yet' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    if (viewport.width === 320) {
      await capture(page, testInfo, `sessions-long-empty-${viewport.name}`)
    }
  }
})
