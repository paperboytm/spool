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
  // Explicit ASCII alphabet rather than `\w`: under the `u` flag (or
  // future engine changes) `\w` can match Unicode word chars, which would
  // widen this public-facing gate. The generated alphabet is ASCII, so
  // pinning it here only tightens the validator.
  return new RegExp(`^[A-Za-z0-9_-]{${SLUG_LEN}}$`).test(s)
}
