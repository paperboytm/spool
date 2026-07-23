import { TeamsSection } from '../components/TeamsSection'
import { WorkspaceFrame } from '../components/WorkspaceFrame'

import '../styles/app.css'

export function TeamsPage() {
  return (
    <WorkspaceFrame active="teams" layout="wide" mainClassName="workspace-content-main">
      <header className="workspace-page-header">
        <p className="workspace-page-eyebrow">Shared workspaces</p>
        <h1>Teams</h1>
        <p>Open a Team’s recent Session feed, manage members, or create a workspace.</p>
      </header>
      <div className="workspace-page-body">
        <TeamsSection signInNext="/teams" />
      </div>
    </WorkspaceFrame>
  )
}
