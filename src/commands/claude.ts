import { spawn } from 'child_process'
import chalk from 'chalk'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { buildContext } from '../claude-context.js'
import { loadConfig } from '../config.js'

export async function claudeCommand(name: string, cwd: string = process.cwd()): Promise<void> {
  const state = new StateManager(cwd)
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }

  const config = await loadConfig(cwd)
  const wm = new WorktreeManager(cwd, `${cwd}/${config.workspacesDir}`)
  const changedFiles = await wm.getChangedFiles(ws.path, ws.baseBranch)
  const context = buildContext(ws, changedFiles)

  console.log(chalk.blue(`Launching Claude in ${ws.path}`))
  spawn('claude', ['--context', context], { cwd: ws.path, stdio: 'inherit' })
}
