# wtree browser / logs / claude — Design

## Goal

Add three utility commands that make working with active workspaces faster:
- `wtree browser <name>` — open the workspace frontend in the browser
- `wtree logs <name>` — tail service logs for a workspace
- `wtree claude <name>` — launch Claude Code in the worktree with workspace context

## Commands

### wtree browser \<name\>

- Look up workspace by name in state
- Error if not found or status is `stopped`
- Open `http://localhost:<firstService.port>` using `open` (macOS) or `xdg-open` (Linux)
- First service = `config.services[0]`

### wtree logs \<name\>

- Look up workspace by name in state
- If one service → tail its log file directly
- If multiple services → numbered interactive prompt:
  ```
  Which service?
  1. frontend (port 3100)
  2. backend  (port 8100)
  ```
  Then tail the chosen log
- Log files live at `.wtree/logs/<workspaceName>-<serviceName>.log`
- Uses `tail -f` via `spawn` with `stdio: 'inherit'`

### wtree claude \<name\>

- Look up workspace by name in state
- Error if not found
- Build context string:
  ```
  Workspace: <name> | Branch: <branch>
  Services: <service> → http://localhost:<port>, ...
  Changed files vs <baseBranch>: <file1>, <file2>, ...
  ```
- `spawn('claude', ['--context', contextString], { cwd: worktreePath, stdio: 'inherit' })`

## ProcessManager changes (required for logs)

Modify `ProcessManager.start()` to pipe child stdout/stderr to **both** the terminal and a log file simultaneously — preserving existing terminal feedback.

```
child.stdout → pipe → process.stdout + fileWriteStream
child.stderr → pipe → process.stderr + fileWriteStream
```

- Log path: `.wtree/logs/<id>.log` where `id` is the existing `<name>:<service>` param (replace `:` with `-`)
- `stdio: 'inherit'` → `stdio: ['inherit', 'pipe', 'pipe']`
- Create `.wtree/logs/` dir if needed

## Files

- Create: `src/commands/browser.ts`
- Create: `src/commands/logs.ts`
- Create: `src/commands/claude.ts`
- Modify: `src/processes.ts` (dual-pipe logging)
- Modify: `src/index.ts` (register 3 new commands)

## Out of Scope

- Log rotation
- Following multiple services simultaneously
- Browser command on Linux (just `open` for now, skip `xdg-open`)
