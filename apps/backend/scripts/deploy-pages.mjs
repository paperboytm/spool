import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PAPERBOY_ACCOUNT_ID = '6898ecdad1e8341d3e09d4b46124d72e'
const targets = {
  production: {
    branch: 'main',
    config: 'wrangler.prod.toml',
    project: 'spool-share-backend',
  },
  staging: {
    branch: 'main',
    config: 'wrangler.staging.toml',
    project: 'spool-share-backend-staging',
  },
}

const targetName = process.argv[2]
const target = targets[targetName]
if (target === undefined) {
  console.error('Usage: node scripts/deploy-pages.mjs <production|staging>')
  process.exit(2)
}

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const redirectPath = join(appDir, '.wrangler', 'deploy', 'config.json')
const commitHash = process.env.GITHUB_SHA?.trim()
if (commitHash !== undefined && !/^[0-9a-f]{40}$/i.test(commitHash)) {
  throw new Error('GITHUB_SHA must be a full 40-character Git commit hash')
}
let previousRedirect = null
let generatedConfigPath = null

try {
  previousRedirect = await readFile(redirectPath)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

let child
let signal = null
try {
  let effectiveConfig = target.config
  if (commitHash) {
    const source = await readFile(join(appDir, target.config), 'utf8')
    if (!source.includes('\n[vars]\n') || /^BUILD_VERSION\s*=/m.test(source)) {
      throw new Error(`${target.config} must contain one [vars] table without BUILD_VERSION`)
    }
    const generatedName = `.wrangler-deploy-${process.pid}.toml`
    generatedConfigPath = join(appDir, generatedName)
    await writeFile(
      generatedConfigPath,
      source.replace('\n[vars]\n', `\n[vars]\nBUILD_VERSION = "${commitHash}"\n`),
    )
    effectiveConfig = generatedName
  }

  await mkdir(dirname(redirectPath), { recursive: true })
  await writeFile(
    redirectPath,
    `${JSON.stringify({ configPath: `../../${effectiveConfig}` }, null, 2)}\n`,
  )

  child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    [
      'exec',
      'wrangler',
      'pages',
      'deploy',
      'public',
      '--project-name',
      target.project,
      '--branch',
      target.branch,
      ...(commitHash ? ['--commit-hash', commitHash] : []),
    ],
    {
      cwd: appDir,
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: PAPERBOY_ACCOUNT_ID,
      },
      stdio: 'inherit',
    },
  )

  const forwardSignal = (received) => {
    signal = received
    child.kill(received)
  }
  process.once('SIGINT', forwardSignal)
  process.once('SIGTERM', forwardSignal)

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, childSignal) => {
      signal ??= childSignal
      resolve(code ?? 1)
    })
  })
  process.exitCode = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : exitCode
} finally {
  if (previousRedirect === null) await rm(redirectPath, { force: true })
  else await writeFile(redirectPath, previousRedirect)
  if (generatedConfigPath !== null) await rm(generatedConfigPath, { force: true })
}
