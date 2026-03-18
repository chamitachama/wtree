import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'

export interface StartResult {
  pid: number
  exited: boolean
  exitCode: number | null
  error?: string
}

export class ProcessManager {
  private procs = new Map<string, { pid: number; kill: () => void }>()

  constructor() {
    process.once('SIGINT', async () => { await this.stopAll(); process.exit(0) })
  }

  async start(
    id: string,
    command: string,
    cwd: string,
    env: Record<string, string>,
    logFile?: string
  ): Promise<number> {
    const result = await this.startWithVerify(id, command, cwd, env, logFile)
    return result.pid
  }

  async startWithVerify(
    id: string,
    command: string,
    cwd: string,
    env: Record<string, string>,
    logFile?: string,
    verifyDelayMs: number = 500
  ): Promise<StartResult> {
    const useLog = !!logFile
    let stderrBuffer = ''
    
    const child = spawn(command, [], {
      cwd,
      env: { ...process.env, ...env },
      stdio: useLog ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      shell: true,
    })
    if (!child.pid) throw new Error(`Failed to spawn process for "${id}"`)
    const pid = child.pid

    let exited = false
    let exitCode: number | null = null

    if (useLog && child.stdout && child.stderr) {
      await mkdir(dirname(logFile!), { recursive: true })
      const fileStream = createWriteStream(logFile!, { flags: 'a' })
      child.stdout.pipe(process.stdout)
      child.stdout.pipe(fileStream)
      child.stderr.pipe(process.stderr)
      child.stderr.pipe(fileStream)
      
      // Capture stderr for error reporting
      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString()
        if (stderrBuffer.length > 2000) {
          stderrBuffer = stderrBuffer.slice(-2000)
        }
      })
    }

    this.procs.set(id, { pid, kill: () => child.kill('SIGTERM') })
    
    child.on('exit', (code) => {
      exited = true
      exitCode = code
      this.procs.delete(id)
    })

    // Wait a bit to see if process stays alive
    await new Promise(r => setTimeout(r, verifyDelayMs))

    return {
      pid,
      exited,
      exitCode,
      error: exited ? stderrBuffer.trim() || undefined : undefined
    }
  }

  isRunning(id: string): boolean { return this.procs.has(id) }

  async stop(id: string): Promise<void> {
    const p = this.procs.get(id)
    if (p) { p.kill(); this.procs.delete(id); await new Promise(r => setTimeout(r, 200)) }
  }

  async stopAll(): Promise<void> { await Promise.all([...this.procs.keys()].map(id => this.stop(id))) }
}
