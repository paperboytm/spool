// Unit tests for the avatar image utility module — MIME sniff,
// dimension parse, EXIF/metadata strip. These are pure-byte helpers
// (no Workers runtime needed) so the suite runs as plain vitest.

import { describe, expect, it } from 'vitest'

import {
  MAX_AVATAR_BYTES,
  MAX_AVATAR_DIM,
  MIN_AVATAR_DIM,
  readDimensions,
  sniffMime,
  stripMetadata,
} from '../src/profile/image'

// ─── fixtures ──────────────────────────────────────────────────────

/** 1x1 PNG header — enough to sniff + dimension-read, won't decode
 *  but the helpers don't decode either. Header is constructed by hand
 *  so the test asserts the exact byte layout the parser expects. */
function buildPngHeader(width: number, height: number, extraChunks: Uint8Array = new Uint8Array()): Uint8Array {
  // Signature (8) + IHDR chunk (4 len + 4 type + 13 data + 4 crc = 25)
  const buf = new Uint8Array(8 + 25 + extraChunks.length + 12)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  // IHDR chunk
  // length (13)
  buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 13
  // type 'IHDR'
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52
  // width
  buf[16] = (width >> 24) & 0xff
  buf[17] = (width >> 16) & 0xff
  buf[18] = (width >> 8) & 0xff
  buf[19] = width & 0xff
  // height
  buf[20] = (height >> 24) & 0xff
  buf[21] = (height >> 16) & 0xff
  buf[22] = (height >> 8) & 0xff
  buf[23] = height & 0xff
  // bit depth + color + compression + filter + interlace (set to plausible vals)
  buf[24] = 8; buf[25] = 6; buf[26] = 0; buf[27] = 0; buf[28] = 0
  // crc placeholder
  buf[29] = 0; buf[30] = 0; buf[31] = 0; buf[32] = 0
  // extra chunks
  buf.set(extraChunks, 33)
  // IEND
  const off = 33 + extraChunks.length
  buf[off] = 0; buf[off + 1] = 0; buf[off + 2] = 0; buf[off + 3] = 0
  buf[off + 4] = 0x49; buf[off + 5] = 0x45; buf[off + 6] = 0x4e; buf[off + 7] = 0x44
  buf[off + 8] = 0; buf[off + 9] = 0; buf[off + 10] = 0; buf[off + 11] = 0
  return buf
}

/** Build a fake EXIF PNG chunk (eXIf type, with arbitrary data bytes). */
function buildExifChunk(): Uint8Array {
  const data = new TextEncoder().encode('fake-exif-data')
  const buf = new Uint8Array(12 + data.length)
  buf[0] = (data.length >> 24) & 0xff
  buf[1] = (data.length >> 16) & 0xff
  buf[2] = (data.length >> 8) & 0xff
  buf[3] = data.length & 0xff
  buf[4] = 0x65; buf[5] = 0x58; buf[6] = 0x49; buf[7] = 0x66 // 'eXIf'
  buf.set(data, 8)
  // CRC placeholder
  buf[8 + data.length] = 0; buf[9 + data.length] = 0
  buf[10 + data.length] = 0; buf[11 + data.length] = 0
  return buf
}

// ─── sniffMime ─────────────────────────────────────────────────────

describe('sniffMime', () => {
  it('detects PNG from the 8-byte signature', () => {
    const buf = new Uint8Array(12)
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffMime(buf)).toBe('image/png')
  })

  it('detects JPEG from the FF D8 FF prefix', () => {
    const buf = new Uint8Array(12)
    buf.set([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffMime(buf)).toBe('image/jpeg')
  })

  it('detects WebP via RIFF...WEBP header', () => {
    const buf = new Uint8Array(12)
    buf.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(sniffMime(buf)).toBe('image/webp')
  })

  it('rejects HTML disguised as image', () => {
    const buf = new TextEncoder().encode('<html><body>...</body>')
    expect(sniffMime(buf)).toBeNull()
  })

  it('rejects GIF (not allow-listed)', () => {
    const buf = new TextEncoder().encode('GIF89a')
    expect(sniffMime(buf)).toBeNull()
  })

  it('rejects too-short buffers', () => {
    const buf = new Uint8Array([0x89, 0x50])
    expect(sniffMime(buf)).toBeNull()
  })
})

// ─── readDimensions ────────────────────────────────────────────────

describe('readDimensions', () => {
  it('reads PNG width/height from IHDR', () => {
    const buf = buildPngHeader(120, 80)
    expect(readDimensions('image/png', buf)).toEqual({ width: 120, height: 80 })
  })

  it('reads JPEG dimensions from SOF0 marker', () => {
    // SOI + SOF0(0xC0) + segLen=11 + bits=8 + height(BE u16) + width(BE u16) + components=3
    const buf = new Uint8Array(20)
    buf[0] = 0xff; buf[1] = 0xd8 // SOI
    buf[2] = 0xff; buf[3] = 0xc0 // SOF0
    buf[4] = 0; buf[5] = 11 // segLen
    buf[6] = 8 // bits
    buf[7] = 0; buf[8] = 80 // height = 80
    buf[9] = 0; buf[10] = 120 // width = 120
    expect(readDimensions('image/jpeg', buf)).toEqual({ width: 120, height: 80 })
  })

  it('rejects malformed PNG (truncated IHDR)', () => {
    const buf = new Uint8Array(16) // too short for IHDR width/height
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(readDimensions('image/png', buf)).toBeNull()
  })

  it('rejects zero/negative dimensions', () => {
    const buf = buildPngHeader(0, 0)
    expect(readDimensions('image/png', buf)).toBeNull()
  })
})

// ─── stripMetadata ─────────────────────────────────────────────────

describe('stripMetadata (PNG)', () => {
  it('drops eXIf chunk while preserving signature, IHDR, IEND', () => {
    const exif = buildExifChunk()
    const withExif = buildPngHeader(64, 64, exif)
    expect(withExif.length).toBeGreaterThan(buildPngHeader(64, 64).length)

    const stripped = stripMetadata('image/png', withExif)

    // Signature intact
    expect(Array.from(stripped.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    // 'IHDR' present
    const hasIhdr = Buffer.from(stripped).includes(Buffer.from([0x49, 0x48, 0x44, 0x52]))
    expect(hasIhdr).toBe(true)
    // 'eXIf' gone
    const hasExif = Buffer.from(stripped).includes(Buffer.from([0x65, 0x58, 0x49, 0x66]))
    expect(hasExif).toBe(false)
    // 'IEND' present
    const hasIend = Buffer.from(stripped).includes(Buffer.from([0x49, 0x45, 0x4e, 0x44]))
    expect(hasIend).toBe(true)
  })

  it('is a no-op on a PNG with no metadata chunks', () => {
    const clean = buildPngHeader(32, 32)
    const out = stripMetadata('image/png', clean)
    expect(out.length).toBe(clean.length)
  })
})

// ─── bounds ───────────────────────────────────────────────────────

describe('bounds export sanity', () => {
  it('caps avatar at 1 MB', () => {
    expect(MAX_AVATAR_BYTES).toBe(1 * 1024 * 1024)
  })
  it('limits dimensions to a sane window', () => {
    expect(MIN_AVATAR_DIM).toBe(32)
    expect(MAX_AVATAR_DIM).toBe(4096)
  })
})
