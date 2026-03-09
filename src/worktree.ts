import { join } from 'path'
import { mkdir } from 'fs/promises'
import simpleGit from 'simple-git'

export class WorktreeManager {
  private git: ReturnType<typeof simpleGit>

  constructor(private repoRoot: string, private worktreesDir: string) {
    this.git = simpleGit(repoRoot)
  }

  private safeName(name: string): string { return name.replace(/\//g, '-') }

  async create(name: string, baseBranch: string): Promise<string> {
    await mkdir(this.worktreesDir, { recursive: true })
    const path = join(this.worktreesDir, this.safeName(name))
    await this.git.raw(['worktree', 'add', '-b', name, path, baseBranch])
    return path
  }

  async open(branch: string): Promise<string> {
    await mkdir(this.worktreesDir, { recursive: true })
    const path = join(this.worktreesDir, this.safeName(branch))
    await this.git.raw(['worktree', 'add', path, branch])
    return path
  }

  async remove(name: string): Promise<void> {
    await this.git.raw(['worktree', 'remove', '--force', join(this.worktreesDir, this.safeName(name))])
  }

  async list(): Promise<Array<{ path: string; branch: string }>> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain'])
    return result.trim().split('\n\n').map(block => {
      const lines = block.split('\n')
      return {
        path: lines.find(l => l.startsWith('worktree '))?.replace('worktree ', '') ?? '',
        branch: lines.find(l => l.startsWith('branch '))?.replace('branch refs/heads/', '') ?? 'detached',
      }
    })
  }

  async getCommitsSince(worktreePath: string, baseBranch: string): Promise<Array<{ hash: string; message: string }>> {
    try {
      const log = await simpleGit(worktreePath).log({ from: baseBranch, to: 'HEAD' })
      return log.all.map(c => ({ hash: c.hash.slice(0, 7), message: c.message }))
    } catch { return [] }
  }

  async getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]> {
    try {
      const diff = await simpleGit(worktreePath).diff([`${baseBranch}...HEAD`, '--name-only'])
      return diff.trim().split('\n').filter(Boolean)
    } catch { return [] }
  }
}
