import { NodeSdk } from '@effect/opentelemetry'
import {
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { PrettyConsoleSpanExporter } from './exporter-pretty.js'
import { RotatingFileSpanExporter } from './exporter-file.js'

export type ObservabilityEnv = 'dev' | 'prod' | 'test'

interface CommonConfig {
  readonly serviceName: string
  readonly serviceVersion?: string
}

export type ObservabilityConfig =
  | (CommonConfig & { readonly env: 'dev' })
  | (CommonConfig & { readonly env: 'prod'; readonly logsDir: string })
  | (CommonConfig & { readonly env: 'test'; readonly testExporter?: SpanExporter })

/** Effect Layer that wires `Effect.withSpan` to either a pretty console
 *  exporter (dev), a rotating jsonl file exporter (prod), or the
 *  supplied test exporter / noop (test). */
export function observabilityLayer(config: ObservabilityConfig): Layer.Layer<never> {
  return NodeSdk.layer(() => ({
    resource: {
      serviceName: config.serviceName,
      ...(config.serviceVersion ? { serviceVersion: config.serviceVersion } : {}),
    },
    spanProcessor: makeProcessor(config),
  }))
}

function makeProcessor(config: ObservabilityConfig): SpanProcessor {
  switch (config.env) {
    case 'test':
      return new SimpleSpanProcessor(config.testExporter ?? noopExporter)
    case 'dev':
      return new SimpleSpanProcessor(new PrettyConsoleSpanExporter())
    case 'prod':
      // SimpleSpanProcessor on purpose: BatchSpanProcessor batches for
      // network export, but our prod sink is a local file. Per-span
      // writes keep logs current for live `tail -f` debugging.
      return new SimpleSpanProcessor(new RotatingFileSpanExporter({ dir: config.logsDir }))
  }
}

const noopExporter: SpanExporter = {
  export: (_spans, cb) => cb({ code: 0 }),
  shutdown: () => Promise.resolve(),
}

/** Build a ManagedRuntime carrying the observability layer + a typed
 *  promise runner. Lets main / scan-worker / sync-worker share the
 *  same env-detection + cast pattern instead of each rolling its own. */
export function makeObservabilityRuntime(config: ObservabilityConfig): {
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
  readonly run: <A, E>(eff: Effect.Effect<A, E>) => Promise<A>
} {
  const runtime = ManagedRuntime.make(observabilityLayer(config))
  return {
    runtime,
    run: <A, E>(eff: Effect.Effect<A, E>) =>
      runtime.runPromise(eff as Effect.Effect<A, never>),
  }
}
