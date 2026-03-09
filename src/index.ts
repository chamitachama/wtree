#!/usr/bin/env node
import { program } from 'commander'
import { openCommand } from './commands/open.js'
import { createCommand } from './commands/create.js'
import { listCommand } from './commands/list.js'
import { stopCommand } from './commands/stop.js'
import { destroyCommand } from './commands/destroy.js'

program
  .name('wtree')
  .description('Run multiple git worktrees in parallel with isolated ports')
  .version('0.1.0')

program.command('open <branch>').description('Open an existing branch as a workspace').action(openCommand)
program.command('create <name>').description('Create a new branch and workspace').option('--from <branch>', 'Base branch').action(createCommand)
program.command('list').description('Show all workspaces').action(listCommand)
program.command('stop <name>').description('Stop a workspace (keeps worktree)').action(stopCommand)
program.command('destroy <name>').description('Stop and delete a workspace (requires typing DELETE)').action(destroyCommand)

program.parse()
