const enc = new TextEncoder()

export async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(input))
}

export function base64urlFromBuffer(b: ArrayBuffer): string {
  const bytes = new Uint8Array(b)
  let s = ''
  for (const byte of bytes) s += String.fromCharCode(byte)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomUrlSafe(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return base64urlFromBuffer(arr.buffer)
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64urlFromBuffer(await sha256(verifier))
}
