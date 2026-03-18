import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import yaml from 'js-yaml'

export interface DetectedService {
  name: string
  command: string
  basePort: number
  cwd?: string  // optional, defaults to '.'
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

interface DockerComposeService {
  ports?: string[]
  image?: string
  build?: { context?: string }
}

async function detectFromDockerCompose(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'docker-compose.yml')) ?? await tryRead(join(cwd, 'docker-compose.yaml'))
  if (!raw) return null
  
  const pm = await detectPackageManager(cwd)
  const runCmd = pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun run' : `${pm} run`
  
  try {
    const doc = yaml.load(raw) as Record<string, unknown>
    const services = doc?.services as Record<string, DockerComposeService> | undefined
    if (!services) return null
    
    const result: DetectedService[] = []
    
    for (const [name, svc] of Object.entries(services)) {
      // Skip infrastructure services
      if (isInfraService(name, svc.image).match) continue
      
      const portStr = String(svc.ports?.[0] ?? '3000:3000')
      const basePort = parseHostPort(portStr) || 3000
      
      // Try to find the actual directory and command
      let serviceCwd = '.'
      let command = `# fill in start command for ${name}`
      
      // Check build context for directory hint
      const buildContext = svc.build?.context
      if (buildContext) {
        serviceCwd = buildContext.startsWith('./') ? buildContext : `./${buildContext}`
        
        // Try to read package.json from that directory
        const pkgPath = join(cwd, buildContext, 'package.json')
        const pkgRaw = await tryRead(pkgPath)
        if (pkgRaw) {
          try {
            const pkg = JSON.parse(pkgRaw)
            const scripts = pkg.scripts ?? {}
            if (scripts.dev) {
              command = `${runCmd} dev`
            } else if (scripts.start) {
              command = `${runCmd} start`
            }
          } catch { /* ignore */ }
        }
      }
      
      result.push({ name, command, basePort, cwd: serviceCwd })
    }
    
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
    await detectFromMonorepo(cwd) ??
    await detectFromPackageJson(cwd) ??
    await detectFromPython(cwd)
  )
}

// Detect package manager from lock files
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm'
  
  // Check subdirectories too
  try {
    const entries = await readdir(cwd, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const subdir = join(cwd, entry.name)
      if (existsSync(join(subdir, 'pnpm-lock.yaml'))) return 'pnpm'
      if (existsSync(join(subdir, 'bun.lockb'))) return 'bun'
      if (existsSync(join(subdir, 'yarn.lock'))) return 'yarn'
      if (existsSync(join(subdir, 'package-lock.json'))) return 'npm'
    }
  } catch { /* ignore */ }
  
  return 'npm' // default
}

export interface SetupCommand {
  command: string
  cwd: string
}

export async function detectSetupCommands(cwd: string): Promise<SetupCommand[]> {
  const pm = await detectPackageManager(cwd)
  const installCmd = pm === 'yarn' ? 'yarn install' : `${pm} install`
  const setup: SetupCommand[] = []
  
  // Check root package.json (workspace root typically handles all installs)
  if (existsSync(join(cwd, 'package.json'))) {
    setup.push({ command: installCmd, cwd: '.' })
  }
  
  // Common monorepo package directories
  const packageDirs = ['packages', 'apps', 'services', '.']
  
  for (const packageDir of packageDirs) {
    const scanDir = packageDir === '.' ? cwd : join(cwd, packageDir)
    const prefix = packageDir === '.' ? './' : `./${packageDir}/`
    
    try {
      const entries = await readdir(scanDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
        
        const subdir = join(scanDir, entry.name)
        const subPkgPath = join(subdir, 'package.json')
        if (!existsSync(subPkgPath)) continue
        
        // Check if this subdir has its own lock file (not using workspace)
        const hasOwnLock = existsSync(join(subdir, 'pnpm-lock.yaml')) ||
                          existsSync(join(subdir, 'package-lock.json')) ||
                          existsSync(join(subdir, 'yarn.lock')) ||
                          existsSync(join(subdir, 'bun.lockb'))
        
        if (hasOwnLock) {
          const subPm = await detectPackageManager(subdir)
          const subInstall = subPm === 'yarn' ? 'yarn install' : `${subPm} install`
          setup.push({ command: subInstall, cwd: `${prefix}${entry.name}` })
        }
      }
    } catch { /* directory doesn't exist, skip */ }
  }
  
  return setup
}

// Scan subdirectories for services (monorepo detection)
async function detectFromMonorepo(cwd: string): Promise<DetectedService[] | null> {
  const pm = await detectPackageManager(cwd)
  const runCmd = pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun run' : `${pm} run`
  const services: DetectedService[] = []
  let portCounter = 0
  
  // Common monorepo package directories
  const packageDirs = ['packages', 'apps', 'services', '.']
  
  for (const packageDir of packageDirs) {
    const scanDir = packageDir === '.' ? cwd : join(cwd, packageDir)
    const prefix = packageDir === '.' ? './' : `./${packageDir}/`
    
    try {
      const entries = await readdir(scanDir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
        
        const pkgPath = join(scanDir, entry.name, 'package.json')
        const raw = await tryRead(pkgPath)
        if (!raw) continue
        
        try {
          const pkg = JSON.parse(raw)
          const scripts = pkg.scripts ?? {}
          
          // Look for dev/start scripts
          let command: string | null = null
          if (scripts.dev) {
            command = `${runCmd} dev`
          } else if (scripts.start) {
            command = `${runCmd} start`
          }
          
          if (command) {
            // Guess port from scripts or use incrementing ports
            let basePort = 3000 + (portCounter * 100)
            
            // Try to detect port from dev script
            const devScript = scripts.dev ?? scripts.start ?? ''
            const portMatch = devScript.match(/(?:--port|PORT=?|:)\s*(\d{4,5})/)
            if (portMatch) {
              basePort = parseInt(portMatch[1], 10)
            } else if (entry.name.includes('front') || entry.name === 'web' || entry.name === 'app') {
              basePort = 3000 + (portCounter * 100)
            } else if (entry.name.includes('back') || entry.name === 'api' || entry.name === 'server') {
              basePort = 8000 + (portCounter * 100)
            }
            
            services.push({
              name: entry.name,
              command,
              basePort,
              cwd: `${prefix}${entry.name}`,
            })
            portCounter++
          }
        } catch { /* ignore parse errors */ }
      }
    } catch { /* directory doesn't exist, skip */ }
  }
  
  return services.length > 0 ? services : null
}

// Detect .env files in the project
export interface EnvFileConfig {
  path: string
  required?: string[]
}

export async function detectEnvFiles(cwd: string): Promise<EnvFileConfig[]> {
  const envFiles: EnvFileConfig[] = []
  
  // Common env file locations
  const locations = [
    '.env',
    '.env.local',
    'frontend/.env',
    'frontend/.env.local',
    'backend/.env',
    'web/.env',
    'app/.env',
    'packages/frontend/.env',
    'packages/backend/.env',
  ]
  
  for (const loc of locations) {
    const fullPath = join(cwd, loc)
    if (existsSync(fullPath)) {
      // Try to detect important vars
      const content = await tryRead(fullPath)
      const required: string[] = []
      
      if (content) {
        // Look for common important env vars
        const importantPatterns = [
          /^(NEXT_PUBLIC_CLERK|CLERK_)/m,
          /^(DATABASE_URL|MONGODB|REDIS)/m,
          /^(NEXTAUTH_|AUTH_)/m,
          /^(STRIPE_|OPENAI_|ANTHROPIC_)/m,
        ]
        
        for (const line of content.split('\n')) {
          const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
          if (match) {
            const varName = match[1]
            for (const pattern of importantPatterns) {
              if (pattern.test(varName)) {
                required.push(varName)
                break
              }
            }
          }
        }
      }
      
      envFiles.push({
        path: `./${loc}`,
        ...(required.length > 0 ? { required: required.slice(0, 5) } : {})
      })
    }
  }
  
  // Also scan service directories from docker-compose
  const raw = await tryRead(join(cwd, 'docker-compose.yml')) ?? await tryRead(join(cwd, 'docker-compose.yaml'))
  if (raw) {
    try {
      const doc = yaml.load(raw) as Record<string, unknown>
      const services = doc?.services as Record<string, { build?: { context?: string }; env_file?: string | string[] }> | undefined
      
      if (services) {
        for (const [, svc] of Object.entries(services)) {
          // Check env_file from docker-compose
          const envFileRefs = Array.isArray(svc.env_file) ? svc.env_file : svc.env_file ? [svc.env_file] : []
          for (const ef of envFileRefs) {
            const normalizedPath = ef.startsWith('./') ? ef : `./${ef}`
            if (!envFiles.some(e => e.path === normalizedPath) && existsSync(join(cwd, ef))) {
              envFiles.push({ path: normalizedPath })
            }
          }
        }
      }
    } catch { /* ignore */ }
  }
  
  return envFiles
}

// Detect env vars that contain localhost URLs and should have dynamic ports
export interface PortEnvVar {
  varName: string
  port: number
  serviceName?: string  // guessed service this belongs to
}

export async function detectPortEnvVars(cwd: string, services: DetectedService[]): Promise<Record<string, PortEnvVar[]>> {
  const result: Record<string, PortEnvVar[]> = {}
  
  // Map ports to service names
  const portToService = new Map<number, string>()
  for (const svc of services) {
    portToService.set(svc.basePort, svc.name)
  }
  
  // Common env file locations to scan
  const locations = [
    { path: '.env', service: null },
    { path: '.env.local', service: null },
    { path: 'frontend/.env', service: 'frontend' },
    { path: 'frontend/.env.local', service: 'frontend' },
    { path: 'web/.env', service: 'web' },
    { path: 'app/.env', service: 'app' },
  ]
  
  for (const loc of locations) {
    const fullPath = join(cwd, loc.path)
    const content = await tryRead(fullPath)
    if (!content) continue
    
    const portVars: PortEnvVar[] = []
    
    for (const line of content.split('\n')) {
      // Match env vars with localhost URLs containing ports
      const match = line.match(/^([A-Z][A-Z0-9_]*)=.*localhost:(\d{4,5})/)
      if (match) {
        const varName = match[1]
        const port = parseInt(match[2], 10)
        
        // Skip if this is a database/infra port
        if (port === 27017 || port === 27018 || port === 6379 || port === 6380 || port === 5432) {
          continue
        }
        
        portVars.push({
          varName,
          port,
          serviceName: portToService.get(port),
        })
      }
    }
    
    if (portVars.length > 0) {
      const serviceName = loc.service ?? 'root'
      result[serviceName] = [...(result[serviceName] ?? []), ...portVars]
    }
  }
  
  return result
}
