export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? '0.0.0.0'
}
