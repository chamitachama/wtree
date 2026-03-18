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

interface ProcessEntry {
  pid: number
  kill: () => void
  shared: boolean
}

export class ProcessManager {
  private procs = new Map<string, ProcessEntry>()

  constructor() {
    process.once('SIGINT', async () => { await this.stopNonShared(); process.exit(0) })
  }

  async start(
    id: string,
    command: string,
    cwd: string,
    env: Record<string, string>,
    logFile?: string,
    shared: boolean = false
  ): Promise<number> {
    const result = await this.startWithVerify(id, command, cwd, env, logFile, 500, shared)
    return result.pid
  }

  async startWithVerify(
    id: string,
    command: string,
    cwd: string,
    env: Record<string, string>,
    logFile?: string,
    verifyDelayMs: number = 500,
    shared: boolean = false
  ): Promise<StartResult> {
    const useLog = !!logFile
    let stderrBuffer = ''
    
    const child = spawn(command, [], {
      cwd,
      env: { ...process.env, ...env },
      stdio: useLog ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      shell: true,
      detached: shared,  // Detach shared services so they survive parent exit
    })
    if (!child.pid) throw new Error(`Failed to spawn process for "${id}"`)
    const pid = child.pid

    // Unref shared processes so they don't keep the parent alive
    if (shared) {
      child.unref()
    }

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

    this.procs.set(id, { pid, kill: () => child.kill('SIGTERM'), shared })
    
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

  async stopNonShared(): Promise<void> {
    const nonShared = [...this.procs.entries()]
      .filter(([, p]) => !p.shared)
      .map(([id]) => id)
    await Promise.all(nonShared.map(id => this.stop(id)))
  }

  async stopAll(): Promise<void> { 
    await Promise.all([...this.procs.keys()].map(id => this.stop(id))) 
  }
}
