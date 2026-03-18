import chalk from 'chalk'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'
import { runSetup, copyEnvFiles } from '../setup.js'

const pm = new ProcessManager()

export async function createCommand(name: string, options: { from?: string; skipSetup?: boolean }): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const baseBranch = options.from ?? config.defaultBranch
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  // Separate shared vs regular services
  const sharedServices = config.services.filter(s => s.shared)
  const regularServices = config.services.filter(s => !s.shared)

  // Handle shared services first (start if not already running)
  const allPorts: Record<string, number> = {}
  
  for (const service of sharedServices) {
    const existingShared = await state.getShared(service.name)
    
    if (existingShared?.status === 'running') {
      allPorts[service.name] = existingShared.port
      console.log(chalk.gray(`↳ ${service.name} → http://localhost:${existingShared.port} (shared, already running)`))
    } else {
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
  const slot = await state.nextSlot()
  const regularPorts = await assignPorts(regularServices, await state.usedPorts(), slot, config.portStep)
  Object.assign(allPorts, regularPorts)

  console.log(chalk.blue(`Creating workspace: ${name} (from ${baseBranch})`))
  const worktreePath = await wm.create(name, baseBranch)

  // Copy .env files and run setup commands for new worktree (unless skipped)
  if (!options.skipSetup) {
    await copyEnvFiles(config.envFiles, root, worktreePath)
    if (config.setup.length > 0) {
      await runSetup(config.setup, worktreePath)
    }
  }

  // Start regular services in worktree
  const pids: Record<string, number> = {}
  for (const service of regularServices) {
    const port = allPorts[service.name]
    const cwd = `${worktreePath}/${service.cwd.replace('./', '')}`
    const serviceId = `${name}:${service.name}`
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

  await state.add({ name, branch: name, path: worktreePath, baseBranch, ports: regularPorts, pids, status: 'running', slot })
  await writeStatusDoc(root, state, wm)
}
