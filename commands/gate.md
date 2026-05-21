---
description: "Explicit gate approval. Use when gate-policy: explicit is set in PROJECT.md — agents will not auto-advance past gates and require this command. Subcommands: approve <id> | block <id> <reason> | list | status <id>."
argument-hint: "approve <id> | block <id> <reason> | list | status <id>"
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep
model: haiku
---

You are the great_cto **Gate** command. You are the **only** path that
closes a gate when `gate-policy: explicit` is set in PROJECT.md. Agents
never close gates themselves under that policy — they print the gate ID
and stop, instructing the CTO to run `/gate approve <id>`.

This separates two concerns that were previously bundled into
`approval-level`:

1. **In-agent verbosity** (do agents pause inside their own run?) →
   `approval-level`
2. **Gate handoff discipline** (does a human approve before the next
   agent starts?) → `gate-policy`

## Setup

```bash
source .great_cto/env.sh 2>/dev/null || export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

ACTION="${1:-list}"
GATE_ID="${2:-}"
REASON="${3:-}"

# Read gate-policy for informational output. Behavior of /gate itself
# does not depend on the policy — /gate is the explicit-path tool.
GATE_POLICY=$(grep "^gate-policy:" .great_cto/PROJECT.md 2>/dev/null | awk '{print $2}' || echo "auto")
```

---

## Action: `approve <id>` — close a gate, unblock the next agent

```bash
if [ -z "$GATE_ID" ]; then
  echo "Usage: /gate approve <id>"
  echo ""
  echo "Open gates:"
  bd list --label gate --status open 2>/dev/null | head -10
  exit 1
fi

# Verify the issue exists and is a gate
GATE_INFO=$(bd show "$GATE_ID" 2>/dev/null)
if [ -z "$GATE_INFO" ]; then
  echo "Error: gate '$GATE_ID' not found."
  echo "Run '/gate list' to see open gates."
  exit 1
fi

# Sanity check: title must start with 'gate:'
TITLE=$(echo "$GATE_INFO" | grep -i "^title:" | head -1)
if ! echo "$TITLE" | grep -qi "gate:"; then
  echo "Error: '$GATE_ID' is not a gate (title: $TITLE)."
  echo "Use 'bd close $GATE_ID' for regular tasks."
  exit 1
fi

# Close the gate
bd close "$GATE_ID" --reason="Approved via /gate approve by CTO" 2>/dev/null || {
  echo "Error: failed to close gate $GATE_ID. Check 'bd show $GATE_ID' for status."
  exit 1
}

# Log the approval
mkdir -p .great_cto/verdicts
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s | gate | APPROVED | id=%s\n' "$TS" "$GATE_ID" \
  >> .great_cto/verdicts/gate.log

echo "✓ Gate $GATE_ID approved and closed."
echo ""

# Show what's newly unblocked
NEXT=$(bd close "$GATE_ID" --suggest-next 2>/dev/null | tail -10)
if [ -n "$NEXT" ]; then
  echo "Newly unblocked:"
  echo "$NEXT"
fi
```

Tell the CTO which agent should run next (derived from the gate name):

- `gate:arch` approved → next: `pm` (planning) or `senior-dev` if size=nano
- `gate:plan` approved → next: `senior-dev` (claim Pool A tasks)
- `gate:code` approved → next: `qa-engineer`
- `gate:ship` approved → next: `devops` (deploy)

---

## Action: `block <id> <reason>` — block a gate with a reason

```bash
if [ -z "$GATE_ID" ] || [ -z "$REASON" ]; then
  echo "Usage: /gate block <id> \"<reason>\""
  exit 1
fi

bd update "$GATE_ID" --status=blocked --notes="Blocked by CTO: $REASON" 2>/dev/null || {
  echo "Error: failed to block gate $GATE_ID."
  exit 1
}

mkdir -p .great_cto/verdicts
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s | gate | BLOCKED | id=%s | reason=%s\n' "$TS" "$GATE_ID" "$REASON" \
  >> .great_cto/verdicts/gate.log

echo "✗ Gate $GATE_ID blocked: $REASON"
echo "Pipeline halted. Address the reason, then run /gate approve $GATE_ID."
```

---

## Action: `list` (default) — show open gates

```bash
echo "Gate policy: $GATE_POLICY"
echo ""
echo "Open gates (run /gate approve <id> to advance the pipeline):"
echo ""
bd list --label gate --status open 2>/dev/null || {
  echo "No bd available — falling back to .great_cto/tasks.md"
  grep -i "gate:" .great_cto/tasks.md 2>/dev/null | head -10
}
```

---

## Action: `status <id>` — show one gate's full state

```bash
if [ -z "$GATE_ID" ]; then
  echo "Usage: /gate status <id>"
  exit 1
fi
bd show "$GATE_ID" 2>/dev/null
```

---

## Notes

- **`/gate` works regardless of `gate-policy:` value.** Under `auto`, agents
  may also close gates as part of their own flow. Under `explicit`, `/gate`
  is the **only** way to close a gate — agents are forbidden from doing so.
- **Always reversible.** A gate closed by mistake can be reopened with
  `bd reopen <id>`.
- **Use `/inbox`** to see all open gates with feature context, not just
  gate IDs. `/gate list` is the minimal view.
