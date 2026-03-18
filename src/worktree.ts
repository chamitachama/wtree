import { join } from 'path'
import { mkdir, rm, access } from 'fs/promises'
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
    const existing = await this.list()
    const isRegistered = existing.some(w => w.path === path)
    
    if (!isRegistered) {
      // Check if directory exists but isn't registered (orphaned from failed attempt)
      const dirExists = await this.pathExists(path)
      if (dirExists) {
        // Clean up orphaned directory
        await rm(path, { recursive: true, force: true })
        // Also prune any stale worktree references
        await this.git.raw(['worktree', 'prune']).catch(() => {})
      }

      // Check if branch exists locally or in remote
      const branchExists = await this.branchExists(branch)
      if (!branchExists) {
        // Try fetching from origin first
        try {
          await this.git.fetch('origin', branch)
        } catch {
          // Fetch failed, branch doesn't exist anywhere
          const suggestions = await this.findSimilarBranches(branch)
          let msg = `Branch '${branch}' not found locally or in remote.`
          if (suggestions.length > 0) {
            msg += `\n\nDid you mean?\n${suggestions.map(s => `  • ${s}`).join('\n')}`
          }
          msg += `\n\nTip: Use 'wtree create ${branch}' to create a new branch.`
          throw new Error(msg)
        }
      }
      await this.git.raw(['worktree', 'add', path, branch])
    }
    return path
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      // Check local branches
      const local = await this.git.branchLocal()
      if (local.all.includes(branch)) return true
      // Check remote branches
      const remote = await this.git.branch(['-r'])
      return remote.all.some(r => r.endsWith(`/${branch}`))
    } catch {
      return false
    }
  }

  private async findSimilarBranches(branch: string): Promise<string[]> {
    try {
      const all = await this.git.branch(['-a'])
      const searchTerm = branch.toLowerCase()
      // Extract key parts (e.g., "LON-502" from "fix/LON-502-infinite-scrol")
      const keyParts = searchTerm.match(/[a-z]+-\d+/gi) || []
      
      return all.all
        .map(b => b.replace('remotes/origin/', ''))
        .filter(b => {
          const lower = b.toLowerCase()
          // Match if contains the ticket number or similar name
          return keyParts.some(part => lower.includes(part.toLowerCase())) ||
                 this.levenshteinClose(lower, searchTerm)
        })
        .slice(0, 5) // Max 5 suggestions
    } catch {
      return []
    }
  }

  private levenshteinClose(a: string, b: string): boolean {
    // Simple similarity check - if 80%+ characters match
    const longer = a.length > b.length ? a : b
    const shorter = a.length > b.length ? b : a
    if (longer.length === 0) return true
    const matchCount = [...shorter].filter((c, i) => longer[i] === c).length
    return matchCount / longer.length > 0.7
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
