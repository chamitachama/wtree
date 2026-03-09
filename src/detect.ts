import { readFile } from 'fs/promises'
import { join } from 'path'
import yaml from 'js-yaml'

export interface DetectedService {
  name: string
  command: string
  basePort: number
}

async function tryRead(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8') } catch { return null }
}

async function detectFromProcfile(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'Procfile'))
  if (!raw) return null
  let nonWebIdx = 0
  const services = raw.trim().split('\n')
    .map(line => line.match(/^([\w-]+):\s*(.+)$/))
    .filter(Boolean)
    .map((m) => {
      const isWeb = m![1] === 'web'
      const basePort = isWeb ? 3000 : 8000 + nonWebIdx++ * 100
      return { name: m![1], command: m![2].trim(), basePort }
    })
  return services.length > 0 ? services : null
}

async function detectFromDockerCompose(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'docker-compose.yml'))
  if (!raw) return null
  try {
    const doc = yaml.load(raw) as Record<string, unknown>
    const services = doc?.services as Record<string, { ports?: string[] }> | undefined
    if (!services) return null
    const result = Object.entries(services).map(([name, svc]) => {
      const portStr = String(svc.ports?.[0] ?? '3000:3000')
      const parts = portStr.split(':')
      const hostPort = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
      const basePort = parseInt(hostPort, 10) || 3000
      return { name, command: `# fill in start command for ${name}`, basePort }
    })
    return result.length > 0 ? result : null
  } catch { return null }
}

async function detectFromPackageJson(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'package.json'))
  if (!raw) return null
  try {
    const pkg = JSON.parse(raw)
    const scripts = pkg.scripts ?? {}
    if (scripts.dev) return [{ name: 'app', command: 'npm run dev', basePort: 3000 }]
    if (scripts.start) return [{ name: 'app', command: 'npm start', basePort: 3000 }]
  } catch { /* ignore */ }
  return null
}

async function detectFromPython(cwd: string): Promise<DetectedService[] | null> {
  const hasPyproject = await tryRead(join(cwd, 'pyproject.toml'))
  const hasRequirements = await tryRead(join(cwd, 'requirements.txt'))
  if (hasPyproject || hasRequirements) {
    return [{ name: 'app', command: 'uvicorn main:app --reload', basePort: 8000 }]
  }
  return null
}

export async function detectServices(cwd: string): Promise<DetectedService[] | null> {
  return (
    await detectFromProcfile(cwd) ??
    await detectFromDockerCompose(cwd) ??
    await detectFromPackageJson(cwd) ??
    await detectFromPython(cwd)
  )
}
