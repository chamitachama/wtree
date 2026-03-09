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
