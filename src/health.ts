import { execSync } from 'child_process'
import chalk from 'chalk'
import type { HealthCheck, ServiceConfig } from './config.js'

const DEFAULT_INTERVAL = 1000
const DEFAULT_TIMEOUT = 30000
const DEFAULT_RETRIES = 30

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function checkHttp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

function checkCommand(command: string): boolean {
  try {
    execSync(command, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export async function waitForHealthy(
  service: ServiceConfig,
  port: number,
  onRetry?: (attempt: number, maxAttempts: number) => void
): Promise<boolean> {
  const hc = service.healthCheck
  if (!hc) return true // No health check = assume healthy
  
  const interval = hc.interval ?? DEFAULT_INTERVAL
  const timeout = hc.timeout ?? DEFAULT_TIMEOUT
  const maxRetries = hc.retries ?? Math.ceil(timeout / interval)
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let healthy = false
    
    if (hc.url) {
      // Replace {port} placeholder
      const url = hc.url.replace('{port}', String(port))
      healthy = await checkHttp(url)
    } else if (hc.command) {
      healthy = checkCommand(hc.command)
    }
    
    if (healthy) return true
    
    if (onRetry) onRetry(attempt, maxRetries)
    await sleep(interval)
  }
  
  return false
}

// Topological sort for dependency order
export function sortByDependencies(services: ServiceConfig[]): ServiceConfig[] {
  const sorted: ServiceConfig[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  
  const serviceMap = new Map(services.map(s => [s.name, s]))
  
  function visit(name: string): void {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected involving: ${name}`)
    }
    
    visiting.add(name)
    const service = serviceMap.get(name)
    if (service) {
      for (const dep of service.dependsOn ?? []) {
        if (serviceMap.has(dep)) {
          visit(dep)
        }
      }
      sorted.push(service)
    }
    visiting.delete(name)
    visited.add(name)
  }
  
  for (const service of services) {
    visit(service.name)
  }
  
  return sorted
}
