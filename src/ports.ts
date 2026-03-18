import getPort from 'get-port'
import type { ServiceConfig } from './config.js'

export async function assignPorts(
  services: ServiceConfig[],
  usedPorts: number[],
  slot: number,
  portStep: number
): Promise<Record<string, number>> {
  const assigned: Record<string, number> = {}
  const taken = new Set(usedPorts)

  for (const service of services) {
    const preferred = service.basePort + slot * portStep
    const port = taken.has(preferred)
      ? await getPort({ port: preferred + 1 })
      : await getPort({ port: preferred })
    assigned[service.name] = port
    taken.add(port)
  }

  return assigned
}

export function resolveEnv(
  env: Record<string, string>,
  allPorts: Record<string, number>,
  infrastructure: Record<string, string> = {}
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    let result = value
    
    // Resolve {service.port} references
    result = result.replace(/\{(\w+)\.port\}/g, (_, name) => {
      if (!(name in allPorts)) {
        console.warn(`wtree: env var "${key}" references unknown service "${name}"`)
        return ''
      }
      return String(allPorts[name])
    })
    
    // Resolve {infrastructure.<type>} references
    result = result.replace(/\{infrastructure\.(\w+)\}/g, (_, type) => {
      if (!(type in infrastructure)) {
        console.warn(`wtree: env var "${key}" references unknown infrastructure "${type}"`)
        return ''
      }
      return infrastructure[type]
    })
    
    resolved[key] = result
  }
  return resolved
}
