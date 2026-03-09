import type { WorkspaceState } from './state.js'

export function buildContext(ws: WorkspaceState, changedFiles: string[]): string {
  const services = Object.entries(ws.ports)
    .map(([name, port]) => `${name} → http://localhost:${port}`)
    .join(', ')
  const lines = [
    `Workspace: ${ws.name} | Branch: ${ws.branch}`,
    `Services: ${services}`,
  ]
  if (changedFiles.length > 0) {
    lines.push(`Changed files vs ${ws.baseBranch}: ${changedFiles.join(', ')}`)
  }
  return lines.join('\n')
}
