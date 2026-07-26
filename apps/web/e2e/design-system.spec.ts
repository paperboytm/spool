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

const doodlewindOwner = {
  kind: 'user',
  id: 'user-doodlewind',
  handle: 'doodlewind',
  name: 'Doodlewind',
  avatar_url: null,
} as const

const paperboyOwner = {
  kind: 'team',
  id: team.id,
  handle: 'paperboy',
  name: 'Paperboy',
  avatar_url: null,
} as const

const paperboySpoolProject = {
  id: 'project-paperboy-spool',
  slug: 'spool',
  name: 'Spool',
  description: 'Publish complete agent Sessions as readable, attributable, and resumable work.',
  github_url: 'https://github.com/paperboytm/spool',
  owner: paperboyOwner,
  session_count: 1,
  star_count: 12,
  updated_at: Date.UTC(2026, 6, 26, 10),
  archived_at: null,
  can_manage: false,
}

const doodlewindSession = {
  ...personalSession,
  sid: 'codex_44444444-4444-4444-8444-444444444444',
  title: 'Build Team-owned publishing and a useful social graph',
  summary:
    'Spool needed authors to publish into Team-owned Projects without losing individual attribution. This Session added that ownership boundary together with Project Stars, private Watching, and person-to-person Follow.',
  published_at: Date.UTC(2026, 6, 26, 10),
  updated_at: Date.UTC(2026, 6, 26, 11),
  team_id: team.id,
  team_name: team.name,
  can_manage_visibility: false,
  author: {
    handle: doodlewindOwner.handle,
    display_name: doodlewindOwner.name,
    avatar_url: null,
  },
}

const doodlewindProject = {
  id: 'project-doodlewind-reading',
  slug: 'session-reading',
  name: 'Session reading',
  description: 'Reader-first experiments for understanding long agent Sessions.',
  github_url: null,
  owner: doodlewindOwner,
  session_count: 2,
  star_count: 4,
  updated_at: Date.UTC(2026, 6, 25, 12),
  archived_at: null,
  can_manage: false,
}

const socialPeople = {
  followers: [
    {
      id: 'user-ada',
      handle: 'ada',
      name: 'Ada Lovelace',
      avatar_url: null,
    },
    {
      id: 'user-grace',
      handle: 'grace',
      name: 'Grace Hopper',
      avatar_url: null,
    },
  ],
  following: [
    {
      id: 'user-linus',
      handle: 'linus',
      name: 'Linus Torvalds',
      avatar_url: null,
    },
  ],
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

interface SocialApiOptions {
  authenticated?: boolean
  initiallyStarred?: boolean
  initiallyWatching?: boolean
  initiallyFollowing?: boolean
  starEligible?: boolean
}

async function installSocialApi(page: Page, options: SocialApiOptions = {}) {
  const authenticated = options.authenticated ?? true
  const starEligible = options.starEligible ?? true
  let viewerStarred = options.initiallyStarred ?? false
  let viewerWatching = options.initiallyWatching ?? false
  let viewerFollowing = options.initiallyFollowing ?? false
  const requests: string[] = []
  const unhandled: string[] = []

  const project = () => ({
    ...paperboySpoolProject,
    star_count: 12 + Number(viewerStarred),
  })
  const projectSocial = () => ({
    version: 1,
    starCount: 12 + Number(viewerStarred),
    watcherCount: 7 + Number(viewerWatching),
    viewerStarred,
    viewerWatching,
    viewerAuthenticated: authenticated,
    starEligible,
    canStar: authenticated && starEligible,
    canWatch: authenticated,
  })
  const followSocial = () => ({
    version: 1,
    followerCount: 21 + Number(viewerFollowing),
    followingCount: 9,
    viewerFollowing,
    viewerAuthenticated: authenticated,
    viewerIsSelf: false,
    canFollow: authenticated,
  })
  const socialProject = () => {
    const { archived_at: _archivedAt, can_manage: _canManage, ...publicProject } = project()
    return publicProject
  }
  const fulfill = async (route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  }
  const unauthenticated = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Authentication required' }),
    })
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const key = `${method} ${path}`
    requests.push(key)

    if (key === 'GET /api/me') {
      if (!authenticated) return unauthenticated(route)
      return fulfill(route, {
        ...me,
        id: 'user-viewer',
        email: 'reader@example.com',
        name: 'Session Reader',
        display_name: 'Session Reader',
        handle: 'session-reader',
      })
    }
    if (key === 'GET /api/teams') {
      if (!authenticated) return unauthenticated(route)
      return fulfill(route, { teams: [team] })
    }
    if (key === 'GET /api/owners/paperboy/projects/spool') {
      return fulfill(route, {
        project: project(),
        sessions: [doodlewindSession],
        next_cursor: null,
      })
    }
    if (key === 'GET /api/owners/paperboy/projects/spool/social') {
      return fulfill(route, projectSocial())
    }
    if (key === 'GET /api/owners/paperboy/projects/spool/stargazers') {
      return fulfill(route, { stargazers: socialPeople.followers, next_cursor: null })
    }
    if (key === 'PUT /api/owners/paperboy/projects/spool/star') {
      if (!authenticated) return unauthenticated(route)
      viewerStarred = true
      return fulfill(route, projectSocial())
    }
    if (key === 'DELETE /api/owners/paperboy/projects/spool/star') {
      if (!authenticated) return unauthenticated(route)
      viewerStarred = false
      return fulfill(route, projectSocial())
    }
    if (key === 'PUT /api/owners/paperboy/projects/spool/watch') {
      if (!authenticated) return unauthenticated(route)
      viewerWatching = true
      return fulfill(route, projectSocial())
    }
    if (key === 'DELETE /api/owners/paperboy/projects/spool/watch') {
      if (!authenticated) return unauthenticated(route)
      viewerWatching = false
      return fulfill(route, projectSocial())
    }
    if (key === 'GET /api/owners/doodlewind/projects') {
      return fulfill(route, {
        owner: doodlewindOwner,
        projects: [doodlewindProject],
        sessions: [doodlewindSession],
        session_count: 1,
        next_cursor: null,
      })
    }
    if (key === 'GET /api/owners/doodlewind/follow') {
      return fulfill(route, followSocial())
    }
    if (key === 'PUT /api/owners/doodlewind/follow') {
      if (!authenticated) return unauthenticated(route)
      viewerFollowing = true
      return fulfill(route, followSocial())
    }
    if (key === 'DELETE /api/owners/doodlewind/follow') {
      if (!authenticated) return unauthenticated(route)
      viewerFollowing = false
      return fulfill(route, followSocial())
    }
    if (key === 'GET /api/owners/doodlewind/starred-projects') {
      return fulfill(route, { projects: [socialProject()], next_cursor: null })
    }
    if (key === 'GET /api/owners/doodlewind/followers') {
      return fulfill(route, { followers: socialPeople.followers, next_cursor: null })
    }
    if (key === 'GET /api/owners/doodlewind/following') {
      return fulfill(route, { following: socialPeople.following, next_cursor: null })
    }
    if (key === 'GET /api/me/starred-projects') {
      if (!authenticated) return unauthenticated(route)
      return fulfill(route, {
        projects: viewerStarred ? [socialProject()] : [],
        next_cursor: null,
      })
    }
    if (key === 'GET /api/me/watching-projects') {
      if (!authenticated) return unauthenticated(route)
      return fulfill(route, {
        projects: viewerWatching ? [socialProject()] : [],
        next_cursor: null,
      })
    }

    unhandled.push(key)
    await route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ detail: `Unhandled social E2E route: ${key}` }),
    })
  })

  return {
    requests,
    unhandled,
    state: () => ({ viewerStarred, viewerWatching, viewerFollowing }),
  }
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

async function expectMinimumTouchTargets(page: Page, selector: string, minimum = 44) {
  const targets = page.locator(selector)
  const count = await targets.count()
  expect(count, `Expected at least one touch target for ${selector}`).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index)
    if (!(await target.isVisible())) continue
    const box = await target.boundingBox()
    expect(box?.width, `${selector} #${index + 1} width`).toBeGreaterThanOrEqual(minimum)
    expect(box?.height, `${selector} #${index + 1} height`).toBeGreaterThanOrEqual(minimum)
  }
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

for (const viewport of VIEWPORTS) {
  test(`public Team Project social actions work at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const api = await installSocialApi(page)
    await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/@paperboy/spool')
    await expect(page.getByRole('heading', { name: 'Spool', exact: true })).toBeVisible()
    await expect(page.getByText('Team · Paperboy', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: doodlewindSession.title, exact: true }),
    ).toBeVisible()

    const star = page.getByRole('button', { name: 'Star', exact: true })
    const watch = page.getByRole('button', { name: /^Watch 7$/ })
    await expect(star).toHaveAttribute('aria-pressed', 'false')
    await expect(watch).toHaveAttribute('aria-pressed', 'false')

    await page.getByRole('button', { name: 'View 12 stargazers', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close stargazers', exact: true }).click()

    await star.click()
    const starred = page.getByRole('button', { name: 'Star', exact: true })
    await expect(starred).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', { name: 'View 13 stargazers', exact: true }),
    ).toBeVisible()
    expect(api.state().viewerStarred).toBe(true)

    await watch.click()
    const watching = page.getByRole('button', { name: /^Watch 8$/ })
    await expect(watching).toHaveAttribute('aria-pressed', 'true')
    expect(api.state().viewerWatching).toBe(true)

    if (viewport.width <= 768) {
      await expectMinimumTouchTargets(page, '.project-social-actions .sp-button')
    }
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `project-paperboy-spool-social-${viewport.name}`)

    await starred.click()
    await expect(page.getByRole('button', { name: 'Star', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await watching.click()
    await expect(page.getByRole('button', { name: /^Watch 7$/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(api.state()).toEqual({
      viewerStarred: false,
      viewerWatching: false,
      viewerFollowing: false,
    })
    expect(api.requests).toContain('PUT /api/owners/paperboy/projects/spool/star')
    expect(api.requests).toContain('DELETE /api/owners/paperboy/projects/spool/star')
    expect(api.requests).toContain('GET /api/owners/paperboy/projects/spool/stargazers')
    expect(api.requests).toContain('PUT /api/owners/paperboy/projects/spool/watch')
    expect(api.requests).toContain('DELETE /api/owners/paperboy/projects/spool/watch')
    expect(api.unhandled).toEqual([])
  })

  test(`person Follow and public social lists work at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const api = await installSocialApi(page)
    await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/@doodlewind')
    await expect(page.getByRole('heading', { name: 'Doodlewind', exact: true })).toBeVisible()
    await expect(page.locator('.profile-project-header p')).toHaveText('@doodlewind')

    const follow = page.getByRole('button', { name: 'Follow', exact: true })
    await follow.click()
    const followingButton = page.getByRole('button', { name: 'Following', exact: true })
    await expect(followingButton).toBeVisible()
    expect(api.state().viewerFollowing).toBe(true)
    await expect(page.getByRole('link', { name: /^Followers 22$/ })).toBeVisible()

    if (viewport.width <= 768) {
      await expectMinimumTouchTargets(page, '.profile-project-header > .sp-button')
      await expectMinimumTouchTargets(page, '.profile-social-tabs a')
    }
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `profile-doodlewind-following-${viewport.name}`)

    await page.getByRole('link', { name: 'Stars', exact: true }).click()
    await expect(page).toHaveURL(/tab=stars/)
    await expect(page.getByRole('heading', { name: 'Starred Projects', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Spool', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `profile-doodlewind-stars-${viewport.name}`)

    await page.getByRole('link', { name: /^Followers 22$/ }).click()
    await expect(page).toHaveURL(/tab=followers/)
    await expect(page.getByRole('heading', { name: 'Followers', exact: true })).toBeVisible()
    await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
    await expect(page.getByText('@grace', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `profile-doodlewind-followers-${viewport.name}`)

    await page.getByRole('link', { name: /^Following 9$/ }).click()
    await expect(page).toHaveURL(/tab=following/)
    await expect(page.getByRole('heading', { name: 'Following', exact: true })).toBeVisible()
    await expect(page.getByText('Linus Torvalds', { exact: true })).toBeVisible()
    await expect(page.getByText('@linus', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `profile-doodlewind-following-list-${viewport.name}`)

    await page.getByRole('link', { name: 'Overview', exact: true }).click()
    await expect(page).toHaveURL(/\/@doodlewind(?:\?tab=overview)?$/)
    await page.getByRole('button', { name: 'Following', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible()
    expect(api.state().viewerFollowing).toBe(false)
    expect(api.requests).toContain('PUT /api/owners/doodlewind/follow')
    expect(api.requests).toContain('DELETE /api/owners/doodlewind/follow')
    expect(api.requests).toContain('GET /api/owners/doodlewind/starred-projects')
    expect(api.requests).toContain('GET /api/owners/doodlewind/followers')
    expect(api.requests).toContain('GET /api/owners/doodlewind/following')
    expect(api.unhandled).toEqual([])
  })

  test(`Starred and Watching Project scopes work at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const api = await installSocialApi(page, {
      initiallyStarred: true,
      initiallyWatching: true,
    })
    await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/projects?scope=starred')
    await expect(page.getByRole('tab', { name: 'Starred', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('heading', { name: 'Spool', exact: true })).toBeVisible()
    await expect(page.getByText('@paperboy/spool', { exact: true })).toBeVisible()
    if (viewport.width <= 768) {
      await expectMinimumTouchTargets(page, '.projects-scope-tabs .sp-tabs__tab')
      await expectMinimumTouchTargets(page, '.project-card-main')
    }
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `projects-starred-${viewport.name}`)

    await page.getByRole('tab', { name: 'Watching', exact: true }).click()
    await expect(page).toHaveURL(/scope=watching/)
    await expect(page.getByRole('tab', { name: 'Watching', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('heading', { name: 'Spool', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `projects-watching-${viewport.name}`)

    expect(api.requests).toContain('GET /api/me/starred-projects')
    expect(api.requests).toContain('GET /api/me/watching-projects')
    expect(api.unhandled).toEqual([])
  })
}

test('anonymous Project Star opens sign-in with the exact return path', async ({
  page,
}, testInfo) => {
  const api = await installSocialApi(page, { authenticated: false })
  await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
  await page.setViewportSize({ width: 451, height: 732 })

  await page.goto('/@paperboy/spool')
  await page.getByRole('button', { name: 'Star', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in\?/)
  const signInUrl = new URL(page.url())
  expect(signInUrl.pathname).toBe('/sign-in')
  expect(signInUrl.searchParams.get('next')).toBe('/@paperboy/spool')
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await capture(page, testInfo, 'project-anonymous-star-sign-in-phone-451')

  expect(api.requests).toContain('PUT /api/owners/paperboy/projects/spool/star')
  expect(api.unhandled).toEqual([])
})

test('private Team Project members can Watch without seeing a Star affordance', async ({
  page,
}) => {
  const api = await installSocialApi(page, { starEligible: false })
  await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
  await page.setViewportSize({ width: 451, height: 732 })

  await page.goto('/@paperboy/spool')
  await expect(page.getByRole('button', { name: /^Star/ })).toHaveCount(0)
  const watch = page.getByRole('button', { name: /^Watch 7$/ })
  await expect(watch).toBeVisible()
  await watch.click()
  await expect(page.getByRole('button', { name: /^Watch 8$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(api.state().viewerWatching).toBe(true)
  expect(api.unhandled).toEqual([])
})
