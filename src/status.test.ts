// src/status.test.ts
import { describe, it, expect } from 'vitest'
import { detectConflicts, generateStatus } from './status.js'
import type { WorkspaceState } from './state.js'

const workspaces: WorkspaceState[] = [
  { name: 'fix-login', branch: 'fix/login', path: '/tmp/a', baseBranch: 'main', ports: { frontend: 3100, backend: 8100 }, pids: {}, status: 'running', slot: 1 },
  { name: 'fix-pay',   branch: 'fix/pay',   path: '/tmp/b', baseBranch: 'main', ports: { frontend: 3200, backend: 8200 }, pids: {}, status: 'running', slot: 2 },
]
const commits = {
  'fix-login': [{ hash: 'abc123', message: 'fix: login' }],
  'fix-pay':   [{ hash: 'xyz789', message: 'fix: payment' }],
}
const changedFiles = {
  'fix-login': ['src/auth.ts', 'src/login.ts'],
  'fix-pay':   ['src/auth.ts', 'src/payment.ts'],
}

describe('detectConflicts', () => {
  it('finds files changed in multiple workspaces', () => {
    const c = detectConflicts(changedFiles)
    expect(c).toHaveLength(1)
    expect(c[0].file).toBe('src/auth.ts')
    expect(c[0].workspaces).toContain('fix-login')
  })

  it('returns empty when no overlap', () => {
    expect(detectConflicts({ a: ['x.ts'], b: ['y.ts'] })).toEqual([])
  })
})

describe('generateStatus', () => {
  it('includes workspace names and ports', () => {
    const md = generateStatus(workspaces, commits, changedFiles)
    expect(md).toContain('fix-login')
    expect(md).toContain(':3100')
  })

  it('includes commit messages', () => {
    expect(generateStatus(workspaces, commits, changedFiles)).toContain('fix: login')
  })

  it('includes conflict warning', () => {
    const md = generateStatus(workspaces, commits, changedFiles)
    expect(md).toContain('Conflict')
    expect(md).toContain('src/auth.ts')
  })
})
