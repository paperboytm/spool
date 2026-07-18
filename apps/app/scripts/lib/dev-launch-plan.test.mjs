import { describe, expect, test } from 'vite-plus/test'

import electronViteConfig from '../../electron.vite.config.ts'
import { DEV_LAUNCH_PLAN } from './dev-launch-plan.mjs'

describe('Electron dev launch plan', () => {
  test('builds isolated worker entries before starting Electron', () => {
    expect(DEV_LAUNCH_PLAN).toEqual([
      {
        label: 'Electron workers',
        command: 'electron-vite',
        args: ['build', '--config', 'electron.workers.vite.config.ts'],
      },
      {
        label: 'Electron app',
        command: 'electron-vite',
        args: ['dev'],
      },
    ])
  })

  test('preserves the worker output when the dev main bundle starts', async () => {
    const resolveConfig = electronViteConfig
    const devConfig = await resolveConfig({ command: 'serve', mode: 'development' })
    const buildConfig = await resolveConfig({ command: 'build', mode: 'production' })

    expect(devConfig.main.build.emptyOutDir).toBe(false)
    expect(buildConfig.main.build.emptyOutDir).toBeUndefined()
  })
})
