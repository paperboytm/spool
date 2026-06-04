import type { EventContext, PagesFunction } from '@cloudflare/workers-types'

// Invoke a PagesFunction with a synthetic EventContext built from a plain
// `Request` + an `env` object. Generic over the handler's Env so each call
// site is typechecked against the handler's actual env shape.
//
// The `as unknown as EventContext<...>` cast is the one boundary cast in
// the test suite: the global `Request` we construct with `new Request(...)`
// is structurally compatible with CF's `Request<unknown, CfProperties>`
// at runtime, but TS treats them as distinct nominal types.
// The optional `params` arg covers dynamic-segment routes (e.g. the
// /api/auth/[provider]/start handler reads ctx.params.provider). Plain
// handlers default to an empty object.
export async function invoke<E>(
  handler: PagesFunction<E>,
  req: Request,
  env: E,
  params: Record<string, string> = {},
): Promise<Response> {
  return handler({
    request: req,
    env,
    next: async () => new Response('not-found', { status: 404 }),
    params,
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    data: {},
  } as unknown as EventContext<E, string, Record<string, unknown>>)
}

// Pull every Set-Cookie value off a Response across runtimes. The CF
// Headers TS type exposes getAll() but undici's Headers (which vitest
// actually uses) only has getSetCookie(). One narrow cast here keeps the
// runtime/type mismatch out of every test.
export function getSetCookies(res: Response): string[] {
  const h = res.headers as unknown as { getSetCookie?: () => string[] }
  if (typeof h.getSetCookie === 'function') return h.getSetCookie()
  return [res.headers.get('set-cookie') ?? '']
}
