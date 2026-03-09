import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

vi.mock('child_process', () => ({ execSync: vi.fn() }))
import { execSync } from 'child_process'

const TMP = '/tmp/wtree-test-browser'
beforeEach(() => mkdirSync(join(TMP, '.wtree'), { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

async function runBrowser(name: string, cwd: string) {
  const { browserCommand } = await import('./browser.js')
  await browserCommand(name, cwd)
}

describe('browserCommand', () => {
  it('opens the first service URL in the browser', async () => {
    writeFileSync(join(TMP, '.wtree', 'state.json'), JSON.stringify({
      workspaces: [{ name: 'my-ws', branch: 'main', path: TMP, baseBranch: 'main',
        ports: { frontend: 3100, backend: 8100 }, pids: {}, status: 'running', slot: 1 }]
    }))
    await runBrowser('my-ws', TMP)
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(expect.stringContaining('3100'))
  })

  it('exits with error when workspace not found', async () => {
    writeFileSync(join(TMP, '.wtree', 'state.json'), JSON.stringify({ workspaces: [] }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(runBrowser('missing', TMP)).rejects.toThrow()
    exitSpy.mockRestore()
  })
})
