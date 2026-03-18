import { spawn } from 'child_process'
import { access, writeFile, copyFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import chalk from 'chalk'
import type { SetupCommand, EnvFileConfig } from './config.js'

const SETUP_MARKER = '.wtree-setup-done'

export async function isSetupDone(worktreePath: string): Promise<boolean> {
  // Check marker file
  const hasMarker = await pathExists(join(worktreePath, SETUP_MARKER))
  if (!hasMarker) return false
  
  // Also verify node_modules actually exists (marker could be stale)
  // Check common locations
  const possibleNodeModules = [
    join(worktreePath, 'node_modules'),
    join(worktreePath, 'frontend', 'node_modules'),
    join(worktreePath, 'backend', 'node_modules'),
  ]
  
  for (const nmPath of possibleNodeModules) {
    if (await pathExists(nmPath)) {
      return true
    }
  }
  
  // Marker exists but no node_modules found - setup is stale
  return false
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
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

function serializeEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n')
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

export interface SyncResult {
  added: number
  updated: number
  differing: string[]
}

export async function syncEnvFile(
  sourcePath: string,
  destPath: string,
  envFile: string,
  force: boolean = false
): Promise<SyncResult> {
  const { readFile, writeFile, appendFile } = await import('fs/promises')
  
  const sourceContent = await readFile(sourcePath, 'utf-8')
  const destContent = await readFile(destPath, 'utf-8')
  
  const sourceVars = parseEnvFile(sourceContent)
  const destVars = parseEnvFile(destContent)
  
  // Find vars in source that are missing in dest
  const missingVars: Record<string, string> = {}
  const differingVars: string[] = []
  const updatedVars: Record<string, string> = {}
  
  for (const [key, value] of Object.entries(sourceVars)) {
    if (!(key in destVars)) {
      missingVars[key] = value
    } else if (destVars[key] !== value) {
      differingVars.push(key)
      if (force) {
        updatedVars[key] = value
      }
    }
  }
  
  // Append missing vars
  if (Object.keys(missingVars).length > 0) {
    const toAppend = '\n# Synced from base\n' + serializeEnvVars(missingVars) + '\n'
    await appendFile(destPath, toAppend)
  }
  
  // Update differing vars if force
  if (force && Object.keys(updatedVars).length > 0) {
    let newContent = destContent
    for (const [key, value] of Object.entries(updatedVars)) {
      // Replace existing line
      const regex = new RegExp(`^${key}=.*$`, 'm')
      newContent = newContent.replace(regex, `${key}=${value}`)
    }
    await writeFile(destPath, newContent)
  }
  
  return {
    added: Object.keys(missingVars).length,
    updated: force ? Object.keys(updatedVars).length : 0,
    differing: force ? [] : differingVars
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

    // Check if file already exists in worktree
    let alreadyExists = false
    try {
      await access(destPath)
      alreadyExists = true
    } catch {
      // File doesn't exist
    }

    if (alreadyExists) {
      // Sync missing vars from base to worktree
      const result = await syncEnvFile(sourcePath, destPath, envFileConfig.path, false)
      if (result.added > 0) {
        console.log(chalk.cyan(`  ↻ ${envFileConfig.path} (synced ${result.added} new vars)`))
      } else {
        console.log(chalk.gray(`  → ${envFileConfig.path} (up to date)`))
      }
      // Warn about differing values
      for (const key of result.differing) {
        console.log(chalk.yellow(`    ⚠ ${key} differs from base (use sync-env --force to update)`))
      }
    } else {
      // Ensure target directory exists and copy
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(sourcePath, destPath)
      console.log(chalk.green(`  ✓ ${envFileConfig.path} (copied)`))
    }

    // Verify required vars (even if file already existed)
    if (envFileConfig.required && envFileConfig.required.length > 0) {
      await verifyRequiredVars(destPath, envFileConfig.required, envFileConfig.path)
    }
  }

  console.log('')
}
