# wtree init Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `wtree init` command that auto-detects project services and writes a `.wtree.json` config file, so users never have to create it manually.

**Architecture:** A `detect.ts` module scans known project files (Procfile, docker-compose.yml, package.json, pyproject.toml/requirements.txt) in priority order and returns detected services. The `init` command uses the detector, handles existing config override, writes `.wtree.json` (or a commented template on fallback), and appends required entries to `.gitignore`. Switch config parsing from `JSON.parse` to `json5` so the template's `//` comments remain valid when users edit the file.

**Tech Stack:** TypeScript, Node.js, json5 (comment-aware JSON parser), js-yaml (docker-compose parsing)

---

## Task 1: Switch config parser to json5

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts` (no test changes needed — existing tests still pass)

**Step 1: Install json5**

```bash
cd /Users/Gen-Quint/Documents/coding/wtree/.worktrees/implement
npm install json5
npm install -D @types/json5
```

**Step 2: Update `src/config.ts` to use json5**

Replace the `JSON.parse` call:

```typescript
import { readFile } from 'fs/promises'
import { join } from 'path'
import JSON5 from 'json5'

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
    const parsed = JSON5.parse(raw)
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

**Step 3: Run tests — verify still passing**

```bash
npm test
```

Expected: PASS (28 tests, same as before)

**Step 4: Commit**

```bash
git add src/config.ts package.json package-lock.json
git commit -m "feat: switch config parser to json5 to support commented .wtree.json"
```

---

## Task 2: Service detector module

**Files:**
- Create: `src/detect.ts`
- Create: `src/detect.test.ts`
- Install: `js-yaml` + `@types/js-yaml`

**Step 1: Install js-yaml**

```bash
npm install js-yaml
npm install -D @types/js-yaml
```

**Step 2: Write the failing test**

```typescript
// src/detect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { detectServices } from './detect.js'

const TMP = '/tmp/wtree-test-detect'
beforeEach(() => mkdirSync(TMP, { recursive: true }))
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('detectServices', () => {
  it('detects npm dev script from package.json', async () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }))
    const services = await detectServices(TMP)
    expect(services).not.toBeNull()
    expect(services![0].name).toBe('app')
    expect(services![0].command).toBe('npm run dev')
    expect(services![0].basePort).toBe(3000)
  })

  it('falls back to npm start if no dev script', async () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }))
    const services = await detectServices(TMP)
    expect(services![0].command).toBe('npm start')
  })

  it('detects python from pyproject.toml', async () => {
    writeFileSync(join(TMP, 'pyproject.toml'), '[tool.poetry]\nname = "app"')
    const services = await detectServices(TMP)
    expect(services![0].command).toBe('uvicorn main:app --reload')
    expect(services![0].basePort).toBe(8000)
  })

  it('detects python from requirements.txt', async () => {
    writeFileSync(join(TMP, 'requirements.txt'), 'fastapi\nuvicorn')
    const services = await detectServices(TMP)
    expect(services![0].command).toBe('uvicorn main:app --reload')
  })

  it('detects services from Procfile', async () => {
    writeFileSync(join(TMP, 'Procfile'), 'web: npm start\nworker: node worker.js')
    const services = await detectServices(TMP)
    expect(services).toHaveLength(2)
    expect(services![0].name).toBe('web')
    expect(services![0].command).toBe('npm start')
    expect(services![1].name).toBe('worker')
  })

  it('detects services from docker-compose.yml', async () => {
    writeFileSync(join(TMP, 'docker-compose.yml'), [
      'services:',
      '  frontend:',
      '    ports: ["3000:3000"]',
      '  backend:',
      '    ports: ["8000:8000"]',
    ].join('\n'))
    const services = await detectServices(TMP)
    expect(services).toHaveLength(2)
    expect(services![0].name).toBe('frontend')
    expect(services![0].basePort).toBe(3000)
  })

  it('returns null when nothing detected', async () => {
    expect(await detectServices(TMP)).toBeNull()
  })
})
```

**Step 3: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `detectServices` not found

**Step 4: Write `src/detect.ts`**

```typescript
import { readFile } from 'fs/promises'
import { join } from 'path'
import yaml from 'js-yaml'

export interface DetectedService {
  name: string
  command: string
  basePort: number
}

async function tryRead(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8') } catch { return null }
}

async function detectFromProcfile(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'Procfile'))
  if (!raw) return null
  const services = raw.trim().split('\n')
    .map(line => line.match(/^(\w+):\s*(.+)$/))
    .filter(Boolean)
    .map((m, i) => ({
      name: m![1],
      command: m![2].trim(),
      basePort: m![1] === 'web' ? 3000 : 8000 + i * 100,
    }))
  return services.length > 0 ? services : null
}

async function detectFromDockerCompose(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'docker-compose.yml'))
  if (!raw) return null
  try {
    const doc = yaml.load(raw) as Record<string, unknown>
    const services = doc?.services as Record<string, { ports?: string[] }> | undefined
    if (!services) return null
    const result = Object.entries(services).map(([name, svc]) => {
      const portStr = svc.ports?.[0] ?? '3000:3000'
      const basePort = parseInt(portStr.split(':')[0], 10) || 3000
      return { name, command: `# fill in start command for ${name}`, basePort }
    })
    return result.length > 0 ? result : null
  } catch { return null }
}

async function detectFromPackageJson(cwd: string): Promise<DetectedService[] | null> {
  const raw = await tryRead(join(cwd, 'package.json'))
  if (!raw) return null
  try {
    const pkg = JSON.parse(raw)
    const scripts = pkg.scripts ?? {}
    if (scripts.dev) return [{ name: 'app', command: 'npm run dev', basePort: 3000 }]
    if (scripts.start) return [{ name: 'app', command: 'npm start', basePort: 3000 }]
  } catch { /* ignore */ }
  return null
}

async function detectFromPython(cwd: string): Promise<DetectedService[] | null> {
  const hasPyproject = await tryRead(join(cwd, 'pyproject.toml'))
  const hasRequirements = await tryRead(join(cwd, 'requirements.txt'))
  if (hasPyproject || hasRequirements) {
    return [{ name: 'app', command: 'uvicorn main:app --reload', basePort: 8000 }]
  }
  return null
}

export async function detectServices(cwd: string): Promise<DetectedService[] | null> {
  return (
    await detectFromProcfile(cwd) ??
    await detectFromDockerCompose(cwd) ??
    await detectFromPackageJson(cwd) ??
    await detectFromPython(cwd)
  )
}
```

**Step 5: Run test — verify it passes**

```bash
npm test
```

Expected: PASS (35 total — 28 existing + 7 new)

**Step 6: Commit**

```bash
git add src/detect.ts src/detect.test.ts package.json package-lock.json
git commit -m "feat: add service detector (package.json, pyproject, Procfile, docker-compose)"
```

---

## Task 3: Init command

**Files:**
- Create: `src/commands/init.ts`
- Create: `src/commands/init.test.ts`
- Modify: `src/index.ts`

**Step 1: Write the failing test**

```typescript
// src/commands/init.test.ts
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
```

**Step 2: Run test — verify it fails**

```bash
npm test
```

Expected: FAIL — `initCommand` not found

**Step 3: Write `src/commands/init.ts`**

```typescript
import { readFile, writeFile, appendFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import * as readline from 'readline'
import chalk from 'chalk'
import { detectServices } from '../detect.js'

const TEMPLATE = `{
  // Default branch for new workspaces
  "defaultBranch": "main",

  // Port offset between workspaces: slot 1 = basePort+100, slot 2 = basePort+200
  "portStep": 100,

  // Services to start in every workspace
  "services": [
    {
      // Unique name shown in wtree list
      "name": "frontend",

      // Command to start this service
      "command": "npm run dev",

      // Directory to run the command from (relative to worktree root)
      "cwd": ".",

      // Base port — actual port = basePort + (slot * portStep)
      "basePort": 3000,

      // Env var the service reads for its port
      "portEnvVar": "PORT",

      // Optional extra env vars. Use {service.port} to reference another service's assigned port.
      // "env": { "NEXT_PUBLIC_API_URL": "http://localhost:{backend.port}" }
      "env": {}
    }
  ]
}
`

function ask(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
  })
}

async function updateGitignore(cwd: string): Promise<void> {
  const path = join(cwd, '.gitignore')
  const existing = existsSync(path) ? await readFile(path, 'utf-8') : ''
  const toAdd = ['.worktrees/', '.wtree/state.json'].filter(e => !existing.includes(e))
  if (toAdd.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    await appendFile(path, prefix + toAdd.join('\n') + '\n')
  }
}

export async function initCommand(cwd: string = process.cwd()): Promise<void> {
  const configPath = join(cwd, '.wtree.json')

  if (existsSync(configPath)) {
    const answer = await ask(chalk.yellow('Worktree config already exists. Override? (y/N) '))
    if (answer.toLowerCase() !== 'y') { console.log(chalk.gray('Aborted.')); return }
  }

  const services = await detectServices(cwd)

  if (services) {
    const config = {
      defaultBranch: 'main',
      portStep: 100,
      services: services.map(s => ({
        name: s.name,
        command: s.command,
        cwd: '.',
        basePort: s.basePort,
        portEnvVar: 'PORT',
        env: {},
      })),
    }
    await writeFile(configPath, JSON.stringify(config, null, 2))
    for (const s of services) {
      console.log(chalk.green(`✓ Detected: ${s.name} (${s.command} → port ${s.basePort})`))
    }
  } else {
    await writeFile(configPath, TEMPLATE)
    console.log(chalk.yellow('✓ No services detected — wrote template .wtree.json'))
    console.log(chalk.gray('  Edit it to add your services, then run: wtree open <branch>'))
  }

  await updateGitignore(cwd)
  console.log(chalk.green('✓ Wrote .wtree.json'))
  console.log(chalk.green('✓ Updated .gitignore'))
  console.log(chalk.blue('→ Run: wtree open <branch>'))
}
```

**Step 4: Register command in `src/index.ts`**

Add to imports:
```typescript
import { initCommand } from './commands/init.js'
```

Add command (before `program.parse()`):
```typescript
program.command('init').description('Set up wtree in the current project').action(initCommand)
```

**Step 5: Run tests — verify all pass**

```bash
npm test
```

Expected: PASS (41 total — 35 existing + 6 new)

**Step 6: Build and verify**

```bash
npm run build && node dist/index.js --help
```

Expected: `init` appears in the command list

**Step 7: Commit**

```bash
git add src/commands/init.ts src/commands/init.test.ts src/index.ts
git commit -m "feat: add wtree init command with auto-detection and commented template"
```

---

## Manual Test

```bash
npm run build && npm install -g .
cd /tmp && mkdir test-project && cd test-project
git init && echo '{"scripts":{"dev":"echo hello"}}' > package.json
wtree init
# ✓ Detected: app (npm run dev → port 3000)
# ✓ Wrote .wtree.json
# ✓ Updated .gitignore
cat .wtree.json
```
