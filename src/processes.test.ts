// src/processes.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
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

it('writes process output to log file when logFile is provided', async () => {
  const logFile = '/tmp/wtree-test-process.log'
  await pm.start('log-test', 'echo hello-from-log', '/tmp', {}, logFile)
  await new Promise(r => setTimeout(r, 300))
  expect(existsSync(logFile)).toBe(true)
  expect(readFileSync(logFile, 'utf-8')).toContain('hello-from-log')
  try { unlinkSync(logFile) } catch {}
}, 5000)
