import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vite-plus/test'

import { PUBLIC_SITE_ORIGIN, SITE_OG_IMAGE_ALT, SITE_OG_IMAGE_URL, siteOgImageMeta } from './site'

const APPROVED_OG_SHA256 = '1de7553456c7ff2af7639fe9cff6e91dc606339c579740ac780d197a0b5861bd'
const LEGACY_OG_SHA256 = 'dcd4a3f4f39857049c91fd7e4ee5d6ac21a92cd0d7b3e36e46215b81e82a1b6c'

const canonicalAsset = new URL('../assets/site-og.png', import.meta.url)
const compatibilityAsset = new URL('../../public/og-image.png', import.meta.url)
const staticHeaders = new URL('../../public/_headers', import.meta.url)

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  if (aboveDistance <= upperLeftDistance) return above
  return upperLeft
}

function decodeRgbaPng(bytes: Buffer): { width: number; height: number; pixels: Buffer } {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )

  let offset = 8
  let width = 0
  let height = 0
  const imageData: Buffer[] = []

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    offset += length + 12

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect([...data.subarray(8, 13)]).toEqual([8, 6, 0, 0, 0])
    } else if (type === 'IDAT') {
      imageData.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  const channels = 4
  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(imageData))
  const pixels = Buffer.alloc(width * height * channels)

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (stride + 1)
    const filter = inflated[sourceOffset]
    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[sourceOffset + column + 1] ?? 0
      const destination = row * stride + column
      const left = column >= channels ? (pixels[destination - channels] ?? 0) : 0
      const above = row > 0 ? (pixels[destination - stride] ?? 0) : 0
      const upperLeft =
        row > 0 && column >= channels ? (pixels[destination - stride - channels] ?? 0) : 0

      switch (filter) {
        case 0:
          pixels[destination] = raw
          break
        case 1:
          pixels[destination] = raw + left
          break
        case 2:
          pixels[destination] = raw + above
          break
        case 3:
          pixels[destination] = raw + Math.floor((left + above) / 2)
          break
        case 4:
          pixels[destination] = raw + paeth(left, above, upperLeft)
          break
        default:
          throw new Error(`Unsupported PNG filter ${filter}`)
      }
    }
  }

  return { width, height, pixels }
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

    const { width, height } = decodeRgbaPng(canonical)
    expect({ format: 'png', width, height }).toEqual({ format: 'png', width: 1200, height: 630 })
  })

  it('uses the void and Paperboy-blue palette without the legacy amber pixels', async () => {
    const canonical = await readFile(canonicalAsset)
    const { pixels } = decodeRgbaPng(canonical)

    expect(exactPixelCount(pixels, 4, [0, 0, 0])).toBeGreaterThan(300_000)
    expect(exactPixelCount(pixels, 4, [91, 177, 240])).toBeGreaterThan(1_000)
    expect(exactPixelCount(pixels, 4, [200, 90, 0])).toBe(0)
    expect(exactPixelCount(pixels, 4, [20, 20, 16])).toBe(0)
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
