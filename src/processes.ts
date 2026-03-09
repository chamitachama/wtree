import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'

export class ProcessManager {
  private procs = new Map<string, { pid: number; kill: () => void }>()

  constructor() {
    process.on('SIGINT', () => { this.stopAll(); process.exit(0) })
  }

  async start(
    id: string,
    command: string,
    cwd: string,
    env: Record<string, string>,
    logFile?: string
  ): Promise<number> {
    const useLog = !!logFile
    const child = spawn(command, [], {
      cwd,
      env: { ...process.env, ...env },
      stdio: useLog ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      shell: true,
    })
    if (!child.pid) throw new Error(`Failed to spawn process for "${id}"`)
    const pid = child.pid

    if (useLog && child.stdout && child.stderr) {
      await mkdir(dirname(logFile!), { recursive: true })
      const fileStream = createWriteStream(logFile!, { flags: 'a' })
      child.stdout.pipe(process.stdout)
      child.stdout.pipe(fileStream)
      child.stderr.pipe(process.stderr)
      child.stderr.pipe(fileStream)
    }

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
