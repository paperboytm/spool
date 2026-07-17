import { test, expect } from '@playwright/test'
import { launchDemoApp, setDemoWindowBounds, waitForDemoSync } from './helpers/demo-launch'
import type { ProjectSeed } from './helpers/demo-fixtures'

const PROJECTS: ProjectSeed[] = [
  {
    name: 'spool',
    total: 5,
    leadSessions: [{ title: 'Hello', source: 'claude', iso: '2026-05-14T15:42:00Z' }],
    fillerSources: ['claude'],
  },
]

test('demo app launches', async () => {
  test.setTimeout(120_000)
  console.log('[smoke] launching')
  const ctx = await launchDemoApp(PROJECTS)
  console.log('[smoke] launched')
  await setDemoWindowBounds(ctx, 1080, 740)
  console.log('[smoke] bounds set')
  await waitForDemoSync(ctx.window)
  console.log('[smoke] synced')
  await expect(ctx.window.locator('[data-testid="sidebar-project-row"]').first()).toBeVisible()
  console.log('[smoke] project visible')
  await ctx.cleanup()
})
