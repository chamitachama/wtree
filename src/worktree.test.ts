// src/worktree.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { WorktreeManager } from './worktree.js'

const REPO = '/tmp/wtree-test-repo'
const TREES = '/tmp/wtree-test-trees'

beforeAll(() => {
  mkdirSync(REPO, { recursive: true })
  mkdirSync(TREES, { recursive: true })
  execSync('git init', { cwd: REPO })
  execSync('git config user.email "t@t.com"', { cwd: REPO })
  execSync('git config user.name "T"', { cwd: REPO })
  writeFileSync(join(REPO, 'README.md'), '# test')
  execSync('git add . && git commit -m "init"', { cwd: REPO })
})

afterAll(() => {
  rmSync(REPO, { recursive: true, force: true })
  rmSync(TREES, { recursive: true, force: true })
})

describe('WorktreeManager', () => {
  it('creates a new worktree', async () => {
    const wm = new WorktreeManager(REPO, TREES)
    const path = await wm.create('my-feature', 'main')
    expect(path).toContain('my-feature')
  })

  it('lists worktrees', async () => {
    const wm = new WorktreeManager(REPO, TREES)
    expect((await wm.list()).length).toBeGreaterThan(0)
  })

  it('removes a worktree', async () => {
    const wm = new WorktreeManager(REPO, TREES)
    await wm.create('to-remove', 'main')
    const before = (await wm.list()).length
    await wm.remove('to-remove')
    expect((await wm.list()).length).toBe(before - 1)
  })
})
