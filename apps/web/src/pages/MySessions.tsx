import { ManagedSessionsSection } from '../components/ManagedSessionsSection'
import { WorkspaceFrame } from '../components/WorkspaceFrame'

import '../styles/app.css'
import '../styles/explore.css'

export function MySessionsPage() {
  return (
    <WorkspaceFrame active="library" rootClassName="explore-root" mainClassName="explore-center">
      <header className="workspace-feed-header">
        <h1>My Sessions</h1>
        <span>Recent</span>
      </header>
      <ManagedSessionsSection presentation="feed" signInNext="/my-sessions" />
    </WorkspaceFrame>
  )
}
