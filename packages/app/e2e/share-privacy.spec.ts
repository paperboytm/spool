import { test, expect, type Page } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import {
  installSaveFilePickerMock,
  navigateToShares,
  seedShareDraft,
  waitForSavedFile,
} from './helpers/share'

let ctx: AppContext

// Vendor-prefixed fixture tokens built at runtime so GitHub's
// push-protection secret scanner doesn't flag the source literals.
// Detector regex still matches the runtime VALUES. Values must
// include digits + ≥ 28 chars to survive the new JS-storage-key
// false-positive filter; the runtime suffix has both.
const STRIPE_LIVE = 'sk_' + 'live_' + 'aH1xK9pQrSt7VwYzA3bC5dF8gJ'
const STRIPE_RK = 'rk_' + 'live_' + 'mNoPqRsT9wXyZ2bC3dE4fG5hJ6kL'
// Fake AWS access-key fixture — the AWS docs `AKIA…EXAMPLE` literal
// is now correctly filtered as a vendor-doc placeholder, so we
// build a non-EXAMPLE-suffix shape at module load.
const FAKE_AKIA = 'AKIA' + 'V3QFKW72ZDLNP4XR'
// Email in a non-reserved domain (example.com / test.com / generic
// placeholder domains are now filtered).
const EMAIL = 'maya@hogwarts.edu'
const EMAIL_MASK = 'm***@hogwarts.edu'

// Conversation fixture covering 6+ detector kinds. Tuned so each rule
// claims a distinct region and the redactSummary categories actually
// fire as intended:
//   • email × 2 occurrences of the same address (dedupe + count)
//   • api-key × 2 distinct standalone tokens (AKIA + rk_live_)
//   • cloud-cred-ini (AWS INI line — wins over api-key for AKIA-in-INI)
//   • env-var (STRIPE_SECRET_KEY=… — wins over api-key for sk_live in assignment)
//   • absolute-path
//   • connection-string (overlapping url-creds; conn-string wins)
//   • author name (synthetic from bracketed [Maya])
const SENSITIVE_TURNS = [
  {
    role: 'user' as const,
    body: `reply to ${EMAIL} when ready`,
    author: '[Maya]',
  },
  {
    role: 'assistant' as const,
    body:
      `check /Users/chen/secrets/keys.txt — uses ${FAKE_AKIA} for AWS access. ` +
      `see the same key ${FAKE_AKIA} in the staging script.`,
  },
  {
    role: 'user' as const,
    body: `STRIPE_SECRET_KEY=${STRIPE_LIVE} and ${EMAIL}`,
  },
  {
    role: 'assistant' as const,
    body:
      `standalone stripe restricted key ${STRIPE_RK} for the API. ` +
      'try postgresql://admin:Zf8P9qXLpKvY@db.spoollab.io/main',
  },
  {
    role: 'user' as const,
    body: `[default]\naws_access_key_id = ${FAKE_AKIA}`,
  },
]

async function seedSensitiveDraft(window: Page, title: string): Promise<string> {
  return seedShareDraft(window, {
    title,
    conversation: {
      source: 'claude',
      sourceLabel: 'Claude',
      origin: { kind: 'web-share', platform: 'Claude' },
      title,
      shareUrl: null,
      createdAt: new Date().toISOString(),
      wordCount: 60,
      readMin: 1,
      turns: SENSITIVE_TURNS,
    },
  })
}

async function openSeededDraft(window: Page, title: string): Promise<void> {
  await waitForSync(window)
  // Force a fresh mount of SharesPage so it re-fetches the drafts list
  // and picks up whatever this test just seeded. Without this, when
  // SharesPage is already mounted (after a previous test's safeExit
  // left us there), the cached draft list does NOT auto-refresh and
  // the newly-seeded card never appears.
  await window.locator('[data-testid="sidebar-library"]').click().catch(() => {})
  await navigateToShares(window)
  const card = window
    .locator(`[data-testid="shares-draft-row"][aria-label="Open ${title}"]`)
    .first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
}

async function gotoPrivacyTab(window: Page): Promise<void> {
  await window.locator('[data-testid="share-editor-view-privacy"]').click()
  await expect(window.locator('[data-testid="share-editor-privacy-panel"]')).toBeVisible()
}

async function safeExit(window: Page): Promise<void> {
  // Idempotent — fine if the editor is already closed (assertion failure
  // mid-flow may have torn it down). Best-effort recovery.
  const back = window.getByRole('button', { name: 'Back' }).first()
  if (await back.isVisible().catch(() => false)) {
    await back.click().catch(() => {})
  }
}

/**
 * Run a per-test fixture+cleanup wrapper. Each test seeds its own
 * draft (so failures don't cascade across tests) and always tries to
 * return to a neutral surface in `finally` so the next test starts
 * predictably.
 */
async function withSensitiveDraft(
  testTitle: string,
  body: (window: Page, title: string) => Promise<void>,
): Promise<void> {
  const draftTitle = `Privacy e2e — ${testTitle}`
  await seedSensitiveDraft(ctx.window, draftTitle)
  try {
    await openSeededDraft(ctx.window, draftTitle)
    await body(ctx.window, draftTitle)
  } finally {
    await safeExit(ctx.window)
  }
}

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('Privacy tab lists every detected category for a mixed-sensitive draft', async () => {
  await withSensitiveDraft('list', async (window) => {
    await gotoPrivacyTab(window)
    const panel = window.locator('[data-testid="share-editor-privacy-panel"]')

    // Categories the fixture should produce.
    for (const slug of [
      'cloud-credentials',
      'connection-string',
      'api-key',
      'env-var-secret',
      'email',
      'absolute-path',
    ]) {
      await expect(panel.locator(`[data-testid="share-editor-privacy-row-${slug}"]`)).toBeVisible()
    }
    // Synthetic row from the bracketed [Maya] author.
    await expect(panel.locator('[data-testid="share-editor-privacy-row-author-name"]')).toBeVisible()

    // All bulk checkboxes default to 'all' (every match will be masked).
    await expect(panel.locator('[data-testid="share-editor-privacy-bulk-email"]'))
      .toHaveAttribute('aria-checked', 'true')
  })
})

test('Master toggle off hides the summary and shows the visible-count warning', async () => {
  await withSensitiveDraft('master-toggle', async (window) => {
    await gotoPrivacyTab(window)
    const summary = window.locator('[data-testid="share-editor-privacy-summary"]')
    await expect(summary).toBeVisible()
    await expect(window.locator('[data-testid="share-editor-privacy-warning"]')).toHaveCount(0)

    await window.locator('[data-testid="share-editor-toggle-redact"]').click()

    await expect(summary).toHaveCount(0)
    const warn = window.locator('[data-testid="share-editor-privacy-warning"]')
    await expect(warn).toBeVisible()
    await expect(warn).toContainText('will be visible')
    await expect(warn).toContainText('Enable redaction before sharing or exporting')

    await expect(window.locator('[data-testid="share-editor-privacy-count"]'))
      .toContainText('will be visible')
  })
})

test('Bulk checkbox toggles whole category and surfaces Reset; Reset clears', async () => {
  await withSensitiveDraft('bulk', async (window) => {
    await gotoPrivacyTab(window)
    const reset = window.locator('[data-testid="share-editor-privacy-reset"]')
    await expect(reset).toHaveCount(0)

    const emailBulk = window.locator('[data-testid="share-editor-privacy-bulk-email"]')
    await expect(emailBulk).toHaveAttribute('aria-checked', 'true')

    // Click bulk → kind is opted out.
    await emailBulk.click()
    await expect(emailBulk).toHaveAttribute('aria-checked', 'false')
    await expect(reset).toBeVisible()
    await expect(window.locator('[data-testid="share-editor-privacy-count"]'))
      .toContainText('visible')

    // Click again returns to all-masked.
    await emailBulk.click()
    await expect(emailBulk).toHaveAttribute('aria-checked', 'true')

    // Bulk-off again, then Reset returns to defaults.
    await emailBulk.click()
    await expect(emailBulk).toHaveAttribute('aria-checked', 'false')
    await reset.click()
    await expect(emailBulk).toHaveAttribute('aria-checked', 'true')
    await expect(reset).toHaveCount(0)
  })
})

test('Expanding a category reveals the real value rows', async () => {
  await withSensitiveDraft('expand', async (window) => {
    await gotoPrivacyTab(window)

    await window.locator('[data-testid="share-editor-privacy-row-email-header"]').click()
    await expect(window.getByTitle(EMAIL, { exact: true })).toBeVisible()

    // api-key category: AKIA (caught here, despite duplicate occurrences)
    // + the standalone rk_live_ Stripe key. The sk_live_ value in the
    // STRIPE_SECRET_KEY=… line is grabbed by env-var, not api-key.
    await window.locator('[data-testid="share-editor-privacy-row-api-key-header"]').click()
    await expect(window.getByTitle(FAKE_AKIA, { exact: true })).toBeVisible()
    await expect(
      window.getByTitle(STRIPE_RK, { exact: true }),
    ).toBeVisible()
  })
})

test('.spool sanitised download replaces literals with per-kind masks and strips redactExclude', async () => {
  await withSensitiveDraft('spool-download', async (window) => {
    await installSaveFilePickerMock(window)

    await window.locator('[data-testid="share-editor-download-trigger"]').click()
    await window.locator('[data-testid="share-editor-download-option-spool"]').click()

    const saved = await waitForSavedFile(window, '.spool')
    const doc = JSON.parse(new TextDecoder().decode(saved.bytes)) as {
      conversation: { turns: { body: string; author?: string }[] }
      opts: { redact: boolean; redactExclude?: unknown }
    }
    const bodyText = doc.conversation.turns.map((t) => t.body).join('\n')

    // Literals replaced.
    expect(bodyText).not.toContain(EMAIL)
    expect(bodyText).not.toContain(FAKE_AKIA)
    expect(bodyText).not.toContain(STRIPE_LIVE)
    expect(bodyText).not.toContain(STRIPE_RK)
    expect(bodyText).not.toContain('hunter2')

    // Per-kind masks present.
    expect(bodyText).toContain(EMAIL_MASK)
    expect(bodyText).toContain('[redacted: AWS key]')
    expect(bodyText).toContain('[redacted: Stripe key]')
    expect(bodyText).toContain('STRIPE_SECRET_KEY=[redacted]')
    expect(bodyText).toContain('postgresql://[redacted]')
    expect(bodyText).toContain('/Users/[redacted]')

    // Author label masked.
    const authorTurn = doc.conversation.turns.find((t) => t.author)
    expect(authorTurn?.author).toBe('[[redacted name]]')

    // Recipient gets no exclusion metadata.
    expect(doc.opts.redactExclude).toBeUndefined()
  })
})

test('Markdown export uses per-kind masks wrapped in inline code', async () => {
  await withSensitiveDraft('markdown-export', async (window) => {
    await installSaveFilePickerMock(window)

    await window.locator('[data-testid="share-editor-download-trigger"]').click()
    await window.locator('[data-testid="share-editor-download-option-md"]').click()

    const saved = await waitForSavedFile(window, '.md')
    const md = new TextDecoder().decode(saved.bytes)

    // Literals replaced.
    expect(md).not.toContain(EMAIL)
    expect(md).not.toContain(FAKE_AKIA)
    expect(md).not.toContain(STRIPE_LIVE)

    // Per-kind masks wrapped in backticks for chip rendering in markdown viewers.
    expect(md).toMatch(/`m\*\*\*@hogwarts\.edu`/)
    expect(md).toContain('`[redacted: AWS key]`')
    expect(md).toContain('`[redacted: Stripe key]`')
    expect(md).toContain('`STRIPE_SECRET_KEY=[redacted]`')
  })
})

test('Per-item opt-out keeps that value verbatim in the sanitised .spool', async () => {
  await withSensitiveDraft('per-item', async (window) => {
    await gotoPrivacyTab(window)

    // Expand email category, click the row to opt out ${EMAIL}.
    await window.locator('[data-testid="share-editor-privacy-row-email-header"]').click()
    await window.getByTitle(EMAIL, { exact: true }).click()

    await expect(window.locator('[data-testid="share-editor-privacy-reset"]')).toBeVisible()
    await expect(window.locator('[data-testid="share-editor-privacy-count"]'))
      .toContainText('visible')

    await installSaveFilePickerMock(window)
    await window.locator('[data-testid="share-editor-download-trigger"]').click()
    await window.locator('[data-testid="share-editor-download-option-spool"]').click()

    const saved = await waitForSavedFile(window, '.spool')
    const doc = JSON.parse(new TextDecoder().decode(saved.bytes)) as {
      conversation: { turns: { body: string }[] }
    }
    const bodyText = doc.conversation.turns.map((t) => t.body).join('\n')

    // Whitelisted email stays.
    expect(bodyText).toContain(EMAIL)
    // Non-whitelisted secrets still masked.
    expect(bodyText).not.toContain(FAKE_AKIA)
    expect(bodyText).toContain('[redacted: AWS key]')
  })
})

test('redactExclude persists through draft autosave and reload', async () => {
  const draftTitle = 'Privacy e2e — persist'
  await seedSensitiveDraft(ctx.window, draftTitle)
  try {
    await openSeededDraft(ctx.window, draftTitle)
    await gotoPrivacyTab(ctx.window)

    // Allow all emails via bulk.
    await ctx.window.locator('[data-testid="share-editor-privacy-bulk-email"]').click()
    await expect(
      ctx.window.locator('[data-testid="share-editor-privacy-bulk-email"]'),
    ).toHaveAttribute('aria-checked', 'false')

    // Autosave debounce is 400ms — wait a safe margin.
    await ctx.window.waitForTimeout(800)

    // Navigate away + come back.
    await safeExit(ctx.window)
    await openSeededDraft(ctx.window, draftTitle)
    await gotoPrivacyTab(ctx.window)

    await expect(
      ctx.window.locator('[data-testid="share-editor-privacy-bulk-email"]'),
    ).toHaveAttribute('aria-checked', 'false')
    await expect(ctx.window.locator('[data-testid="share-editor-privacy-reset"]')).toBeVisible()
  } finally {
    await safeExit(ctx.window)
  }
})

test('No sensitive data → empty state', async () => {
  const draftTitle = 'Privacy e2e — clean'
  await seedShareDraft(ctx.window, {
    title: draftTitle,
    conversation: {
      source: 'claude',
      sourceLabel: 'Claude',
      origin: { kind: 'web-share', platform: 'Claude' },
      title: draftTitle,
      shareUrl: null,
      createdAt: new Date().toISOString(),
      wordCount: 6,
      readMin: 1,
      turns: [
        { role: 'user', body: 'just a benign conversation about cats' },
        { role: 'assistant', body: 'cats are great. nothing sensitive here.' },
      ],
    },
  })
  try {
    await openSeededDraft(ctx.window, draftTitle)
    await gotoPrivacyTab(ctx.window)

    await expect(ctx.window.locator('[data-testid="share-editor-privacy-clean"]')).toBeVisible()
    await expect(ctx.window.locator('[data-testid="share-editor-privacy-count"]'))
      .toContainText('none detected')
    await expect(ctx.window.locator('[data-testid^="share-editor-privacy-row-"]'))
      .toHaveCount(0)
  } finally {
    await safeExit(ctx.window)
  }
})
