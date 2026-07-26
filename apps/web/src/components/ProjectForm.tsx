import { Button } from '@spool-lab/ui'
import { GitBranch } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import type { ProjectSummary, ProjectWrite } from '../lib/project-api'

export function slugifyProjectName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

export function ProjectForm({
  initial,
  ownerHandle,
  busy,
  error,
  submitLabel,
  onSubmit,
}: {
  initial?: ProjectSummary
  ownerHandle: string
  busy: boolean
  error: string | null
  submitLabel: string
  onSubmit: (value: ProjectWrite) => void | Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(Boolean(initial))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [githubUrl, setGithubUrl] = useState(initial?.github_url ?? '')

  useEffect(() => {
    if (!slugEdited) setSlug(slugifyProjectName(name))
  }, [name, slugEdited])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value: ProjectWrite = {
      name: name.trim(),
      slug: slugifyProjectName(slug),
      description: description.trim() || null,
      github_url: githubUrl.trim() || null,
    }
    if (!value.name || !value.slug || busy) return
    void onSubmit(value)
  }

  return (
    <form className="project-form" onSubmit={submit}>
      <div className="project-form-row">
        <label>
          <span>Project name</span>
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            placeholder="React Vapor"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <span>Project URL</span>
          <span className="project-slug-input">
            <span>@{ownerHandle}/</span>
            <input
              required
              maxLength={64}
              pattern="[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?"
              value={slug}
              placeholder="react-vapor"
              aria-describedby="project-slug-help"
              onChange={(event) => {
                setSlugEdited(true)
                setSlug(event.target.value.toLowerCase())
              }}
            />
          </span>
        </label>
      </div>
      <p id="project-slug-help" className="project-form-help">
        This owner-and-slug URL is how Sessions and the CLI refer to the Project.
      </p>
      <label>
        <span>Description</span>
        <textarea
          rows={4}
          maxLength={600}
          value={description}
          placeholder="Explain the problem this Project explores and why the Sessions belong together."
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        <span>
          GitHub URL <em>optional</em>
        </span>
        <span className="project-github-input">
          <GitBranch size={15} strokeWidth={1.7} aria-hidden="true" />
          <input
            type="url"
            inputMode="url"
            maxLength={500}
            value={githubUrl}
            placeholder="https://github.com/owner/repository"
            onChange={(event) => setGithubUrl(event.target.value)}
          />
        </span>
      </label>
      {error ? (
        <p className="project-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="project-form-actions">
        <Button
          size="lg"
          type="submit"
          variant="accent"
          loading={busy}
          loadingLabel="Saving…"
          disabled={!busy && (!name.trim() || !slugifyProjectName(slug))}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
