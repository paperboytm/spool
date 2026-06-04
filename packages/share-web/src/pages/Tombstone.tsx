// Shown for revoked, expired, and not-found shares. Distinct copy per
// reason — users land here from a real link, so saying "this share was
// taken down" is more honest than a generic 404.

import { Footer, Header, Page } from '../components/Chrome'
import { humanDateTime } from '../lib/dates'

export type TombstoneReason = 'revoked' | 'expired' | 'not-found'

interface Props {
  reason: TombstoneReason
  at?: number
}

const COPY: Record<
  TombstoneReason,
  { eyebrow: string; title: string; body: string; metaLabel: string | null; tone: 'err' | 'muted' }
> = {
  revoked: {
    eyebrow: 'Share unavailable',
    title: 'This share is no longer available',
    body: 'The author has unpublished it.',
    metaLabel: 'Removed',
    tone: 'err',
  },
  expired: {
    eyebrow: 'Share expired',
    title: 'This share has expired',
    body: 'The author set an expiration that has now passed.',
    metaLabel: 'Expired',
    tone: 'err',
  },
  'not-found': {
    eyebrow: 'Not found',
    title: 'We couldn’t find a share here',
    body: 'Check the link, or ask the author for a fresh one. If it was just published, give it a moment.',
    metaLabel: null,
    tone: 'muted',
  },
}

function formatAt(at: number | undefined): string | null {
  if (!at) return null
  return humanDateTime(at) || null
}

export function Tombstone({ reason, at }: Props) {
  const c = COPY[reason]
  const when = formatAt(at)
  return (
    <Page>
      <Header auth="out" />
      <main className="sw-main center">
        <div className="sw-card tight" style={{ maxWidth: 560 }}>
          <div className="sw-rule" style={{ marginBottom: 22 }}>
            <span className={`tag ${c.tone}`}>{c.eyebrow}</span>
            <span className="line" />
          </div>
          <h1 className="sw-title">{c.title}</h1>
          <p className="sw-lede">{c.body}</p>
          {c.metaLabel && when && (
            <p
              className="sw-mono"
              style={{
                marginTop: 14,
                fontSize: 11.5,
                color: 'var(--muted)',
                letterSpacing: '0.03em',
              }}
            >
              {c.metaLabel} on {when}.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </Page>
  )
}
