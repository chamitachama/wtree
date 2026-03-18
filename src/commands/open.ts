import chalk from 'chalk'
import { execSync } from 'child_process'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'
import { isSetupDone, runSetup, copyEnvFiles } from '../setup.js'
import { sortByDependencies, waitForHealthy } from '../health.js'

const pm = new ProcessManager()

export interface OpenOptions {
  skipSetup?: boolean
}

async function resolvePrBranch(input: string): Promise<string> {
  // Check if input is pr/123 or pr#123 format
  const prMatch = input.match(/^pr[/#](\d+)$/i)
  if (!prMatch) return input
  
  const prNumber = prMatch[1]
  console.log(chalk.blue(`🔍 Fetching PR #${prNumber} info...`))
  
  try {
    // Get PR branch name using gh CLI
    const branchName = execSync(`gh pr view ${prNumber} --json headRefName --jq '.headRefName'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
    
    // Fetch the branch
    execSync(`git fetch origin ${branchName}`, { stdio: 'inherit' })
    
    console.log(chalk.green(`✓ PR #${prNumber} → ${branchName}`))
    return branchName
  } catch (error) {
    console.error(chalk.red(`Failed to fetch PR #${prNumber}. Is 'gh' CLI installed and authenticated?`))
    process.exit(1)
  }
}

export async function openCommand(branch: string, options: OpenOptions = {}): Promise<void> {
  // Resolve PR number to branch name if needed
  const resolvedBranch = await resolvePrBranch(branch)
  
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const name = resolvedBranch.replace(/\//g, '-')
  const existing = await state.get(name)

  // Separate shared vs regular services
  const sharedServices = config.services.filter(s => s.shared)
  const regularServices = config.services.filter(s => !s.shared)

  // Handle shared services first (start if not already running)
  const allPorts: Record<string, number> = {}
  
  for (const service of sharedServices) {
    const existingShared = await state.getShared(service.name)
    
    if (existingShared?.status === 'running') {
      // Already running, reuse
      allPorts[service.name] = existingShared.port
      console.log(chalk.gray(`↳ ${service.name} → http://localhost:${existingShared.port} (shared, already running)`))
    } else {
      // Start shared service from main repo root
      const port = service.basePort
      const serviceId = `shared:${service.name}`
      const logFile = `${root}/.wtree/logs/${serviceId.replace(':', '-')}.log`
      const cwd = `${root}/${service.cwd.replace('./', '')}`
      
      const pid = await pm.start(
        serviceId,
        service.command,
        cwd,
        { [service.portEnvVar]: String(port), ...resolveEnv(service.env, allPorts, config.infrastructure) },
        logFile
      )
      
      allPorts[service.name] = port
      
      if (existingShared) {
        await state.updateShared(service.name, { pid, status: 'running' })
      } else {
        await state.addShared({ name: service.name, port, pid, status: 'running' })
      }
      
      console.log(chalk.magenta(`✓ ${service.name} → http://localhost:${port} (shared)`))
    }
  }

  // Assign ports for regular services
  const slot = existing?.status === 'stopped' ? existing.slot : await state.nextSlot()
  const regularPorts = existing?.status === 'stopped' 
    ? existing.ports 
    : await assignPorts(regularServices, await state.usedPorts(), slot, config.portStep)
  
  // Merge regular ports into allPorts
  Object.assign(allPorts, regularPorts)

  console.log(chalk.blue(`${existing?.status === 'stopped' ? 'Restarting' : 'Opening'} workspace: ${resolvedBranch}`))
  const worktreePath = await wm.open(resolvedBranch)

  // Copy .env files and run setup if not done yet (and not skipped)
  if (!options.skipSetup) {
    const setupDone = await isSetupDone(worktreePath)
    if (!setupDone) {
      await copyEnvFiles(config.envFiles, root, worktreePath)
      if (config.setup.length > 0) {
        await runSetup(config.setup, worktreePath)
      }
    }
  }

  // Start regular services in dependency order
  const pids: Record<string, number> = {}
  const sortedServices = sortByDependencies(regularServices)
  
  for (const service of sortedServices) {
    // Wait for dependencies to be healthy
    if (service.dependsOn && service.dependsOn.length > 0) {
      for (const depName of service.dependsOn) {
        const depService = config.services.find(s => s.name === depName)
        const depPort = allPorts[depName]
        if (depService?.healthCheck && depPort) {
          process.stdout.write(chalk.gray(`  ⏳ Waiting for ${depName}...`))
          const healthy = await waitForHealthy(depService, depPort, (attempt, max) => {
            process.stdout.write('.')
          })
          if (!healthy) {
            console.log(chalk.red(` timeout!`))
            console.error(chalk.red(`\n✗ ${depName} failed health check, cannot start ${service.name}`))
            process.exit(1)
          }
          console.log(chalk.green(' ready'))
        }
      }
    }
    
    const port = allPorts[service.name]
    const cwd = `${worktreePath}/${service.cwd.replace('./', '')}`
    const serviceId = `${resolvedBranch}:${service.name}`
    const logFile = `${root}/.wtree/logs/${serviceId.replace(':', '-')}.log`
    const result = await pm.startWithVerify(
      serviceId,
      service.command,
      cwd,
      { [service.portEnvVar]: String(port), ...resolveEnv(service.env, allPorts, config.infrastructure) },
      logFile,
      800 // verify process stays alive for 800ms
    )
    
    if (result.exited) {
      console.log(chalk.red(`✗ ${service.name} crashed immediately (exit code ${result.exitCode})`))
      if (result.error) {
        // Show relevant error (command not found, etc)
        const relevantError = result.error.split('\n').slice(-3).join('\n')
        console.log(chalk.red(`  ${relevantError}`))
      }
      console.log(chalk.yellow(`\nTip: Try running setup manually:`))
      console.log(chalk.gray(`  cd ${worktreePath}`))
      console.log(chalk.gray(`  pnpm install  # or npm install`))
      process.exit(1)
    }
    
    pids[service.name] = result.pid
    console.log(chalk.green(`✓ ${service.name} → http://localhost:${port}`))
  }

  if (existing?.status === 'stopped') {
    await state.update(name, { pids, ports: regularPorts, status: 'running' })
  } else {
    await state.add({ name, branch: resolvedBranch, path: worktreePath, baseBranch: config.defaultBranch, ports: regularPorts, pids, status: 'running', slot })
  }
  await writeStatusDoc(root, state, wm)

  // Handle Ctrl+C gracefully
  const cleanup = async () => {
    console.log(chalk.yellow('\n\nStopping workspace...'))
    
    // Kill regular service processes
    for (const pid of Object.values(pids)) {
      try { process.kill(pid) } catch { /* already gone */ }
    }
    
    // Update state to stopped (preserves slot/ports for reuse)
    await state.update(name, { status: 'stopped', pids: {} })
    await writeStatusDoc(root, state, wm)
    
    console.log(chalk.yellow(`Stopped: ${name} (slot ${slot} preserved)`))
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Keep process alive to handle signals
  console.log(chalk.gray('\nPress Ctrl+C to stop workspace\n'))
  await new Promise(() => {}) // Block forever until signal
}
