# Hooks

great_cto uses [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) to enforce policies and capture state without manual intervention.

## What's wired

| Event | Matcher | Hook | What it does |
|---|---|---|---|
| `SessionStart` | — | inline (plugin.json) | Loads PROJECT.md, syncs agents/commands, primes context |
| `SessionEnd` | — | `session-end.mjs` | Writes session snapshot to `.great_cto/logs/`, seeds `brain.md`/`lessons.md` if missing, drops a `.learn-pending` marker |
| `PreToolUse` | `Bash` | inline | Blocks dangerous bash (rm -rf, force push, DROP TABLE, etc.) |
| `PreToolUse` | `Edit\|Write\|MultiEdit` | `secret-scan.mjs` | Blocks writes containing hardcoded API keys |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | inline + `format-check.mjs` | Logs writes + auto-formats by extension |
| `UserPromptSubmit` | — | `user-prompt-submit.py` + `cost-guard.mjs` | Sets session title + warns on expensive prompts |
| `PreCompact` | — | inline | Saves HANDOFF.md before context compaction |
| `SubagentStart` | — | inline | Injects project context to subagents |
| `PermissionDenied` | — | inline | Logs denials for diagnostics |

Source: `.claude-plugin/plugin.json`, scripts in `scripts/hooks/`.

## What each hook does

### `secret-scan.mjs`

Scans content of `Edit`, `Write`, and `MultiEdit` tool calls for hardcoded secrets (AWS keys, Stripe keys, GitHub PATs, OpenAI/Anthropic keys, PEM private keys, JWT tokens, etc.).

- **Blocks** the tool call (exit 2) on high-confidence detections
- **Warns** (stderr) on lower-confidence patterns like JWT tokens

**Skipped paths:** `tests/`, `fixtures/`, `*.test.*`, `*.spec.*`, `.example`, `.sample`, `.template`, `EXAMPLES.md`, `CHANGELOG.md`.

**Opt-out:**
```bash
# Disable for current session
export GREAT_CTO_DISABLE_SECRET_SCAN=1
```

Or per-file:
```typescript
// great_cto:allow-secrets
const TOK = "ghp_realToken...";  // intentional, e.g. tutorial code
```

See **ADR-014** for the full pattern catalogue.

### `format-check.mjs`

After `Edit`/`Write`/`MultiEdit`, auto-formats the file by extension if a matching tool is on PATH:

| Extensions | Formatter | Fallback |
|---|---|---|
| `.js .jsx .ts .tsx .mjs .cjs .json .md .yml` | `prettier` | — |
| `.py` | `ruff format` | `black` |
| `.go` | `gofmt -w` | — |
| `.rs` | `rustfmt` | — |

Failures are logged to `.great_cto/format.log`, never block.

**Opt-out:**
```bash
export GREAT_CTO_DISABLE_FORMAT=1
```

### `cost-guard.mjs`

Watches for prompts that trigger expensive operations (`/start`, `/audit`, "architect this", large refactors) and prints a cost estimate to stderr.

If `.great_cto/PROJECT.md` has a `cost-cap-usd-month: <N>` line and `.great_cto/cost-history.log` shows recent spend, also prints remaining budget and a warning if the operation would push you over.

Informational only — never blocks.

**Opt-out:**
```bash
export GREAT_CTO_DISABLE_COST_GUARD=1
```

### `session-end.mjs`

Captures a snapshot at session end:

- Git state (branch, last commit, uncommitted files, commits in last 8h)
- Beads state (open / blocked tasks)
- Recent cost log

Writes to `.great_cto/logs/session-YYYY-MM-DD-HHMM-end.md`.

It also:

- **Seeds `.great_cto/brain.md` and `.great_cto/lessons.md`** with honest
  placeholder content if they don't exist — so the board's memory tab is
  never a blank/missing file; the seeded file states how to populate it
  (`/digest` for brain, `/learn` for lessons).
- **Drops a `.great_cto/.learn-pending` marker** (only when the session
  did real work — commits or uncommitted changes) listing the session
  log. The next `SessionStart` reads it and prints
  `→ N session(s) not yet learned — run /learn`. `/learn` clears it.

It does **not** run the continuous-learner agent. A SessionEnd hook
executes in a sandbox with no access to the agent fleet, so it cannot do
the extraction — `lessons.md` is populated when the user runs `/learn`
(or `/save`). This hook only makes that need visible.

**Opt-out:**
```bash
export GREAT_CTO_DISABLE_SESSION_LEARNING=1
```

## Adding your own hook

1. Create `scripts/hooks/<your-hook>.mjs` reading JSON from stdin, exiting 0/2.
2. Register in `.claude-plugin/plugin.json` under the appropriate event:
   ```jsonc
   "PreToolUse": [
     {
       "matcher": "Edit|Write",
       "hooks": [
         {
           "type": "command",
           "command": "PLUGIN_DIR=$(...); node \"${PLUGIN_DIR}/scripts/hooks/your-hook.mjs\" 2>&1; exit $?",
           "timeout": 5,
           "statusMessage": "Running your-hook..."
         }
       ]
     }
   ]
   ```
3. Add tests in `tests/hooks/your-hook.test.mjs`.
4. Document here.

### Conventions

- Read JSON from `stdin`. Use `readFileSync(0, 'utf8')`.
- Exit 0 by default; exit 2 only in `PreToolUse` hooks that intend to block.
- Log to `.great_cto/<hook>.log` for debugging — never write to stdout (Claude Code interprets some stdout as control messages).
- Surface user-visible messages on stderr.
- Always wrap top-level logic in try/catch — a crashing hook breaks every session.
- Honor `GREAT_CTO_DISABLE_<NAME>=1` env var for per-feature opt-out.

## Disabling all hooks

If you need to disable everything at once (e.g. troubleshooting), uninstall the plugin temporarily:

```bash
# In Claude Code:
/plugin disable great_cto
```

Or set a master kill switch (env var consumed by all hooks):

```bash
export GREAT_CTO_DISABLE_HOOKS=1
```

> Note: the master kill switch is honored by all `*.mjs` hooks since v1.1.0 but
> not by inline shell hooks (which would require a plugin.json change).

## Testing hooks locally

```bash
# Run all hook tests
node --test tests/hooks/*.test.mjs

# Test a single hook with handcrafted input
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.ts","content":"AKIAIOSFODNN7EXAMPLE"}}' \
  | node scripts/hooks/secret-scan.mjs
echo "exit=$?"
# expected: exit=2 with stderr message
```

## Architecture

See:
- **ADR-013** — Hook execution model (why Node.mjs over bash, blocking vs non-blocking, etc.)
- **ADR-014** — Secret detection patterns (what we detect, why)
