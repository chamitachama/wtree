import { execSync } from 'child_process'
import chalk from 'chalk'
import { StateManager } from '../state.js'

export async function browserCommand(name: string, cwd: string = process.cwd()): Promise<void> {
  const state = new StateManager(cwd)
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }
  if (ws.status === 'stopped') { console.error(chalk.red(`Workspace "${name}" is stopped`)); process.exit(1) }
  const port = Object.values(ws.ports)[0]
  const url = `http://localhost:${port}`
  console.log(chalk.blue(`Opening ${url}`))
  execSync(`open "${url}"`)
}
