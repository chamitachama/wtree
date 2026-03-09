import chalk from 'chalk'
import { StateManager } from '../state.js'

export async function listCommand(): Promise<void> {
  const state = new StateManager(process.cwd())
  const workspaces = await state.getAll()
  if (workspaces.length === 0) {
    console.log(chalk.gray('No active workspaces. Run `wtree open <branch>` to start one.'))
    return
  }
  for (const ws of workspaces) {
    const ports = Object.entries(ws.ports).map(([n, p]) => `${n}:${p}`).join('  ')
    const dot = ws.status === 'running' ? chalk.green('●') : chalk.gray('○')
    console.log(`${dot} ${chalk.bold(ws.name)} [${ws.branch}]  ${ports}`)
  }
}
