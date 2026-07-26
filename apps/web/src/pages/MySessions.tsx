import { ManagedSessionsSection } from '../components/ManagedSessionsSection'
import { SessionLanguageToggle } from '../components/SessionLanguageToggle'
import { WorkspaceFrame } from '../components/WorkspaceFrame'

import '../styles/app.css'
import '../styles/explore.css'

export function MySessionsPage() {
  return (
    <WorkspaceFrame active="library" rootClassName="explore-root" mainClassName="explore-center">
      <header className="workspace-feed-header">
        <h1>My Sessions</h1>
        <div className="workspace-feed-header-actions">
          <span>Recent</span>
          <SessionLanguageToggle />
        </div>
      </header>
      <ManagedSessionsSection presentation="feed" signInNext="/my-sessions" />
    </WorkspaceFrame>
  )
}
