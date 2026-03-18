import chalk from 'chalk'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'
import { isSetupDone, runSetup } from '../setup.js'

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

  // Reuse slot/ports from stopped workspace, or assign new ones
  const slot = existing?.status === 'stopped' ? existing.slot : await state.nextSlot()
  const ports = existing?.status === 'stopped' 
    ? existing.ports 
    : await assignPorts(config.services, await state.usedPorts(), slot, config.portStep)

  console.log(chalk.blue(`${existing?.status === 'stopped' ? 'Restarting' : 'Opening'} workspace: ${branch}`))
  const worktreePath = await wm.open(branch)

  // Run setup if not done yet (and not skipped)
  if (!options.skipSetup && config.setup.length > 0) {
    const setupDone = await isSetupDone(worktreePath)
    if (!setupDone) {
      await runSetup(config.setup, worktreePath)
    }
  }

  const pids: Record<string, number> = {}
  for (const service of config.services) {
    const port = ports[service.name]
    const cwd = `${worktreePath}/${service.cwd.replace('./', '')}`
    const serviceId = `${branch}:${service.name}`
    const logFile = `${root}/.wtree/logs/${serviceId.replace(':', '-')}.log`
    pids[service.name] = await pm.start(
      serviceId,
      service.command,
      cwd,
      { [service.portEnvVar]: String(port), ...resolveEnv(service.env, ports) },
      logFile
    )
    console.log(chalk.green(`✓ ${service.name} → http://localhost:${port}`))
  }

  if (existing?.status === 'stopped') {
    await state.update(name, { pids, status: 'running' })
  } else {
    await state.add({ name, branch, path: worktreePath, baseBranch: config.defaultBranch, ports, pids, status: 'running', slot })
  }
  await writeStatusDoc(root, state, wm)
}
