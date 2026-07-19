import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vite-plus/test'

const repoRoot = new URL('../..', import.meta.url)
const releaseWorkflow = readFileSync(new URL('.github/workflows/release.yml', repoRoot), 'utf8')

describe('npm release workflow', () => {
  test('builds every publish target through its prepack script', () => {
    const buildBlock = releaseWorkflow.match(
      /- name: Build publish targets[\s\S]*?(?=\n      - name:)/,
    )?.[0]
    const publishDirectories = [
      ...releaseWorkflow.matchAll(/^\s+publish_if_missing ([^\s]+)$/gm),
    ].map((match) => match[1])

    expect(buildBlock).toBeDefined()
    expect(publishDirectories.length).toBeGreaterThan(0)

    for (const packageDirectory of publishDirectories) {
      const manifest = JSON.parse(
        readFileSync(new URL(`${packageDirectory}/package.json`, repoRoot), 'utf8'),
      )
      expect(buildBlock).toContain(`pnpm -F ${manifest.name} run prepack`)
    }
  })
})
