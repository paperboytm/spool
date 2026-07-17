// Trust assumption: in production this Worker is reachable ONLY via the
// Cloudflare edge, which strips any inbound `CF-Connecting-IP` and sets it
// to the real client IP — so trusting the header is safe there. On a
// direct-origin or `wrangler dev` path the header is client-controlled and
// therefore spoofable, which would let an attacker rotate the value to
// dodge the IP-keyed rate limits (oauth-callback / signin / profile). Keep
// this path edge-only in prod. Not hardened via `request.cf` because its
// presence isn't a reliable "came through the edge" signal in the Pages
// runtime; gating on it could drop legitimate traffic.
export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? '0.0.0.0'
}
