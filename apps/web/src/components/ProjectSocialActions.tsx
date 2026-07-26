import { Avatar, Button, Dialog, IconButton } from '@spool-lab/ui'
import { Bell, Star, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  fetchProjectSocial,
  fetchProjectStargazers,
  setProjectStar,
  setProjectWatch,
  type ProjectSocialState,
  type SocialIdentity,
} from '../lib/project-api'

type State = { kind: 'loading' } | { kind: 'ready'; social: ProjectSocialState } | { kind: 'error' }
type StargazersState =
  | { kind: 'idle' | 'loading' | 'error' }
  | { kind: 'ready'; people: SocialIdentity[]; nextCursor: string | null }

export function ProjectSocialActions({ handle, slug }: { handle: string; slug: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [pending, setPending] = useState<'star' | 'watch' | null>(null)
  const [actionError, setActionError] = useState(false)
  const [stargazersOpen, setStargazersOpen] = useState(false)
  const [stargazers, setStargazers] = useState<StargazersState>({ kind: 'idle' })
  const [stargazersLoadingMore, setStargazersLoadingMore] = useState(false)
  const requestId = useRef(0)
  const stargazersRequestId = useRef(0)

  useEffect(() => {
    const current = ++requestId.current
    setState({ kind: 'loading' })
    setPending(null)
    setActionError(false)
    setStargazersOpen(false)
    void fetchProjectSocial(handle, slug).then((result) => {
      if (current !== requestId.current) return
      setState(result.kind === 'ok' ? { kind: 'ready', social: result.data } : { kind: 'error' })
    })
  }, [handle, slug])

  useEffect(() => {
    const current = ++stargazersRequestId.current
    setStargazersLoadingMore(false)
    if (!stargazersOpen) {
      setStargazers({ kind: 'idle' })
      return
    }
    setStargazers({ kind: 'loading' })
    void fetchProjectStargazers(handle, slug).then((result) => {
      if (current !== stargazersRequestId.current) return
      setStargazers(
        result.kind === 'ok'
          ? {
              kind: 'ready',
              people: result.data.stargazers,
              nextCursor: result.data.next_cursor,
            }
          : { kind: 'error' },
      )
    })
  }, [handle, slug, stargazersOpen])

  async function mutate(kind: 'star' | 'watch') {
    if (state.kind !== 'ready' || pending !== null) return
    const current = requestId.current
    const next = kind === 'star' ? !state.social.viewerStarred : !state.social.viewerWatching
    setPending(kind)
    setActionError(false)
    const result =
      kind === 'star'
        ? await setProjectStar(handle, slug, next)
        : await setProjectWatch(handle, slug, next)
    if (current !== requestId.current) return
    setPending(null)
    if (result.kind === 'unauthenticated') {
      const nextPath = `/@${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`
      window.location.assign(`/sign-in?next=${encodeURIComponent(nextPath)}`)
      return
    }
    if (result.kind === 'ok') {
      setState({ kind: 'ready', social: result.data })
    } else {
      setActionError(true)
    }
  }

  async function loadMoreStargazers() {
    if (stargazers.kind !== 'ready' || stargazers.nextCursor === null || stargazersLoadingMore) {
      return
    }
    const current = ++stargazersRequestId.current
    setStargazersLoadingMore(true)
    const result = await fetchProjectStargazers(handle, slug, stargazers.nextCursor)
    if (current !== stargazersRequestId.current) return
    setStargazersLoadingMore(false)
    if (result.kind !== 'ok') return
    setStargazers((previous) =>
      previous.kind !== 'ready'
        ? previous
        : {
            kind: 'ready',
            people: appendUniquePeople(previous.people, result.data.stargazers),
            nextCursor: result.data.next_cursor,
          },
    )
  }

  if (state.kind === 'loading') {
    return <span className="project-social-loading sw-skel" aria-label="Loading Project actions" />
  }
  if (state.kind === 'error') return null

  const { social } = state
  const showStar = social.starEligible
  const showWatch = social.starEligible || social.canWatch
  if (!showStar && !showWatch) return null

  return (
    <div className="project-social-actions" aria-label="Project social actions">
      {showStar ? (
        <div className="inline-flex">
          <Button
            className="rounded-r-none"
            type="button"
            size="sm"
            variant={social.viewerStarred ? 'accent' : 'outline'}
            aria-pressed={social.viewerStarred}
            loading={pending === 'star'}
            loadingLabel="Updating star…"
            onClick={() => void mutate('star')}
          >
            <Star
              size={14}
              strokeWidth={1.8}
              fill={social.viewerStarred ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            Star
          </Button>
          <Button
            className="-ml-px rounded-l-none px-2"
            type="button"
            size="sm"
            variant="outline"
            aria-label={`View ${social.starCount} ${
              social.starCount === 1 ? 'stargazer' : 'stargazers'
            }`}
            onClick={() => setStargazersOpen(true)}
          >
            <Users size={14} strokeWidth={1.8} aria-hidden="true" />
            {social.starCount}
          </Button>
        </div>
      ) : null}
      {showWatch ? (
        <Button
          type="button"
          size="sm"
          variant={social.viewerWatching ? 'accent' : 'outline'}
          aria-pressed={social.viewerWatching}
          loading={pending === 'watch'}
          loadingLabel="Updating watch…"
          onClick={() => void mutate('watch')}
        >
          <Bell
            size={14}
            strokeWidth={1.8}
            fill={social.viewerWatching ? 'currentColor' : 'none'}
            aria-hidden="true"
          />
          Watch
          <span className="project-social-count">{social.watcherCount}</span>
        </Button>
      ) : null}
      {actionError ? (
        <span className="text-meta text-status-error" role="alert">
          Could not update this Project. Try again.
        </span>
      ) : null}
      <Dialog
        className="max-w-[520px]"
        open={stargazersOpen}
        onOpenChange={setStargazersOpen}
        aria-labelledby="project-stargazers-title"
      >
        <header className="border-border flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 id="project-stargazers-title" className="text-section-title m-0 font-semibold">
              Stargazers
            </h2>
            <p className="text-meta text-muted m-0">
              People who starred @{handle}/{slug}
            </p>
          </div>
          <IconButton aria-label="Close stargazers" onClick={() => setStargazersOpen(false)}>
            <X aria-hidden="true" />
          </IconButton>
        </header>
        <div className="max-h-[min(60dvh,520px)] overflow-y-auto p-2">
          {stargazers.kind === 'loading' ? (
            <p className="text-ui text-muted m-0 px-3 py-8 text-center" aria-live="polite">
              Loading stargazers…
            </p>
          ) : null}
          {stargazers.kind === 'error' ? (
            <p className="text-ui text-status-error m-0 px-3 py-8 text-center" role="alert">
              Stargazers could not be loaded.
            </p>
          ) : null}
          {stargazers.kind === 'ready' && stargazers.people.length === 0 ? (
            <p className="text-ui text-muted m-0 px-3 py-8 text-center">No stargazers yet.</p>
          ) : null}
          {stargazers.kind === 'ready'
            ? stargazers.people.map((person) => (
                <a
                  key={person.id}
                  href={`/@${encodeURIComponent(person.handle)}`}
                  className="focus-visible:shadow-focus-ring rounded-control hover:bg-surface-2 flex min-h-12 items-center gap-3 px-3 py-2 focus-visible:outline-none"
                >
                  <Avatar src={person.avatar_url} name={person.name} alt="" size="sm" />
                  <span className="min-w-0">
                    <strong className="text-ui block truncate font-medium">{person.name}</strong>
                    <span className="text-meta text-muted block truncate">@{person.handle}</span>
                  </span>
                </a>
              ))
            : null}
          {stargazers.kind === 'ready' && stargazers.nextCursor !== null ? (
            <div className="flex justify-center p-2">
              <Button
                variant="outline"
                loading={stargazersLoadingMore}
                loadingLabel="Loading more…"
                onClick={() => void loadMoreStargazers()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}

function appendUniquePeople(
  current: readonly SocialIdentity[],
  incoming: readonly SocialIdentity[],
): SocialIdentity[] {
  const ids = new Set(current.map((person) => person.id))
  return [
    ...current,
    ...incoming.filter((person) => {
      if (ids.has(person.id)) return false
      ids.add(person.id)
      return true
    }),
  ]
}
