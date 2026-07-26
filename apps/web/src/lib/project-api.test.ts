import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  archiveProject,
  createProject,
  fetchAllTeamProjects,
  fetchOwnerProject,
  fetchOwnerProjects,
  fetchProjectSocial,
  fetchProjectStargazers,
  fetchPublicProjects,
  fetchTeamProjects,
  fetchUserFollow,
  setProjectStar,
  setProjectWatch,
  setUserFollow,
  updateProject,
} from './project-api'

afterEach(() => vi.restoreAllMocks())

function respond(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const write = {
  name: 'React Vapor',
  slug: 'react-vapor',
  description: 'Why the work exists.',
  github_url: 'https://github.com/paperboytm/react-vapor',
}

describe('Project API client', () => {
  it('loads public and Team Project collections with encoded cursors and tenant ids', async () => {
    respond(200, { projects: [], next_cursor: null })
    await fetchPublicProjects('opaque/next+cursor')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/projects?cursor=opaque%2Fnext%2Bcursor',
      expect.objectContaining({ credentials: 'same-origin' }),
    )

    respond(200, { projects: [], next_cursor: null })
    await fetchTeamProjects('team/a', 'next/value')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/teams/team%2Fa/projects?cursor=next%2Fvalue',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('loads every Team Project page and de-duplicates cursor overlap', async () => {
    const first = {
      id: 'project_1',
      name: 'First',
    }
    const second = {
      id: 'project_2',
      name: 'Second',
    }
    respond(200, { projects: [first], next_cursor: 'next/page' })
    respond(200, { projects: [first, second], next_cursor: null })

    await expect(fetchAllTeamProjects('team/a')).resolves.toEqual({
      kind: 'ok',
      data: { projects: [first, second] },
    })
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/teams/team%2Fa/projects?cursor=next%2Fpage',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('fails closed when a Team Project cursor repeats', async () => {
    respond(200, { projects: [], next_cursor: 'same' })
    respond(200, { projects: [], next_cursor: 'same' })

    await expect(fetchAllTeamProjects('team_1')).resolves.toEqual({ kind: 'error' })
  })

  it('loads the canonical owner/project path without trusting raw URL segments', async () => {
    respond(200, { project: {}, sessions: [], next_cursor: null })
    await fetchOwnerProject('team/name', 'project one', 'next/value')

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/team%2Fname/projects/project%20one?cursor=next%2Fvalue',
      expect.objectContaining({ credentials: 'same-origin' }),
    )

    respond(200, {
      owner: {},
      projects: [],
      sessions: [],
      session_count: 0,
      next_cursor: null,
    })
    await fetchOwnerProjects('maya/name', 'profile/next')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/maya%2Fname/projects?cursor=profile%2Fnext',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('creates a personal Project with an idempotency key', async () => {
    respond(201, { project: {} })
    await createProject(write, 'project-create-intent-0001')

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/me/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(write),
      }),
    )
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('project-create-intent-0001')
  })

  it('updates and archives only inside the selected Team boundary', async () => {
    respond(200, { project: {} })
    await updateProject('project/a', write, 'team/a')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/teams/team%2Fa/projects/project%2Fa',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(write) }),
    )

    respond(200, { project: {} })
    await archiveProject('project/a', 'team/a')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/teams/team%2Fa/projects/project%2Fa',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      }),
    )
  })

  it('keeps authorization, validation, and conflicts typed', async () => {
    respond(401, {})
    expect(await createProject(write, 'project-create-intent-0002')).toEqual({
      kind: 'unauthenticated',
    })

    respond(409, { detail: 'slug already exists' })
    expect(await createProject(write, 'project-create-intent-0003')).toEqual({
      kind: 'conflict',
      detail: 'slug already exists',
    })

    respond(422, { detail: 'invalid github url' })
    expect(await createProject(write, 'project-create-intent-0004')).toEqual({
      kind: 'invalid',
      detail: 'invalid github url',
    })
  })

  it('uses canonical social endpoints and idempotent PUT/DELETE mutations', async () => {
    respond(200, { version: 1, starCount: 2 })
    await fetchProjectSocial('paperboy/team', 'spool project')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/paperboy%2Fteam/projects/spool%20project/social',
      expect.objectContaining({ credentials: 'same-origin' }),
    )

    respond(200, { stargazers: [], next_cursor: null })
    await fetchProjectStargazers('paperboy/team', 'spool project', 'next/value')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/paperboy%2Fteam/projects/spool%20project/stargazers?cursor=next%2Fvalue',
      expect.objectContaining({ credentials: 'same-origin' }),
    )

    respond(200, { version: 1, starCount: 3 })
    await setProjectStar('paperboy', 'spool', true)
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/paperboy/projects/spool/star',
      expect.objectContaining({ method: 'PUT' }),
    )

    respond(200, { version: 1, starCount: 2 })
    await setProjectStar('paperboy', 'spool', false)
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/paperboy/projects/spool/star',
      expect.objectContaining({ method: 'DELETE' }),
    )

    respond(200, { version: 1, watcherCount: 1 })
    await setProjectWatch('paperboy', 'spool', true)
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/paperboy/projects/spool/watch',
      expect.objectContaining({ method: 'PUT' }),
    )

    respond(200, { version: 1, followerCount: 4 })
    await fetchUserFollow('doodlewind')
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/doodlewind/follow',
      expect.objectContaining({ credentials: 'same-origin' }),
    )

    respond(200, { version: 1, viewerFollowing: true })
    await setUserFollow('doodlewind', true)
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/owners/doodlewind/follow',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
