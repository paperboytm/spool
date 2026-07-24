import { ManagedSessionsSection } from '../components/ManagedSessionsSection'
import { WorkspaceFrame } from '../components/WorkspaceFrame'

import '../styles/app.css'

export function MySessionsPage() {
  return (
    <WorkspaceFrame active="library" layout="wide" mainClassName="workspace-content-main">
      <header className="workspace-page-header">
        <p className="workspace-page-eyebrow">Your library</p>
        <h1>My Sessions</h1>
        <p>Review your uploaded Sessions and manage who can read them.</p>
      </header>
      <div className="workspace-page-body">
        <ManagedSessionsSection signInNext="/my-sessions" />
      </div>
    </WorkspaceFrame>
  )
}
