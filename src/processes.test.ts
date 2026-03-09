// src/processes.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { ProcessManager } from './processes.js'

const pm = new ProcessManager()
afterEach(() => pm.stopAll())

describe('ProcessManager', () => {
  it('starts a process and returns a pid', async () => {
    expect(await pm.start('echo-test', 'echo hello', '/tmp', {})).toBeGreaterThan(0)
  })

  it('tracks running processes', async () => {
    await pm.start('sleep-test', 'sleep 10', '/tmp', {})
    expect(pm.isRunning('sleep-test')).toBe(true)
  })

  it('stops a process', async () => {
    await pm.start('stop-test', 'sleep 10', '/tmp', {})
    await pm.stop('stop-test')
    expect(pm.isRunning('stop-test')).toBe(false)
  })
})
