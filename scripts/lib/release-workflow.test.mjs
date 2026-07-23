import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vite-plus/test'

const repoRoot = new URL('../..', import.meta.url)
const releaseWorkflow = readFileSync(new URL('.github/workflows/release.yml', repoRoot), 'utf8')
const deployWorkflow = readFileSync(new URL('.github/workflows/deploy-web.yml', repoRoot), 'utf8')

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

  test('ships a CLI-only release and deploys web after npm succeeds', () => {
    expect(releaseWorkflow).not.toMatch(/build-mac|build-linux|package:mac|package:linux|\.dmg/)
    expect(releaseWorkflow).toContain('needs: publish-npm')
    expect(releaseWorkflow).toContain('curl -fsSL https://spool.new/install.sh | sh')
    expect(releaseWorkflow).toContain(
      'gh workflow run deploy-web.yml --ref "$release_ref" -f target=production',
    )
  })

  test('refuses to publish npm packages from a non-version tag', () => {
    expect(releaseWorkflow).toContain('Verify release tag')
    expect(releaseWorkflow).toContain("GITHUB_REF_TYPE\" != 'tag'")
    expect(releaseWorkflow).toContain('GITHUB_REF_NAME\" != \"$expected_tag')
    expect(releaseWorkflow).toContain('git rev-list -n 1 \"$expected_tag\"')
  })

  test('blocks production web until the matching CLI package is published', () => {
    expect(deployWorkflow).toContain('Check matching CLI release')
    expect(deployWorkflow).toContain('git diff --quiet "$tag"')
    expect(deployWorkflow).toContain('npm view "@spool-lab/cli@${version}" version')
  })

  test('skips only ineligible automatic production deployments', () => {
    const gateJob = deployWorkflow.match(/  release-gate:[\s\S]*?(?=\n  deploy:)/)?.[0]
    const deployJob = deployWorkflow.match(/^  deploy:[\s\S]*?steps:/m)?.[0]

    expect(deployWorkflow).toContain('push:\n    branches: [main]')
    expect(gateJob).toBeDefined()
    expect(gateJob).toContain('if [ "$GITHUB_EVENT_NAME" = \'push\' ]')
    expect(gateJob).toContain('echo "deploy=false" >> "$GITHUB_OUTPUT"')
    expect(gateJob).toContain('echo "::error::${reason}"')
    expect(deployJob).toContain('needs: release-gate')
    expect(deployJob).toContain("if: needs.release-gate.outputs.deploy == 'true'")
    expect(deployWorkflow).toContain('Verify Cloudflare D1 access')
  })
})
