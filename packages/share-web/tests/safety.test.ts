// CI guard: no `dangerouslySetInnerHTML` anywhere we render untrusted
// snapshot content.
//
// Reader inputs are immutable, server-validated JSON Snapshot
// documents but everything inside them is user-authored text — turn
// bodies, titles, custom labels. Any leak of that into HTML via
// `dangerouslySetInnerHTML` would be an XSS hole, and the CSP would
// stop the immediate `<script>` payload but would NOT stop an
// `<img onerror>` exfiltrating cookies (`connect-src 'self'` is fine
// for first-party data theft).
//
// We grep instead of relying on lint because lint isn't wired up for
// these packages and a single regression here is shape-of-the-product
// dangerous. Test runs in Node, scans the filesystem, fails on the
// first match.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')

const SCAN_ROOTS = [
  // The whole web SPA — render path *and* helpers.
  resolve(PROJECT_ROOT, 'packages/share-web/src'),
  // share-kit's reader entry point and the templates the reader
  // composes. We intentionally don't scan all of share-kit because
  // the editor host inside the Spool app may, in the future, use
  // dangerouslySetInnerHTML for a non-user surface (e.g. an
  // editor-only help panel). The reader path is the only place we
  // hard-require safety.
  resolve(PROJECT_ROOT, 'packages/share-kit/src/reader'),
  resolve(PROJECT_ROOT, 'packages/share-kit/src/templates'),
  resolve(PROJECT_ROOT, 'packages/share-kit/src/components'),
  resolve(PROJECT_ROOT, 'packages/share-kit/src/lib'),
]

const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const FORBIDDEN = 'dangerouslySetInnerHTML'
// Match real JSX prop usage / runtime references, not the literal word
// appearing inside a `//` line comment or a `/* … */` block comment.
// We strip comments per-line before scanning. The block-comment case
// is handled by a state machine that walks the file once.
const SAFETY_TOKEN = /dangerouslySetInnerHTML/

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (FILE_EXTS.has(extname(full))) out.push(full)
  }
}

function extname(p: string): string {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i).toLowerCase()
}

/** Replace `//…` and `/* … *\/` comment bodies with spaces, preserving
 *  line breaks and column positions so file/line numbers stay sane.
 *  Naïve string-state machine — good enough for this guard because the
 *  token we're hunting for is a literal identifier never built up from
 *  string concatenation. */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let inLine = false
  let inBlock = false
  let inStr: string | null = null
  while (i < src.length) {
    const c = src[i] ?? ''
    const next = src[i + 1] ?? ''
    if (inLine) {
      if (c === '\n') {
        inLine = false
        out += c
      } else {
        out += ' '
      }
      i++
      continue
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false
        out += '  '
        i += 2
        continue
      }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (inStr) {
      out += c
      if (c === '\\' && next) {
        out += next
        i += 2
        continue
      }
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '/' && next === '/') {
      inLine = true
      out += '  '
      i += 2
      continue
    }
    if (c === '/' && next === '*') {
      inBlock = true
      out += '  '
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      out += c
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

describe('share-web + reader path safety', () => {
  it('contains no dangerouslySetInnerHTML usage', () => {
    const files: string[] = []
    for (const root of SCAN_ROOTS) walk(root, files)

    // Sanity check: we should be scanning *something*, otherwise the
    // test is trivially green.
    expect(files.length).toBeGreaterThan(0)

    const offenders: { file: string; line: number; text: string }[] = []
    for (const file of files) {
      // The guard test itself contains the forbidden string in this
      // very comment — skip self-scan.
      if (file === __filename) continue
      const src = readFileSync(file, 'utf8')
      if (!src.includes(FORBIDDEN)) continue
      const stripped = stripComments(src)
      const lines = stripped.split('\n')
      lines.forEach((line, idx) => {
        if (SAFETY_TOKEN.test(line)) {
          offenders.push({ file, line: idx + 1, text: line.trim() })
        }
      })
    }

    if (offenders.length > 0) {
      const summary = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n')
      throw new Error(
        `Found ${offenders.length} use(s) of ${FORBIDDEN} in the reader/share-web path:\n${summary}`,
      )
    }
  })
})
