#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = join(scriptDir, '..')
const clientDir = join(packageDir, 'dist', 'client')
const canonicalAsset = await readFile(join(packageDir, 'src', 'assets', 'site-og.png'))
const compatibilityAsset = await readFile(join(clientDir, 'og-image.png'))

function invariant(condition, message) {
  if (!condition) throw new Error(`[site-og build] ${message}`)
}

function metaContent(html, key, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tag = html.match(new RegExp(`<meta[^>]+${key}="${escaped}"[^>]*>`))?.[0]
  return tag?.match(/\bcontent="([^"]+)"/)?.[1] ?? null
}

invariant(
  compatibilityAsset.equals(canonicalAsset),
  'dist/client/og-image.png must stay byte-identical to the canonical asset',
)

const emittedCandidates = (await readdir(join(clientDir, 'assets'))).filter((name) =>
  /^site-og-[A-Za-z0-9_-]+\.png$/.test(name),
)
invariant(
  emittedCandidates.length === 1,
  `expected one fingerprinted site OG asset, found ${emittedCandidates.length}`,
)

const emittedName = emittedCandidates[0]
const emittedAsset = await readFile(join(clientDir, 'assets', emittedName))
invariant(emittedAsset.equals(canonicalAsset), `${emittedName} differs from the canonical asset`)

const expectedUrl = `https://spool.new/assets/${emittedName}`
const pages = [
  ['/', join(clientDir, 'index.html')],
  ['/daemon', join(clientDir, 'daemon', 'index.html')],
  ['/blog', join(clientDir, 'blog', 'index.html')],
]

for (const [route, path] of pages) {
  const html = await readFile(path, 'utf8')
  const ogImage = metaContent(html, 'property', 'og:image')
  const twitterImage = metaContent(html, 'name', 'twitter:image')

  invariant(ogImage === expectedUrl, `${route} og:image is ${ogImage ?? 'missing'}`)
  invariant(twitterImage === expectedUrl, `${route} twitter:image is ${twitterImage ?? 'missing'}`)
  invariant(!html.includes('https://spool.new/og-image.png'), `${route} still uses the legacy URL`)
}

const headers = await readFile(join(clientDir, '_headers'), 'utf8')
invariant(
  headers.includes('/assets/*\n  Cache-Control: public, max-age=31536000, immutable'),
  'fingerprinted asset cache policy is missing',
)

console.log(`[site-og build] verified canonical, compatibility, and ${emittedName}`)
