// src/ports.test.ts
import { describe, it, expect } from 'vitest'
import { assignPorts, resolveEnv } from './ports.js'
import type { ServiceConfig } from './config.js'

const services: ServiceConfig[] = [
  { name: 'frontend', command: 'pnpm dev', cwd: '.', basePort: 3000, portEnvVar: 'PORT',
    env: { 'NEXT_PUBLIC_API_URL': 'http://localhost:{backend.port}' }, shared: false },
  { name: 'backend', command: 'uvicorn main:app', cwd: '.', basePort: 8000, portEnvVar: 'PORT', env: {}, shared: false },
]

describe('assignPorts', () => {
  it('assigns ports using slot * portStep offset', async () => {
    const ports = await assignPorts(services, [], 1, 100)
    expect(ports.frontend).toBe(3100)
    expect(ports.backend).toBe(8100)
  })

  it('uses slot 2 for second workspace', async () => {
    const ports = await assignPorts(services, [], 2, 100)
    expect(ports.frontend).toBe(3200)
    expect(ports.backend).toBe(8200)
  })

  it('falls back to next free port if preferred is taken', async () => {
    const ports = await assignPorts(services, [3100], 1, 100)
    expect(ports.frontend).not.toBe(3100)
  })
})

describe('resolveEnv', () => {
  it('replaces {service.port} templates', () => {
    const resolved = resolveEnv({ 'NEXT_PUBLIC_API_URL': 'http://localhost:{backend.port}' }, { frontend: 3100, backend: 8100 })
    expect(resolved['NEXT_PUBLIC_API_URL']).toBe('http://localhost:8100')
  })

  it('leaves strings without templates unchanged', () => {
    expect(resolveEnv({ FOO: 'bar' }, {})['FOO']).toBe('bar')
  })
})
