import { readFile } from 'fs/promises'
import { join } from 'path'
import yaml from 'js-yaml'

export interface DetectedService {
  name: string
  command: string
  basePort: number
}

export interface DetectedInfrastructure {
  name: string
  type: 'mongodb' | 'redis' | 'postgres' | 'mysql' | 'rabbitmq' | 'unknown'
  hostPort: number
  connectionString: string
}

// Common infrastructure service name/image patterns
const INFRA_PATTERNS: Record<string, { type: DetectedInfrastructure['type']; connectionTemplate: (port: number) => string }> = {
  mongo: { type: 'mongodb', connectionTemplate: (p) => `mongodb://localhost:${p}` },
  mongodb: { type: 'mongodb', connectionTemplate: (p) => `mongodb://localhost:${p}` },
  redis: { type: 'redis', connectionTemplate: (p) => `redis://localhost:${p}` },
  postgres: { type: 'postgres', connectionTemplate: (p) => `postgresql://localhost:${p}` },
  postgresql: { type: 'postgres', connectionTemplate: (p) => `postgresql://localhost:${p}` },
  mysql: { type: 'mysql', connectionTemplate: (p) => `mysql://localhost:${p}` },
  mariadb: { type: 'mysql', connectionTemplate: (p) => `mysql://localhost:${p}` },
  rabbitmq: { type: 'rabbitmq', connectionTemplate: (p) => `amqp://localhost:${p}` },
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

function isInfraService(name: string, image?: string): { match: boolean; pattern?: string } {
  const nameL = name.toLowerCase()
  const imageL = (image ?? '').toLowerCase()
  
  for (const pattern of Object.keys(INFRA_PATTERNS)) {
    if (nameL.includes(pattern) || imageL.includes(pattern)) {
      return { match: true, pattern }
    }
  }
  return { match: false }
}

function parseHostPort(portStr: string): number {
  // Handle formats: "27018:27017", "27018:27017/tcp", "27017"
  const parts = portStr.replace(/\/\w+$/, '').split(':')
  const hostPort = parts.length >= 2 ? parts[0] : parts[0]
  return parseInt(hostPort, 10) || 0
}

async function detectFromDockerCompose(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'docker-compose.yml')) ?? await tryRead(join(cwd, 'docker-compose.yaml'))
  if (!raw) return null
  try {
    const doc = yaml.load(raw) as Record<string, unknown>
    const services = doc?.services as Record<string, { ports?: string[]; image?: string }> | undefined
    if (!services) return null
    
    // Filter out infrastructure services
    const result = Object.entries(services)
      .filter(([name, svc]) => !isInfraService(name, svc.image).match)
      .map(([name, svc]) => {
        const portStr = String(svc.ports?.[0] ?? '3000:3000')
        const basePort = parseHostPort(portStr) || 3000
        return { name, command: `# fill in start command for ${name}`, basePort }
      })
    return result.length > 0 ? result : null
  } catch { return null }
}

export async function detectInfrastructure(cwd: string): Promise<DetectedInfrastructure[]> {
  const raw = await tryRead(join(cwd, 'docker-compose.yml')) ?? await tryRead(join(cwd, 'docker-compose.yaml'))
  if (!raw) return []
  
  try {
    const doc = yaml.load(raw) as Record<string, unknown>
    const services = doc?.services as Record<string, { ports?: string[]; image?: string }> | undefined
    if (!services) return []
    
    const infra: DetectedInfrastructure[] = []
    
    for (const [name, svc] of Object.entries(services)) {
      const { match, pattern } = isInfraService(name, svc.image)
      if (!match || !pattern) continue
      
      const portStr = svc.ports?.[0]
      if (!portStr) continue
      
      const hostPort = parseHostPort(String(portStr))
      if (!hostPort) continue
      
      const config = INFRA_PATTERNS[pattern]
      infra.push({
        name,
        type: config.type,
        hostPort,
        connectionString: config.connectionTemplate(hostPort),
      })
    }
    
    return infra
  } catch { return [] }
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
