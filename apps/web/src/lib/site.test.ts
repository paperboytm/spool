import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import sharp from 'sharp'
import { describe, expect, it } from 'vite-plus/test'

import { PUBLIC_SITE_ORIGIN, SITE_OG_IMAGE_ALT, SITE_OG_IMAGE_URL, siteOgImageMeta } from './site'

const APPROVED_OG_SHA256 = 'dd5f9c53f63cdbacb8b1df1e27c58ecd133a5f97300d0da5d938dc32a1f3625f'
const LEGACY_OG_SHA256 = 'dcd4a3f4f39857049c91fd7e4ee5d6ac21a92cd0d7b3e36e46215b81e82a1b6c'

const canonicalAsset = new URL('../assets/site-og.png', import.meta.url)
const compatibilityAsset = new URL('../../public/og-image.png', import.meta.url)
const staticHeaders = new URL('../../public/_headers', import.meta.url)

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function exactPixelCount(
  pixels: Buffer,
  channels: number,
  target: readonly [number, number, number],
): number {
  let count = 0
  for (let offset = 0; offset < pixels.length; offset += channels) {
    if (
      pixels[offset] === target[0] &&
      pixels[offset + 1] === target[1] &&
      pixels[offset + 2] === target[2]
    ) {
      count += 1
    }
  }
  return count
}

describe('site OG image contract', () => {
  it('ships the approved 1200x630 PNG at canonical and compatibility paths', async () => {
    const [canonical, compatibility] = await Promise.all([
      readFile(canonicalAsset),
      readFile(compatibilityAsset),
    ])

    expect(compatibility.equals(canonical)).toBe(true)
    expect(sha256(canonical)).toBe(APPROVED_OG_SHA256)
    expect(sha256(canonical)).not.toBe(LEGACY_OG_SHA256)

    const metadata = await sharp(canonical).metadata()
    expect(metadata).toMatchObject({ format: 'png', width: 1200, height: 630 })
  })

  it('uses the void and Paperboy-blue palette without the legacy amber pixels', async () => {
    const canonical = await readFile(canonicalAsset)
    const { data, info } = await sharp(canonical)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect(exactPixelCount(data, info.channels, [0, 0, 0])).toBeGreaterThan(300_000)
    expect(exactPixelCount(data, info.channels, [91, 177, 240])).toBeGreaterThan(1_000)
    expect(exactPixelCount(data, info.channels, [200, 90, 0])).toBe(0)
    expect(exactPixelCount(data, info.channels, [20, 20, 16])).toBe(0)
  })
})

describe('site OG metadata', () => {
  it('uses the fingerprintable canonical asset instead of the compatibility pathname', () => {
    const url = new URL(SITE_OG_IMAGE_URL)

    expect(url.origin).toBe(PUBLIC_SITE_ORIGIN)
    expect(url.pathname).not.toBe('/og-image.png')
    // Vite's test transform preserves its internal no-inline marker; the
    // production build contract below verifies that emitted metadata does not.
    expect(['', '?no-inline']).toContain(url.search)
  })

  it('emits one complete Open Graph and Twitter image contract', () => {
    expect(siteOgImageMeta()).toEqual([
      { property: 'og:image', content: SITE_OG_IMAGE_URL },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: SITE_OG_IMAGE_ALT },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: SITE_OG_IMAGE_URL },
      { name: 'twitter:image:alt', content: SITE_OG_IMAGE_ALT },
    ])
  })

  it('makes only fingerprinted assets immutable', async () => {
    const headers = await readFile(staticHeaders, 'utf8')

    expect(headers).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')
    expect(headers).not.toMatch(/\/og-image\.png[\s\S]*immutable/)
  })
})
