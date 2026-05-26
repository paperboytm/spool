import type { Session } from '@spool-lab/core'

export function printSession(s: Session): void {
  const date = formatDate(s.startedAt)
  const source = s.source.padEnd(7)
  const project = s.projectDisplayName.slice(0, 20).padEnd(20)
  const title = (s.title ?? '(no title)').slice(0, 50)
  console.log(`${source} ${date}  ${project}  ${title}`)
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return iso.slice(0, 10)
  }
}
