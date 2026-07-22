import { ApiError } from '../errors'

export async function requireInternalBearer(request: Request, expected: string | undefined) {
  if (!expected) throw new ApiError('NOT_FOUND')
  const header = request.headers.get('authorization') ?? ''
  if (header.length > 1_024 || expected.length > 512) throw new ApiError('NOT_FOUND')
  const supplied = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!(await constantTimeEqual(supplied, expected))) throw new ApiError('NOT_FOUND')
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode('spool-internal-token-comparison'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.sign('HMAC', key, leftBytes),
    crypto.subtle.sign('HMAC', key, rightBytes),
  ])
  const leftView = new Uint8Array(leftDigest)
  const rightView = new Uint8Array(rightDigest)
  if (leftView.byteLength !== rightView.byteLength) return false
  let difference = leftBytes.byteLength ^ rightBytes.byteLength
  for (let index = 0; index < leftView.byteLength; index++) {
    difference |= leftView[index]! ^ rightView[index]!
  }
  return difference === 0
}
