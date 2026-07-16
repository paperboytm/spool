const HEX_BYTE = /^[0-9a-f]{2}$/

export async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto crypto.subtle is required')
  const input = new Uint8Array(bytes.byteLength)
  input.set(bytes)
  return new Uint8Array(await subtle.digest('SHA-256', input.buffer))
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) throw new TypeError('OID must be 64 lowercase hexadecimal characters')

  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = hex.slice(index * 2, index * 2 + 2)
    if (!HEX_BYTE.test(pair)) throw new TypeError('OID must be 64 lowercase hexadecimal characters')
    bytes[index] = Number.parseInt(pair, 16)
  }
  return bytes
}
