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

export interface SharedServiceState {
  name: string
  port: number
  pid: number
  status: 'running' | 'stopped'
}

interface StateFile {
  workspaces: WorkspaceState[]
  shared?: SharedServiceState[]
}

export class StateManager {
  private statePath: string
  private dirReady = false

  constructor(private root: string) {
    this.statePath = join(root, '.wtree', 'state.json')
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return
    await mkdir(join(this.root, '.wtree'), { recursive: true })
    this.dirReady = true
  }

  private async readFile(): Promise<StateFile> {
    try {
      return JSON.parse(await readFile(this.statePath, 'utf-8')) as StateFile
    } catch { return { workspaces: [], shared: [] } }
  }

  private async writeFile(state: StateFile): Promise<void> {
    await this.ensureDir()
    const tmp = this.statePath + '.tmp'
    await writeFile(tmp, JSON.stringify(state, null, 2))
    await rename(tmp, this.statePath)
  }

  // Workspace methods
  async getAll(): Promise<WorkspaceState[]> { return (await this.readFile()).workspaces }
  async get(name: string): Promise<WorkspaceState | undefined> { return (await this.readFile()).workspaces.find(w => w.name === name) }
  
  async add(workspace: WorkspaceState): Promise<void> { 
    const state = await this.readFile()
    state.workspaces.push(workspace)
    await this.writeFile(state)
  }
  
  async remove(name: string): Promise<void> { 
    const state = await this.readFile()
    state.workspaces = state.workspaces.filter(w => w.name !== name)
    await this.writeFile(state)
  }
  
  async update(name: string, patch: Partial<WorkspaceState>): Promise<void> {
    const state = await this.readFile()
    state.workspaces = state.workspaces.map(w => w.name === name ? { ...w, ...patch } : w)
    await this.writeFile(state)
  }

  async nextSlot(): Promise<number> {
    const slots = new Set((await this.readFile()).workspaces.map(w => w.slot))
    let slot = 1
    while (slots.has(slot)) slot++
    return slot
  }

  async usedPorts(): Promise<number[]> {
    const state = await this.readFile()
    const workspacePorts = state.workspaces.flatMap(w => Object.values(w.ports))
    const sharedPorts = (state.shared ?? []).map(s => s.port)
    return [...workspacePorts, ...sharedPorts]
  }

  // Shared service methods
  async getShared(name: string): Promise<SharedServiceState | undefined> {
    return (await this.readFile()).shared?.find(s => s.name === name)
  }

  async getAllShared(): Promise<SharedServiceState[]> {
    return (await this.readFile()).shared ?? []
  }

  async addShared(service: SharedServiceState): Promise<void> {
    const state = await this.readFile()
    state.shared = state.shared ?? []
    state.shared.push(service)
    await this.writeFile(state)
  }

  async updateShared(name: string, patch: Partial<SharedServiceState>): Promise<void> {
    const state = await this.readFile()
    state.shared = (state.shared ?? []).map(s => s.name === name ? { ...s, ...patch } : s)
    await this.writeFile(state)
  }

  async removeShared(name: string): Promise<void> {
    const state = await this.readFile()
    state.shared = (state.shared ?? []).filter(s => s.name !== name)
    await this.writeFile(state)
  }
}
