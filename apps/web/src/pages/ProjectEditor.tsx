import { Button, ButtonLink } from '@spool-lab/ui'
import { Archive, FolderKanban } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { projectHref } from '../components/ProjectCard'
import { ProjectForm } from '../components/ProjectForm'
import { WorkspaceFrame } from '../components/WorkspaceFrame'
import { fetchMe } from '../lib/api'
import {
  archiveProject,
  createProject,
  fetchManagedProject,
  updateProject,
  type ProjectSummary,
  type ProjectWrite,
} from '../lib/project-api'
import { fetchTeam } from '../lib/team-api'

import '../styles/projects.css'

type OwnerState =
  | { kind: 'loading' }
  | { kind: 'ready'; id: string; handle: string; name: string; teamId?: string }
  | { kind: 'missing-handle'; teamId?: string }
  | { kind: 'unavailable' }

function projectFailureMessage(kind: string, detail?: string): string {
  if (kind === 'conflict') return detail ?? 'That Project URL is already in use.'
  if (kind === 'invalid') return detail ?? 'Check the Project details and try again.'
  if (kind === 'forbidden') return detail ?? 'You cannot manage Projects in this workspace.'
  if (kind === 'rate-limited') return 'Too many changes. Wait a moment and try again.'
  return 'The Project could not be saved. Try again.'
}

function redirectToSignIn(): void {
  const next = `${window.location.pathname}${window.location.search}`
  window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`)
}

export function NewProjectPage({ teamId }: { teamId?: string }) {
  const [owner, setOwner] = useState<OwnerState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idempotencyKey = useRef(crypto.randomUUID())

  useEffect(() => {
    let alive = true
    if (teamId) {
      void fetchTeam(teamId).then((result) => {
        if (!alive) return
        if (result.kind === 'unauthenticated') return redirectToSignIn()
        if (result.kind !== 'ok') return setOwner({ kind: 'unavailable' })
        const handle = result.data.team.handle
        setOwner(
          handle
            ? {
                kind: 'ready',
                id: result.data.team.id,
                handle,
                name: result.data.team.name,
                teamId: result.data.team.id,
              }
            : { kind: 'missing-handle', teamId: result.data.team.id },
        )
      })
    } else {
      void fetchMe().then((result) => {
        if (!alive) return
        if (result.kind === 'unauthenticated') return redirectToSignIn()
        if (result.kind !== 'ok') return setOwner({ kind: 'unavailable' })
        setOwner(
          result.me.handle
            ? {
                kind: 'ready',
                id: result.me.id,
                handle: result.me.handle,
                name: result.me.display_name,
              }
            : { kind: 'missing-handle' },
        )
      })
    }
    return () => {
      alive = false
    }
  }, [teamId])

  async function submit(value: ProjectWrite) {
    if (owner.kind !== 'ready') return
    setBusy(true)
    setError(null)
    const result = await createProject(value, idempotencyKey.current, owner.teamId)
    setBusy(false)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') {
      setError(projectFailureMessage(result.kind, 'detail' in result ? result.detail : undefined))
      return
    }
    window.location.assign(projectHref(result.data.project))
  }

  return (
    <WorkspaceFrame active="projects" activeTeamId={teamId} mainClassName="workspace-content-main">
      <header className="workspace-page-header project-editor-header">
        <p className="workspace-page-eyebrow">{teamId ? 'Team Project' : 'Your namespace'}</p>
        <h1>New Project</h1>
        <p>
          Give related Sessions a stable home, a clear explanation, and an optional link to their
          code.
        </p>
      </header>
      <div className="workspace-page-body project-editor-body">
        {owner.kind === 'loading' ? (
          <div className="projects-state" aria-busy="true">
            <span className="sw-spin sw-spin-anim" aria-hidden="true" />
            <span>Checking the Project owner</span>
          </div>
        ) : null}
        {owner.kind === 'missing-handle' ? (
          <div className="projects-state">
            <FolderKanban size={22} strokeWidth={1.6} aria-hidden="true" />
            <h2>Choose a handle first</h2>
            <p>
              A Project needs a stable owner URL before it can be referenced by Sessions and the
              CLI.
            </p>
            <ButtonLink
              href={owner.teamId ? `/teams/${encodeURIComponent(owner.teamId)}` : '/me'}
              variant="accent"
            >
              Set handle
            </ButtonLink>
          </div>
        ) : null}
        {owner.kind === 'unavailable' ? (
          <div className="projects-state" role="alert">
            <h2>Project owner unavailable</h2>
            <p>Open a workspace you can manage and try again.</p>
          </div>
        ) : null}
        {owner.kind === 'ready' ? (
          <ProjectForm
            ownerHandle={owner.handle}
            busy={busy}
            error={error}
            submitLabel="Create Project"
            onSubmit={submit}
          />
        ) : null}
      </div>
    </WorkspaceFrame>
  )
}

type EditState =
  | { kind: 'loading' }
  | { kind: 'ready'; project: ProjectSummary }
  | { kind: 'unavailable' }

export function EditProjectPage({ projectId, teamId }: { projectId: string; teamId?: string }) {
  const [state, setState] = useState<EditState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const result = await fetchManagedProject(projectId, teamId)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok' || !result.data.project.can_manage) {
      setState({ kind: 'unavailable' })
      return
    }
    setState({ kind: 'ready', project: result.data.project })
  }, [projectId, teamId])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(value: ProjectWrite) {
    if (state.kind !== 'ready') return
    setBusy(true)
    setError(null)
    const result = await updateProject(projectId, value, teamId)
    setBusy(false)
    if (result.kind !== 'ok') {
      if (result.kind === 'unauthenticated') return redirectToSignIn()
      setError(projectFailureMessage(result.kind, 'detail' in result ? result.detail : undefined))
      return
    }
    window.location.assign(projectHref(result.data.project))
  }

  async function archive() {
    if (state.kind !== 'ready') return
    if (
      !window.confirm(
        `Archive the empty Project ${state.project.name}? It will disappear from Project navigation.`,
      )
    ) {
      return
    }
    setArchiveBusy(true)
    const result = await archiveProject(projectId, teamId)
    setArchiveBusy(false)
    if (result.kind !== 'ok') {
      setError(projectFailureMessage(result.kind, 'detail' in result ? result.detail : undefined))
      return
    }
    window.location.assign(
      teamId ? `/projects?scope=team&team=${encodeURIComponent(teamId)}` : '/projects?scope=mine',
    )
  }

  return (
    <WorkspaceFrame active="projects" activeTeamId={teamId} mainClassName="workspace-content-main">
      <header className="workspace-page-header project-editor-header">
        <p className="workspace-page-eyebrow">Project settings</p>
        <h1>{state.kind === 'ready' ? state.project.name : 'Edit Project'}</h1>
        <p>Project metadata explains why its Sessions belong together; it never stores code.</p>
      </header>
      <div className="workspace-page-body project-editor-body">
        {state.kind === 'loading' ? (
          <div className="projects-state" aria-busy="true">
            <span className="sw-spin sw-spin-anim" aria-hidden="true" />
            <span>Loading Project</span>
          </div>
        ) : null}
        {state.kind === 'unavailable' ? (
          <div className="projects-state">
            <h2>Project unavailable</h2>
            <p>This Project does not exist, or you cannot manage it.</p>
          </div>
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <ProjectForm
              initial={state.project}
              ownerHandle={state.project.owner.handle}
              busy={busy}
              error={error}
              submitLabel="Save Project"
              onSubmit={submit}
            />
            <section className="project-danger-zone">
              <div>
                <h2>Archive Project</h2>
                <p>
                  {state.project.session_count > 0
                    ? 'Move every Session to another Project before archiving this one.'
                    : 'Hide this empty Project from navigation. Its owner-and-slug URL will stop resolving.'}
                </p>
              </div>
              <Button
                variant="danger"
                loading={archiveBusy}
                loadingLabel="Archiving…"
                disabled={state.project.session_count > 0}
                onClick={() => void archive()}
              >
                <Archive size={15} aria-hidden="true" />
                Archive
              </Button>
            </section>
          </>
        ) : null}
      </div>
    </WorkspaceFrame>
  )
}
