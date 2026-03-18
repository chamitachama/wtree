import { spawn } from 'child_process'
import { access, writeFile, copyFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import chalk from 'chalk'
import type { SetupCommand, EnvFileConfig } from './config.js'

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

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([^=]+)=(.*)$/)
    if (match) {
      vars[match[1].trim()] = match[2].trim()
    }
  }
  return vars
}

async function verifyRequiredVars(
  destPath: string, 
  required: string[], 
  envFile: string
): Promise<void> {
  if (required.length === 0) return

  const { readFile } = await import('fs/promises')
  const content = await readFile(destPath, 'utf-8')
  const vars = parseEnvFile(content)
  
  const missing = required.filter(key => !(key in vars))
  
  if (missing.length > 0) {
    console.log(chalk.yellow(`  ⚠ ${envFile} missing required vars: ${missing.join(', ')}`))
  } else {
    console.log(chalk.gray(`    ✓ All required vars present (${required.length})`))
  }
}

export async function copyEnvFiles(
  envFiles: EnvFileConfig[],
  rootPath: string,
  worktreePath: string
): Promise<void> {
  if (envFiles.length === 0) return

  console.log(chalk.blue('\n🔐 Copying .env files...'))

  for (const envFileConfig of envFiles) {
    const relativePath = envFileConfig.path.replace(/^\.\//, '')
    const sourcePath = join(rootPath, relativePath)
    const destPath = join(worktreePath, relativePath)

    // Check if source exists
    try {
      await access(sourcePath)
    } catch {
      console.log(chalk.yellow(`  ⚠ Skipping ${envFileConfig.path} (not found in main repo)`))
      continue
    }

    // Don't overwrite existing .env in worktree
    let alreadyExists = false
    try {
      await access(destPath)
      console.log(chalk.gray(`  → ${envFileConfig.path} (already exists, skipping copy)`))
      alreadyExists = true
    } catch {
      // File doesn't exist, proceed with copy
    }

    if (!alreadyExists) {
      // Ensure target directory exists
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(sourcePath, destPath)
      console.log(chalk.green(`  ✓ ${envFileConfig.path}`))
    }

    // Verify required vars (even if file already existed)
    if (envFileConfig.required && envFileConfig.required.length > 0) {
      await verifyRequiredVars(destPath, envFileConfig.required, envFileConfig.path)
    }
  }

  console.log('')
}
