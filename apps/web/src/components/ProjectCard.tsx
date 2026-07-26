import { Badge } from '@spool-lab/ui'
import { ExternalLink, FolderKanban, LockKeyhole } from 'lucide-react'

import type { ProjectSummary } from '../lib/project-api'

export function projectHref(project: ProjectSummary): string {
  return `/@${encodeURIComponent(project.owner.handle)}/${encodeURIComponent(project.slug)}`
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const teamOwned = project.owner.kind === 'team'
  const editHref = teamOwned
    ? `/projects/${encodeURIComponent(project.id)}/edit?team=${encodeURIComponent(project.owner.id)}`
    : `/projects/${encodeURIComponent(project.id)}/edit`
  return (
    <article className="project-card">
      <a className="project-card-main" href={projectHref(project)}>
        <div className="project-card-icon" aria-hidden="true">
          <FolderKanban size={17} strokeWidth={1.7} />
        </div>
        <div className="project-card-copy">
          <div className="project-card-title-line">
            <h2>{project.name}</h2>
            {teamOwned ? (
              <Badge className="project-card-visibility">
                <LockKeyhole size={11} strokeWidth={1.8} aria-hidden="true" />
                Team
              </Badge>
            ) : null}
          </div>
          <span className="project-card-owner">
            @{project.owner.handle}/{project.slug}
          </span>
          <p>{project.description || 'A home for related agent Sessions.'}</p>
          <span className="project-card-meta">
            {project.session_count} {project.session_count === 1 ? 'Session' : 'Sessions'}
          </span>
        </div>
      </a>
      {project.github_url || project.can_manage ? (
        <div className="project-card-actions">
          {project.github_url ? (
            <a
              className="project-card-action"
              href={project.github_url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${project.name} on GitHub`}
            >
              GitHub
              <ExternalLink size={13} strokeWidth={1.7} aria-hidden="true" />
            </a>
          ) : null}
          {project.can_manage ? (
            <a className="project-card-action" href={editHref}>
              Edit
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
