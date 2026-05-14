# Skill resolution audit — 2026-05-14

Where each skill referenced in agent frontmatter actually resolves on disk.

## Resolution map

| Skill | Resolved at | Bundled with | Risk on fresh install |
|---|---|---|---|
| `superpowers:writing-plans` | `~/.claude/plugins/cache/local/superpowers/5.0.6/skills/writing-plans` | superpowers plugin (required) | ⚠️ user must install superpowers |
| `superpowers:requesting-code-review` | superpowers 5.0.6 | superpowers | ⚠️ |
| `superpowers:subagent-driven-development` | superpowers 5.0.6 | superpowers | ⚠️ |
| `superpowers:systematic-debugging` | superpowers 5.0.6 | superpowers | ⚠️ |
| `superpowers:test-driven-development` | superpowers 5.0.6 | superpowers | ⚠️ |
| `anthropic-skills:adr` | `~/Library/Application Support/Claude/...skills/adr` | anthropic-skills plugin | ⚠️ |
| `anthropic-skills:system-architect` | anthropic-skills plugin | anthropic-skills | ⚠️ |
| `beads` | `~/.claude/plugins/cache/local/beads/1.0.0/skills/beads` | beads plugin (required) | ⚠️ user must install beads |
| `done-blocked` | `skills/done-blocked/` | **great_cto** ✅ | low |
| `skeptical-triage` | `skills/skeptical-triage/` | **great_cto** ✅ | low |
| `canary` | `~/.claude/skills/canary` (user-local) | **NOT bundled with great_cto** | 🔴 missing on fresh install |
| `cso` | `~/.claude/skills/cso` (user-local) | **NOT bundled** | 🔴 |
| `investigate` | `~/.claude/skills/investigate` (user-local) | **NOT bundled** | 🔴 |
| `land-and-deploy` | `~/.claude/skills/land-and-deploy` (user-local) | **NOT bundled** | 🔴 |
| `ship` | `~/.claude/skills/ship` (user-local) | **NOT bundled** | 🔴 |
| `anti-patterns` | **nowhere on this machine** | **NOT bundled** | 🔴 missing |
| `cost-model` | **nowhere** | **NOT bundled** | 🔴 |
| `discovery` | **nowhere** | **NOT bundled** | 🔴 |
| `pm-planning` | **nowhere** | **NOT bundled** | 🔴 |
| `pre-mortem` | **nowhere** | **NOT bundled** | 🔴 |
| `prose-style` | **nowhere** | **NOT bundled** | 🔴 |
| `well-architected` | **nowhere** | **NOT bundled** | 🔴 |

## Summary

| Status | Count |
|---|---|
| 🟢 Bundled in great_cto | **9** (done-blocked, skeptical-triage + 7 added in this session: anti-patterns, cost-model, discovery, pm-planning, pre-mortem, prose-style, well-architected) |
| 🟡 External plugin required | 8 (superpowers ×5, anthropic-skills ×2, beads) |
| 🔴 User-local but not shipped | 5 (canary, cso, investigate, land-and-deploy, ship) |
| ~~🔴 Not found anywhere~~ | ~~7 — RESOLVED 2026-05-14 (now bundled)~~ |

## Risks

### 🔴 7 skills referenced but missing on disk

On a fresh great_cto install, the LLM will see e.g. `skills: [..., well-architected, ...]` in the agent frontmatter, but the runtime will fail to load the skill. The agent still runs (skills are advisory in current Claude Code), but the **claim** that the architect uses the `well-architected` framework is misleading.

Likely scenarios:
1. These skills were imported from gstack but the SKILL.md files were never bundled
2. Names are wrong — actual skill resolves under a different name
3. Skills were planned but never built

### 🔴 5 user-local skills not shipped with great_cto

The 5 skills (canary, cso, investigate, land-and-deploy, ship) live in `~/.claude/skills/` on this machine but not in `great_cto/skills/`. On someone else's fresh machine they don't exist either, unless they have gstack installed (which is a separate plugin).

## Recommended actions

### Phase 1 (this session) — DONE

Document the situation. Implemented as this file.

### Phase 2 (next sprint) — STILL TODO

1. **Audit each of 7 missing skills.** Either:
   - Add SKILL.md to `skills/<name>/` if intent is to ship it
   - Remove from agent frontmatter if obsolete
   - Rename to point at canonical location if it lives elsewhere

2. **Bundle the 5 user-local skills.** Copy from `~/.claude/skills/` into
   great_cto's `skills/` directory and remove the dependency on
   gstack-being-installed.

3. **Add canary check.** Extend `scripts/canary.sh` step to enumerate every
   skill referenced in agent frontmatter and verify it resolves. Fail
   canary if any skill missing.

### Phase 3 (later) — DESIGN

Define the formal resolution order: `~/.claude/skills/` (user) →
`plugin-cache/<plugin>/skills/` (plugin) → `<plugin>/skills/` (project).
Document in CLAUDE.md.
