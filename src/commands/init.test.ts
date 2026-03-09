import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

vi.mock('readline', () => ({ createInterface: vi.fn() }))
import * as readline from 'readline'

const TMP = '/tmp/wtree-test-init'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

async function runInit(cwd: string) {
  const { initCommand } = await import('./init.js')
  await initCommand(cwd)
}

describe('initCommand', () => {
  it('writes .wtree.json for detected package.json project', async () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }))
    await runInit(TMP)
    expect(existsSync(join(TMP, '.wtree.json'))).toBe(true)
    const config = JSON.parse(readFileSync(join(TMP, '.wtree.json'), 'utf-8'))
    expect(config.services[0].command).toBe('npm run dev')
  })

  it('writes template .wtree.json when nothing detected', async () => {
    await runInit(TMP)
    expect(existsSync(join(TMP, '.wtree.json'))).toBe(true)
    const raw = readFileSync(join(TMP, '.wtree.json'), 'utf-8')
    expect(raw).toContain('defaultBranch')
    expect(raw).toContain('//')
  })

  it('creates .gitignore with required entries', async () => {
    await runInit(TMP)
    const gitignore = readFileSync(join(TMP, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.worktrees/')
    expect(gitignore).toContain('.wtree/state.json')
  })

  it('does not duplicate .gitignore entries', async () => {
    writeFileSync(join(TMP, '.gitignore'), '.worktrees/\n')
    await runInit(TMP)
    const gitignore = readFileSync(join(TMP, '.gitignore'), 'utf-8')
    expect(gitignore.split('.worktrees/').length - 1).toBe(1)
  })

  it('aborts if .wtree.json exists and user declines', async () => {
    writeFileSync(join(TMP, '.wtree.json'), '{"services":[]}')
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_: string, cb: (a: string) => void) => cb('n'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    await runInit(TMP)
    expect(readFileSync(join(TMP, '.wtree.json'), 'utf-8')).toBe('{"services":[]}')
  })

  it('overwrites if .wtree.json exists and user confirms', async () => {
    writeFileSync(join(TMP, '.wtree.json'), '{"services":[]}')
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }))
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_: string, cb: (a: string) => void) => cb('y'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    await runInit(TMP)
    const config = JSON.parse(readFileSync(join(TMP, '.wtree.json'), 'utf-8'))
    expect(config.services[0].command).toBe('npm run dev')
  })
})
