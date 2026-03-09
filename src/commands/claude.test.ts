import { describe, it, expect } from 'vitest'
import { buildContext } from '../claude-context.js'
import type { WorkspaceState } from '../state.js'

const ws: WorkspaceState = {
  name: 'fix-login', branch: 'fix/login', path: '/tmp/fix-login',
  baseBranch: 'main', ports: { frontend: 3100, backend: 8100 },
  pids: {}, status: 'running', slot: 1,
}

describe('buildContext', () => {
  it('includes workspace name and branch', () => {
    const ctx = buildContext(ws, [])
    expect(ctx).toContain('fix-login')
    expect(ctx).toContain('fix/login')
  })

  it('includes service URLs', () => {
    const ctx = buildContext(ws, [])
    expect(ctx).toContain('http://localhost:3100')
    expect(ctx).toContain('http://localhost:8100')
  })

  it('includes changed files when provided', () => {
    const ctx = buildContext(ws, ['src/auth.ts', 'src/login.ts'])
    expect(ctx).toContain('src/auth.ts')
  })

  it('omits changed files section when empty', () => {
    const ctx = buildContext(ws, [])
    expect(ctx).not.toContain('Changed files')
  })
})
