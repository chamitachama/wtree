# wtree

Run multiple git worktrees in parallel, each with its own full-stack environment on isolated ports.

## Install

```bash
npm install -g wtree
```

## Setup

In your project root:

```bash
wtree init
```

Auto-detects services from Procfile, docker-compose, or package.json and writes `.wtree.json`. If nothing is detected, a commented template is written for you to fill in.

### Manual config

```json5
{
  // Default branch for new workspaces
  "defaultBranch": "main",

  // Port offset between workspaces (slot 1 = basePort+100, slot 2 = basePort+200)
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

Use `{service.port}` in env values to reference another service's assigned port.

## Commands

```bash
wtree init                         # detect services + write .wtree.json
wtree open <branch>                # open an existing branch as a workspace
wtree create <name>                # create new branch + workspace
wtree create <name> --from <base>  # branch off a specific base
wtree list                         # see all workspaces + ports
wtree stop <name>                  # stop processes, keep worktree
wtree destroy <name>               # stop + delete (requires typing DELETE)
```

## Example

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

# Cleanup:
wtree destroy my-branch-1
# ⚠️  Type DELETE to confirm: DELETE
# Destroyed workspace: my-branch-1
```
