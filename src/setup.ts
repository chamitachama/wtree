import { spawn } from 'child_process'
import { access, writeFile, copyFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
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

export async function copyEnvFiles(
  envFiles: string[],
  rootPath: string,
  worktreePath: string
): Promise<void> {
  if (envFiles.length === 0) return

  console.log(chalk.blue('\n🔐 Copying .env files...'))

  for (const envFile of envFiles) {
    const relativePath = envFile.replace(/^\.\//, '')
    const sourcePath = join(rootPath, relativePath)
    const destPath = join(worktreePath, relativePath)

    // Check if source exists
    try {
      await access(sourcePath)
    } catch {
      console.log(chalk.yellow(`  ⚠ Skipping ${envFile} (not found in main repo)`))
      continue
    }

    // Don't overwrite existing .env in worktree
    try {
      await access(destPath)
      console.log(chalk.gray(`  → ${envFile} (already exists, skipping)`))
      continue
    } catch {
      // File doesn't exist, proceed with copy
    }

    // Ensure target directory exists
    await mkdir(dirname(destPath), { recursive: true })

    await copyFile(sourcePath, destPath)
    console.log(chalk.green(`  ✓ ${envFile}`))
  }

  console.log('')
}
