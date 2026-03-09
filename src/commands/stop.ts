import chalk from 'chalk'
import { execSync } from 'child_process'
import { StateManager } from '../state.js'

export async function stopCommand(name: string): Promise<void> {
  const state = new StateManager(process.cwd())
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }
  for (const pid of Object.values(ws.pids)) {
    try { execSync(`kill ${pid}`) } catch { /* already gone */ }
  }
  await state.update(name, { status: 'stopped', pids: {} })
  console.log(chalk.yellow(`Stopped workspace: ${name}`))
}
