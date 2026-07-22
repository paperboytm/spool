import { ExternalLink } from 'lucide-react'

/* The Session's route map: the derived trajectory from prompt to
 * outcome rendered as a winding path — steering prompts are waypoints,
 * friction (tool errors / failed checks) branches off as dead-end
 * stubs, and the recorded PR closes the route. Clicking a waypoint
 * jumps the conversation to that prompt. */
import type { SessionRoute } from '../../lib/session-route'

const MIN_WIDTH = 640
const POINT_GAP = 96
const PAD_X = 64
const BASE_Y = 96
const WAVE = 32
const HEIGHT = 192

interface Point {
  x: number
  y: number
}

function phasePoints(count: number, width: number): Point[] {
  const usable = width - PAD_X * 2
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1)
    return {
      x: PAD_X + t * usable,
      y: BASE_Y + (i % 2 === 0 ? -WAVE : WAVE) * (count === 1 ? 0 : 1),
    }
  })
}

function routePath(points: Point[]): string {
  if (points.length === 0) return ''
  let d = `M${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const mx = (a.x + b.x) / 2
    d += ` C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`
  }
  return d
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function phaseActivity(phase: SessionRoute['phases'][number]): string[] {
  return [
    phase.tools > 0 ? countLabel(phase.tools, 'tool') : null,
    phase.edits > 0 ? countLabel(phase.edits, 'edit') : null,
    phase.agents > 0 ? countLabel(phase.agents, 'agent') : null,
  ].filter((part): part is string => part !== null)
}

function phaseDeadEnds(phase: SessionRoute['phases'][number]): number {
  return phase.errors + phase.checkFails
}

function safePullRequestUrl(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    return url.origin === 'https://github.com' &&
      /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)
      ? value
      : null
  } catch {
    return null
  }
}

function phaseAccessibleLabel(
  phase: SessionRoute['phases'][number],
  index: number,
  phaseCount: number,
): string {
  const details = phaseActivity(phase)
  const deadEnds = phaseDeadEnds(phase)
  if (deadEnds > 0) details.push(countLabel(deadEnds, 'dead end'))

  return [
    `Phase ${index + 1} of ${phaseCount}: ${phase.label}`,
    details.length > 0 ? details.join(', ') : null,
    'Jump to this point in the session',
  ]
    .filter((part): part is string => part !== null)
    .join('. ')
}

export function SessionRouteMap({
  route,
  onJump,
}: {
  route: SessionRoute
  onJump: (recordIndex: number) => void
}) {
  const { phases } = route
  const width = Math.max(MIN_WIDTH, phases.length * POINT_GAP + PAD_X * 2)
  const points = phasePoints(phases.length + 1, width)
  const outcome = points[points.length - 1]!
  const path = routePath(points)
  const prUrl = safePullRequestUrl(route.prUrl)

  return (
    <section
      aria-labelledby="session-route-title"
      className="mb-6 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card,var(--bg))]"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-[var(--border)] px-4 py-3">
        <h3
          id="session-route-title"
          className="m-0 shrink-0 text-[10px] font-semibold tracking-[0.08em] text-[var(--muted)] uppercase"
        >
          Route
        </h3>
        {route.goal !== null && (
          <span className="order-3 w-full min-w-0 font-mono text-[11px] break-words text-[var(--text)] sm:order-none sm:w-auto sm:flex-1 sm:truncate">
            <span className="font-semibold text-[var(--accent)]">/goal</span> {route.goal}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--muted)] tabular-nums">
          {countLabel(phases.length, 'phase')}
          {route.totalErrors > 0 ? ` · ${countLabel(route.totalErrors, 'dead end')}` : ''}
        </span>
      </div>

      <div className="px-3 py-3 lg:hidden">
        <ol className="m-0 list-none space-y-2 p-0">
          {phases.map((phase, index) => {
            const activity = phaseActivity(phase)
            const deadEnds = phaseDeadEnds(phase)
            return (
              <li key={phase.recordIndex}>
                <button
                  type="button"
                  aria-label={phaseAccessibleLabel(phase, index, phases.length)}
                  onClick={() => onJump(phase.recordIndex)}
                  className="flex min-h-12 w-full cursor-pointer items-start gap-3 rounded-[6px] border border-[var(--border)] bg-[var(--card)] p-3 text-left transition-colors duration-[80ms] hover:border-[var(--border-strong)] hover:bg-[var(--card-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:bg-[var(--accent-bg)]"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1 size-2 shrink-0 rounded-full border-2 border-[var(--accent)] bg-[var(--bg)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-xs leading-5 break-words text-[var(--text)]">
                      {phase.label}
                    </span>
                    {(activity.length > 0 || deadEnds > 0) && (
                      <span className="mt-1 block font-mono text-[11px] leading-4 text-[var(--muted)] tabular-nums">
                        {[...activity, deadEnds > 0 ? countLabel(deadEnds, 'dead end') : null]
                          .filter((part): part is string => part !== null)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
          <li className="flex min-h-12 items-center gap-3 px-3 py-2">
            <span
              aria-hidden="true"
              className="flex size-4 shrink-0 items-center justify-center rounded-full border border-[var(--accent)]"
            >
              <span className="size-2 rounded-full bg-[var(--accent)]" />
            </span>
            <span className="min-w-0 font-mono text-[11px] leading-4 font-semibold break-words text-[var(--accent)]">
              {route.prLabel ?? 'Session end'}
            </span>
          </li>
        </ol>
      </div>

      <div className="hidden lg:block">
        <span className="sr-only">Outcome: {route.prLabel ?? 'Session end'}</span>
      </div>

      <div className="hidden overflow-x-auto px-2 py-3 lg:block">
        <div className="relative w-full" style={{ minWidth: `${width}px` }}>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="pointer-events-none block h-auto w-full"
            aria-hidden="true"
          >
            {/* route */}
            <path
              d={path}
              fill="none"
              stroke="color-mix(in srgb, var(--accent) 18%, transparent)"
              strokeWidth={8}
              strokeLinecap="round"
            />
            <path
              d={path}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
            />

            {phases.map((phase, i) => {
              const p = points[i]!
              const above = p.y <= BASE_Y
              const labelY = above ? p.y - 32 : p.y + 32
              const metaY = above ? p.y - 16 : p.y + 48
              const stubY = above ? p.y + 32 : p.y - 32
              const anchor = p.x < 96 ? 'start' : p.x > width - 96 ? 'end' : 'middle'
              const anchorX = anchor === 'start' ? p.x - 8 : anchor === 'end' ? p.x + 8 : p.x
              const meta = phaseActivity(phase).join(' · ')
              const deadEnds = phaseDeadEnds(phase)
              return (
                <g key={phase.recordIndex}>
                  {deadEnds > 0 && (
                    <>
                      <path
                        d={`M${p.x} ${p.y} C${p.x + 16} ${(p.y + stubY) / 2} ${p.x + 8} ${(p.y + stubY) / 2} ${p.x + 24} ${stubY}`}
                        fill="none"
                        stroke="var(--muted)"
                        strokeWidth={1.6}
                        strokeDasharray="4 4"
                      />
                      <circle
                        cx={p.x + 24}
                        cy={stubY}
                        r={8}
                        fill="var(--bg)"
                        stroke="var(--muted)"
                        strokeWidth={1.6}
                      />
                      <path
                        d={`M${p.x + 21} ${stubY - 3} L${p.x + 27} ${stubY + 3} M${p.x + 27} ${stubY - 3} L${p.x + 21} ${stubY + 3}`}
                        stroke="var(--muted)"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                      />
                      <text
                        x={p.x + 40}
                        y={stubY + 4}
                        className="fill-[var(--muted)] font-mono text-[11px]"
                      >
                        {deadEnds}
                      </text>
                    </>
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    fill="var(--bg)"
                    stroke="var(--accent)"
                    strokeWidth={2}
                  />
                  <text
                    x={anchorX}
                    y={labelY}
                    textAnchor={anchor}
                    className="fill-[var(--text)] font-mono text-xs"
                  >
                    {phase.label.length > 26 ? `${phase.label.slice(0, 25)}…` : phase.label}
                  </text>
                  {meta && (
                    <text
                      x={anchorX}
                      y={metaY}
                      textAnchor={anchor}
                      className="fill-[var(--muted)] font-mono text-[11px]"
                    >
                      {meta}
                    </text>
                  )}
                </g>
              )
            })}

            {/* outcome */}
            <g>
              <circle
                cx={outcome.x}
                cy={outcome.y}
                r={12}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.6}
                opacity={0.6}
              />
              <circle cx={outcome.x} cy={outcome.y} r={6} fill="var(--accent)" />
              <text
                x={width - 32}
                y={outcome.y <= BASE_Y ? outcome.y - 24 : outcome.y + 32}
                textAnchor="end"
                className="fill-[var(--accent)] font-mono text-[11px] font-semibold"
              >
                {route.prLabel ?? 'Session end'}
              </text>
            </g>
          </svg>

          {phases.map((phase, index) => {
            const point = points[index]!
            return (
              <button
                key={phase.recordIndex}
                type="button"
                title={phase.label}
                aria-label={phaseAccessibleLabel(phase, index, phases.length)}
                onClick={() => onJump(phase.recordIndex)}
                className="absolute size-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-[6px] border border-transparent bg-transparent transition-colors duration-[80ms] hover:bg-[var(--accent-weak)] focus-visible:bg-[var(--accent-weak)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:bg-[var(--accent-bg)]"
                style={{ left: `${(point.x / width) * 100}%`, top: `${(point.y / HEIGHT) * 100}%` }}
              />
            )
          })}
        </div>
      </div>

      {prUrl !== null && (
        <div className="border-t border-[var(--border)] px-4">
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center gap-2 font-mono text-[11px] text-[var(--accent)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <span>{route.prLabel ?? 'Open pull request'}</span>
            <ExternalLink size={12} strokeWidth={1.7} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      )}
    </section>
  )
}
