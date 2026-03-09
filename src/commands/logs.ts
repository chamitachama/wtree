import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { StateManager } from '../state.js'
import { pickService } from '../logs-picker.js'

export async function logsCommand(name: string, cwd: string = process.cwd()): Promise<void> {
  const state = new StateManager(cwd)
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }

  const serviceNames = Object.keys(ws.ports)
  const chosen = await pickService(serviceNames)
  const logFile = join(cwd, '.wtree', 'logs', `${name}-${chosen}.log`)

  if (!existsSync(logFile)) {
    console.error(chalk.red(`No log file found for "${chosen}". Is the workspace running?`))
    process.exit(1)
  }

  console.log(chalk.blue(`Tailing logs for ${chosen}...`))
  spawn('tail', ['-f', logFile], { stdio: 'inherit' })
}
