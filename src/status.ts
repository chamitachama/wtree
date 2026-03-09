import type { WorkspaceState } from './state.js'

export interface Conflict { file: string; workspaces: string[] }

export function detectConflicts(changedFiles: Record<string, string[]>): Conflict[] {
  const map = new Map<string, string[]>()
  for (const [ws, files] of Object.entries(changedFiles)) {
    for (const file of files) map.set(file, [...(map.get(file) ?? []), ws])
  }
  return [...map.entries()]
    .filter(([, wsList]) => wsList.length > 1)
    .map(([file, workspaces]) => ({ file, workspaces }))
}

export function generateStatus(
  workspaces: WorkspaceState[],
  commits: Record<string, Array<{ hash: string; message: string }>>,
  changedFiles: Record<string, string[]>
): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const lines = ['# Workspace Status', `Last updated: ${now}`, '']

  for (const ws of workspaces) {
    const ports = Object.entries(ws.ports).map(([n, p]) => `${n}:${p}`).join(' / ')
    lines.push(`## ${ws.name} · ${ws.status} · ${ports}`)
    lines.push(`Branch: ${ws.branch} (from ${ws.baseBranch})`)
    for (const c of commits[ws.name] ?? []) lines.push(`- ${c.hash} ${c.message}`)
    lines.push(`Files changed: ${(changedFiles[ws.name] ?? []).length}`, '')
  }

  const conflicts = detectConflicts(changedFiles)
  if (conflicts.length > 0) {
    lines.push('---', '## ⚠️ Conflict Risks')
    for (const c of conflicts) lines.push(`- ${c.workspaces.join(' + ')} → ${c.file}`)
  }

  return lines.join('\n')
}
