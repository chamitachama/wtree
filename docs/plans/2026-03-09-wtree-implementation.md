# wtree Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a globally-installable TypeScript CLI (`wtree`) that spins up full-stack git worktrees on isolated ports with inter-service routing and live conflict detection.

**Architecture:** Commander.js CLI wraps simple-git for worktree operations and spawn for service processes. Port slots are assigned in configurable steps (default 100). Each service receives resolved env vars (including `{service.port}` templates) at startup. State persists in `.wtree/state.json`; `.wtree/STATUS.md` is regenerated on every state change.

**Tech Stack:** TypeScript, Node.js, commander, simple-git, get-port, chalk, readline, vitest

---

## Expected Input / Output per Command

```
wtree open <branch>
  IN:  existing git branch name
  OUT: ✓ Worktree ready: <branch>
       ✓ frontend → http://localhost:3100
       ✓ backend  → http://localhost:8100
  ERR: "Branch <branch> does not exist"

wtree create <name> [--from <base>]
  IN:  new workspace name, optional base branch
  OUT: ✓ Creating workspace: <name> (from <base>)
       ✓ frontend → http://localhost:3200
       ✓ backend  → http://localhost:8200
  ERR: "Workspace <name> already exists"

wtree list
  IN:  (none)
  OUT: ● fix-login  [fix/login]  frontend:3100  backend:8100
       ● my-fix     [my-fix]     frontend:3200  backend:8200
  ERR: "No active workspaces"

wtree stop <name>
  IN:  workspace name
  OUT: Stopped workspace: <name>
  ERR: "Workspace <name> not found"

wtree destroy <name>
  IN:  workspace name
  PROMPT: ⚠️  This will permanently delete workspace "<name>" and its worktree.
          Type DELETE to confirm: _
  OUT: Destroyed workspace: <name>      (if user typed DELETE)
       Aborted.                         (if user typed anything else)
  ERR: "Workspace <name> not found"
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.gitignore`

**Step 1: Initialise package**

```bash
cd /Users/Gen-Quint/Documents/coding/wtree
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install commander simple-git get-port chalk
npm install -D typescript @types/node vitest tsx
```

**Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

**Step 4: Replace `package.json` with:**

```json
{
  "name": "wtree",
  "version": "0.1.0",
  "description": "Run multiple git worktrees in parallel with isolated ports",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "wtree": "dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "repository": { "type": "git", "url": "https://github.com/chamitachama/wtree" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chalk": "^5.0.0",
    "commander": "^12.0.0",
    "get-port": "^7.0.0",
    "simple-git": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  },
  "license": "MIT"
}
```

**Step 5: Write `src/index.ts`**

```typescript
#!/usr/bin/env node
import { program } from 'commander'

program
  .name('wtree')
  .description('Run multiple git worktrees in parallel with isolated ports')
  .version('0.1.0')

program.parse()
```

**Step 6: Write `.gitignore`**

```
node_modules/
dist/
.worktrees/
.wtree/state.json
```

**Step 7: Build and verify**

```bash
npm run build
node dist/index.js --version
```

Expected output: `0.1.0`

**Step 8: Commit**

```bash
git add .
git commit -m "feat: scaffold TypeScript CLI project"
```

---

## Task 2: Config loader

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Step 1: Write the failing test**

```typescript
// src/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { loadConfig } from './config.js'

const TMP = '/tmp/wtree-test-config'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('loadConfig', () => {
  it('loads a valid .wtree.json', async () => {
    writeFileSync(join(TMP, '.wtree.json'), JSON.stringify({
      services: [{ name: 'web', command: 'npm start', basePort: 3000 }]
    }))
    const config = await loadConfig(TMP)
    expect(config.services[0].name).toBe('web')
  })

  it('applies defaults for optional fields', async () => {
    writeFileSync(join(TMP, '.wtree.json'), JSON.stringify({
      services: [{ name: 'web', command: 'npm start', basePort: 3000 }]
    }))
    const config = await loadConfig(TMP)
    expect(config.defaultBranch).toBe('main')
    expect(config.workspacesDir).toBe('.worktrees')
    expect(config.portStep).toBe(100)
  })

  it('throws when .wtree.json is missing', async () => {
    await expect(loadConfig(TMP)).rejects.toThrow('No .wtree.json found')
  })

  it('preserves custom portStep', async () => {
    writeFileSync(join(TMP, '.wtree.json'), JSON.stringify({
      portStep: 50,
      services: [{ name: 'web', command: 'npm start', basePort: 3000 }]
    }))
    const config = await loadConfig(TMP)
    expect(config.portStep).toBe(50)
  })
})
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `loadConfig` not found

**Step 3: Write `src/config.ts`**

```typescript
import { readFile } from 'fs/promises'
import { join } from 'path'

export interface ServiceConfig {
  name: string
  command: string
  cwd: string
  basePort: number
  portEnvVar: string
  env: Record<string, string>
}

export interface WtreeConfig {
  defaultBranch: string
  workspacesDir: string
  portStep: number
  services: ServiceConfig[]
}

export async function loadConfig(cwd: string = process.cwd()): Promise<WtreeConfig> {
  const configPath = join(cwd, '.wtree.json')
  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      defaultBranch: parsed.defaultBranch ?? 'main',
      workspacesDir: parsed.workspacesDir ?? '.worktrees',
      portStep: parsed.portStep ?? 100,
      services: parsed.services.map((s: Partial<ServiceConfig>) => ({
        name: s.name!,
        command: s.command!,
        cwd: s.cwd ?? '.',
        basePort: s.basePort!,
        portEnvVar: s.portEnvVar ?? 'PORT',
        env: s.env ?? {},
      })),
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No .wtree.json found in ${cwd}`)
    }
    throw e
  }
}
```

**Step 4: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config loader with portStep and env support"
```

---

## Task 3: Port manager

**Files:**
- Create: `src/ports.ts`
- Create: `src/ports.test.ts`

**Step 1: Write the failing test**

```typescript
// src/ports.test.ts
import { describe, it, expect } from 'vitest'
import { assignPorts, resolveEnv } from './ports.js'
import type { ServiceConfig } from './config.js'

const services: ServiceConfig[] = [
  { name: 'frontend', command: 'pnpm dev', cwd: '.', basePort: 3000, portEnvVar: 'PORT',
    env: { 'NEXT_PUBLIC_API_URL': 'http://localhost:{backend.port}' } },
  { name: 'backend', command: 'uvicorn main:app', cwd: '.', basePort: 8000, portEnvVar: 'PORT', env: {} },
]

describe('assignPorts', () => {
  it('assigns ports using slot * portStep offset', async () => {
    const ports = await assignPorts(services, [], 1, 100)
    expect(ports.frontend).toBe(3100)
    expect(ports.backend).toBe(8100)
  })

  it('uses slot 2 for second workspace', async () => {
    const ports = await assignPorts(services, [], 2, 100)
    expect(ports.frontend).toBe(3200)
    expect(ports.backend).toBe(8200)
  })

  it('falls back to next free port if preferred is taken', async () => {
    const ports = await assignPorts(services, [3100], 1, 100)
    expect(ports.frontend).not.toBe(3100)
  })
})

describe('resolveEnv', () => {
  it('replaces {service.port} templates', () => {
    const resolved = resolveEnv({ 'NEXT_PUBLIC_API_URL': 'http://localhost:{backend.port}' }, { frontend: 3100, backend: 8100 })
    expect(resolved['NEXT_PUBLIC_API_URL']).toBe('http://localhost:8100')
  })

  it('leaves strings without templates unchanged', () => {
    expect(resolveEnv({ FOO: 'bar' }, {})['FOO']).toBe('bar')
  })
})
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — functions not found

**Step 3: Write `src/ports.ts`**

```typescript
import getPort from 'get-port'
import type { ServiceConfig } from './config.js'

export async function assignPorts(
  services: ServiceConfig[],
  usedPorts: number[],
  slot: number,
  portStep: number
): Promise<Record<string, number>> {
  const assigned: Record<string, number> = {}
  const taken = new Set(usedPorts)

  for (const service of services) {
    const preferred = service.basePort + slot * portStep
    const port = taken.has(preferred)
      ? await getPort({ port: preferred + 1 })
      : await getPort({ port: preferred })
    assigned[service.name] = port
    taken.add(port)
  }

  return assigned
}

export function resolveEnv(
  env: Record<string, string>,
  allPorts: Record<string, number>
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\{(\w+)\.port\}/g, (_, name) => String(allPorts[name] ?? ''))
  }
  return resolved
}
```

**Step 4: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/ports.ts src/ports.test.ts
git commit -m "feat: add port assignment with step offsets and env template resolver"
```

---

## Task 4: State manager

**Files:**
- Create: `src/state.ts`
- Create: `src/state.test.ts`

**Step 1: Write the failing test**

```typescript
// src/state.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { StateManager } from './state.js'

const TMP = '/tmp/wtree-test-state'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('StateManager', () => {
  it('starts with empty workspaces', async () => {
    expect(await new StateManager(TMP).getAll()).toEqual([])
  })

  it('adds and retrieves a workspace', async () => {
    const s = new StateManager(TMP)
    await s.add({ name: 'fix-login', branch: 'fix/login', path: '/tmp/a', baseBranch: 'main', ports: { frontend: 3100 }, pids: {}, status: 'running', slot: 1 })
    expect((await s.getAll())[0].name).toBe('fix-login')
  })

  it('removes a workspace', async () => {
    const s = new StateManager(TMP)
    await s.add({ name: 'fix-login', branch: 'fix/login', path: '/tmp/a', baseBranch: 'main', ports: {}, pids: {}, status: 'running', slot: 1 })
    await s.remove('fix-login')
    expect(await s.getAll()).toEqual([])
  })

  it('updates a workspace field', async () => {
    const s = new StateManager(TMP)
    await s.add({ name: 'fix-login', branch: 'fix/login', path: '/tmp/a', baseBranch: 'main', ports: {}, pids: {}, status: 'running', slot: 1 })
    await s.update('fix-login', { status: 'stopped' })
    expect((await s.get('fix-login'))?.status).toBe('stopped')
  })

  it('returns next available slot', async () => {
    const s = new StateManager(TMP)
    expect(await s.nextSlot()).toBe(1)
    await s.add({ name: 'a', branch: 'a', path: '/tmp/a', baseBranch: 'main', ports: {}, pids: {}, status: 'running', slot: 1 })
    expect(await s.nextSlot()).toBe(2)
  })
})
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `StateManager` not found

**Step 3: Write `src/state.ts`**

```typescript
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

export interface WorkspaceState {
  name: string
  branch: string
  path: string
  baseBranch: string
  ports: Record<string, number>
  pids: Record<string, number>
  status: 'running' | 'stopped'
  slot: number
}

export class StateManager {
  private statePath: string

  constructor(private root: string) {
    this.statePath = join(root, '.wtree', 'state.json')
  }

  private async read(): Promise<WorkspaceState[]> {
    try {
      return (JSON.parse(await readFile(this.statePath, 'utf-8')) as { workspaces: WorkspaceState[] }).workspaces
    } catch { return [] }
  }

  private async write(workspaces: WorkspaceState[]): Promise<void> {
    await mkdir(join(this.root, '.wtree'), { recursive: true })
    await writeFile(this.statePath, JSON.stringify({ workspaces }, null, 2))
  }

  async getAll(): Promise<WorkspaceState[]> { return this.read() }
  async get(name: string): Promise<WorkspaceState | undefined> { return (await this.read()).find(w => w.name === name) }
  async add(workspace: WorkspaceState): Promise<void> { await this.write([...await this.read(), workspace]) }
  async remove(name: string): Promise<void> { await this.write((await this.read()).filter(w => w.name !== name)) }
  async update(name: string, patch: Partial<WorkspaceState>): Promise<void> {
    await this.write((await this.read()).map(w => w.name === name ? { ...w, ...patch } : w))
  }

  async nextSlot(): Promise<number> {
    const slots = new Set((await this.read()).map(w => w.slot))
    let slot = 1
    while (slots.has(slot)) slot++
    return slot
  }

  async usedPorts(): Promise<number[]> {
    return (await this.read()).flatMap(w => Object.values(w.ports))
  }
}
```

**Step 4: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat: add state manager with slot tracking"
```

---

## Task 5: Git worktree manager

**Files:**
- Create: `src/worktree.ts`
- Create: `src/worktree.test.ts`

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `WorktreeManager` not found

**Step 3: Write `src/worktree.ts`**

```typescript
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
```

**Step 4: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/worktree.ts src/worktree.test.ts
git commit -m "feat: add worktree manager"
```

---

## Task 6: Process manager

**Files:**
- Create: `src/processes.ts`
- Create: `src/processes.test.ts`

**Step 1: Write the failing test**

```typescript
// src/processes.test.ts
import { describe, it, expect, afterEach } from 'vitest'
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
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `ProcessManager` not found

**Step 3: Write `src/processes.ts`**

```typescript
import { spawn } from 'child_process'

export class ProcessManager {
  private procs = new Map<string, { pid: number; kill: () => void }>()

  async start(id: string, command: string, cwd: string, env: Record<string, string>): Promise<number> {
    const child = spawn(command, [], { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: true })
    const pid = child.pid ?? 0
    this.procs.set(id, { pid, kill: () => child.kill('SIGTERM') })
    child.on('exit', () => this.procs.delete(id))
    return pid
  }

  isRunning(id: string): boolean { return this.procs.has(id) }

  async stop(id: string): Promise<void> {
    const p = this.procs.get(id)
    if (p) { p.kill(); this.procs.delete(id); await new Promise(r => setTimeout(r, 200)) }
  }

  stopAll(): void { for (const id of [...this.procs.keys()]) this.stop(id) }
}
```

**Step 4: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/processes.ts src/processes.test.ts
git commit -m "feat: add process manager"
```

---

## Task 7: Status document + conflict detector

**Files:**
- Create: `src/status.ts`
- Create: `src/status.test.ts`
- Create: `src/status-writer.ts`

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL

**Step 3: Write `src/status.ts`**

```typescript
import type { WorkspaceState } from './state.js'

export interface Conflict { file: string; workspaces: string[] }

export function detectConflicts(changedFiles: Record<string, string[]>): Conflict[] {
  const map = new Map<string, string[]>()
  for (const [ws, files] of Object.entries(changedFiles)) {
    for (const file of files) map.set(file, [...(map.get(file) ?? []), ws])
  }
  return [...map.entries()]
    .filter(([, wsList]) => wsList.length > 1)
    .map(([file, workspaces]) => ({ file, workspaces }))
}

export function generateStatus(
  workspaces: WorkspaceState[],
  commits: Record<string, Array<{ hash: string; message: string }>>,
  changedFiles: Record<string, string[]>
): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const lines = ['# Workspace Status', `Last updated: ${now}`, '']

  for (const ws of workspaces) {
    const ports = Object.entries(ws.ports).map(([n, p]) => `${n}:${p}`).join(' / ')
    lines.push(`## ${ws.name} · ${ws.status} · ${ports}`)
    lines.push(`Branch: ${ws.branch} (from ${ws.baseBranch})`)
    for (const c of commits[ws.name] ?? []) lines.push(`- ${c.hash} ${c.message}`)
    lines.push(`Files changed: ${(changedFiles[ws.name] ?? []).length}`, '')
  }

  const conflicts = detectConflicts(changedFiles)
  if (conflicts.length > 0) {
    lines.push('---', '## ⚠️ Conflict Risks')
    for (const c of conflicts) lines.push(`- ${c.workspaces.join(' + ')} → ${c.file}`)
  }

  return lines.join('\n')
}
```

**Step 4: Write `src/status-writer.ts`**

```typescript
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { generateStatus } from './status.js'
import type { StateManager } from './state.js'
import type { WorktreeManager } from './worktree.js'

export async function writeStatusDoc(root: string, state: StateManager, wm: WorktreeManager): Promise<void> {
  const workspaces = await state.getAll()
  const commits: Record<string, Array<{ hash: string; message: string }>> = {}
  const changedFiles: Record<string, string[]> = {}
  for (const ws of workspaces) {
    commits[ws.name] = await wm.getCommitsSince(ws.path, ws.baseBranch)
    changedFiles[ws.name] = await wm.getChangedFiles(ws.path, ws.baseBranch)
  }
  await mkdir(join(root, '.wtree'), { recursive: true })
  await writeFile(join(root, '.wtree', 'STATUS.md'), generateStatus(workspaces, commits, changedFiles))
}
```

**Step 5: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (5 tests)

**Step 6: Commit**

```bash
git add src/status.ts src/status.test.ts src/status-writer.ts
git commit -m "feat: add status generator and conflict detector"
```

---

## Task 8: Confirm prompt helper

**Files:**
- Create: `src/prompt.ts`
- Create: `src/prompt.test.ts`

This is used by `destroy` to require the user to type `DELETE` before proceeding.

**Step 1: Write the failing test**

```typescript
// src/prompt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { confirmDelete } from './prompt.js'
import * as readline from 'readline'

describe('confirmDelete', () => {
  it('resolves true when user types DELETE', async () => {
    vi.spyOn(readline, 'createInterface').mockReturnValue({
      question: (_: string, cb: (answer: string) => void) => cb('DELETE'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    expect(await confirmDelete('my-workspace')).toBe(true)
  })

  it('resolves false when user types anything else', async () => {
    vi.spyOn(readline, 'createInterface').mockReturnValue({
      question: (_: string, cb: (answer: string) => void) => cb('yes'),
      close: vi.fn(),
    } as unknown as readline.Interface)
    expect(await confirmDelete('my-workspace')).toBe(false)
  })

  it('resolves false when user types nothing', async () => {
    vi.spyOn(readline, 'createInterface').mockReturnValue({
      question: (_: string, cb: (answer: string) => void) => cb(''),
      close: vi.fn(),
    } as unknown as readline.Interface)
    expect(await confirmDelete('my-workspace')).toBe(false)
  })
})
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `confirmDelete` not found

**Step 3: Write `src/prompt.ts`**

```typescript
import * as readline from 'readline'
import chalk from 'chalk'

export function confirmDelete(name: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    console.log(chalk.yellow(`⚠️  This will permanently delete workspace "${name}" and its worktree.`))
    rl.question('Type DELETE to confirm: ', answer => {
      rl.close()
      resolve(answer.trim() === 'DELETE')
    })
  })
}
```

**Step 4: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/prompt.ts src/prompt.test.ts
git commit -m "feat: add DELETE confirmation prompt"
```

---

## Task 9: Wire up all commands

**Files:**
- Create: `src/commands/open.ts`
- Create: `src/commands/create.ts`
- Create: `src/commands/list.ts`
- Create: `src/commands/stop.ts`
- Create: `src/commands/destroy.ts`
- Modify: `src/index.ts`

**Step 1: Write `src/commands/open.ts`**

```typescript
import chalk from 'chalk'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'

const pm = new ProcessManager()

export async function openCommand(branch: string): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const slot = await state.nextSlot()
  const ports = await assignPorts(config.services, await state.usedPorts(), slot, config.portStep)

  console.log(chalk.blue(`Opening workspace: ${branch}`))
  const worktreePath = await wm.open(branch)

  const pids: Record<string, number> = {}
  for (const service of config.services) {
    const port = ports[service.name]
    const cwd = `${worktreePath}/${service.cwd.replace('./', '')}`
    pids[service.name] = await pm.start(
      `${branch}:${service.name}`,
      service.command,
      cwd,
      { [service.portEnvVar]: String(port), ...resolveEnv(service.env, ports) }
    )
    console.log(chalk.green(`✓ ${service.name} → http://localhost:${port}`))
  }

  const name = branch.replace(/\//g, '-')
  await state.add({ name, branch, path: worktreePath, baseBranch: config.defaultBranch, ports, pids, status: 'running', slot })
  await writeStatusDoc(root, state, wm)
}
```

**Step 2: Write `src/commands/create.ts`**

```typescript
import chalk from 'chalk'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { ProcessManager } from '../processes.js'
import { assignPorts, resolveEnv } from '../ports.js'
import { writeStatusDoc } from '../status-writer.js'

const pm = new ProcessManager()

export async function createCommand(name: string, options: { from?: string }): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const baseBranch = options.from ?? config.defaultBranch
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const slot = await state.nextSlot()
  const ports = await assignPorts(config.services, await state.usedPorts(), slot, config.portStep)

  console.log(chalk.blue(`Creating workspace: ${name} (from ${baseBranch})`))
  const worktreePath = await wm.create(name, baseBranch)

  const pids: Record<string, number> = {}
  for (const service of config.services) {
    const port = ports[service.name]
    const cwd = `${worktreePath}/${service.cwd.replace('./', '')}`
    pids[service.name] = await pm.start(
      `${name}:${service.name}`,
      service.command,
      cwd,
      { [service.portEnvVar]: String(port), ...resolveEnv(service.env, ports) }
    )
    console.log(chalk.green(`✓ ${service.name} → http://localhost:${port}`))
  }

  await state.add({ name, branch: name, path: worktreePath, baseBranch, ports, pids, status: 'running', slot })
  await writeStatusDoc(root, state, wm)
}
```

**Step 3: Write `src/commands/list.ts`**

```typescript
import chalk from 'chalk'
import { StateManager } from '../state.js'

export async function listCommand(): Promise<void> {
  const state = new StateManager(process.cwd())
  const workspaces = await state.getAll()
  if (workspaces.length === 0) {
    console.log(chalk.gray('No active workspaces. Run `wtree open <branch>` to start one.'))
    return
  }
  for (const ws of workspaces) {
    const ports = Object.entries(ws.ports).map(([n, p]) => `${n}:${p}`).join('  ')
    const dot = ws.status === 'running' ? chalk.green('●') : chalk.gray('○')
    console.log(`${dot} ${chalk.bold(ws.name)} [${ws.branch}]  ${ports}`)
  }
}
```

**Step 4: Write `src/commands/stop.ts`**

```typescript
import chalk from 'chalk'
import { execSync } from 'child_process'
import { StateManager } from '../state.js'

export async function stopCommand(name: string): Promise<void> {
  const state = new StateManager(process.cwd())
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }
  for (const pid of Object.values(ws.pids)) {
    try { execSync(`kill ${pid}`) } catch { /* already gone */ }
  }
  await state.update(name, { status: 'stopped', pids: {} })
  console.log(chalk.yellow(`Stopped workspace: ${name}`))
}
```

**Step 5: Write `src/commands/destroy.ts`**

```typescript
import chalk from 'chalk'
import { execSync } from 'child_process'
import { loadConfig } from '../config.js'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { writeStatusDoc } from '../status-writer.js'
import { confirmDelete } from '../prompt.js'

export async function destroyCommand(name: string): Promise<void> {
  const root = process.cwd()
  const config = await loadConfig(root)
  const state = new StateManager(root)
  const wm = new WorktreeManager(root, `${root}/${config.workspacesDir}`)

  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }

  const confirmed = await confirmDelete(name)
  if (!confirmed) { console.log(chalk.gray('Aborted.')); return }

  for (const pid of Object.values(ws.pids)) {
    try { execSync(`kill ${pid}`) } catch { /* already gone */ }
  }

  await wm.remove(name)
  await state.remove(name)
  await writeStatusDoc(root, state, wm)
  console.log(chalk.red(`Destroyed workspace: ${name}`))
}
```

**Step 6: Replace `src/index.ts`**

```typescript
#!/usr/bin/env node
import { program } from 'commander'
import { openCommand } from './commands/open.js'
import { createCommand } from './commands/create.js'
import { listCommand } from './commands/list.js'
import { stopCommand } from './commands/stop.js'
import { destroyCommand } from './commands/destroy.js'

program
  .name('wtree')
  .description('Run multiple git worktrees in parallel with isolated ports')
  .version('0.1.0')

program.command('open <branch>').description('Open an existing branch as a workspace').action(openCommand)
program.command('create <name>').description('Create a new branch and workspace').option('--from <branch>', 'Base branch').action(createCommand)
program.command('list').description('Show all workspaces').action(listCommand)
program.command('stop <name>').description('Stop a workspace (keeps worktree)').action(stopCommand)
program.command('destroy <name>').description('Stop and delete a workspace (requires typing DELETE)').action(destroyCommand)

program.parse()
```

**Step 7: Build and verify**

```bash
npm run build && node dist/index.js --help
```

Expected: all 5 commands listed

**Step 8: Commit**

```bash
git add src/
git commit -m "feat: wire up all CLI commands"
```

---

## Task 10: README + push

**Files:**
- Create: `README.md`

**Step 1: Write `README.md`**

````markdown
# wtree

Run multiple git worktrees in parallel, each with its own full-stack environment on isolated ports.

## Install

```bash
npm install -g wtree
```

## Setup

Add `.wtree.json` to your project root:

```json
{
  "defaultBranch": "main",
  "portStep": 100,
  "services": [
    {
      "name": "frontend",
      "command": "pnpm dev",
      "cwd": "./frontend",
      "basePort": 3000,
      "portEnvVar": "PORT",
      "env": {
        "NEXT_PUBLIC_API_URL": "http://localhost:{backend.port}"
      }
    },
    {
      "name": "backend",
      "command": "uvicorn src.main:app --reload",
      "cwd": "./backend",
      "basePort": 8000,
      "portEnvVar": "PORT"
    }
  ]
}
```

Add to `.gitignore`:

```
.worktrees/
.wtree/state.json
```

## Commands

```bash
wtree open <branch>                # open an existing branch
wtree create <name>                # create new branch + workspace
wtree create <name> --from <base>  # branch off a specific base
wtree list                         # see all workspaces + ports
wtree stop <name>                  # stop processes, keep worktree
wtree destroy <name>               # stop + delete (requires typing DELETE)
```

## End-to-End Validation

```bash
# Terminal 1 — in your project root:
wtree open my-branch-1
# ✓ frontend → http://localhost:3100
# ✓ backend  → http://localhost:8100

# Terminal 2:
wtree open my-branch-2
# ✓ frontend → http://localhost:3200
# ✓ backend  → http://localhost:8200

wtree list
# ● my-branch-1  frontend:3100  backend:8100
# ● my-branch-2  frontend:3200  backend:8200

cat .wtree/STATUS.md
# Full status with commits and conflict warnings

# Open http://localhost:3100 and http://localhost:3200 — both load independently

# Cleanup:
wtree destroy my-branch-1
# ⚠️  Type DELETE to confirm: DELETE
# Destroyed workspace: my-branch-1
```
````

**Step 2: Final build and full test run**

```bash
npm run build && npm test
```

Expected: build succeeds, all tests pass

**Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: add README with setup and end-to-end validation checklist"
git push origin main
```

---

## Done

To install and test locally:

```bash
npm run build
npm install -g .
cd /path/to/your-project
wtree open your-branch
```
