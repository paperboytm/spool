import type { SessionUsageV1 } from './types.js'

/**
 * Vendored model-pricing snapshot, USD per 1M tokens — the same shape
 * ccusage reads from LiteLLM's model_prices JSON. It is deliberately a
 * static file: costs are computed at share/projection time and the read
 * path never fetches pricing from an origin. Refreshing prices = editing
 * this table.
 *
 * Snapshot: 2026-07-25 standard global list prices. Batch, regional,
 * priority, and long-context modifiers are intentionally outside this
 * aggregate estimate. Matching is longest-prefix on the model id, so dated
 * ids like "claude-sonnet-4-5-20250929" resolve to their family.
 */
export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  // Sonnet 5 launch pricing is effective through 2026-08-31. Published
  // Sessions retain this snapshot even after the vendored table changes.
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  'gpt-5.6-terra': { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 },
  'gpt-5.6-luna': { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
  'gpt-5.6-sol': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
  // The unsuffixed alias routes to Sol.
  'gpt-5.6': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  'gpt-5.4': { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  'gpt-5-codex': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  o3: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
}

export interface SessionCost {
  /** Estimated USD, or null when any token-bearing model is unpriced. */
  usd: number | null
  /** All tokens seen, priced or not. */
  totalTokens: number
  /** Model ids that carried tokens but matched no pricing entry. */
  unpricedModels: string[]
}

const PRICING_PREFIXES = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length)

function pricingFor(model: string): ModelPricing | null {
  const normalized = model.toLowerCase()
  for (const prefix of PRICING_PREFIXES) {
    if (normalized.startsWith(prefix) || normalized.includes(`/${prefix}`)) {
      return MODEL_PRICING[prefix]!
    }
  }
  return null
}

const PER_MILLION = 1_000_000

/** Views cross a trust boundary (client-uploaded), so token fields are
 * re-validated here instead of trusting the declared type. */
function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function safeAdd(left: number, right: number): number | null {
  const sum = left + right
  return Number.isSafeInteger(sum) ? sum : null
}

export function costForUsage(usage: SessionUsageV1 | null | undefined): SessionCost | null {
  if (!usage || typeof usage !== 'object') return null
  const models = (usage as { models?: unknown }).models
  if (models === null || typeof models !== 'object' || Array.isArray(models)) return null
  const entries = Object.entries(models as Record<string, unknown>)
  if (entries.length === 0) return null

  let usd = 0
  let totalTokens = 0
  const unpricedModels: string[] = []

  for (const [model, rawTotals] of entries) {
    if (rawTotals === null || typeof rawTotals !== 'object') continue
    const totals = rawTotals as Record<string, unknown>
    const counts = [
      safeCount(totals['input']),
      safeCount(totals['output']),
      safeCount(totals['cacheRead']),
      safeCount(totals['cacheWrite']),
    ]
    if (counts.some((count) => count === null)) return null
    const [input, output, cacheRead, cacheWrite] = counts as [number, number, number, number]
    const inputAndOutput = safeAdd(input, output)
    const cacheTokens = safeAdd(cacheRead, cacheWrite)
    if (inputAndOutput === null || cacheTokens === null) return null
    const tokens = safeAdd(inputAndOutput, cacheTokens)
    if (tokens === null) return null
    const nextTotal = safeAdd(totalTokens, tokens)
    if (nextTotal === null) return null
    totalTokens = nextTotal
    const pricing = pricingFor(model)
    if (!pricing) {
      if (tokens > 0) unpricedModels.push(model)
      continue
    }
    usd +=
      (input * pricing.input +
        output * pricing.output +
        cacheRead * pricing.cacheRead +
        cacheWrite * pricing.cacheWrite) /
      PER_MILLION
  }

  if (totalTokens === 0) return null
  return {
    usd: unpricedModels.length > 0 ? null : Math.round(usd * 10_000) / 10_000,
    totalTokens,
    unpricedModels,
  }
}
