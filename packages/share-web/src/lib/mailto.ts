// Build a mailto link with a pre-filled subject + body so the user
// doesn't have to remember what to include when reporting a share.
// Goes to abuse@spool.pro which is a Cloudflare Email Routing forward
// to the operator's inbox.

export function reportMailto(id: string): string {
  const subject = `Report spool.pro/s/${id}`
  const body = [
    `Share URL: https://spool.pro/s/${id}`,
    '',
    'Reason (please pick one): copyright | privacy | harassment | illegal | spam | other',
    '',
    'Details:',
    '',
  ].join('\n')
  return `mailto:abuse@spool.pro?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
