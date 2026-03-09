# browser / logs / claude Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three utility commands — `wtree browser`, `wtree logs`, and `wtree claude` — that make working with active workspaces faster.

**Architecture:** Each command reads workspace state from `StateManager`, then performs a focused action (open URL, tail log file, or launch Claude with context). A small change to `ProcessManager.start()` enables dual-pipe logging — output goes to both the terminal and a `.wtree/logs/<name>-<service>.log` file simultaneously, which `wtree logs` then tails.

**Tech Stack:** TypeScript, Node.js, child_process (spawn/execSync), fs streams

---

## Task 1: Dual-pipe logging in ProcessManager

**Files:**
- Modify: `src/processes.ts`
- Modify: `src/processes.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/processes.test.ts
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

it('writes process output to log file when logFile is provided', async () => {
  const logFile = '/tmp/wtree-test-process.log'
  await pm.start('log-test', 'echo hello-from-log', '/tmp', {}, logFile)
  await new Promise(r => setTimeout(r, 300))
  expect(existsSync(logFile)).toBe(true)
  expect(readFileSync(logFile, 'utf-8')).toContain('hello-from-log')
  try { unlinkSync(logFile) } catch {}
}, 5000)
```

Add `unlinkSync` to the import from `fs` at the top of the test file.

**Step 2: Run test — verify it fails**

```bash
cd /Users/Gen-Quint/Documents/coding/wtree/.worktrees/features
npm test
```

Expected: FAIL — `logFile` parameter not accepted

**Step 3: Update `src/processes.ts`**

```typescript
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'

export class ProcessManager {
  private procs = new Map<string, { pid: number; kill: () => void }>()

  constructor() {
    process.on('SIGINT', () => { this.stopAll(); process.exit(0) })
  }

  async start(
    id: string,
    command: string,
    cwd: string,
    env: Record<string, string>,
    logFile?: string
  ): Promise<number> {
    const useLog = !!logFile
    const child = spawn(command, [], {
      cwd,
      env: { ...process.env, ...env },
      stdio: useLog ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      shell: true,
    })
    if (!child.pid) throw new Error(`Failed to spawn process for "${id}"`)
    const pid = child.pid

    if (useLog && child.stdout && child.stderr) {
      await mkdir(dirname(logFile!), { recursive: true })
      const fileStream = createWriteStream(logFile!, { flags: 'a' })
      child.stdout.pipe(process.stdout)
      child.stdout.pipe(fileStream)
      child.stderr.pipe(process.stderr)
      child.stderr.pipe(fileStream)
    }

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

**Step 4: Update `src/commands/open.ts` and `src/commands/create.ts`**

In both files, pass a `logFile` to `pm.start()`. The `id` param is already `${name}:${service}` — derive the log path from it:

In `open.ts`, change:
```typescript
pids[service.name] = await pm.start(
  `${branch}:${service.name}`,
  service.command,
  cwd,
  { [service.portEnvVar]: String(port), ...resolveEnv(service.env, ports) }
)
```
To:
```typescript
const serviceId = `${branch}:${service.name}`
const logFile = `${root}/.wtree/logs/${serviceId.replace(':', '-')}.log`
pids[service.name] = await pm.start(
  serviceId,
  service.command,
  cwd,
  { [service.portEnvVar]: String(port), ...resolveEnv(service.env, ports) },
  logFile
)
```

Apply the same change in `create.ts` (use `name` instead of `branch`).

**Step 5: Run tests — verify passing**

```bash
npm test
```

Expected: PASS (43 existing + 1 new = 44 total)

**Step 6: Commit**

```bash
git add src/processes.ts src/processes.test.ts src/commands/open.ts src/commands/create.ts
git commit -m "feat: dual-pipe process output to terminal and log file"
```

---

## Task 2: wtree browser command

**Files:**
- Create: `src/commands/browser.ts`
- Create: `src/commands/browser.test.ts`

**Step 1: Write the failing test**

```typescript
// src/commands/browser.test.ts
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
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `browserCommand` not found

**Step 3: Write `src/commands/browser.ts`**

```typescript
import { execSync } from 'child_process'
import chalk from 'chalk'
import { StateManager } from '../state.js'

export async function browserCommand(name: string, cwd: string = process.cwd()): Promise<void> {
  const state = new StateManager(cwd)
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }
  if (ws.status === 'stopped') { console.error(chalk.red(`Workspace "${name}" is stopped`)); process.exit(1) }
  const port = Object.values(ws.ports)[0]
  const url = `http://localhost:${port}`
  console.log(chalk.blue(`Opening ${url}`))
  execSync(`open "${url}"`)
}
```

**Step 4: Run tests — verify passing**

```bash
npm test
```

Expected: PASS (44 + 2 = 46 total)

**Step 5: Commit**

```bash
git add src/commands/browser.ts src/commands/browser.test.ts
git commit -m "feat: add wtree browser command"
```

---

## Task 3: wtree logs command

**Files:**
- Create: `src/commands/logs.ts`
- Create: `src/commands/logs.test.ts`

**Step 1: Write the failing test**

Focus on the service-picker logic — the actual `tail -f` is not unit tested (it blocks).

```typescript
// src/commands/logs.test.ts
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
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `pickService` not found

**Step 3: Write `src/logs-picker.ts`**

```typescript
import * as readline from 'readline'
import chalk from 'chalk'

export function pickService(services: string[]): Promise<string> {
  if (services.length === 1) return Promise.resolve(services[0])
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    console.log(chalk.blue('Which service?'))
    services.forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
    rl.question('> ', answer => {
      rl.close()
      const idx = parseInt(answer.trim(), 10) - 1
      resolve(services[idx >= 0 && idx < services.length ? idx : 0])
    })
  })
}
```

**Step 4: Write `src/commands/logs.ts`**

```typescript
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { StateManager } from '../state.js'
import { pickService } from '../logs-picker.js'

export async function logsCommand(name: string, cwd: string = process.cwd()): Promise<void> {
  const state = new StateManager(cwd)
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }

  const serviceNames = Object.keys(ws.ports)
  const chosen = await pickService(serviceNames)
  const logFile = join(cwd, '.wtree', 'logs', `${name}-${chosen}.log`)

  if (!existsSync(logFile)) {
    console.error(chalk.red(`No log file found for "${chosen}". Is the workspace running?`))
    process.exit(1)
  }

  console.log(chalk.blue(`Tailing logs for ${chosen}...`))
  spawn('tail', ['-f', logFile], { stdio: 'inherit' })
}
```

**Step 5: Run tests — verify passing**

```bash
npm test
```

Expected: PASS (46 + 3 = 49 total)

**Step 6: Commit**

```bash
git add src/logs-picker.ts src/commands/logs.ts src/commands/logs.test.ts
git commit -m "feat: add wtree logs command with interactive service picker"
```

---

## Task 4: wtree claude command

**Files:**
- Create: `src/commands/claude.ts`
- Create: `src/commands/claude.test.ts`

**Step 1: Write the failing test**

Test the context string generation — not the actual claude spawn.

```typescript
// src/commands/claude.test.ts
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
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `buildContext` not found

**Step 3: Write `src/claude-context.ts`**

```typescript
import type { WorkspaceState } from './state.js'

export function buildContext(ws: WorkspaceState, changedFiles: string[]): string {
  const services = Object.entries(ws.ports)
    .map(([name, port]) => `${name} → http://localhost:${port}`)
    .join(', ')
  const lines = [
    `Workspace: ${ws.name} | Branch: ${ws.branch}`,
    `Services: ${services}`,
  ]
  if (changedFiles.length > 0) {
    lines.push(`Changed files vs ${ws.baseBranch}: ${changedFiles.join(', ')}`)
  }
  return lines.join('\n')
}
```

**Step 4: Write `src/commands/claude.ts`**

```typescript
import { spawn } from 'child_process'
import chalk from 'chalk'
import { StateManager } from '../state.js'
import { WorktreeManager } from '../worktree.js'
import { buildContext } from '../claude-context.js'
import { loadConfig } from '../config.js'

export async function claudeCommand(name: string, cwd: string = process.cwd()): Promise<void> {
  const state = new StateManager(cwd)
  const ws = await state.get(name)
  if (!ws) { console.error(chalk.red(`Workspace "${name}" not found`)); process.exit(1) }

  const config = await loadConfig(cwd)
  const wm = new WorktreeManager(cwd, `${cwd}/${config.workspacesDir}`)
  const changedFiles = await wm.getChangedFiles(ws.path, ws.baseBranch)
  const context = buildContext(ws, changedFiles)

  console.log(chalk.blue(`Launching Claude in ${ws.path}`))
  spawn('claude', ['--context', context], { cwd: ws.path, stdio: 'inherit' })
}
```

**Step 5: Run tests — verify passing**

```bash
npm test
```

Expected: PASS (49 + 4 = 53 total)

**Step 6: Commit**

```bash
git add src/claude-context.ts src/commands/claude.ts src/commands/claude.test.ts
git commit -m "feat: add wtree claude command with workspace context"
```

---

## Task 5: Register all commands + final build

**Files:**
- Modify: `src/index.ts`

**Step 1: Read `src/index.ts` then add imports and commands**

Add imports:
```typescript
import { browserCommand } from './commands/browser.js'
import { logsCommand } from './commands/logs.js'
import { claudeCommand } from './commands/claude.js'
```

Add commands before `program.parse()`:
```typescript
program.command('browser <name>').description('Open workspace frontend in browser').action(browserCommand)
program.command('logs <name>').description('Tail logs for a workspace service').action(logsCommand)
program.command('claude <name>').description('Launch Claude Code in workspace with context').action(claudeCommand)
```

**Step 2: Build and verify**

```bash
npm run build && node dist/index.js --help
```

Expected: `browser`, `logs`, `claude` all appear in command list

**Step 3: Run full test suite**

```bash
npm test
```

Expected: PASS (53 tests)

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: register browser, logs, and claude commands"
```
