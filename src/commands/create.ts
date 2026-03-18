import chalk from 'chalk'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'
import { runSetup } from '../setup.js'

const pm = new ProcessManager()

export async function createCommand(name: string, options: { from?: string; skipSetup?: boolean }): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const baseBranch = options.from ?? config.defaultBranch
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const slot = await state.nextSlot()
  const ports = await assignPorts(config.services, await state.usedPorts(), slot, config.portStep)

  console.log(chalk.blue(`Creating workspace: ${name} (from ${baseBranch})`))
  const worktreePath = await wm.create(name, baseBranch)

  // Run setup commands for new worktree (unless skipped)
  if (!options.skipSetup && config.setup.length > 0) {
    await runSetup(config.setup, worktreePath)
  }

  const pids: Record<string, number> = {}
  for (const service of config.services) {
    const port = ports[service.name]
    const cwd = `${worktreePath}/${service.cwd.replace('./', '')}`
    const serviceId = `${name}:${service.name}`
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

  await state.add({ name, branch: name, path: worktreePath, baseBranch, ports, pids, status: 'running', slot })
  await writeStatusDoc(root, state, wm)
}
