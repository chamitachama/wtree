// src/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { loadConfig } from './config.js'

const TMP = '/tmp/wtree-test-config'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('loadConfig', () => {
  it('loads a valid .wtree.json', async () => {
    writeFileSync(join(TMP, '.wtree.json'), JSON.stringify({
      services: [{ name: 'web', command: 'npm start', basePort: 3000 }]
    }))
    const config = await loadConfig(TMP)
    expect(config.services[0].name).toBe('web')
  })

  it('applies defaults for optional fields', async () => {
    writeFileSync(join(TMP, '.wtree.json'), JSON.stringify({
      services: [{ name: 'web', command: 'npm start', basePort: 3000 }]
    }))
    const config = await loadConfig(TMP)
    expect(config.defaultBranch).toBe('main')
    expect(config.workspacesDir).toBe('.worktrees')
    expect(config.portStep).toBe(100)
  })

  it('throws when .wtree.json is missing', async () => {
    await expect(loadConfig(TMP)).rejects.toThrow('No .wtree.json found')
  })

  it('parses .wtree.json with inline comments', async () => {
    writeFileSync(join(TMP, '.wtree.json'), `{
      // default branch
      "services": [{ "name": "web", "command": "npm start", "basePort": 3000 }]
    }`)
    const config = await loadConfig(TMP)
    expect(config.services[0].name).toBe('web')
  })

  it('preserves custom portStep', async () => {
    writeFileSync(join(TMP, '.wtree.json'), JSON.stringify({
      portStep: 50,
      services: [{ name: 'web', command: 'npm start', basePort: 3000 }]
    }))
    const config = await loadConfig(TMP)
    expect(config.portStep).toBe(50)
  })
})
