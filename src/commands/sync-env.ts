import chalk from 'chalk'
import { access } from 'fs/promises'
import { join } from 'path'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { syncEnvFile } from '../setup.js'

export interface SyncEnvOptions {
  force?: boolean
}

export async function syncEnvCommand(name: string, options: SyncEnvOptions = {}): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  
  const ws = await state.get(name)
  if (!ws) {
    console.error(chalk.red(`Workspace "${name}" not found`))
    process.exit(1)
  }

  if (config.envFiles.length === 0) {
    console.log(chalk.yellow('No envFiles configured in .wtree.json'))
    return
  }

  const forceLabel = options.force ? ' (force mode)' : ''
  console.log(chalk.blue(`\n🔄 Syncing env files for ${name}${forceLabel}...`))

  let totalAdded = 0
  let totalUpdated = 0

  for (const envFileConfig of config.envFiles) {
    const relativePath = envFileConfig.path.replace(/^\.\//, '')
    const sourcePath = join(root, relativePath)
    const destPath = join(ws.path, relativePath)

    // Check source exists
    try {
      await access(sourcePath)
    } catch {
      console.log(chalk.yellow(`  ⚠ ${envFileConfig.path} (not found in base)`))
      continue
    }

    // Check dest exists
    try {
      await access(destPath)
    } catch {
      console.log(chalk.yellow(`  ⚠ ${envFileConfig.path} (not found in worktree)`))
      continue
    }

    const result = await syncEnvFile(sourcePath, destPath, envFileConfig.path, options.force ?? false)
    
    const parts: string[] = []
    if (result.added > 0) parts.push(`+${result.added} new`)
    if (result.updated > 0) parts.push(`${result.updated} updated`)
    
    if (parts.length > 0) {
      console.log(chalk.cyan(`  ↻ ${envFileConfig.path} (${parts.join(', ')})`))
    } else {
      console.log(chalk.gray(`  ✓ ${envFileConfig.path} (up to date)`))
    }
    
    // Warn about differing values (only if not force)
    for (const key of result.differing) {
      console.log(chalk.yellow(`    ⚠ ${key} differs from base`))
    }
    
    totalAdded += result.added
    totalUpdated += result.updated
  }

  if (totalAdded > 0 || totalUpdated > 0) {
    const summary: string[] = []
    if (totalAdded > 0) summary.push(`${totalAdded} added`)
    if (totalUpdated > 0) summary.push(`${totalUpdated} updated`)
    console.log(chalk.green(`\n✓ ${summary.join(', ')}`))
  } else {
    console.log(chalk.gray('\n✓ All env files up to date'))
  }
}
