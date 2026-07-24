import { expect, test, type Page, type TestInfo } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 720 },
  { name: 'phone-451', width: 451, height: 732 },
  { name: 'compact-768', width: 768, height: 900 },
  { name: 'desktop-1024', width: 1024, height: 900 },
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

async function installAccountApi(page: Page) {
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
            ? { sessions: [] }
            : path === '/api/discovery/v1/sessions'
              ? { version: 1, items: [], nextCursor: null }
              : path === '/api/teams'
                ? { teams: [team] }
                : path === '/api/teams/team-paperboy'
                  ? { team }
                  : path === '/api/teams/team-paperboy/sessions'
                    ? { sessions: [] }
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
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders,
      chain,
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
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible()
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
    await expect(page.getByRole('heading', { name: 'Paperboy' })).toBeVisible()
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
      .toMatch(/^rgb\((?:19, 135, 255|91, 177, 240)\)$/)
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

  test(`workspace navigation fits ${viewport.width}px`, async ({ page }, testInfo) => {
    await installAccountApi(page)
    await page.addInitScript(() => localStorage.setItem('spool-theme', 'light'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    await page.goto('/explore?sort=recommended')
    await expect(page.getByRole('tab', { name: 'Top' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Recent' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'For you' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Trending' })).toHaveCount(0)

    const desktopNavigation = page.getByRole('navigation', { name: 'Primary navigation' })
    const mobileNavigation = page.getByRole('navigation', {
      name: 'Mobile workspace navigation',
    })
    const mobileMenuTrigger = page.getByRole('button', { name: 'Open navigation' })
    if (viewport.width <= 768) {
      await expect(desktopNavigation).toBeHidden()
      await expect(mobileMenuTrigger).toBeVisible()
      await mobileMenuTrigger.click()
      await expect(mobileNavigation).toBeVisible()
    } else {
      await expect(desktopNavigation).toBeVisible()
      await expect(mobileNavigation).toBeHidden()
      await expect(mobileMenuTrigger).toBeHidden()
    }
    await expectNoHorizontalOverflow(page)

    await page.goto('/my-sessions')
    await expect(page.getByRole('heading', { name: 'My Sessions' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/teams')
    await expect(
      page.locator('.workspace-page-header').getByRole('heading', { name: 'Teams', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Paperboy', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await capture(page, testInfo, `workspace-${viewport.name}`)
  })
}
