import { readFile, writeFile, appendFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import * as readline from 'readline'
import chalk from 'chalk'
import { detectServices, detectInfrastructure } from '../detect.js'

const TEMPLATE = `{
  // Default branch for new workspaces
  "defaultBranch": "main",

  // Directory where worktrees are created
  "workspacesDir": ".worktrees",

  // Port offset between workspaces: slot 1 = basePort+100, slot 2 = basePort+200
  "portStep": 100,

  // Services to start in every workspace
  "services": [
    {
      // Unique name shown in wtree list
      "name": "frontend",

      // Command to start this service
      "command": "npm run dev",

      // Directory to run the command from (relative to worktree root)
      "cwd": ".",

      // Base port — actual port = basePort + (slot * portStep)
      "basePort": 3000,

      // Env var the service reads for its port
      "portEnvVar": "PORT",

      // Optional extra env vars. Use {service.port} to reference another service's assigned port.
      // "env": { "NEXT_PUBLIC_API_URL": "http://localhost:{backend.port}" }
      "env": {}
    }
  ]
}
`

function ask(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
  })
}

async function updateGitignore(cwd: string): Promise<void> {
  const path = join(cwd, '.gitignore')
  const existing = existsSync(path) ? await readFile(path, 'utf-8') : ''
  const lines = existing.split('\n').map(l => l.trim())
  const toAdd = ['.worktrees/', '.wtree/state.json'].filter(e => !lines.includes(e))
  if (toAdd.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    await appendFile(path, prefix + toAdd.join('\n') + '\n')
  }
}

export async function initCommand(cwd: string = process.cwd()): Promise<void> {
  const configPath = join(cwd, '.wtree.json')

  if (existsSync(configPath)) {
    const answer = await ask(chalk.yellow('Worktree config already exists. Override? (y/N) '))
    if (answer.toLowerCase() !== 'y') { console.log(chalk.gray('Aborted.')); return }
  }

  const services = await detectServices(cwd)
  const infrastructure = await detectInfrastructure(cwd)

  if (services) {
    // Build infrastructure connection strings map
    const infraMap: Record<string, string> = {}
    for (const infra of infrastructure) {
      infraMap[infra.type] = infra.connectionString
    }

    const config = {
      defaultBranch: 'main',
      workspacesDir: '.worktrees',
      portStep: 100,
      envFiles: [],
      infrastructure: infraMap,
      setup: [],
      services: services.map(s => ({
        name: s.name,
        command: s.command,
        cwd: '.',
        basePort: s.basePort,
        portEnvVar: 'PORT',
        env: {},
      })),
    }
    await writeFile(configPath, JSON.stringify(config, null, 2))

    // Print detected services
    for (const s of services) {
      console.log(chalk.green(`✓ Detected service: ${s.name} (${s.command} → port ${s.basePort})`))
    }

    // Print detected infrastructure with hints
    if (infrastructure.length > 0) {
      console.log(chalk.blue('\n📦 Detected infrastructure services:'))
      for (const infra of infrastructure) {
        console.log(chalk.cyan(`  • ${infra.name} (${infra.type}) → localhost:${infra.hostPort}`))
      }
      console.log(chalk.yellow('\n💡 Tip: Use {infrastructure.<type>} in service env vars:'))
      console.log(chalk.gray('   "env": { "DATABASE_URL": "{infrastructure.mongodb}" }'))
    }
  } else {
    await writeFile(configPath, TEMPLATE)
    console.log(chalk.yellow('✓ No services detected — wrote template .wtree.json'))
    console.log(chalk.gray('  Edit it to add your services, then run: wtree open <branch>'))
  }

  await updateGitignore(cwd)
  console.log(chalk.green('✓ Wrote .wtree.json'))
  console.log(chalk.green('✓ Updated .gitignore'))
  console.log(chalk.blue('→ Run: wtree open <branch>'))
}
