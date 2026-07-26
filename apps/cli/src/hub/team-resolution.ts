import type { HubTeam } from './client.js'

export class AmbiguousTeamReferenceError extends Error {
  constructor(reference: string, teams: readonly HubTeam[]) {
    const choices = teams.map((team) => `${team.handle ? `@${team.handle} · ` : ''}${team.id}`)
    super(
      `More than one Team is named "${reference}". ` +
        `Pass a Team handle or id: ${choices.join(', ')}.`,
    )
    this.name = 'AmbiguousTeamReferenceError'
  }
}

/**
 * Resolve a stable Team id/handle first. A mutable display name remains a
 * convenience only when it identifies exactly one confirmed membership.
 */
export function resolveTeamReference(
  teams: readonly HubTeam[],
  reference: string,
): HubTeam | undefined {
  const wanted = reference.trim()
  const handle = wanted.startsWith('@') ? wanted.slice(1) : wanted
  const stable = teams.find(
    (team) =>
      team.id === wanted ||
      (typeof team.handle === 'string' && team.handle.toLowerCase() === handle.toLowerCase()),
  )
  if (stable) return stable

  const named = teams.filter((team) => team.name === wanted)
  if (named.length > 1) throw new AmbiguousTeamReferenceError(wanted, named)
  return named[0]
}
