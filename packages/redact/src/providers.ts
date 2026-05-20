// Pluggable provider boundary for sensitive-data detection.
//
// `RedactProvider` is the single seam through which the Share editor,
// the future Security Scan feature, and the CLI all consume detection.
// Today the only implementation is `regexProvider` — deterministic,
// zero-dep, <1ms on a typical session body. Tomorrow another provider
// (e.g. OpenAI Privacy Filter served via transformers.js + WebGPU)
// can plug in *without touching call sites*.
//
// Local-first invariant: every provider must run entirely on-device.
// Network round-trips for detection are out of scope by policy —
// Spool data does not leave the user's machine.
//
// Why we are NOT shipping OpenAI Privacy Filter today
// (Apache-2.0, 1.5B/50M-active, 96% F1 on PII-Masking-300k):
//
//   1. The model bundle (Q4-quantised ONNX) is ~800 MB. Downloading
//      that the first time a user opens the Share editor is a poor
//      experience for an interactive surface; it makes more sense
//      behind an explicit "enable enhanced detection" toggle, paired
//      with the planned background Security Scan feature.
//   2. Privacy Filter's `secret` category is broad but does not
//      reliably recognise the long tail of vendor token formats
//      (`ghp_…`, `sk-ant-…`, `dop_v1_…`). Regex remains the right
//      mechanism for structurally-distinctive credentials.
//   3. The marginal win is on prose-style PII — sentences like "my
//      SSN is 123-45-6789", names embedded in free text, addresses
//      in error messages — where regex fundamentally can't help.
//      That win matters for the Security Scan report; for the
//      Share editor (where the user is also reviewing the artifact
//      visually) it is much less critical.
//
// Concretely, the integration path when we do enable it:
//   • Add `@huggingface/transformers` as an optional dependency
//   • Implement `privacyFilterProvider` in this file (or a sibling)
//     that lazy-imports the package, downloads the ONNX bundle to
//     userData/, and exposes `analyze(text): Promise<SensitiveMatch[]>`
//     emitting matches with `provider: 'privacy-filter'`
//   • Map its 8 entity types (`private_person`, `private_email`,
//     `private_phone`, `private_url`, `private_address`,
//     `private_date`, `account_number`, `secret`) to our existing
//     SensitiveKind values, adding new kinds for what's net-new
//     (`person-name`, `postal-address`, `date-of-birth`)
//   • In the Settings panel, gate behind a toggle showing model
//     size, where the file lives, and how to delete it

import type { SensitiveMatch } from './types.js'
import { detectWithRegex } from './detectors.js'

export interface RedactProvider {
  /** Stable identifier used in `SensitiveMatch.provider` and shown
   *  to the user when explaining where a flag came from. */
  readonly name: string
  /** Human-readable label for settings UI. */
  readonly displayName: string
  /** True when the provider is loaded and ready to call `analyze`.
   *  Always true for regex; future ML providers return false until
   *  the model bundle is on disk. */
  available(): boolean
  /** Run detection on the given text. Even synchronous providers
   *  return a Promise so callers can compose providers uniformly. */
  analyze(text: string): Promise<SensitiveMatch[]>
}

/** The default, always-available provider. */
export const regexProvider: RedactProvider = {
  name: 'regex',
  displayName: 'Pattern matcher (built-in)',
  available: () => true,
  analyze: async (text: string) => detectWithRegex(text, 'regex'),
}

/** Merge results from multiple providers and de-overlap by priority.
 *  When two providers flag overlapping spans, the higher-priority
 *  provider wins. Higher priority = earlier in the array. */
export async function analyzeWith(
  providers: RedactProvider[],
  text: string,
): Promise<SensitiveMatch[]> {
  if (providers.length === 0) return []
  const lists = await Promise.all(
    providers.map((p) => (p.available() ? p.analyze(text) : Promise.resolve([] as SensitiveMatch[]))),
  )
  const claimed: { start: number; end: number }[] = []
  const out: SensitiveMatch[] = []
  // Priority = order in `providers`; lower index wins.
  for (const matches of lists) {
    for (const m of matches) {
      if (claimed.some((c) => m.start < c.end && m.end > c.start)) continue
      out.push(m)
      claimed.push({ start: m.start, end: m.end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}
