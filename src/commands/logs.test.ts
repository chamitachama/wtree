import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pickService } from '../logs-picker.js'

const TMP = '/tmp/wtree-test-logs'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

vi.mock('readline', () => ({ createInterface: vi.fn() }))
import * as readline from 'readline'

describe('pickService', () => {
  it('returns the only service without prompting', async () => {
    const result = await pickService(['frontend'])
    expect(result).toBe('frontend')
    expect(vi.mocked(readline.createInterface)).not.toHaveBeenCalled()
  })

  it('prompts and returns chosen service', async () => {
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_: string, cb: (a: string) => void) => cb('2'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    const result = await pickService(['frontend', 'backend'])
    expect(result).toBe('backend')
  })

  it('defaults to first service on invalid input', async () => {
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_: string, cb: (a: string) => void) => cb('99'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    const result = await pickService(['frontend', 'backend'])
    expect(result).toBe('frontend')
  })
})
