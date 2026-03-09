#!/usr/bin/env node
import { program } from 'commander'

program
  .name('wtree')
  .description('Run multiple git worktrees in parallel with isolated ports')
  .version('0.1.0')

program.parse()
