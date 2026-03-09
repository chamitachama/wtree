import { spawn } from 'child_process'

export class ProcessManager {
  private procs = new Map<string, { pid: number; kill: () => void }>()

  async start(id: string, command: string, cwd: string, env: Record<string, string>): Promise<number> {
    const child = spawn(command, [], { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: true })
    const pid = child.pid ?? 0
    this.procs.set(id, { pid, kill: () => child.kill('SIGTERM') })
    child.on('exit', () => this.procs.delete(id))
    return pid
  }

  isRunning(id: string): boolean { return this.procs.has(id) }

  async stop(id: string): Promise<void> {
    const p = this.procs.get(id)
    if (p) { p.kill(); this.procs.delete(id); await new Promise(r => setTimeout(r, 200)) }
  }

  stopAll(): void { for (const id of [...this.procs.keys()]) this.stop(id) }
}
