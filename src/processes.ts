import { spawn } from 'child_process'

export class ProcessManager {
  private procs = new Map<string, { pid: number; kill: () => void }>()

  constructor() {
    process.once('SIGINT', async () => { await this.stopAll(); process.exit(0) })
  }

  async start(id: string, command: string, cwd: string, env: Record<string, string>): Promise<number> {
    const child = spawn(command, [], { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: true })
    if (!child.pid) throw new Error(`Failed to spawn process for "${id}"`)
    const pid = child.pid
    this.procs.set(id, { pid, kill: () => child.kill('SIGTERM') })
    child.on('exit', () => this.procs.delete(id))
    return pid
  }

  isRunning(id: string): boolean { return this.procs.has(id) }

  async stop(id: string): Promise<void> {
    const p = this.procs.get(id)
    if (p) { p.kill(); this.procs.delete(id); await new Promise(r => setTimeout(r, 200)) }
  }

  async stopAll(): Promise<void> { await Promise.all([...this.procs.keys()].map(id => this.stop(id))) }
}
