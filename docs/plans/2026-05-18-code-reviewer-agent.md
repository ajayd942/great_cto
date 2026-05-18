# code-reviewer Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `code-reviewer` pipeline agent that reviews `senior-dev`'s diff for craft, correctness, and a light security/perf sniff — as a blocking gate before `qa-engineer`.

**Architecture:** A new agent prompt file `agents/code-reviewer.md`, modelled structurally on `agents/qa-engineer.md` (post-implementation agent: phase-task tracking → skill browse → read-the-diff → review → write report → file Beads bugs → emit verdict). Registered in the plugin's SessionStart hook and the skill-discovery registry. No pipeline-order edit needed — `SKILL.md:179` already lists `code-reviewer` between `senior-dev` and `qa-engineer`.

**Tech Stack:** Markdown agent definition (YAML frontmatter + prose body), `plugin.json` hook, bash (`skill-discover.sh`), Node test runner, Python structural tests.

**Reference docs:**
- Design: `docs/plans/2026-05-18-code-reviewer-agent-design.md`
- Template agent: `agents/qa-engineer.md` (closest analogue — post-impl, blocking, files bugs)
- Reviewer tone: `agents/cli-reviewer.md`
- Verdict convention: `agents/_shared/verdict-format.md`
- "How to add an agent": the 5-touchpoint checklist established earlier this session

---

## Task 1: Create the `code-reviewer` agent file

**Files:**
- Create: `agents/code-reviewer.md`

**Step 1: Write the frontmatter (exact)**

```yaml
---
name: code-reviewer
description: Use after senior-dev completes a task, before qa-engineer. Reviews the implementation diff for design quality, correctness, and a light security/perf sniff. Blocking gate — emits PASS/FAIL.
model: sonnet
advisor-model: claude-opus-4-7
advisor-max-uses: 2
beta: advisor-tool-2026-03-01
tools: Read, Write, Bash, Glob, Grep, WebFetch, advisor_20260301, memory_20250929, mcp__great_cto_llm_router__ask_kimi
maxTurns: 35
timeout: 900
effort: HIGH
memory: project
color: green
skills:
  - davila7-find-bugs
  - simplify
  - architecture-patterns
  - skeptical-triage
  - superpowers:systematic-debugging
  - superpowers:verification-before-completion
  - java-junit
  - postgresql-optimization
  - vercel-react-best-practices
  - fastapi-python
  - spring-boot-testing
  - beads
  - done-blocked
  - prose-style
---
```

**Step 2: Write the body sections**

Mirror `agents/qa-engineer.md`'s section structure. Required sections, in order:

1. **Intro** — one paragraph: "You are the Code Reviewer. You are the first agent
   to read senior-dev's diff as *code*. qa-engineer owns behaviour, security-officer
   owns vulnerabilities — you own craft and correctness."
2. **Phase task tracking (mandatory)** — copy the block verbatim from
   `qa-engineer.md` lines ~29-50, changing the agent name to `code-reviewer`.
3. **When you're invoked** — after senior-dev closes an implementation task;
   before qa-engineer; on every feature (not archetype-gated).
4. **Skeptical Triage (when to apply)** — apply `skills/skeptical-triage/SKILL.md`
   to borderline Critical/High findings before failing the gate (avoid
   false-blocking on style nitpicks).
5. **Review scope — three tiers** — copy the design's three-tier scope verbatim
   (Craft / Correctness / Security-perf flag-and-defer). Include the explicit
   "do NOT deep-audit security or performance — record and hand off" rule.
6. **Workflow**:
   - Step 0: read archetype from `.great_cto/PROJECT.md`; locate the diff
     (`git diff` against the base branch / the senior-dev worktree).
   - Step 1: read the changed files + their tests + the ARCH/ADR docs they
     implement.
   - Step 2: review against the three tiers; for stack-specific files invoke the
     matching skill (java-junit, fastapi-python, etc.).
   - Step 3: write `docs/code-reviews/CR-{slug}.md` — findings grouped
     Critical / High / Medium / Low, each with `file:line` + a concrete fix
     suggestion.
   - Step 4: file Beads bugs — Critical/High AND Medium/Low — labelled
     `feature-{slug}` + `code-review`.
   - Step 5: emit verdict (next section).
7. **Verdict rules** —
   - `VERDICT: FAIL` if ≥1 Critical or High finding → routes back to senior-dev.
   - `VERDICT: PASS` otherwise (Medium/Low filed as bugs, pipeline continues).
   - Log via `bash scripts/log-verdict.sh code-reviewer <APPROVED|REJECTED> <cost> feature=<slug> cr=docs/code-reviews/CR-<slug>.md`
     — use `APPROVED` for PASS, `REJECTED` for FAIL (matches `verdict-format.md`).
8. **Reporting Contract** — terminate with a DONE or BLOCKED line per
   `skills/done-blocked/SKILL.md`.
9. **Writing Style** — prose-style note, same as qa-engineer lines ~118-127.

Keep the body in the 250-450 line range — comparable to `cli-reviewer.md`, lighter than `qa-engineer.md`.

**Step 3: Verify the file parses**

Run: `awk '/^---$/{c++} c>=2{exit} {print}' agents/code-reviewer.md | head -20`
Expected: clean YAML frontmatter, all 14 skills listed.

**Step 4: Commit**

```bash
git add agents/code-reviewer.md
git commit -m "feat: add code-reviewer agent definition"
```

---

## Task 2: Register code-reviewer in the SessionStart hook

**Files:**
- Modify: `.claude-plugin/plugin.json` (the `for AGENT in ...` loop in the SessionStart hook command)

**Step 1: Locate the loop**

Run: `grep -o 'for AGENT in [^;]*' .claude-plugin/plugin.json`
Expected: a space-separated agent list starting `architect senior-dev qa-engineer ...`.

**Step 2: Add `code-reviewer`**

Insert `code-reviewer` immediately after `senior-dev` in that list (keeps the
list in pipeline order). Single-token edit.

**Step 3: Verify JSON is still valid**

Run: `python3 -c "import json; json.load(open('.claude-plugin/plugin.json')); print('valid')"`
Expected: `valid`

**Step 4: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: register code-reviewer in SessionStart agent sync"
```

---

## Task 3: Add code-reviewer to the skill-discovery registry

**Files:**
- Modify: `scripts/skill-discover.sh` (the `AGENT_SKILLS` JSON heredoc, after the `senior-dev` block, before `qa-engineer`)

**Step 1: Add the block**

Insert after the `senior-dev` object's closing `},`:

```json
  "code-reviewer": {
    "_default":          ["simplify", "anti-patterns", "knowledge-extraction", "superpowers:systematic-debugging", "superpowers:verification-before-completion"],
    "ai-system":         ["+agent-pack", "+ai-pack"],
    "agent-product":     ["+agent-pack"],
    "commerce":          ["+commerce-pack"],
    "web3":              ["+web3-pack"],
    "data-platform":     ["+data-pack"],
    "mobile-app":        ["+mobile-pack"],
    "enterprise":        ["+enterprise-pack"]
  },
```

(Only registry-resolvable names — `superpowers:*` resolve via tier2; bare
`~/.claude/skills/` names like `simplify`/`anti-patterns` resolve via tier1 or
are skipped gracefully, exactly as the existing entries behave.)

**Step 2: Verify bash syntax**

Run: `bash -n scripts/skill-discover.sh`
Expected: no output (valid).

**Step 3: Verify the registry test passes**

Run: `python3 tests/structural/test_agent_skills.py`
Expected: `PASS — all ... bundled skill references resolve` (external `superpowers:*` lines reported as `skip external`).

**Step 4: Commit**

```bash
git add scripts/skill-discover.sh
git commit -m "feat: add code-reviewer to skill-discovery registry"
```

---

## Task 4: Enable performance-engineer for web-service / streaming archetypes

**Files:**
- Modify: `agents/performance-engineer.md` (activation regex ~line 57, and the `description:` line ~line 3)

**Step 1: Widen the activation regex**

Change:
```bash
if [ -n "$PERF_SLA" ] || echo "$ARCHETYPE" | grep -qE "data-platform|enterprise|commerce"; then
```
to:
```bash
if [ -n "$PERF_SLA" ] || echo "$ARCHETYPE" | grep -qE "data-platform|enterprise|commerce|web-service|streaming"; then
```

**Step 2: Update the description frontmatter**

In the `description:` line, change `archetype is data-platform / enterprise / commerce`
to `archetype is data-platform / enterprise / commerce / web-service / streaming`.

**Step 3: Verify**

Run: `grep -n "web-service|streaming" agents/performance-engineer.md`
Expected: 1 match (the regex line); description mentions the new archetypes.

**Step 4: Commit**

```bash
git add agents/performance-engineer.md
git commit -m "feat: activate performance-engineer for web-service and streaming"
```

---

## Task 5: Run the full test suite and fix regressions

**Files:**
- Test: `tests/agent-prompt-integrity.test.mjs`, `tests/structural/test_agent_skills.py`, `tests/structural/validate.py`, `tests/pipeline-contracts.test.mjs`, `tests/pipeline-e2e.test.mjs`, `tests/cost-correctness.test.mjs`

**Step 1: Run the structural + integrity tests**

```bash
node --test tests/agent-prompt-integrity.test.mjs
python3 tests/structural/test_agent_skills.py
python3 tests/structural/validate.py
bash -n scripts/skill-discover.sh
```
Expected: all pass.

**Step 2: Run the pipeline tests that mention code-reviewer**

```bash
node --test tests/pipeline-contracts.test.mjs tests/pipeline-e2e.test.mjs tests/cost-correctness.test.mjs
```
Expected: all pass (these reference `code-reviewer` only as fixture data — adding the agent should not break them; confirm).

**Step 3: Fix any failure**

If a test asserts a property of `code-reviewer` (e.g. an expected verdict
vocabulary), adjust `agents/code-reviewer.md` to satisfy it — do not weaken the
test. Re-run until green.

**Step 4: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "test: satisfy code-reviewer pipeline contracts"
```

---

## Task 6: Refresh the local plugin install

**Files:** none (operational)

**Step 1: Sync marketplace copy + cache + active agents**

After the branch is merged to `main`, in `~/.claude/.local-marketplace/great_cto`:
```bash
git pull --ff-only origin main
rsync -a --exclude='.git' --exclude='.beads' ~/.claude/.local-marketplace/great_cto/ ~/.claude/plugins/cache/local/great_cto/2.8.5/
cp ~/.claude/plugins/cache/local/great_cto/2.8.5/agents/code-reviewer.md ~/.claude/agents/great_cto-code-reviewer.md
cp ~/.claude/plugins/cache/local/great_cto/2.8.5/agents/performance-engineer.md ~/.claude/agents/great_cto-performance-engineer.md
```

**Step 2: Verify**

Run: `ls ~/.claude/agents/great_cto-code-reviewer.md`
Expected: file exists.

---

## Task 7: Open the pull request

**Step 1: Push the branch**

```bash
git push -u origin feat/code-reviewer-agent
```

**Step 2: Open PR against the fork's main**

```bash
gh pr create --repo ajayd942/great_cto --base main --head feat/code-reviewer-agent \
  --title "Add code-reviewer agent to the pipeline" \
  --body "<simple-language summary: what it does, where it slots, the perf-engineer change, tests passing>"
```

---

## Definition of done

- [ ] `agents/code-reviewer.md` exists, valid frontmatter, 14 skills, ~250-450 line body.
- [ ] `code-reviewer` in the `plugin.json` SessionStart agent loop.
- [ ] `code-reviewer` block in `skill-discover.sh` `AGENT_SKILLS`.
- [ ] `performance-engineer` activates for `web-service` + `streaming`.
- [ ] `agent-prompt-integrity`, `test_agent_skills.py`, `validate.py`, and the 3 pipeline tests all pass.
- [ ] PR opened against `ajayd942/great_cto` `main`.
