// Shown for revoked, expired, and not-found shares. Distinct copy per
// reason — users land here from a real link, so saying "this share was
// taken down" is more honest than a generic 404.

export type TombstoneReason = 'revoked' | 'expired' | 'not-found'

interface Props {
  reason: TombstoneReason
  at?: number
}

const COPY: Record<TombstoneReason, { title: string; body: string }> = {
  revoked: {
    title: 'This share is no longer available',
    body: 'The author has unpublished it.',
  },
  expired: {
    title: 'This share has expired',
    body: 'The author set an expiration that has now passed.',
  },
  'not-found': {
    title: 'Not found',
    body: 'We couldn’t find a share at this address. Check the link, or ask the author for a fresh one.',
  },
}

function formatAt(at: number | undefined): string | null {
  if (!at) return null
  try {
    return new Date(at).toLocaleString()
  } catch {
    return null
  }
}

export function Tombstone({ reason, at }: Props) {
  const { title, body } = COPY[reason]
  const when = formatAt(at)
  return (
    <main className="tombstone">
      <div className="tombstone-card">
        <div className="tombstone-eyebrow">spool.pro</div>
        <h1 className="tombstone-title">{title}</h1>
        <p className="tombstone-body">{body}</p>
        {when && (
          <p className="tombstone-meta">
            {reason === 'expired' ? 'Expired' : 'Removed'} on {when}.
          </p>
        )}
        <p className="tombstone-actions">
          <a href="https://spool.lab" rel="noopener noreferrer">
            Learn about Spool
          </a>
          <span aria-hidden="true"> · </span>
          <a href="/terms">Terms</a>
          <span aria-hidden="true"> · </span>
          <a href="/privacy">Privacy</a>
        </p>
      </div>
    </main>
  )
}
