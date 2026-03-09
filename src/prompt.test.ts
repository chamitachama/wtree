// src/prompt.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('readline', () => ({ createInterface: vi.fn() }))

import * as readline from 'readline'
import { confirmDelete } from './prompt.js'

describe('confirmDelete', () => {
  it('resolves true when user types DELETE', async () => {
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_: string, cb: (answer: string) => void) => cb('DELETE'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    expect(await confirmDelete('my-workspace')).toBe(true)
  })

  it('resolves false when user types anything else', async () => {
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_: string, cb: (answer: string) => void) => cb('yes'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    expect(await confirmDelete('my-workspace')).toBe(false)
  })

  it('resolves false when user types nothing', async () => {
    vi.mocked(readline.createInterface).mockReturnValue({
      question: (_: string, cb: (answer: string) => void) => cb(''),
      close: vi.fn(),
    } as unknown as readline.Interface)
    expect(await confirmDelete('my-workspace')).toBe(false)
  })
})
