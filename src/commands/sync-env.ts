import chalk from 'chalk'
import { access } from 'fs/promises'
import { join } from 'path'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { syncEnvFile } from '../setup.js'

export async function syncEnvCommand(name: string): Promise<void> {
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

  console.log(chalk.blue(`\n🔄 Syncing env files for ${name}...`))

  let totalSynced = 0

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

    const synced = await syncEnvFile(sourcePath, destPath, envFileConfig.path)
    if (synced > 0) {
      console.log(chalk.cyan(`  ↻ ${envFileConfig.path} (+${synced} vars)`))
      totalSynced += synced
    } else {
      console.log(chalk.gray(`  ✓ ${envFileConfig.path} (up to date)`))
    }
  }

  if (totalSynced > 0) {
    console.log(chalk.green(`\n✓ Synced ${totalSynced} new env vars`))
  } else {
    console.log(chalk.gray('\n✓ All env files up to date'))
  }
}
