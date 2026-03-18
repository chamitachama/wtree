import { readFile, writeFile, appendFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import * as readline from 'readline'
import chalk from 'chalk'
import { detectServices, detectInfrastructure, detectSetupCommands, detectPackageManager, detectEnvFiles, detectPortEnvVars } from '../detect.js'

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

    // Print detected services
    console.log(chalk.blue('\n📋 Detected services:'))
    for (const s of services) {
      console.log(chalk.cyan(`  • ${s.name} (port ${s.basePort})`))
    }

    // Ask about shared services
    console.log(chalk.gray('\nShared services run once globally instead of per-worktree.'))
    const sharedServices: Set<string> = new Set()
    
    for (const s of services) {
      const answer = await ask(chalk.yellow(`Share ${s.name} across all worktrees? (y/N) `))
      if (answer.toLowerCase() === 'y') {
        sharedServices.add(s.name)
      }
    }

    // Auto-detect setup commands
    const setupCommands = await detectSetupCommands(cwd)
    const pm = await detectPackageManager(cwd)
    
    if (setupCommands.length > 0) {
      console.log(chalk.blue(`\n📦 Detected package manager: ${pm}`))
      console.log(chalk.cyan('  Setup commands:'))
      for (const cmd of setupCommands) {
        console.log(chalk.gray(`    • ${cmd.command} (in ${cmd.cwd})`))
      }
    }

    // Auto-detect env files
    const envFiles = await detectEnvFiles(cwd)
    
    if (envFiles.length > 0) {
      console.log(chalk.blue('\n🔐 Detected env files:'))
      for (const ef of envFiles) {
        const reqStr = ef.required?.length ? ` (${ef.required.length} important vars)` : ''
        console.log(chalk.cyan(`  • ${ef.path}${reqStr}`))
      }
    }

    // Detect env vars with localhost URLs that need dynamic ports
    const portEnvVars = await detectPortEnvVars(cwd, services)
    const serviceEnvOverrides: Record<string, Record<string, string>> = {}
    
    for (const [serviceLoc, vars] of Object.entries(portEnvVars)) {
      for (const v of vars) {
        if (v.serviceName) {
          // This env var references another service's port
          const targetService = services.find(s => s.name === v.serviceName)
          if (targetService) {
            // Find which service should have this env var
            const ownerService = serviceLoc === 'root' ? 'frontend' : serviceLoc
            if (!serviceEnvOverrides[ownerService]) {
              serviceEnvOverrides[ownerService] = {}
            }
            serviceEnvOverrides[ownerService][v.varName] = `http://localhost:{${v.serviceName}.port}`
          }
        }
      }
    }

    // Also check for APP_URL type vars that should use the service's own port
    for (const [serviceLoc, vars] of Object.entries(portEnvVars)) {
      for (const v of vars) {
        const ownerService = serviceLoc === 'root' ? 'frontend' : serviceLoc
        const service = services.find(s => s.name === ownerService)
        if (service && v.port === service.basePort && !v.serviceName) {
          // This var points to the service's own port
          if (!serviceEnvOverrides[ownerService]) {
            serviceEnvOverrides[ownerService] = {}
          }
          serviceEnvOverrides[ownerService][v.varName] = `http://localhost:{${ownerService}.port}`
        }
      }
    }

    if (Object.keys(serviceEnvOverrides).length > 0) {
      console.log(chalk.blue('\n🔗 Detected URL env vars (will use dynamic ports):'))
      for (const [svc, vars] of Object.entries(serviceEnvOverrides)) {
        for (const [varName, value] of Object.entries(vars)) {
          console.log(chalk.cyan(`  • ${svc}: ${varName} → ${value}`))
        }
      }
    }

    const config = {
      defaultBranch: 'main',
      workspacesDir: '.worktrees',
      portStep: 100,
      envFiles,
      infrastructure: infraMap,
      setup: setupCommands,
      services: services.map(s => ({
        name: s.name,
        command: s.command,
        cwd: s.cwd ?? '.',
        basePort: s.basePort,
        portEnvVar: 'PORT',
        env: serviceEnvOverrides[s.name] ?? {},
        shared: sharedServices.has(s.name),
      })),
    }
    await writeFile(configPath, JSON.stringify(config, null, 2))

    // Summary
    console.log('')
    for (const s of services) {
      const sharedLabel = sharedServices.has(s.name) ? chalk.magenta(' [shared]') : ''
      console.log(chalk.green(`✓ ${s.name} → port ${s.basePort}${sharedLabel}`))
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
