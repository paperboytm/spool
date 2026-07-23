#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = join(scriptDir, '..')
const sourceAsset = join(packageDir, 'src', 'assets', 'site-og.png')
const compatibilityAsset = join(packageDir, 'public', 'og-image.png')
const checkOnly = process.argv.includes('--check')
if (process.platform === 'darwin') {
  process.env.FONTCONFIG_FILE ??= join(scriptDir, 'site-og-fontconfig.xml')
}

// Keep typography tied to the exact self-hosted faces used by the app.
// sharp hands these files directly to Pango, so the host's installed fonts
// never affect the generated pixels.
const geistSans = require.resolve('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')
const geistMono = require.resolve('@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2')

const WIDTH = 1200
const HEIGHT = 630
const VOID = '#000000'
const SURFACE = '#090909'
const BORDER = '#1F1F1F'
const TEXT = '#FFFFFF'
const MUTED = '#A6A6A6'
const BLUE = '#5BB1F0'

const geometry = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
      <path d="M34 0H0V34" fill="none" stroke="${BORDER}" stroke-width="1" opacity=".48"/>
    </pattern>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${BLUE}" stop-opacity=".28"/>
      <stop offset=".45" stop-color="${BLUE}" stop-opacity=".09"/>
      <stop offset="1" stop-color="${BLUE}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft-glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="11"/>
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${VOID}"/>
  <rect x="748" width="452" height="${HEIGHT}" fill="url(#grid)" opacity=".72"/>
  <rect x="748" width="1" height="${HEIGHT}" fill="${BORDER}"/>
  <circle cx="972" cy="286" r="242" fill="url(#glow)"/>

  <!-- Canonical wound-spool mark from the production favicon. -->
  <g transform="translate(63 63) scale(1.28)" fill="none" stroke="${BLUE}" stroke-linecap="round">
    <ellipse cx="16" cy="7.2" rx="12.2" ry="4.1" fill="${BLUE}" stroke="none"/>
    <path d="M7 12.2 C13 15.8 19.5 15.4 25 14.2" stroke-width="1.9"/>
    <path d="M7 16.4 C13 20 19.5 19.6 25 18.4" stroke-width="1.9"/>
    <path d="M7 20.6 C13 24.2 19.5 23.8 25 22.6" stroke-width="1.9"/>
    <path d="M25 22.6 C26.8 24.4 28.4 25.6 30.4 26.2" stroke-width="1.7"/>
  </g>

  <!-- Local agent records flowing into one shared knowledge space. -->
  <g fill="none" stroke="${BLUE}" stroke-linecap="round">
    <path d="M793 187 C854 194 858 257 909 269" stroke-width="1.5" opacity=".72"/>
    <path d="M795 379 C849 372 868 315 911 299" stroke-width="1.5" opacity=".72"/>
    <path d="M1016 279 C1062 255 1093 220 1137 192" stroke-width="1.5" opacity=".72"/>
    <path d="M1018 303 C1062 332 1092 374 1138 397" stroke-width="1.5" opacity=".72"/>
    <path d="M971 338 C970 383 973 421 973 460" stroke-width="1.5" opacity=".72"/>
  </g>

  <g>
    <rect x="781" y="147" width="120" height="76" rx="10" fill="${SURFACE}" stroke="${BORDER}"/>
    <circle cx="799" cy="165" r="3" fill="${BLUE}"/>
    <rect x="812" y="162" width="57" height="6" rx="3" fill="${MUTED}" opacity=".7"/>
    <rect x="797" y="183" width="78" height="5" rx="2.5" fill="${TEXT}" opacity=".7"/>
    <rect x="797" y="198" width="48" height="5" rx="2.5" fill="${MUTED}" opacity=".42"/>

    <rect x="781" y="341" width="120" height="76" rx="10" fill="${SURFACE}" stroke="${BORDER}"/>
    <circle cx="799" cy="359" r="3" fill="${BLUE}"/>
    <rect x="812" y="356" width="57" height="6" rx="3" fill="${MUTED}" opacity=".7"/>
    <rect x="797" y="377" width="68" height="5" rx="2.5" fill="${TEXT}" opacity=".7"/>
    <rect x="797" y="392" width="80" height="5" rx="2.5" fill="${MUTED}" opacity=".42"/>
  </g>

  <circle cx="970" cy="287" r="106" fill="${BLUE}" opacity=".12" filter="url(#soft-glow)"/>
  <circle cx="970" cy="287" r="91" fill="${SURFACE}" stroke="${BLUE}" stroke-width="1.5"/>
  <circle cx="970" cy="287" r="77" fill="${VOID}" stroke="${BORDER}"/>

  <g transform="translate(912 228) scale(3.62)" fill="none" stroke="${BLUE}" stroke-linecap="round">
    <ellipse cx="16" cy="7.2" rx="12.2" ry="4.1" fill="${BLUE}" stroke="none"/>
    <path d="M7 12.2 C13 15.8 19.5 15.4 25 14.2" stroke-width="1.9"/>
    <path d="M7 16.4 C13 20 19.5 19.6 25 18.4" stroke-width="1.9"/>
    <path d="M7 20.6 C13 24.2 19.5 23.8 25 22.6" stroke-width="1.9"/>
    <path d="M25 22.6 C26.8 24.4 28.4 25.6 30.4 26.2" stroke-width="1.7"/>
  </g>

  <g fill="${SURFACE}" stroke="${BLUE}" stroke-width="1.5">
    <circle cx="793" cy="187" r="7"/>
    <circle cx="795" cy="379" r="7"/>
    <circle cx="1137" cy="192" r="7"/>
    <circle cx="1138" cy="397" r="7"/>
    <circle cx="973" cy="460" r="7"/>
  </g>
  <g fill="${BLUE}">
    <circle cx="793" cy="187" r="2.5"/>
    <circle cx="795" cy="379" r="2.5"/>
    <circle cx="1137" cy="192" r="2.5"/>
    <circle cx="1138" cy="397" r="2.5"/>
    <circle cx="973" cy="460" r="2.5"/>
  </g>

  <line x1="64" y1="529" x2="1136" y2="529" stroke="${BORDER}"/>
</svg>
`)

function textInput(text, { font, fontfile, size, width, spacing = 0 }) {
  return {
    text: {
      text,
      font: `${font} ${size}`,
      fontfile,
      ...(width ? { width } : {}),
      spacing,
      rgba: true,
      dpi: 72,
    },
  }
}

async function renderText(sharp, text, options) {
  return sharp(textInput(text, options)).png().toBuffer()
}

async function buildPng() {
  // Load sharp lazily so this script stays importable by small contract tools
  // without initializing libvips until generation is actually requested.
  const { default: sharp } = await import('sharp')

  const [
    wordmark,
    eyebrow,
    headlineOne,
    headlineTwo,
    subhead,
    footer,
    origin,
    localLabel,
    sharedLabel,
    resumeLabel,
  ] = await Promise.all([
    renderText(
      sharp,
      `<span foreground="${TEXT}" font_weight="700">Spool</span><span foreground="${BLUE}" font_weight="700">.</span>`,
      { font: 'Geist', fontfile: geistSans, size: 42 },
    ),
    renderText(
      sharp,
      `<span foreground="${BLUE}" font_weight="600" letter_spacing="1700">PUBLIC AGENT WORK, END TO END</span>`,
      { font: 'Geist', fontfile: geistSans, size: 13 },
    ),
    renderText(
      sharp,
      `<span foreground="${TEXT}" font_weight="600" letter_spacing="-650">One shared space</span>`,
      { font: 'Geist', fontfile: geistSans, size: 64 },
    ),
    renderText(
      sharp,
      `<span foreground="${TEXT}" font_weight="600" letter_spacing="-650">for agent sessions</span><span foreground="${BLUE}" font_weight="600">.</span>`,
      { font: 'Geist', fontfile: geistSans, size: 64 },
    ),
    renderText(
      sharp,
      `<span foreground="${MUTED}" font_weight="400">Real Sessions. Shared knowledge. Resumable work.</span>`,
      { font: 'Geist', fontfile: geistSans, size: 21 },
    ),
    renderText(
      sharp,
      `<span foreground="${BLUE}" letter_spacing="1400">READ  ·  SEARCH  ·  RESUME</span>`,
      { font: 'Geist Mono', fontfile: geistMono, size: 13 },
    ),
    renderText(sharp, `<span foreground="${MUTED}">spool.new</span>`, {
      font: 'Geist Mono',
      fontfile: geistMono,
      size: 14,
    }),
    renderText(sharp, `<span foreground="${MUTED}" letter_spacing="900">LOCAL</span>`, {
      font: 'Geist Mono',
      fontfile: geistMono,
      size: 10,
    }),
    renderText(sharp, `<span foreground="${BLUE}" letter_spacing="900">SHARED</span>`, {
      font: 'Geist Mono',
      fontfile: geistMono,
      size: 10,
    }),
    renderText(sharp, `<span foreground="${MUTED}" letter_spacing="900">RESUME</span>`, {
      font: 'Geist Mono',
      fontfile: geistMono,
      size: 10,
    }),
  ])

  const originMeta = await sharp(origin).metadata()

  return sharp(geometry)
    .composite([
      { input: wordmark, left: 112, top: 63 },
      { input: eyebrow, left: 66, top: 169 },
      { input: headlineOne, left: 62, top: 215 },
      { input: headlineTwo, left: 62, top: 291 },
      { input: subhead, left: 66, top: 408 },
      { input: footer, left: 66, top: 558 },
      { input: origin, left: 1134 - (originMeta.width ?? 0), top: 555 },
      { input: localLabel, left: 813, top: 447 },
      { input: sharedLabel, left: 947, top: 487 },
      { input: resumeLabel, left: 1080, top: 447 },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function assertCurrent(path, expected) {
  let actual
  try {
    actual = await readFile(path)
  } catch {
    throw new Error(`${path} is missing; run pnpm --filter @spool/web og:generate`)
  }
  if (!actual.equals(expected)) {
    throw new Error(`${path} is stale; run pnpm --filter @spool/web og:generate`)
  }
}

const png = await buildPng()
const sha256 = digest(png)

if (checkOnly) {
  await Promise.all([assertCurrent(sourceAsset, png), assertCurrent(compatibilityAsset, png)])
  console.log(`[site-og] assets match generator (${sha256})`)
} else {
  await Promise.all([
    mkdir(dirname(sourceAsset), { recursive: true }),
    mkdir(dirname(compatibilityAsset), { recursive: true }),
  ])
  await Promise.all([writeFile(sourceAsset, png), writeFile(compatibilityAsset, png)])
  console.log(`[site-og] wrote 1200x630 PNG to canonical + compatibility paths (${sha256})`)
}
