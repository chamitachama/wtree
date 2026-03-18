import { spawn } from 'child_process'
import { access, writeFile } from 'fs/promises'
import { join } from 'path'
import chalk from 'chalk'
import type { SetupCommand } from './config.js'

const SETUP_MARKER = '.wtree-setup-done'

export async function isSetupDone(worktreePath: string): Promise<boolean> {
  try {
    await access(join(worktreePath, SETUP_MARKER))
    return true
  } catch {
    return false
  }
}

export async function markSetupDone(worktreePath: string): Promise<void> {
  await writeFile(join(worktreePath, SETUP_MARKER), new Date().toISOString())
}

export async function runSetup(
  commands: SetupCommand[],
  worktreePath: string
): Promise<void> {
  if (commands.length === 0) return

  console.log(chalk.blue('\n📦 Running setup commands...'))

  for (const cmd of commands) {
    const cwd = join(worktreePath, cmd.cwd.replace(/^\.\//, ''))
    console.log(chalk.gray(`  → ${cmd.command} (in ${cmd.cwd})`))

    const exitCode = await new Promise<number>((resolve, reject) => {
      const proc = spawn(cmd.command, {
        cwd,
        shell: true,
        stdio: 'inherit',
      })

      proc.on('error', reject)
      proc.on('close', (code) => resolve(code ?? 0))
    })

    if (exitCode !== 0) {
      throw new Error(`Setup command failed with exit code ${exitCode}: ${cmd.command}`)
    }
  }

  await markSetupDone(worktreePath)
  console.log(chalk.green('✓ Setup complete\n'))
}
