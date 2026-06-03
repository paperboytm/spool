// 64-char URL-safe alphabet → 6 bits/char × 21 chars = 126 bits of entropy.
// Comfortably above the birthday-paradox horizon for any realistic share
// volume, so we don't bother checking for collisions before INSERT.
const ALPHABET = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SLUG_LEN = 21

export function nanoidSlug(): string {
  const arr = new Uint8Array(SLUG_LEN)
  crypto.getRandomValues(arr)
  let s = ''
  for (let i = 0; i < SLUG_LEN; i++) s += ALPHABET[arr[i]! & 63]
  return s
}

export function isValidSlug(s: string): boolean {
  return new RegExp(`^[\\w-]{${SLUG_LEN}}$`).test(s)
}
