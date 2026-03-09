import chalk from 'chalk'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'

const pm = new ProcessManager()

export async function openCommand(branch: string): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const slot = await state.nextSlot()
  const ports = await assignPorts(config.services, await state.usedPorts(), slot, config.portStep)

  console.log(chalk.blue(`Opening workspace: ${branch}`))
  const worktreePath = await wm.open(branch)

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

  const name = branch.replace(/\//g, '-')
  await state.add({ name, branch, path: worktreePath, baseBranch: config.defaultBranch, ports, pids, status: 'running', slot })
  await writeStatusDoc(root, state, wm)
}
