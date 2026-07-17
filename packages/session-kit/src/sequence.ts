import { bytesToHex, hexToBytes, sha256 } from './crypto.js'

const DIGEST_BYTES = 32

export async function chainRoots(oids: readonly string[]): Promise<string[]> {
  const roots: string[] = []
  let node: Uint8Array<ArrayBuffer> = new Uint8Array(DIGEST_BYTES)

  for (const oid of oids) {
    const input = new Uint8Array(DIGEST_BYTES * 2)
    input.set(node, 0)
    input.set(hexToBytes(oid), DIGEST_BYTES)
    node = await sha256(input)
    roots.push(bytesToHex(node))
  }

  return roots
}

export async function sequenceRoot(
  oids: readonly string[],
  count: number = oids.length,
): Promise<string> {
  if (!Number.isSafeInteger(count) || count < 0 || count > oids.length) {
    throw new RangeError('Sequence prefix count must be an integer between 0 and the manifest length')
  }
  if (count === 0) return '0'.repeat(DIGEST_BYTES * 2)

  const roots = await chainRoots(oids.slice(0, count))
  return roots[count - 1] as string
}
