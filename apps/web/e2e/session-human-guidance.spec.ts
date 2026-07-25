import { expect, test, type Page } from '@playwright/test'

const SID = 'codex_00000000-0000-7000-8000-000000000042'
const TOTAL_RECORDS = 2_726
const PROMPTS = new Map([
  [12, 'Explain the reader bottleneck before changing the implementation.'],
  [
    1_200,
    'Show me only how the human directed this work, and keep the complete Agent reply on demand.',
  ],
  [2_710, 'Verify the compact view on a 320px screen without loading the whole Session.'],
])
const REPLIES = new Map([
  [
    18,
    'I traced the initial load and found the full record history was blocking the first screen.',
  ],
  [1_204, 'I isolated human prompts into sparse record ranges and kept Agent work collapsed.'],
  [
    1_208,
    'The complete reply confirms that opening this turn does not start a 2,726-record download.',
  ],
])
const HIDDEN_CURATED_PROMPT = 'This instruction is outside the published selection.'
const CURATED_PROMPT_RAW = 'Keep the curated guidance for maya@hogwarts.edu.'
const CURATED_PROMPT_REDACTED = 'Keep the curated guidance for m***@hogwarts.edu.'
const CURATED_REPLY_RAW = 'Only maya@hogwarts.edu should receive the published result.'
const CURATED_SPOOL_DOCUMENT = {
  version: 2,
  exportedAt: '2026-07-25T09:00:00.000Z',
  conversation: {
    source: 'codex-cli',
    sourceLabel: 'Codex CLI',
    origin: { kind: 'agent-session', agent: 'codex' },
    title: 'Curated human guidance',
    shareUrl: null,
    createdAt: '2026-07-25T08:00:00.000Z',
    turns: [
      { role: 'user', body: HIDDEN_CURATED_PROMPT },
      { role: 'assistant', body: 'This response is outside the published selection.' },
      { role: 'user', body: CURATED_PROMPT_RAW },
      { role: 'assistant', body: CURATED_REPLY_RAW },
    ],
  },
  opts: {
    template: 'chat',
    paper: 'snow',
    typeface: 'geist',
    colorway: 'amber',
    accentHex: '#C85A00',
    density: 'compact',
    redact: true,
    selected: [2, 3],
    showGaps: true,
    showMasthead: false,
    showColophon: false,
    hideEmptyTurns: true,
  },
}
const GUIDANCE = {
  v: 1 as const,
  turns: [
    {
      promptRecord: 12,
      replyRecords: [18],
      replyChars: characterCount(REPLIES.get(18)!),
      toolCalls: 3,
    },
    {
      promptRecord: 1_200,
      replyRecords: [1_204, 1_208],
      replyChars: characterCount(REPLIES.get(1_204)!) + characterCount(REPLIES.get(1_208)!),
      toolCalls: 7,
    },
    {
      promptRecord: 2_710,
      replyRecords: [],
      replyChars: 0,
      toolCalls: 0,
    },
  ],
}

type RecordRequest = { from: number; to: number }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function characterCount(value: string): number {
  return [...value.trim()].length
}

function record(index: number) {
  const user = PROMPTS.get(index)
  const assistant = REPLIES.get(index)
  const payload =
    user === undefined
      ? assistant === undefined
        ? { type: 'token_count', info: null }
        : { type: 'agent_message', message: assistant }
      : { type: 'user_message', message: user }
  return {
    i: index,
    oid: `oid-${index}`,
    data: JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(Date.UTC(2026, 6, 25, 8, 0, index)).toISOString(),
      payload,
    }),
  }
}

async function installLegacyGuidanceSession(page: Page): Promise<RecordRequest[]> {
  const recordRequests: RecordRequest[] = []
  const sessionBase = `/api/hub/v1/sessions/${SID}`

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname === `${sessionBase}/records`) {
      const from = Number(url.searchParams.get('from'))
      const to = Number(url.searchParams.get('to'))
      recordRequests.push({ from, to })
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
      // Legacy immutable view: guidance lives in the root-matched meta
      // backfill and is intentionally absent from this canonical object.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          v: 1,
          index: [],
          files: [],
          outline: [],
          firstPrompt: PROMPTS.get(12),
          lastReply: REPLIES.get(1_208),
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
          root: 'a'.repeat(64),
          count: TOTAL_RECORDS,
          sig: null,
          summaryMd:
            '---\ntitle: Make long Sessions readable on demand\ntitle_zh: 按需阅读超长 Session\n---\n\n## Outcome\nThe first screen stays useful while Human guidance reads only sparse source records.',
          cardJson: null,
          lineageJson: null,
          viewOid: 'b'.repeat(64),
          guidance: GUIDANCE,
          spoolFileOid: null,
          createdAt: Date.UTC(2026, 6, 25, 8),
          updatedAt: Date.UTC(2026, 6, 25, 9),
          visibility: 'public',
          author: {
            handle: 'guidance-author',
            displayName: 'Guidance Author',
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
          starCount: 9,
          forkCount: 2,
          viewerStarred: false,
          canStar: true,
        }),
      })
      return
    }

    if (url.pathname === '/api/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'guidance-reader',
          email: 'reader@example.test',
          name: 'Guidance Reader',
          display_name: 'Guidance Reader',
          display_name_override: null,
          avatar_url: null,
          custom_avatar_id: null,
          avatar_visible: true,
          handle: 'guidance-reader',
          deletion_pending_until: null,
        }),
      })
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  return recordRequests
}

async function installDelayedCuratedGuidanceSession(page: Page) {
  const recordRequests: RecordRequest[] = []
  const spoolRequested = deferred()
  const spoolRelease = deferred()
  const sessionBase = `/api/hub/v1/sessions/${SID}`

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname === `${sessionBase}/records`) {
      const from = Number(url.searchParams.get('from'))
      const to = Number(url.searchParams.get('to'))
      recordRequests.push({ from, to })
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

    if (url.pathname === `${sessionBase}/spool-file`) {
      spoolRequested.resolve()
      await spoolRelease.promise
      await route.fulfill({
        status: 200,
        contentType: 'application/spool+json',
        body: JSON.stringify(CURATED_SPOOL_DOCUMENT),
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
          firstPrompt: PROMPTS.get(12),
          lastReply: REPLIES.get(1_208),
          diffstat: { files: 0, adds: 0, dels: 0 },
          guidance: GUIDANCE,
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
          root: 'a'.repeat(64),
          count: TOTAL_RECORDS,
          sig: null,
          summaryMd:
            '---\ntitle: Keep curated guidance private until ready\ntitle_zh: 等待策展指引就绪\n---\n\n## Outcome\nThe bounded publication remains authoritative while it loads.',
          cardJson: null,
          lineageJson: null,
          viewOid: 'b'.repeat(64),
          guidance: GUIDANCE,
          spoolFileOid: 'c'.repeat(64),
          createdAt: Date.UTC(2026, 6, 25, 8),
          updatedAt: Date.UTC(2026, 6, 25, 9),
          visibility: 'public',
          author: {
            handle: 'guidance-author',
            displayName: 'Guidance Author',
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
          starCount: 9,
          forkCount: 2,
          viewerStarred: false,
          canStar: true,
        }),
      })
      return
    }

    if (url.pathname === '/api/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'guidance-reader',
          email: 'reader@example.test',
          name: 'Guidance Reader',
          display_name: 'Guidance Reader',
          display_name_override: null,
          avatar_url: null,
          custom_avatar_id: null,
          avatar_visible: true,
          handle: 'guidance-reader',
          deletion_pending_until: null,
        }),
      })
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  return {
    recordRequests,
    spoolRequested: spoolRequested.promise,
    releaseSpool: spoolRelease.resolve,
  }
}

async function openGuidance(page: Page, recordRequests: RecordRequest[]) {
  await page.goto(`/session/${SID}`)
  await expect(
    page.getByRole('heading', { name: 'Make long Sessions readable on demand' }),
  ).toBeVisible()
  await expect(page.getByTestId('session-history-idle')).toBeVisible()
  expect(recordRequests).toEqual([])

  await page.getByRole('tab', { name: 'Human guidance' }).click()
  for (const prompt of PROMPTS.values()) {
    await expect(page.getByText(prompt, { exact: true })).toBeVisible()
  }

  expect(recordRequests).toEqual([
    { from: 12, to: 13 },
    { from: 1_200, to: 1_201 },
    { from: 2_710, to: 2_711 },
  ])
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1)
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1)
}

test('Human guidance fetches only sparse prompts and the opened Agent reply', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_440, height: 900 })
  const recordRequests = await installLegacyGuidanceSession(page)
  await openGuidance(page, recordRequests)
  await page.screenshot({ path: testInfo.outputPath('human-guidance-1440.png'), fullPage: true })

  const turn = page.locator('article').filter({ hasText: PROMPTS.get(1_200)! })
  const replyTrigger = turn.getByRole('button', { name: /Open Agent response/ })
  await expect(replyTrigger).toContainText('7 tool calls')
  await replyTrigger.click()

  const dialog = page.getByRole('dialog', { name: 'Agent response' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(REPLIES.get(1_204)!, { exact: true })).toBeVisible()
  await expect(dialog.getByText(REPLIES.get(1_208)!, { exact: true })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('agent-reply-dialog-1440.png'),
    fullPage: true,
  })
  expect(recordRequests).toEqual([
    { from: 12, to: 13 },
    { from: 1_200, to: 1_201 },
    { from: 2_710, to: 2_711 },
    { from: 1_204, to: 1_209 },
  ])
  expect(recordRequests.every(({ from, to }) => to - from < TOTAL_RECORDS)).toBe(true)
  await expectNoHorizontalOverflow(page)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(replyTrigger).toBeFocused()
})

test('Human guidance and its Agent dialog stay overflow-safe at 320px', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const recordRequests = await installLegacyGuidanceSession(page)
  await openGuidance(page, recordRequests)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('human-guidance-320.png'), fullPage: true })

  const turn = page.locator('article').filter({ hasText: PROMPTS.get(1_200)! })
  await turn.getByRole('button', { name: /Open Agent response/ }).click()
  await expect(page.getByRole('dialog', { name: 'Agent response' })).toBeVisible()
  await expect(page.getByText(REPLIES.get(1_208)!, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('agent-reply-dialog-320.png'), fullPage: true })
  await expectNoHorizontalOverflow(page)
  expect(recordRequests.at(-1)).toEqual({ from: 1_204, to: 1_209 })
  expect(recordRequests).toHaveLength(4)
})

test('Human guidance waits for a curated .spool before exposing any raw records', async ({
  page,
}) => {
  const control = await installDelayedCuratedGuidanceSession(page)

  try {
    await page.goto(`/session/${SID}`)
    await expect(
      page.getByRole('heading', { name: 'Keep curated guidance private until ready' }),
    ).toBeVisible()
    await control.spoolRequested

    await page.getByRole('tab', { name: 'Human guidance' }).click()
    await expect(page.getByText('Preparing guidance', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Preparing human guidance')).toBeVisible()
    await expect(page.getByText(PROMPTS.get(12)!, { exact: true })).toHaveCount(0)
    expect(control.recordRequests).toEqual([])

    control.releaseSpool()

    await expect(page.getByText(CURATED_PROMPT_REDACTED, { exact: true })).toBeVisible()
    await expect(page.getByText(CURATED_PROMPT_RAW, { exact: true })).toHaveCount(0)
    await expect(page.getByText(HIDDEN_CURATED_PROMPT, { exact: true })).toHaveCount(0)
    for (const prompt of PROMPTS.values()) {
      await expect(page.getByText(prompt, { exact: true })).toHaveCount(0)
    }
    expect(control.recordRequests).toEqual([])
  } finally {
    control.releaseSpool()
  }
})

test('a record deep link cannot bypass a curated .spool guidance gate', async ({ page }) => {
  const control = await installDelayedCuratedGuidanceSession(page)

  try {
    await page.goto(`/session/${SID}#r/12`)
    await expect(
      page.getByRole('heading', { name: 'Keep curated guidance private until ready' }),
    ).toBeVisible()

    // A record-addressed URL must not make the raw source outrank the bounded
    // publication. The attached .spool remains authoritative while it loads.
    expect(control.recordRequests).toEqual([])
    await control.spoolRequested

    await page.getByRole('tab', { name: 'Human guidance' }).click()
    await expect(page.getByText('Preparing guidance', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Preparing human guidance')).toBeVisible()
    await expect(page.getByText(PROMPTS.get(12)!, { exact: true })).toHaveCount(0)
    expect(control.recordRequests).toEqual([])

    control.releaseSpool()

    await expect(page.getByText(CURATED_PROMPT_REDACTED, { exact: true })).toBeVisible()
    await expect(page.getByText(CURATED_PROMPT_RAW, { exact: true })).toHaveCount(0)
    await expect(page.getByText(HIDDEN_CURATED_PROMPT, { exact: true })).toHaveCount(0)
    for (const prompt of PROMPTS.values()) {
      await expect(page.getByText(prompt, { exact: true })).toHaveCount(0)
    }
    expect(control.recordRequests).toEqual([])
  } finally {
    control.releaseSpool()
  }
})
