# wtree — Design Document

**Date:** 2026-03-09
**Status:** Approved
**Repo:** https://github.com/chamitachama/wtree

---

## What It Is

`wtree` is a standalone CLI tool (npm package) that lets developers run multiple git worktrees in parallel, each with its own full-stack environment running on isolated ports. You can work on several fixes or features simultaneously without them interfering with each other.

---

## Core Flow

1. Add a `.wtree.json` config to your project describing how to start each service
2. Run `wtree open <branch>` or `wtree create <name>` in a terminal
3. `wtree` creates an isolated git worktree and starts all your services on available ports
4. Open another terminal and repeat for a different branch
5. Each workspace runs independently — different ports, different code, same machine

---

## Installation

```bash
npm install -g wtree
```

Then add `.wtree.json` to your project root.

---

## Config File (`.wtree.json`)

```json
{
  "defaultBranch": "main",
  "workspacesDir": ".worktrees",
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

- `defaultBranch` — base branch for new workspaces (can be overridden per command)
- `workspacesDir` — where worktrees are stored on disk
- `portStep` — port gap between workspaces (default: `100`). Workspace 1 gets `basePort + 100`, workspace 2 gets `basePort + 200`, etc.
- `services` — list of processes to start per workspace
- `basePort` — starting port for this service
- `portEnvVar` — environment variable injected so your app knows which port to use
- `env` — optional extra environment variables; use `{serviceName.port}` to reference another service's assigned port in the same workspace

## Port Allocation

With `portStep: 100` and two services:

| Workspace | frontend | backend |
|-----------|----------|---------|
| 1st       | 3100     | 8100    |
| 2nd       | 3200     | 8200    |
| 3rd       | 3300     | 8300    |

Easy to remember, and leaves room in case a service needs adjacent ports.

## Inter-Service Routing

Each workspace is fully self-contained. `wtree` resolves all `{service.port}` templates before launching any process, so services always talk to each other within the same workspace — never cross-workspace.

**Workspace 1 (`fix-login`) gets:**
```
PORT=3100
NEXT_PUBLIC_API_URL=http://localhost:8100
```

**Workspace 2 (`fix-payment`) gets:**
```
PORT=3200
NEXT_PUBLIC_API_URL=http://localhost:8200
```

---

## Commands

```bash
# Open an existing branch as a workspace
wtree open <branch-name>

# Create a new branch + workspace
wtree create <workspace-name>
wtree create <workspace-name> --from <base-branch>   # branch off any branch

# See all workspaces
wtree list

# Stop a workspace (keep worktree)
wtree stop <workspace-name>

# Delete a workspace entirely
wtree destroy <workspace-name>
```

---

## Parallel Workflow Example

```
Terminal 1:
$ wtree open fix/posthog-signup-funnel
✓ Worktree ready: fix/posthog-signup-funnel
✓ frontend → http://localhost:3001
✓ backend  → http://localhost:8001

Terminal 2:
$ wtree open chamitachama/multi-workspace-runner
✓ Worktree ready: chamitachama/multi-workspace-runner
✓ frontend → http://localhost:3002
✓ backend  → http://localhost:8002
```

---

## Port Management

- `wtree` scans for free ports automatically starting from `basePort + 1`
- No manual port configuration needed
- Port assignments are saved in `.wtree/state.json` so they persist across restarts
- All active port assignments are visible in `.wtree/STATUS.md`

---

## Status Document (`.wtree/STATUS.md`)

Auto-generated and kept up to date as you commit and work. No need to run commands to see it — just open it in your editor once.

```markdown
# Workspace Status
Last updated: 2026-03-09 14:32

## fix/posthog-signup-funnel · running · :3001 / :8001
Branch: fix/posthog-signup-funnel (from main)
Commits:
- abc123 fix: dedup error toast on payment success page
- def456 fix: add localStorage guard to SignupTracker
Files changed: 6

## chamitachama/multi-workspace-runner · running · :3002 / :8002
Branch: chamitachama/multi-workspace-runner (from main)
Commits:
- xyz789 feat: add dry-run runner support
- uvw012 feat: upload market data tool
Files changed: 14

---
## ⚠️ Conflict Risks
- fix/posthog-signup-funnel + chamitachama/multi-workspace-runner
  → frontend/src/components/Auth.tsx
```

---

## Conflict Detection

`wtree` watches commits across all active workspaces and compares changed files. When two workspaces modify the same file, it flags it in `STATUS.md` automatically. This gives you an early warning before you try to merge anything — no surprises.

---

## Internal File Structure

```
your-project/
├── .wtree/
│   ├── STATUS.md        ← live status document (auto-updated)
│   └── state.json       ← internal state (ports, PIDs, running workspaces)
├── .worktrees/
│   ├── fix-login/       ← isolated full copy of project
│   └── fix-payment/     ← another isolated full copy
└── .wtree.json          ← your config file
```

Add to `.gitignore`:
```
.worktrees/
.wtree/state.json
```

---

## Architecture

- **Language:** TypeScript
- **Runtime:** Node.js
- **Published:** npm (global install)
- **Git operations:** native `git` CLI via child processes
- **Service management:** Node.js child processes with output piping
- **File watching:** chokidar (watches for new commits to update STATUS.md)
- **Port scanning:** checks availability before assigning

---

## What's Out of Scope (v1)

- Web dashboard / UI
- Remote/SSH worktrees
- Automatic cherry-pick between workspaces
- Windows support (v1 is Mac/Linux only)
