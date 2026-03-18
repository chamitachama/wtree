# wtree

[![npm version](https://img.shields.io/npm/v/@chamitachama/wtree)](https://www.npmjs.com/package/@chamitachama/wtree)
[![npm downloads](https://img.shields.io/npm/dm/@chamitachama/wtree)](https://www.npmjs.com/package/@chamitachama/wtree)
[![license](https://img.shields.io/npm/l/@chamitachama/wtree)](https://github.com/chamitachama/wtree/blob/main/LICENSE)

Run multiple git worktrees in parallel, each with its own full-stack environment on isolated ports.

## Install

```bash
npm install -g @chamitachama/wtree
```

Or with aliases for convenience:
```bash
npm install -g @chamitachama/wtree
alias wtree='npx @chamitachama/wtree'
```

## Quick Start

```bash
wtree init                    # detect services + write .wtree.json
wtree open feature/my-branch  # start workspace with isolated ports
wtree list                    # see all workspaces
wtree stop my-branch          # stop processes, keep worktree
wtree destroy my-branch       # stop + delete worktree
```

## Setup

In your project root:

```bash
wtree init
```

Auto-detects services from `docker-compose.yml`, `Procfile`, or `package.json` and writes `.wtree.json`.

### What gets detected

- **App services** — ports, names, base commands
- **Infrastructure** — MongoDB, Redis, Postgres with host-mapped ports
- **Connection strings** — auto-generated for detected infra

## Configuration

### Full example

```json5
{
  "defaultBranch": "main",
  "workspacesDir": ".worktrees",
  "portStep": 100,

  // Copy .env files from main repo into each new worktree
  "envFiles": [
    { "path": "./backend/.env", "required": ["DATABASE_URL"] },
    "./frontend/.env"
  ],

  // Auto-detected from docker-compose (or configure manually)
  "infrastructure": {
    "mongodb": "mongodb://localhost:27018",
    "redis": "redis://localhost:6380"
  },

  // Run once when worktree is first created
  "setup": [
    { "command": "pnpm install --frozen-lockfile", "cwd": "." },
    { "command": "poetry install", "cwd": "./backend" }
  ],

  "services": [
    {
      "name": "backend",
      "command": "uvicorn src.main:app --reload",
      "cwd": "./backend",
      "basePort": 8000,
      "portEnvVar": "PORT",
      "shared": true,  // Single instance for all worktrees
      "env": {
        "DATABASE_URL": "{infrastructure.mongodb}",
        "REDIS_URL": "{infrastructure.redis}"
      }
    },
    {
      "name": "frontend",
      "command": "pnpm dev",
      "cwd": "./frontend",
      "basePort": 3000,
      "portEnvVar": "PORT",
      "shared": false,  // One per worktree (default)
      "env": {
        "NEXT_PUBLIC_API_URL": "http://localhost:{backend.port}"
      }
    }
  ]
}
```

### Template variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{service.port}` | Another service's assigned port | `http://localhost:{backend.port}` |
| `{infrastructure.<type>}` | Infrastructure connection string | `{infrastructure.mongodb}` |

### Port allocation

Each workspace gets a slot (1, 2, 3...). Actual port = `basePort + (slot × portStep)`.

| Workspace | Slot | frontend | backend |
|-----------|------|----------|---------|
| feature-a | 1    | 3100     | 8100    |
| feature-b | 2    | 3200     | 8200    |

### Shared services

Mark a service as `shared: true` to run a single global instance instead of one per worktree:

```json5
"services": [
  { "name": "backend", "shared": true, "basePort": 8000, ... },  // one instance
  { "name": "frontend", "basePort": 3000, ... }  // per worktree
]
```

- Shared services run from the main repo root (not the worktree)
- Use fixed `basePort` (no slot offset)
- Start once, reused across all worktrees
- Not stopped when individual worktrees stop
- `wtree init` asks interactively which services to share

## Commands

### Workspace management

```bash
wtree init                         # Detect services, write .wtree.json
wtree open <branch>                # Open existing branch as workspace
wtree open <branch> --skip-setup   # Skip setup commands (deps already installed)
wtree create <name>                # Create new branch + workspace
wtree create <name> --from <base>  # Branch off a specific base
wtree create <name> --skip-setup   # Skip setup commands
wtree list                         # Show all workspaces + ports
wtree stop <name>                  # Stop processes, keep worktree
wtree destroy <name>               # Stop + delete (requires typing DELETE)
```

### Utilities

```bash
wtree browser <name>    # Open workspace frontend in browser
wtree logs <name>       # Tail logs for a workspace
wtree claude <name>     # Launch Claude Code in workspace context
wtree sync-env <name>   # Sync env vars from base to worktree
```

## Features

### 🔐 Environment files

Copy `.env` files from your main repo into each worktree automatically:

```json5
// Simple format
"envFiles": ["./backend/.env", "./frontend/.env"]

// With required vars verification
"envFiles": [
  { "path": "./backend/.env", "required": ["DATABASE_URL", "REDIS_URL"] },
  { "path": "./frontend/.env", "required": ["NEXT_PUBLIC_API_URL"] }
]
```

- Copies on first `open` or `create`
- **Syncs new vars** on subsequent opens (appends missing vars without overwriting)
- Skips if file doesn't exist in main repo (warning)
- Warns if required vars are missing
- Use `wtree sync-env <name>` to sync on demand

### 📦 Setup commands

Run install/build commands when a worktree is first created:

```json5
"setup": [
  { "command": "pnpm install", "cwd": "." },
  { "command": "poetry install", "cwd": "./backend" }
]
```

- Runs sequentially (order matters)
- Creates `.wtree-setup-done` marker to avoid re-running
- Use `--skip-setup` to bypass

### 🐳 Infrastructure detection

`wtree init` parses `docker-compose.yml` to find infrastructure services:

```
📦 Detected infrastructure services:
  • mongodb (mongodb) → localhost:27018
  • redis (redis) → localhost:6380

💡 Tip: Use {infrastructure.<type>} in service env vars
```

Supported: MongoDB, Redis, PostgreSQL, MySQL, RabbitMQ

### ♻️ Workspace reuse

When you `stop` a workspace and later `open` it again, wtree reuses the same slot and ports instead of creating duplicates.

## Example workflow

```bash
# Setup (once)
wtree init
# 📋 Detected services:
#   • backend (port 8000)
#   • frontend (port 3000)
# 
# Share backend across all worktrees? (y/N) y
# Share frontend across all worktrees? (y/N) n
#
# ✓ backend → port 8000 [shared]
# ✓ frontend → port 3000
# ✓ Wrote .wtree.json

# Daily workflow
wtree open feat/LON-123-new-feature
# 🔐 Copying .env files...
#   ✓ ./backend/.env
#     ✓ All required vars present (1)
# 📦 Running setup commands...
#   → pnpm install (in .)
# ✓ backend → http://localhost:8000 (shared)
# ✓ frontend → http://localhost:3100

# Work on another feature in parallel
wtree open feat/LON-456-hotfix
# ↳ backend → http://localhost:8000 (shared, already running)
# ✓ frontend → http://localhost:3200

# Check status
wtree list
# ● feat-LON-123-new-feature  frontend:3100
# ● feat-LON-456-hotfix       frontend:3200
# ◆ backend (shared)          :8000

# Done with a feature
wtree destroy feat-LON-123-new-feature
# ⚠️  Type DELETE to confirm: DELETE
# Destroyed workspace (shared services kept running)
```

## Files

| Path | Description |
|------|-------------|
| `.wtree.json` | Configuration file |
| `.wtree/state.json` | Active workspaces state |
| `.wtree/logs/` | Service log files |
| `.wtree/STATUS.md` | Human-readable status doc |
| `.worktrees/` | Git worktree directories |

Add to `.gitignore`:
```
.worktrees/
.wtree/state.json
```

## License

MIT
