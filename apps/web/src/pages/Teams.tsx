import { TeamsSection } from '../components/TeamsSection'
import { WorkspaceFrame } from '../components/WorkspaceFrame'

import '../styles/app.css'

export function TeamsPage() {
  return (
    <WorkspaceFrame active="teams" mainClassName="workspace-content-main">
      <header className="workspace-page-header">
        <p className="workspace-page-eyebrow">Team workspace</p>
        <h1>Create a Team</h1>
        <p>Start a private workspace for Sessions shared with current members.</p>
      </header>
      <div className="workspace-page-body">
        <TeamsSection signInNext="/teams" presentation="create" />
      </div>
    </WorkspaceFrame>
  )
}
