import chalk from 'chalk'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'
import { isSetupDone, runSetup, copyEnvFiles } from '../setup.js'

const pm = new ProcessManager()

export interface OpenOptions {
  skipSetup?: boolean
}

export async function openCommand(branch: string, options: OpenOptions = {}): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const name = branch.replace(/\//g, '-')
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

  console.log(chalk.blue(`${existing?.status === 'stopped' ? 'Restarting' : 'Opening'} workspace: ${branch}`))
  const worktreePath = await wm.open(branch)

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

  // Start regular services in worktree
  const pids: Record<string, number> = {}
  for (const service of regularServices) {
    const port = allPorts[service.name]
    const cwd = `${worktreePath}/${service.cwd.replace('./', '')}`
    const serviceId = `${branch}:${service.name}`
    const logFile = `${root}/.wtree/logs/${serviceId.replace(':', '-')}.log`
    pids[service.name] = await pm.start(
      serviceId,
      service.command,
      cwd,
      { [service.portEnvVar]: String(port), ...resolveEnv(service.env, allPorts, config.infrastructure) },
      logFile
    )
    console.log(chalk.green(`✓ ${service.name} → http://localhost:${port}`))
  }

  if (existing?.status === 'stopped') {
    await state.update(name, { pids, ports: regularPorts, status: 'running' })
  } else {
    await state.add({ name, branch, path: worktreePath, baseBranch: config.defaultBranch, ports: regularPorts, pids, status: 'running', slot })
  }
  await writeStatusDoc(root, state, wm)
}
