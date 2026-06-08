// Avatar image pre-write pipeline:
//   1. Sniff MIME from leading bytes — never trust the upload's
//      Content-Type. Reject anything not in the small allow-list.
//   2. Strip EXIF/metadata so no GPS / camera serial / capture
//      timestamp leaks from a casual phone-camera upload.
//   3. Surface raw image dimensions so the caller can refuse
//      pathological inputs before they reach R2.
//
// No transcoding, no resize: v1 accepts what the user gives us within
// caps. Cloudflare Pages Function runtime doesn't ship `sharp` or
// libwebp, and bringing in a native image lib via NAPI bindings is out
// of scope for v1. The 2 MB body cap + 4096 px dimension cap is the
// bound that keeps R2 storage sane.

export type SupportedMime = 'image/png' | 'image/jpeg' | 'image/webp'

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024 // 2 MB
export const MAX_AVATAR_DIM = 4096
export const MIN_AVATAR_DIM = 32

export interface SniffedImage {
  mime: SupportedMime
  width: number
  height: number
}

/**
 * Identify the image's real MIME by inspecting the first few bytes,
 * not the upload's claimed Content-Type header (which a client can
 * trivially lie about). Returns null when the magic numbers don't
 * match any of our allow-listed formats.
 *
 * PNG  : 89 50 4E 47 0D 0A 1A 0A
 * JPEG : FF D8 FF
 * WEBP : 'RIFF' .... 'WEBP'
 */
export function sniffMime(buf: Uint8Array): SupportedMime | null {
  if (buf.length < 12) return null
  // PNG
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png'
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // WebP: 'RIFF' (52 49 46 46), then 4 bytes file size, then 'WEBP'
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp'
  return null
}

/**
 * Pull image dimensions (width, height) from the header bytes of a
 * known-format buffer. Returns null when the bytes are malformed for
 * the declared format — caller should treat that as "reject upload",
 * never "assume some default".
 *
 * Why we don't pipe through a real decoder: we don't ship one, and we
 * only need width/height for sanity bounds. The header structure of
 * all three formats is tiny and well-specified.
 */
export function readDimensions(mime: SupportedMime, buf: Uint8Array): { width: number; height: number } | null {
  if (mime === 'image/png') return readPngDimensions(buf)
  if (mime === 'image/jpeg') return readJpegDimensions(buf)
  if (mime === 'image/webp') return readWebpDimensions(buf)
  return null
}

function readPngDimensions(buf: Uint8Array): { width: number; height: number } | null {
  // Width/height are big-endian uint32 at offsets 16 and 20 (IHDR chunk).
  // `>>> 0` coerces the bit-or result back to unsigned — without it a width
  // with the high bit set (>= 2^31) reads as negative in JS's signed 32-bit
  // bitwise math and the `<= 0` guard rejects it as malformed even though
  // the PNG header is technically well-formed.
  if (buf.length < 24) return null
  const width = (((buf[16]! << 24) | (buf[17]! << 16) | (buf[18]! << 8) | buf[19]!) >>> 0)
  const height = (((buf[20]! << 24) | (buf[21]! << 16) | (buf[22]! << 8) | buf[23]!) >>> 0)
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

function readJpegDimensions(buf: Uint8Array): { width: number; height: number } | null {
  // Walk JPEG segments until we hit an SOF (0xC0..0xCF except DHT 0xC4,
  // JPG 0xC8, DAC 0xCC). SOF carries height/width as big-endian uint16
  // at offsets +5 / +7 inside the segment.
  let i = 2 // skip the SOI marker (FF D8)
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null
    let marker = buf[i + 1]!
    while (marker === 0xff && i + 2 < buf.length) {
      // pad bytes
      i++
      marker = buf[i + 1]!
    }
    const sof =
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (sof) {
      if (i + 9 >= buf.length) return null
      const height = (buf[i + 5]! << 8) | buf[i + 6]!
      const width = (buf[i + 7]! << 8) | buf[i + 8]!
      if (width <= 0 || height <= 0) return null
      return { width, height }
    }
    const segLen = (buf[i + 2]! << 8) | buf[i + 3]!
    if (segLen < 2) return null
    i += 2 + segLen
  }
  return null
}

function readWebpDimensions(buf: Uint8Array): { width: number; height: number } | null {
  // WebP comes in three flavours: VP8 (lossy), VP8L (lossless), VP8X
  // (extended). Each places width/height differently. We handle all
  // three since the user upload could be any of them.
  if (buf.length < 30) return null
  const fourcc = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!)
  if (fourcc === 'VP8 ') {
    // little-endian uint16, 14-bit max width/height at offsets 26, 28
    const w = ((buf[27]! & 0x3f) << 8) | buf[26]!
    const h = ((buf[29]! & 0x3f) << 8) | buf[28]!
    return w > 0 && h > 0 ? { width: w, height: h } : null
  }
  if (fourcc === 'VP8L') {
    // 14-bit width-minus-1, height-minus-1 packed into 4 bytes after signature
    if (buf.length < 25) return null
    const b1 = buf[21]!, b2 = buf[22]!, b3 = buf[23]!, b4 = buf[24]!
    const width = 1 + (((b2 & 0x3f) << 8) | b1)
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (fourcc === 'VP8X') {
    // 24-bit width-minus-1, height-minus-1 little-endian at offsets 24 / 27
    if (buf.length < 30) return null
    const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16))
    const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16))
    return width > 0 && height > 0 ? { width, height } : null
  }
  return null
}

/**
 * Strip PNG eXIf / iTXt / tEXt / zTXt / iCCP chunks (all the
 * metadata-carrying ones), leaving the structural and pixel-data
 * chunks intact. Returns a new Uint8Array; the source buffer is not
 * mutated.
 *
 * PNG layout: 8-byte signature, then a sequence of <length:u32be>
 * <type:4 chars> <data:length bytes> <crc:u32be> chunks. We scan
 * the chunks once, copy the ones we want into the output, and skip
 * the rest.
 */
function stripPngMetadata(buf: Uint8Array): Uint8Array {
  const out: number[] = []
  // Signature
  for (let i = 0; i < 8; i++) out.push(buf[i]!)
  const SKIP = new Set(['eXIf', 'iTXt', 'tEXt', 'zTXt', 'iCCP'])
  let i = 8
  while (i + 12 <= buf.length) {
    const len =
      (buf[i]! << 24) | (buf[i + 1]! << 16) | (buf[i + 2]! << 8) | buf[i + 3]!
    const type = String.fromCharCode(buf[i + 4]!, buf[i + 5]!, buf[i + 6]!, buf[i + 7]!)
    const total = 12 + len
    if (i + total > buf.length) break // truncated — bail
    if (!SKIP.has(type)) {
      for (let j = 0; j < total; j++) out.push(buf[i + j]!)
    }
    i += total
    if (type === 'IEND') break
  }
  return new Uint8Array(out)
}

/**
 * Strip JPEG APP1 (EXIF/XMP) + APP2 (ICC profile) + COM (comment)
 * segments. Decoders only need SOI / DQT / SOFx / DHT / SOS / EOI to
 * render; the APPn segments are metadata and safe to drop.
 *
 * JPEG layout: FF D8 (SOI), then a sequence of FF <marker:1> for
 * markers, with most markers followed by <length:u16be> <data>. SOS
 * (FF DA) starts the entropy-coded body which runs until EOI (FF D9)
 * — we copy that whole tail verbatim.
 */
function stripJpegMetadata(buf: Uint8Array): Uint8Array {
  const out: number[] = []
  out.push(buf[0]!, buf[1]!) // SOI
  let i = 2
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) break
    let marker = buf[i + 1]!
    // skip fill bytes
    while (marker === 0xff && i + 2 < buf.length) {
      i++
      marker = buf[i + 1]!
    }
    if (marker === 0xda) {
      // SOS — copy rest of file verbatim
      for (let j = i; j < buf.length; j++) out.push(buf[j]!)
      break
    }
    if (i + 4 >= buf.length) break
    const segLen = (buf[i + 2]! << 8) | buf[i + 3]!
    if (segLen < 2) break
    const total = 2 + segLen
    // Strip every APPn we don't need + the COM (comment) marker:
    //   APP1 (FFE1)  EXIF / XMP
    //   APP2 (FFE2)  ICC profile / FlashPix
    //   APP3..APP12  proprietary maker notes
    //   APP13 (FFED) Photoshop / IPTC (carries geo + captions)
    //   APP15 (FFEF) reserved / app-specific
    //   COM   (FFFE) free-text comment
    // Keep:
    //   APP0  (FFE0) JFIF — structural, defines pixel density
    //   APP14 (FFEE) Adobe — colour-space flag some decoders rely on
    const strip =
      (marker >= 0xe1 && marker <= 0xed) ||
      marker === 0xef ||
      marker === 0xfe
    if (!strip) {
      for (let j = 0; j < total; j++) out.push(buf[i + j]!)
    }
    i += total
  }
  return new Uint8Array(out)
}

/**
 * Strip WebP EXIF / XMP / ICCP chunks. WebP is a RIFF container —
 * 'RIFF' <size:u32le> 'WEBP' then a sequence of <fourcc:4> <size:u32le>
 * <data> with implicit 1-byte padding to even-align the next chunk.
 *
 * We scan the chunks, drop the metadata ones (EXIF, XMP , ICCP), and
 * recompute the RIFF size at the head.
 */
function stripWebpMetadata(buf: Uint8Array): Uint8Array {
  if (buf.length < 12) return buf
  const out: number[] = []
  // 'RIFF', 4-byte size placeholder (rewrite at end), 'WEBP'
  for (let i = 0; i < 4; i++) out.push(buf[i]!)
  out.push(0, 0, 0, 0)
  for (let i = 8; i < 12; i++) out.push(buf[i]!)
  const STRIP = new Set(['EXIF', 'XMP ', 'ICCP'])
  let i = 12
  while (i + 8 <= buf.length) {
    const type = String.fromCharCode(buf[i]!, buf[i + 1]!, buf[i + 2]!, buf[i + 3]!)
    const size = buf[i + 4]! | (buf[i + 5]! << 8) | (buf[i + 6]! << 16) | (buf[i + 7]! << 24)
    const pad = size & 1 // RIFF chunks 2-byte aligned
    const total = 8 + size + pad
    if (i + total > buf.length) break
    if (!STRIP.has(type)) {
      for (let j = 0; j < total; j++) out.push(buf[i + j]!)
    }
    i += total
  }
  // Rewrite RIFF size = file length - 8
  const newSize = out.length - 8
  out[4] = newSize & 0xff
  out[5] = (newSize >> 8) & 0xff
  out[6] = (newSize >> 16) & 0xff
  out[7] = (newSize >> 24) & 0xff
  return new Uint8Array(out)
}

/**
 * Strip metadata chunks from a sniffed image. Returns a new buffer.
 * Unknown / unsupported mime returns the original buffer.
 */
export function stripMetadata(mime: SupportedMime, buf: Uint8Array): Uint8Array {
  if (mime === 'image/png') return stripPngMetadata(buf)
  if (mime === 'image/jpeg') return stripJpegMetadata(buf)
  if (mime === 'image/webp') return stripWebpMetadata(buf)
  return buf
}
