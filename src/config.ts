import { readFile } from 'fs/promises'
import { join } from 'path'

export interface ServiceConfig {
  name: string
  command: string
  cwd: string
  basePort: number
  portEnvVar: string
  env: Record<string, string>
}

export interface WtreeConfig {
  defaultBranch: string
  workspacesDir: string
  portStep: number
  services: ServiceConfig[]
}

export async function loadConfig(cwd: string = process.cwd()): Promise<WtreeConfig> {
  const configPath = join(cwd, '.wtree.json')
  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      defaultBranch: parsed.defaultBranch ?? 'main',
      workspacesDir: parsed.workspacesDir ?? '.worktrees',
      portStep: parsed.portStep ?? 100,
      services: parsed.services.map((s: Partial<ServiceConfig>) => ({
        name: s.name!,
        command: s.command!,
        cwd: s.cwd ?? '.',
        basePort: s.basePort!,
        portEnvVar: s.portEnvVar ?? 'PORT',
        env: s.env ?? {},
      })),
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No .wtree.json found in ${cwd}`)
    }
    throw e
  }
}
