import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { detectServices } from './detect.js'

const TMP = '/tmp/wtree-test-detect'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('detectServices', () => {
  it('detects npm dev script from package.json', async () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }))
    const services = await detectServices(TMP)
    expect(services).not.toBeNull()
    expect(services![0].name).toBe('app')
    expect(services![0].command).toBe('npm run dev')
    expect(services![0].basePort).toBe(3000)
  })

  it('falls back to npm start if no dev script', async () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }))
    const services = await detectServices(TMP)
    expect(services![0].command).toBe('npm start')
  })

  it('detects python from pyproject.toml', async () => {
    writeFileSync(join(TMP, 'pyproject.toml'), '[tool.poetry]\nname = "app"')
    const services = await detectServices(TMP)
    expect(services![0].command).toBe('uvicorn main:app --reload')
    expect(services![0].basePort).toBe(8000)
  })

  it('detects python from requirements.txt', async () => {
    writeFileSync(join(TMP, 'requirements.txt'), 'fastapi\nuvicorn')
    const services = await detectServices(TMP)
    expect(services![0].command).toBe('uvicorn main:app --reload')
  })

  it('detects services from Procfile', async () => {
    writeFileSync(join(TMP, 'Procfile'), 'web: npm start\nworker: node worker.js')
    const services = await detectServices(TMP)
    expect(services).toHaveLength(2)
    expect(services![0].name).toBe('web')
    expect(services![0].command).toBe('npm start')
    expect(services![1].name).toBe('worker')
  })

  it('detects services from docker-compose.yml', async () => {
    writeFileSync(join(TMP, 'docker-compose.yml'), [
      'services:',
      '  frontend:',
      '    ports: ["3000:3000"]',
      '  backend:',
      '    ports: ["8000:8000"]',
    ].join('\n'))
    const services = await detectServices(TMP)
    expect(services).toHaveLength(2)
    expect(services![0].name).toBe('frontend')
    expect(services![0].basePort).toBe(3000)
  })

  it('returns null when nothing detected', async () => {
    expect(await detectServices(TMP)).toBeNull()
  })
})
