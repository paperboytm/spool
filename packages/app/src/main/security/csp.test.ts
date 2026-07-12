import { describe, expect, it } from 'vitest'

import { __cspFixtures, buildCsp, buildPfInferenceCsp, isPfInferenceDocument } from './csp.js'

// We don't import installRendererCsp itself in tests — wiring it would
// require an Electron `session` stub. The string fixtures cover the
// actual product surface (drift in directives) without the harness.
const { DEV_CSP, PROD_CSP } = __cspFixtures

function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const segment of csp.split(';')) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const [name, ...rest] = trimmed.split(/\s+/)
    out.set(name!, rest)
  }
  return out
}

describe('Renderer CSP policy', () => {
  describe('required directives present', () => {
    const required = [
      'default-src',
      'script-src',
      'style-src',
      'font-src',
      'img-src',
      'connect-src',
      'frame-src',
      'object-src',
      'frame-ancestors',
      'base-uri',
    ] as const

    for (const profile of [
      { name: 'dev', csp: DEV_CSP },
      { name: 'prod', csp: PROD_CSP },
    ]) {
      it(`${profile.name} CSP carries every directive needed to silence Electron's warning`, () => {
        const dirs = directives(profile.csp)
        for (const key of required) {
          expect(dirs.has(key), `${profile.name}: missing ${key}`).toBe(true)
        }
      })
    }
  })

  it('default-src restricts to self on both profiles', () => {
    expect(directives(DEV_CSP).get('default-src')).toEqual(["'self'"])
    expect(directives(PROD_CSP).get('default-src')).toEqual(["'self'"])
  })

  it('frame-ancestors locks down third-party embedding on both profiles', () => {
    for (const csp of [DEV_CSP, PROD_CSP]) {
      expect(directives(csp).get('frame-ancestors')).toEqual(["'none'"])
    }
  })

  it('object-src allows self/blob/chrome-extension so the PDF viewer paints', () => {
    // Chromium's built-in PDF MIME handler hosts the rendered document
    // via an internal `<embed type="application/pdf">` whose src points
    // back at the same `chrome-extension://` origin. Without these
    // tokens the embed mounts but the document never paints (the
    // iframe goes grey with no console hint). Don't tighten this
    // without first wiring an alternative renderer like pdf.js.
    for (const csp of [DEV_CSP, PROD_CSP]) {
      const obj = directives(csp).get('object-src') ?? []
      expect(obj).toContain("'self'")
      expect(obj).toContain('blob:')
      expect(obj).toContain('chrome-extension:')
    }
  })

  describe('dev profile', () => {
    it('allows Vite HMR transport (ws://localhost:5173)', () => {
      const connect = directives(DEV_CSP).get('connect-src') ?? []
      expect(connect).toContain('ws://localhost:5173')
    })

    it('allows the share-backend wrangler on http://localhost:8788', () => {
      const connect = directives(DEV_CSP).get('connect-src') ?? []
      expect(connect).toContain('http://localhost:8788')
    })

    it('allows `unsafe-eval` because vite-plugin-react fast-refresh needs it', () => {
      // Dev only — the production bundle does not ship the fast-refresh
      // runtime so the prod profile explicitly omits this allowance.
      expect(directives(DEV_CSP).get('script-src')).toContain("'unsafe-eval'")
    })
  })

  describe('prod profile', () => {
    it('does NOT permit unsafe-eval (no fast-refresh in prod)', () => {
      const script = directives(PROD_CSP).get('script-src') ?? []
      expect(script).not.toContain("'unsafe-eval'")
    })

    it('does NOT permit localhost transports', () => {
      const connect = directives(PROD_CSP).get('connect-src') ?? []
      expect(connect.every((src) => !src.includes('localhost'))).toBe(true)
    })

    it('allows the spool.pro origin family on connect-src', () => {
      const connect = directives(PROD_CSP).get('connect-src') ?? []
      expect(connect).toContain('https://spool.pro')
      expect(connect).toContain('https://*.spool.pro')
    })
  })

  describe('frame-src (both profiles)', () => {
    // The editor's PDF preview iframes a `blob:` URL of the rendered
    // document so Chromium's built-in PDF MIME handler can paint the
    // toolbar + page thumbnails. Without `blob:` here the iframe goes
    // blank with no console hint — this was a real regression caught
    // when we first locked CSP down. Pin it.
    it('allows blob: and chrome-extension: so the PDF preview iframe renders', () => {
      // The viewer iframe loads its UI from
      // `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/`, and the
      // PDF document itself is the `blob:` URL we generated. Both must
      // be in frame-src or the iframe goes silently blank.
      for (const csp of [DEV_CSP, PROD_CSP]) {
        const frame = directives(csp).get('frame-src') ?? []
        expect(frame).toContain("'self'")
        expect(frame).toContain('blob:')
        expect(frame).toContain('chrome-extension:')
      }
    })
  })

  describe('connect-src (both profiles)', () => {
    // pdf.js + savePdfFromPreview both `fetch(blobUrl)` on
    // freshly-generated PDF Blobs. Without blob: in connect-src the
    // fetch silently fails with "Failed to fetch" and the save dialog
    // gets zero bytes.
    it('allows blob: so the PDF save flow can fetch its own blob', () => {
      for (const csp of [DEV_CSP, PROD_CSP]) {
        const connect = directives(csp).get('connect-src') ?? []
        expect(connect).toContain('blob:')
      }
    })
  })

  describe('SPOOL_SHARE_BACKEND override origin', () => {
    // The env var swings every main-process API call to another host
    // (staging, e2e mock, future domain move). The renderer's direct
    // fetches — avatar <img> loads and api calls — must follow, or CSP
    // silently blocks them while main works fine and the bug looks
    // like a broken image with an empty network tab.
    const origin = 'https://staging.example.dev'

    for (const dev of [true, false]) {
      const name = dev ? 'dev' : 'prod'
      it(`${name}: override origin lands in connect-src and img-src`, () => {
        const dirs = directives(buildCsp({ dev, backendOrigin: origin }))
        expect(dirs.get('connect-src')).toContain(origin)
        expect(dirs.get('img-src')).toContain(origin)
      })
    }

    it('prod keeps the canonical spool.pro family alongside the override', () => {
      // Published-share URLs and avatar links keep pointing at
      // spool.pro even when the API origin is overridden.
      const connect = directives(buildCsp({ dev: false, backendOrigin: origin })).get('connect-src') ?? []
      expect(connect).toContain('https://spool.pro')
      expect(connect).toContain('https://*.spool.pro')
    })

    it('no override produces the default fixtures exactly', () => {
      expect(buildCsp({ dev: true })).toBe(DEV_CSP)
      expect(buildCsp({ dev: false, backendOrigin: null })).toBe(PROD_CSP)
    })
  })

  describe('image origins (both profiles)', () => {
    it('allows data: and blob: for inline images + screenshot exports', () => {
      for (const csp of [DEV_CSP, PROD_CSP]) {
        const img = directives(csp).get('img-src') ?? []
        expect(img).toContain('data:')
        expect(img).toContain('blob:')
      }
    })

    it('allows the Google user-content host for OAuth avatars', () => {
      for (const csp of [DEV_CSP, PROD_CSP]) {
        const img = directives(csp).get('img-src') ?? []
        expect(img).toContain('https://lh3.googleusercontent.com')
      }
    })
  })

  describe('Privacy Filter inference document', () => {
    it('selects only the dedicated inference HTML entry', () => {
      expect(isPfInferenceDocument('file:///Applications/Spool.app/Contents/Resources/app.asar/out/renderer/pf-inference.html')).toBe(true)
      expect(isPfInferenceDocument('http://localhost:5173/pf-inference.html')).toBe(true)
      expect(isPfInferenceDocument('file:///Applications/Spool.app/Contents/Resources/app.asar/out/renderer/index.html')).toBe(false)
    })

    it('allows the local model protocol and WASM execution', () => {
      for (const dev of [true, false]) {
        const dirs = directives(buildPfInferenceCsp({ dev }))
        expect(dirs.get('connect-src')).toContain('pf-model:')
        expect(dirs.get('script-src')).toContain("'wasm-unsafe-eval'")
        expect(dirs.get('worker-src')).toContain('blob:')
      }
    })

    it('keeps production inference offline except for local schemes', () => {
      const connect = directives(buildPfInferenceCsp({ dev: false })).get('connect-src') ?? []
      expect(connect).toEqual(["'self'", 'pf-model:', 'blob:'])
      expect(connect.every(source => !source.startsWith('http') && !source.startsWith('ws'))).toBe(true)
    })
  })
})
