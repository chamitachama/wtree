// src/state.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { StateManager } from './state.js'

const TMP = '/tmp/wtree-test-state'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('StateManager', () => {
  it('starts with empty workspaces', async () => {
    expect(await new StateManager(TMP).getAll()).toEqual([])
  })

  it('adds and retrieves a workspace', async () => {
    const s = new StateManager(TMP)
    await s.add({ name: 'fix-login', branch: 'fix/login', path: '/tmp/a', baseBranch: 'main', ports: { frontend: 3100 }, pids: {}, status: 'running', slot: 1 })
    expect((await s.getAll())[0].name).toBe('fix-login')
  })

  it('removes a workspace', async () => {
    const s = new StateManager(TMP)
    await s.add({ name: 'fix-login', branch: 'fix/login', path: '/tmp/a', baseBranch: 'main', ports: {}, pids: {}, status: 'running', slot: 1 })
    await s.remove('fix-login')
    expect(await s.getAll()).toEqual([])
  })

  it('updates a workspace field', async () => {
    const s = new StateManager(TMP)
    await s.add({ name: 'fix-login', branch: 'fix/login', path: '/tmp/a', baseBranch: 'main', ports: {}, pids: {}, status: 'running', slot: 1 })
    await s.update('fix-login', { status: 'stopped' })
    expect((await s.get('fix-login'))?.status).toBe('stopped')
  })

  it('returns next available slot', async () => {
    const s = new StateManager(TMP)
    expect(await s.nextSlot()).toBe(1)
    await s.add({ name: 'a', branch: 'a', path: '/tmp/a', baseBranch: 'main', ports: {}, pids: {}, status: 'running', slot: 1 })
    expect(await s.nextSlot()).toBe(2)
  })
})
