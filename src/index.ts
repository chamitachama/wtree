#!/usr/bin/env node
import { program } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { openCommand } from './commands/open.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
import { createCommand } from './commands/create.js'
import { listCommand } from './commands/list.js'
import { stopCommand } from './commands/stop.js'
import { destroyCommand } from './commands/destroy.js'
import { initCommand } from './commands/init.js'
import { browserCommand } from './commands/browser.js'
import { logsCommand } from './commands/logs.js'
import { claudeCommand } from './commands/claude.js'
import { syncEnvCommand } from './commands/sync-env.js'

program
  .name('wtree')
  .description('Run multiple git worktrees in parallel with isolated ports')
  .version(pkg.version)

program.command('open <branch>')
  .description('Open an existing branch as a workspace')
  .option('--skip-setup', 'Skip running setup commands')
  .action((branch, opts) => openCommand(branch, { skipSetup: opts.skipSetup }))
program.command('create <name>')
  .description('Create a new branch and workspace')
  .option('--from <branch>', 'Base branch')
  .option('--skip-setup', 'Skip running setup commands')
  .action(createCommand)
program.command('list').description('Show all workspaces').action(() => listCommand())
program.command('stop <name>').description('Stop a workspace (keeps worktree)').action(stopCommand)
program.command('destroy <name>').description('Stop and delete a workspace (requires typing DELETE)').action(destroyCommand)
program.command('init').description('Set up wtree in the current project').action(() => initCommand())

program.command('browser <name>').description('Open workspace frontend in browser').action((name) => browserCommand(name))
program.command('logs <name>').description('Tail logs for a workspace service').action((name) => logsCommand(name))
program.command('claude <name>').description('Launch Claude Code in workspace with context').action((name) => claudeCommand(name))
program.command('sync-env <name>')
  .description('Sync env vars from base to worktree')
  .option('--force', 'Overwrite differing values with base values')
  .action((name, opts) => syncEnvCommand(name, { force: opts.force }))

program.parse()
