import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'

/**
 * Main-process event-loop lag monitor.
 *
 * Beachballs on launch trace back to one thing: the main-process JS
 * thread does some chunk of work without yielding to the AppKit event
 * loop for long enough that macOS surfaces the spinning pinwheel. Sync
 * `child_process.execSync('<shell> -ilc ...')` was one such regression;
 * a large blocking SQL query or an oversized JSON.parse could be the
 * next. Rather than enumerating offenders, we directly observe the
 * symptom: how long the event loop is stalled between scheduled ticks.
 *
 * Implementation: `node:perf_hooks.monitorEventLoopDelay` runs in C++
 * with nanosecond precision and negligible overhead — the right tool
 * for this job. A homegrown setInterval-based heartbeat would itself
 * be subject to the lag it's trying to measure.
 *
 * Read-out is via the test-only `spool:debug:event-loop-lag` IPC
 * handler (registered only when `SPOOL_E2E_TEST=1`), so production
 * builds carry the monitor (it's cheap) but never expose the channel.
 */

let histogram: IntervalHistogram | null = null
let startedAtMs: number | null = null

export function startEventLoopMonitor(resolutionMs = 10): void {
  if (histogram) return
  histogram = monitorEventLoopDelay({ resolution: resolutionMs })
  histogram.enable()
  startedAtMs = Date.now()
}

export interface EventLoopLagSnapshot {
  /** Wall time (ms) since the monitor was enabled. */
  uptimeMs: number
  /** Worst single delay observed, in ms. The beachball red line. */
  maxMs: number
  /** P99 delay in ms. Captures typical worst-case rather than one-off spikes. */
  p99Ms: number
  /** Mean delay in ms. Should sit just above the resolution under healthy load. */
  meanMs: number
  /** Total sample count. */
  count: number
}

export function snapshotEventLoopLag(): EventLoopLagSnapshot {
  if (!histogram || startedAtMs === null) {
    return { uptimeMs: 0, maxMs: 0, p99Ms: 0, meanMs: 0, count: 0 }
  }
  return {
    uptimeMs: Date.now() - startedAtMs,
    maxMs: histogram.max / 1e6,
    p99Ms: histogram.percentile(99) / 1e6,
    meanMs: histogram.mean / 1e6,
    count: histogram.count,
  }
}

/** Reset the histogram so a subsequent snapshot only reflects activity
 *  after the reset. Useful for measuring a specific window
 *  (e.g. cold launch up to first interactive frame). */
export function resetEventLoopLag(): void {
  histogram?.reset()
  startedAtMs = Date.now()
}
