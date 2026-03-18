import { readFile } from 'fs/promises'
import { join } from 'path'
import JSON5 from 'json5'

export interface HealthCheck {
  url?: string           // HTTP endpoint to check (e.g., "http://localhost:{port}/health")
  command?: string       // Command to run (exit 0 = healthy)
  interval?: number      // Check interval in ms (default: 1000)
  timeout?: number       // Total timeout in ms (default: 30000)
  retries?: number       // Number of retries (default: 30)
}

export interface ServiceConfig {
  name: string
  command: string
  cwd: string
  basePort: number
  portEnvVar: string
  env: Record<string, string>
  shared: boolean
  dependsOn?: string[]   // Services that must be healthy before this one starts
  healthCheck?: HealthCheck
}

export interface SetupCommand {
  command: string
  cwd: string
}

export interface EnvFileConfig {
  path: string
  required?: string[]
}

export interface WtreeConfig {
  defaultBranch: string
  workspacesDir: string
  portStep: number
  envFiles: EnvFileConfig[]
  setup: SetupCommand[]
  infrastructure: Record<string, string>
  services: ServiceConfig[]
}

export async function loadConfig(cwd: string = process.cwd()): Promise<WtreeConfig> {
  const configPath = join(cwd, '.wtree.json')
  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON5.parse(raw)
    return {
      defaultBranch: parsed.defaultBranch ?? 'main',
      workspacesDir: parsed.workspacesDir ?? '.worktrees',
      portStep: parsed.portStep ?? 100,
      envFiles: (parsed.envFiles ?? []).map((e: string | Partial<EnvFileConfig>) => 
        typeof e === 'string' ? { path: e, required: [] } : { path: e.path ?? '', required: e.required ?? [] }
      ).filter((e: EnvFileConfig) => e.path),
      infrastructure: parsed.infrastructure ?? {},
      setup: (parsed.setup ?? []).map((s: Partial<SetupCommand>, i: number) => ({
        command: s.command ?? '',
        cwd: s.cwd ?? '.',
      })).filter((s: SetupCommand) => s.command),
      services: parsed.services.map((s: Partial<ServiceConfig>, i: number) => {
        if (!s.name) throw new Error(`Service at index ${i} is missing required field "name"`)
        if (!s.command) throw new Error(`Service "${s.name}" is missing required field "command"`)
        if (!s.basePort) throw new Error(`Service "${s.name}" is missing required field "basePort"`)
        return {
          name: s.name,
          command: s.command,
          cwd: s.cwd ?? '.',
          basePort: s.basePort,
          portEnvVar: s.portEnvVar ?? 'PORT',
          env: s.env ?? {},
          shared: s.shared ?? false,
          dependsOn: s.dependsOn ?? [],
          healthCheck: s.healthCheck,
        }
      }),
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No .wtree.json found in ${cwd}`)
    }
    throw e
  }
}
