import chalk from 'chalk'
import { execSync } from 'child_process'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { writeStatusDoc } from '../status-writer.js'
import { confirmDelete } from '../prompt.js'

export async function destroyCommand(name: string): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }

  const confirmed = await confirmDelete(name)
  if (!confirmed) { console.log(chalk.gray('Aborted.')); return }

  for (const pid of Object.values(ws.pids)) {
    try { execSync(`kill ${pid}`) } catch { /* already gone */ }
  }

  await wm.remove(name)
  await state.remove(name)
  await writeStatusDoc(root, state, wm)
  console.log(chalk.red(`Destroyed workspace: ${name}`))
}
