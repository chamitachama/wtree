import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { join } from 'path'

export interface WorkspaceState {
  name: string
  branch: string
  path: string
  baseBranch: string
  ports: Record<string, number>
  pids: Record<string, number>
  status: 'running' | 'stopped'
  slot: number
}

export class StateManager {
  private statePath: string

  constructor(private root: string) {
    this.statePath = join(root, '.wtree', 'state.json')
  }

  private async read(): Promise<WorkspaceState[]> {
    try {
      return (JSON.parse(await readFile(this.statePath, 'utf-8')) as { workspaces: WorkspaceState[] }).workspaces
    } catch { return [] }
  }

  private async write(workspaces: WorkspaceState[]): Promise<void> {
    await mkdir(join(this.root, '.wtree'), { recursive: true })
    const tmp = this.statePath + '.tmp'
    await writeFile(tmp, JSON.stringify({ workspaces }, null, 2))
    await rename(tmp, this.statePath)
  }

  async getAll(): Promise<WorkspaceState[]> { return this.read() }
  async get(name: string): Promise<WorkspaceState | undefined> { return (await this.read()).find(w => w.name === name) }
  async add(workspace: WorkspaceState): Promise<void> { await this.write([...await this.read(), workspace]) }
  async remove(name: string): Promise<void> { await this.write((await this.read()).filter(w => w.name !== name)) }
  async update(name: string, patch: Partial<WorkspaceState>): Promise<void> {
    await this.write((await this.read()).map(w => w.name === name ? { ...w, ...patch } : w))
  }

  async nextSlot(): Promise<number> {
    const slots = new Set((await this.read()).map(w => w.slot))
    let slot = 1
    while (slots.has(slot)) slot++
    return slot
  }

  async usedPorts(): Promise<number[]> {
    return (await this.read()).flatMap(w => Object.values(w.ports))
  }
}
