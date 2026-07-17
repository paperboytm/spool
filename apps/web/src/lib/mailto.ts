// Build a mailto link with a pre-filled subject + body so the user
// doesn't have to remember what to include when reporting a share.
// Goes to abuse@spool.pro which is a Cloudflare Email Routing forward
// to the operator's inbox.
//
// `origin` is overridable so the dev/staging reader sends "Report
// localhost:3002/s/<id>" instead of pointing to prod. Browser callers
// just rely on the default — window.location.origin already gives the
// right value at runtime.

const DEFAULT_ORIGIN = 'https://spool.pro'

function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return DEFAULT_ORIGIN
}

export function reportMailto(id: string, origin: string = currentOrigin()): string {
  const displayBase = origin.replace(/^https?:\/\//, '')
  const subject = `Report ${displayBase}/s/${id}`
  const body = [
    `Share URL: ${origin}/s/${id}`,
    '',
    'Reason (please pick one): copyright | privacy | harassment | illegal | spam | other',
    '',
    'Details:',
    '',
  ].join('\n')
  return `mailto:abuse@spool.pro?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
