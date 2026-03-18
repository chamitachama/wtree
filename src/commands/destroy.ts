import chalk from 'chalk'
import { execSync } from 'child_process'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { writeStatusDoc } from '../status-writer.js'
import { confirmDelete } from '../prompt.js'

function spinner(text: string): { stop: (final?: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  const interval = setInterval(() => {
    process.stdout.write(`\r${chalk.cyan(frames[i++ % frames.length])} ${text}`)
  }, 80)
  
  return {
    stop: (final?: string) => {
      clearInterval(interval)
      process.stdout.write('\r' + ' '.repeat(text.length + 10) + '\r')
      if (final) console.log(final)
    }
  }
}

export async function destroyCommand(name: string): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }

  const confirmed = await confirmDelete(name)
  if (!confirmed) { console.log(chalk.gray('Aborted.')); return }

  const spin = spinner(`Destroying ${name}...`)

  try {
    // Stop processes
    for (const pid of Object.values(ws.pids)) {
      try { execSync(`kill ${pid}`, { stdio: 'ignore' }) } catch { /* already gone */ }
    }

    // Remove worktree (this is the slow part)
    await wm.remove(name)
    await state.remove(name)
    await writeStatusDoc(root, state, wm)
    
    spin.stop(chalk.red(`✓ Destroyed workspace: ${name}`))
  } catch (err) {
    spin.stop(chalk.red(`✗ Failed to destroy: ${(err as Error).message}`))
    process.exit(1)
  }
}
