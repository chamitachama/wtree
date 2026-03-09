# wtree init — Design

## Goal

Add a `wtree init` command that auto-detects project services and writes `.wtree.json`, so users never need to create config manually.

## Behaviour

### Flow

1. Check for existing `.wtree.json`
   - If found: prompt `"Worktree config already exists. Override? (y/N)"`
   - If user declines: exit with no changes
2. Run detectors in priority order (stop at first match):
   - **Procfile** — each line (`web: <cmd>`) becomes a service
   - **docker-compose.yml** — each service + its first exposed port
   - **package.json** — looks for `dev` or `start` in scripts; default port 3000
   - **pyproject.toml / requirements.txt** — suggests `uvicorn main:app --reload`; default port 8000
3. If detection succeeded: write `.wtree.json` with detected services
4. If nothing detected: write a heavily-commented template `.wtree.json`
5. Append `.worktrees/` and `.wtree/state.json` to `.gitignore` if not already present
6. Print confirmation and next steps

### Output

```
# detected case
✓ Detected: package.json (dev → port 3000)
✓ Wrote .wtree.json
✓ Updated .gitignore
→ Run: wtree open <branch>

# fallback (template) case
✓ No services detected — wrote template .wtree.json
✓ Edit it to add your services, then run: wtree open <branch>
```

### Commented Template (fallback)

```json
{
  // Default branch to use when creating new workspaces
  "defaultBranch": "main",

  // How much to offset ports between workspaces (slot 1 = base+100, slot 2 = base+200)
  "portStep": 100,

  // List your services here. Each one will be started in every workspace.
  "services": [
    {
      // Unique name for this service
      "name": "frontend",

      // Command to start the service
      "command": "npm run dev",

      // Subdirectory to run the command from (use "." for project root)
      "cwd": ".",

      // Base port — actual port = basePort + (slot * portStep)
      "basePort": 3000,

      // Environment variable the service reads for its port
      "portEnvVar": "PORT",

      // Optional env vars. Use {service.port} to reference another service's port.
      "env": {
        // "NEXT_PUBLIC_API_URL": "http://localhost:{backend.port}"
      }
    }
  ]
}
```

## Files

- Create: `src/commands/init.ts`
- Modify: `src/index.ts` (register `init` command)

## Detection Logic

| File | What to read | Service name | Command | Default port |
|------|-------------|--------------|---------|-------------|
| `Procfile` | Each `name: cmd` line | line key | line value | 3000 (web), 8000 (others) |
| `docker-compose.yml` | `services` map + `ports` | service key | (omitted, user fills) | first exposed port |
| `package.json` | `scripts.dev` or `scripts.start` | `app` | `npm run dev` or `npm start` | 3000 |
| `pyproject.toml` | presence only | `app` | `uvicorn main:app --reload` | 8000 |
| `requirements.txt` | presence only | `app` | `uvicorn main:app --reload` | 8000 |

## Out of Scope

- Recursive monorepo scanning
- Interactive prompts for unknown stacks
- Validation of detected commands
