import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type LoopbackResult = { code: string; state: string }

export interface LoopbackHandle {
  port: number
  redirectUri: string
  awaitCallback: () => Promise<LoopbackResult>
  close: () => void
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000

// Browser landing after the OAuth redirect. Single self-contained HTML
// (no network deps — the page sits at 127.0.0.1; remote stylesheets or
// fonts would slow the page paint for zero benefit). Echoes the
// share-web aesthetic: warm parchment background, accent amber,
// sentence-case copy, Spool brand mark for continuity with the desktop
// window the user just left.
//
// No `window.close()` call: only scripts that themselves opened a
// window via `window.open()` can close it. This tab was opened by the
// browser when Electron called `shell.openExternal`, so a JS-driven
// close would be a no-op — promising "this will close on its own" in
// the copy would be a lie. Instead the page tells the user to close it
// themselves and return to Spool.
const SUCCESS_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Signed in to Spool</title>
<style>
  :root {
    --bg: #FAFAF8;
    --surface: #FFFFFF;
    --border: #E8E8E2;
    --text: #1C1C18;
    --muted: #6B6B60;
    --faint: #ADADAA;
    --accent: #C85A00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141410;
      --surface: #1C1C18;
      --border: #2E2E28;
      --text: #F2F2EC;
      --muted: #8A8A80;
      --faint: #505048;
      --accent: #F07020;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  .page {
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 420px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 40px 36px 32px;
    box-shadow:
      0 1px 2px rgba(28,28,24,0.04),
      0 14px 36px rgba(28,28,24,0.06);
    text-align: center;
  }
  .mark {
    display: inline-flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    margin-bottom: 18px;
  }
  h1 {
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.25;
    margin: 0 0 8px;
  }
  p {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--muted);
  }
  .meta {
    margin-top: 20px;
    font-size: 11.5px;
    color: var(--faint);
    letter-spacing: 0.04em;
    font-variant: small-caps;
  }
</style>
</head>
<body>
  <main class="page">
    <div class="card" role="status" aria-live="polite">
      <div class="mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none" stroke="currentColor">
          <ellipse cx="16" cy="9" rx="12" ry="4.5" stroke-width="1.8"/>
          <line x1="4" y1="9" x2="4" y2="22" stroke-width="1.8"/>
          <line x1="28" y1="9" x2="28" y2="22" stroke-width="1.8"/>
          <path d="M4 22 C4 24.5 9 27 16 27 C23 27 28 24.5 28 22" stroke-width="1.8"/>
          <ellipse cx="16" cy="11" rx="7" ry="2.5" stroke-width="1.2"/>
          <line x1="9" y1="11" x2="9" y2="20" stroke-width="1.2"/>
          <line x1="23" y1="11" x2="23" y2="20" stroke-width="1.2"/>
          <path d="M9 20 C9 21.5 12 23 16 23 C20 23 23 21.5 23 20" stroke-width="1.2"/>
          <ellipse cx="16" cy="11" rx="3" ry="1.2" fill="currentColor" stroke="none"/>
        </svg>
      </div>
      <h1>You're signed in</h1>
      <p>You can close this tab and head back to Spool.</p>
      <p class="meta">spool.pro</p>
    </div>
  </main>
</body>
</html>`

export async function startLoopback(
  expectedState: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<LoopbackHandle> {
  let resolveFn!: (v: LoopbackResult) => void
  let rejectFn!: (e: Error) => void
  let settled = false
  const result = new Promise<LoopbackResult>((res, rej) => {
    resolveFn = (v) => { if (!settled) { settled = true; res(v) } }
    rejectFn = (e) => { if (!settled) { settled = true; rej(e) } }
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    // Validate BEFORE writing the success page. A CSRF probe (e.g.
    // someone tricks the user into hitting /callback?state=x with a
    // crafted state) would otherwise see the green "You're signed in"
    // page even though the main process rejected the promise — the
    // user would close the tab thinking everything's fine while the
    // app shows a sign-in error in the background. With validation
    // first, the browser gets a 400 with a meaningful message and the
    // user knows something went wrong.
    if (!code || !state) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('missing code or state')
      rejectFn(new Error('missing params'))
      return
    }
    if (state !== expectedState) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('state mismatch — request did not originate from this Spool window')
      rejectFn(new Error('state mismatch'))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(SUCCESS_PAGE)
    resolveFn({ code, state })
  })

  await new Promise<void>((res, rej) => {
    server.once('error', rej)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rej)
      res()
    })
  })
  const port = (server.address() as AddressInfo).port

  const timer = setTimeout(() => rejectFn(new Error('timeout')), timeoutMs)
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    ;(timer as { unref?: () => void }).unref?.()
  }
  result.finally(() => {
    clearTimeout(timer)
    server.close()
  }).catch(() => {
    // result rejection is the caller's concern; finally just cleans up
  })

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    awaitCallback: () => result,
    close: () => server.close(),
  }
}
