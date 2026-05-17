# Design — `code-reviewer` agent

**Date:** 2026-05-18
**Status:** Approved (brainstorming → design)
**Author:** ajaydubey + Claude

## Problem

The great_cto pipeline has no agent that reviews `senior-dev`'s output *as code*.
`qa-engineer` checks behaviour, `security-officer` checks vulnerabilities, and the
pre-implementation reviewers threat-model *before* code exists. Code craft —
design, abstractions, naming, duplication, test quality, simplicity — is only
covered if `senior-dev` voluntarily invokes the `requesting-code-review` skill.

This is a known gap: `SKILL.md` line 179 already lists `code-reviewer` in the
pipeline-agent sequence, `agents/cli-reviewer.md` and `agents/library-reviewer.md`
refer to "the general code-reviewer", and four test files
(`pipeline-contracts`, `pipeline-e2e`, `openrouter-real-pipeline`,
`cost-correctness`) already reference a `code-reviewer`. The framework was
designed for this agent; the agent file was never created.

## Pipeline position

```
architect → pm → [pre-impl reviewers] → senior-dev → code-reviewer → qa-engineer → security-officer → devops
```

`SKILL.md` already documents this order — no pipeline-order edit is needed there.

## Behaviour — blocking gate

Emits `VERDICT: PASS` / `VERDICT: FAIL`.

| Finding severity | Effect |
|---|---|
| Critical / High | `VERDICT: FAIL` → routes back to `senior-dev`; filed as Beads bugs |
| Medium / Low | Filed as Beads bugs; pipeline continues (no block) |

No new human gate — it is an automated stage.

## Review scope — full, three tiers (no double-work)

1. **Primary — Craft:** design/abstractions, naming, DRY/duplication, simplicity
   (YAGNI), error handling, test quality and coverage adequacy.
2. **Secondary — Correctness:** logic errors, edge cases, null/None handling,
   race conditions, resource leaks.
3. **Tertiary — Security/perf sniff:** flag-and-defer only. Spots obvious issues
   (injection, hardcoded secrets, N+1 queries, unbounded loops), records them,
   and hands off to `security-officer` / `performance-engineer` — does not
   deep-audit. Keeps the agent out of their lanes.

## Frontmatter

- `model: sonnet` + `advisor-model: claude-opus-4-7` (`advisor-max-uses: 2`) for
  hard design calls.
- `tools:` `Read, Write, Bash, Glob, Grep, WebFetch, advisor_20260301,
  memory_20250929, mcp__great_cto_llm_router__ask_kimi` — **no `Edit`**. A
  reviewer reviews; it never patches source. Findings return to `senior-dev`.
- `color: green` · `effort: HIGH` · `maxTurns: 35` · `timeout: 900` · `memory: project`
- `skills:` `davila7-find-bugs`, `simplify`, `architecture-patterns`,
  `skeptical-triage`, `superpowers:systematic-debugging`,
  `superpowers:verification-before-completion`, `java-junit`,
  `postgresql-optimization`, `vercel-react-best-practices`, `fastapi-python`,
  `spring-boot-testing`, `beads`, `done-blocked`, `prose-style`

## Output artifact

`docs/code-reviews/CR-{slug}.md` — findings grouped by severity, each with
`file:line`, ending in the `VERDICT:` line. Follows the great_cto
verdict-format and prose-style conventions, and the phase-task protocol
(`scripts/phase-task.sh open code-reviewer <slug>`).

## Touchpoints

1. **New file** `agents/code-reviewer.md`.
2. `.claude-plugin/plugin.json` — add `code-reviewer` to the SessionStart
   agent-copy loop (`for AGENT in ...`).
3. `scripts/skill-discover.sh` — add a `code-reviewer` block to `AGENT_SKILLS`.
4. Pipeline order — already present in `SKILL.md`; verify only.
5. `agents/performance-engineer.md` — extend the activation regex from
   `data-platform|enterprise|commerce` to also include `web-service|streaming`,
   and update the `description:` line to match (approved separately).
6. Tests — confirm `agent-prompt-integrity.test.mjs`, `test_agent_skills.py`,
   `pipeline-contracts.test.mjs` pass; satisfy any contract those four test
   files already assert for `code-reviewer`.

## Out of scope (YAGNI)

- No `Edit` access — the agent cannot "helpfully fix" code.
- No deep security/perf auditing — flag-and-defer to the owning agents.
- No new human gate.
- No splitting `senior-dev` into per-language builders — stack skills on the
  single `senior-dev` already cover that.
