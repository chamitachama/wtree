import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { generateStatus } from './status.js'
import type { StateManager } from './state.js'
import type { WorktreeManager } from './worktree.js'

export async function writeStatusDoc(root: string, state: StateManager, wm: WorktreeManager): Promise<void> {
  const workspaces = await state.getAll()
  const commits: Record<string, Array<{ hash: string; message: string }>> = {}
  const changedFiles: Record<string, string[]> = {}
  for (const ws of workspaces) {
    commits[ws.name] = await wm.getCommitsSince(ws.path, ws.baseBranch)
    changedFiles[ws.name] = await wm.getChangedFiles(ws.path, ws.baseBranch)
  }
  await mkdir(join(root, '.wtree'), { recursive: true })
  await writeFile(join(root, '.wtree', 'STATUS.md'), generateStatus(workspaces, commits, changedFiles))
}
