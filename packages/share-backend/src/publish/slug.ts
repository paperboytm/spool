const ALPHABET = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function nanoidSlug(): string {
  const arr = new Uint8Array(21)
  crypto.getRandomValues(arr)
  let s = ''
  for (let i = 0; i < 21; i++) s += ALPHABET[arr[i]! & 63]
  return s
}

export function isValidSlug(s: string): boolean {
  return /^[\w-]{21}$/.test(s)
}
