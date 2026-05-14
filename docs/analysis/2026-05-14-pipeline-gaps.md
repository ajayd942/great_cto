# Pipeline gap analysis — 2026-05-14

System inventory + gap analysis after E2E + multi-archetype validation.

---

## 1. Agents (34 total)

### Inventory by stage

| Pipeline stage | Agent(s) | Status |
|---|---|---|
| Architect | `architect` (55KB) | ✅ |
| PM / planning | `pm` (17KB) | ✅ |
| Senior-dev | `senior-dev` (25KB) | ✅ |
| Domain reviewers | 18 archetype-specific reviewers | partial — see gaps |
| AI-specific | `ai-prompt-architect`, `ai-eval-engineer`, `ai-security-reviewer` | ✅ |
| QA | `qa-engineer` (32KB) | ✅ |
| Security | `security-officer` (45KB) | ✅ |
| Performance | `performance-engineer` | ✅ |
| Deploy | `devops` (32KB) | ✅ |
| Support | `l3-support` (27KB), `continuous-learner` | ✅ |
| Audit | `project-auditor` (41KB) | ✅ |

### 🔴 Gaps in archetype-reviewer coverage

great_cto claims **25 archetypes** but the reviewer-name mapping needs documentation. Verified mappings:

| Archetype | Reviewer | Source |
|---|---|---|
| fintech | `pci-reviewer` (cross-domain naming) | hardcoded in pipeline |
| healthcare | `security-officer` (generic) | **NO dedicated reviewer** |
| commerce | `security-officer` (generic) | **NO dedicated reviewer** |
| web-service | `security-officer` (generic) | **NO dedicated reviewer** |
| cli-tool | `cli-reviewer` | ✅ direct match |
| iot-embedded | `firmware-reviewer` | alt-name match |
| browser-extension | `web-store-reviewer` | alt-name match |
| mobile-app | `mobile-store-reviewer` | alt-name match |
| ai-system, agent-product | `ai-security-reviewer` (shared) | OK but shared |
| gov-public | `gov-reviewer` | ✅ |
| (others 14) | matching-name reviewer | ✅ |

**Gap #A1 — Healthcare has no dedicated reviewer.** Uses generic `security-officer` for HIPAA. Should have a `hipaa-reviewer` or `healthcare-reviewer` agent with FHIR + PHI + audit-log expertise.

**Gap #A2 — Naming inconsistency.** `pci-reviewer` is for fintech, `firmware-reviewer` for iot, `web-store-reviewer` for browser-extension. The `<archetype>-reviewer` convention breaks in 4 places. Either rename or document aliases in `archetypes.ts`.

**Gap #A3 — No archetype→reviewer mapping table in code.** The connection between an archetype and its reviewer lives only in the pipeline orchestration (agent prompts mention it, code doesn't). Should be a typed map: `reviewersFor(archetype: Archetype): AgentName[]`.

---

## 2. Tools

### 🔴 Bash-access gaps in reviewer agents

10 reviewers have **NO Bash access**:

```
ai-security-reviewer    cms-reviewer       edtech-reviewer
firmware-reviewer       game-reviewer      gov-reviewer
insurance-reviewer      marketplace-reviewer  mobile-store-reviewer
oracle-reviewer
```

**Gap #T1 — These reviewers can't run their own validators.** A pci-reviewer should be able to run `bd list`, `git log`, `npm audit`, etc. Without Bash, they can only read files via the Read tool.

**Fix:** Add scoped Bash patterns to reviewers — e.g.:
```
tools: ..., Bash(git:*), Bash(bd:*), Bash(npm:*), Bash(grep:*)
```

### 🟡 MCP integration gaps

| MCP server | Used by | Status |
|---|---|---|
| `memory_20250929` | 28 of 34 agents | ✅ mostly wired |
| `advisor_20260301` | 28 of 34 agents | ✅ |
| `mcp__great_cto_llm_router__ask_kimi` | architect, senior-dev, devops, qa-engineer, security-officer | ✅ for major roles |
| `mcp__grafana__*` | l3-support only | ✅ |

**Gap #T2 — `ai-eval-engineer` has no MCP access** (no memory, no advisor). This agent runs eval suites — it should at least have `memory_*` to track historical evals across runs.

### 🔴 WebFetch/WebSearch missing in pm + continuous-learner

**Gap #T3 — `pm` has no Web*** access.** When decomposing tasks, PM should be able to look up library docs, GitHub repos for similar features, etc. Currently it can't.

**Gap #T4 — `continuous-learner` has no Web*** access.** Same reasoning — can't enrich lessons with external context.

---

## 3. Skills

### Inventory — what's mounted

| Agent | Skills mounted |
|---|---|
| architect | superpowers (writing-plans, requesting-code-review), anthropic (system-architect, adr), beads, skeptical-triage, done-blocked, well-architected, discovery |
| pm | pm-planning, pre-mortem, cost-model, anti-patterns, beads |
| senior-dev | superpowers (TDD, subagent-driven, requesting-review), beads, done-blocked |
| qa-engineer | beads, skeptical-triage, done-blocked, prose-style |
| security-officer | cso, beads, skeptical-triage, done-blocked, prose-style |
| devops | ship, land-and-deploy, canary, beads, done-blocked |
| l3-support | superpowers:systematic-debugging, investigate, beads, done-blocked |

### What's on disk

```
skills/
├── done-blocked/
├── great_cto/
└── skeptical-triage/
```

### 🔴 Skill-registry gaps

**Gap #S1 — Skills referenced but NOT on disk in `skills/`.** Agents reference 12 unique skills (well-architected, discovery, pm-planning, pre-mortem, cost-model, anti-patterns, cso, ship, land-and-deploy, canary, investigate, prose-style). Only 3 are in `skills/`. The other 9 must be loaded from elsewhere (likely the runtime / plugin host).

**Risk:** if a user installs great_cto on a fresh machine, do these skills resolve? Need to verify each is either:
1. Bundled in the great_cto plugin
2. Available from superpowers/anthropic-skills
3. Documented as a manual dependency

**Gap #S2 — No `requesting-code-review` invocation in reviewer agents.** Reviewers don't currently mount `superpowers:receiving-code-review` (the inverse skill). They should — it formalises the review-output contract.

**Gap #S3 — No common base skill for archetype-reviewers.** Each reviewer reimplements its review heuristics in its 7-10KB prompt. A shared `skills/archetype-review-base/` would reduce duplication and ensure consistency (mandatory sections: domain checks, regulatory citations, PASS/BLOCKED criteria).

---

## 4. Testing

### Current coverage (44 automated + real-LLM)

| Layer | Tests | Cases | Cost |
|---|---|---|---|
| Detect + archetype + compliance | `run-archetype-e2e.mjs` | 26 | $0 |
| Cost dashboard correctness | `cost-correctness.test.mjs` | 6 | $0 |
| Board gate approval | `board-gate.test.mjs` | 5 | $0 |
| Pipeline state machine | `pipeline-e2e.test.mjs` | 4 | $0 |
| Cross-session resume | `resume-e2e.test.mjs` | 3 | $0 |
| Single-archetype real LLM | `openrouter-real-pipeline.mjs` | 1 run | ~$0.17 |
| Multi-archetype real LLM | `openrouter-multi-archetype.mjs` | 8 archetypes | ~$1.35 |

### 🔴 Testing gaps

**Gap #X1 — No tests for `senior-dev` actually running TDD.** All 5 automated suites either seed verdicts or test orchestration. None drives the test-driven-development skill end-to-end (write failing test → impl → green → refactor). The real-LLM tests only run senior-dev to a stub, not a TDD cycle.

**Gap #X2 — No tests for `continuous-learner` extracting lessons.** Sessions write `.great_cto/lessons.md` — there's no test verifying the extraction logic.

**Gap #X3 — No tests for `devops` deploy paths.** Devops can ship to Vercel, Fly.io, Render, Heroku, etc. None of these paths is exercised in tests.

**Gap #X4 — No multi-platform parity tests.** great_cto ships configs for Cursor, Codex, Aider, Continue. The "AGENTS.md is parseable" check is in canary, but **does an agent in Cursor actually receive the same prompt as in Claude Code?** Untested.

**Gap #X5 — No tests for `/audit` on real codebases.** project-auditor (41KB prompt) is the largest agent. There's no end-to-end test where it runs against a real existing codebase and produces the expected backlog.

**Gap #X6 — No regression tests for the 18 reviewer agents.** Each archetype reviewer's BLOCKED/APPROVED criteria are codified in prompts only. A test that seeds a known-vulnerable stub and asserts the reviewer flags it would catch prompt regressions.

**Gap #X7 — No LLM-output schema validation.** Agents emit verdicts in space-separated format, file blocks in `<file>` tags, etc. There's no schema test that catches "agent stopped emitting verdict line" or "file block format changed".

**Gap #X8 — No cost-budget regression test.** A user installs great_cto and runs a small feature — what's the actual monthly cost on Sonnet+Haiku mixed? No test asserts the cost stays under a threshold.

---

## 5. Human gates per archetype

### Gate inventory across the codebase

10 distinct gate types found:

```
gate:plan       — after architect, before senior-dev
gate:arch       — after architect (alt to gate:plan in some flows)
gate:code       — after senior-dev (rarely used)
gate:qa         — after qa-engineer
gate:security   — after security-officer
gate:compliance — for regulated/fintech/healthcare archetypes
gate:ship       — final go/no-go before devops deploys
gate:edtech-review    — archetype-specific
gate:gov-review       — archetype-specific
gate:insurance-review — archetype-specific
```

### Project-size affects gate count

From `qa-engineer.md`:
- **nano**: skip qa-engineer → senior-dev deploys directly → **1 gate** (gate:plan only)
- **small**: qa lightweight → **2 gates** (gate:plan + gate:ship)
- **medium**: full pipeline → **3 gates** (gate:plan + gate:qa + gate:ship)
- **large/enterprise**: full + compliance → **4-5 gates**

### Per-archetype gate count (medium project_size)

| Archetype | Standard gates | Domain gate(s) | Total |
|---|---|---|---|
| web-service | plan, qa, ship | — | **3** |
| commerce | plan, qa, security, ship | compliance | **5** |
| fintech | plan, qa, security, ship | compliance (PCI/SOX) | **5** |
| healthcare | plan, qa, security, ship | compliance (HIPAA) | **5** |
| web3 | plan, qa, security, ship | (no explicit web3 gate) | **4** |
| mlops | plan, qa, security, ship | — | **4** |
| agent-product | plan, qa, security, ship | (eu-ai-act in security) | **4** |
| edtech | plan, qa, security, ship | **edtech-review** | **5** |
| gov-public | plan, qa, security, ship | **gov-review** + compliance | **6** |
| insurance | plan, qa, security, ship | **insurance-review** + compliance | **6** |
| regulated | plan, qa, security, ship | compliance | **5** |
| enterprise-saas | plan, qa, security, ship | compliance (SOC2) | **5** |
| iot-embedded | plan, qa, security, ship | — | **4** |
| browser-extension | plan, qa, ship | store-policy (in reviewer) | **3** |
| mobile-app | plan, qa, ship | store-policy (in reviewer) | **3** |
| cli-tool | plan, qa, ship | — | **3** |
| library | plan, qa, ship | (semver in reviewer) | **3** |
| game | plan, qa, ship | age-rating (in reviewer) | **3** |
| data-platform | plan, qa, ship | — | **3** |
| streaming | plan, qa, ship | — | **3** |
| infra | plan, qa, ship | drift-detection (in reviewer) | **3** |
| devtools | plan, qa, ship | sigstore (in reviewer) | **3** |
| marketplace | plan, qa, security, ship | compliance (KYC) | **5** |
| cms | plan, qa, ship | DMCA (in reviewer) | **3** |
| ai-system | plan, qa, security, ship | (eu-ai-act in security) | **4** |

### 🔴 Gate gaps

**Gap #G1 — Web3 has no dedicated `gate:oracle-review`.** Smart contracts need a human gate after `oracle-reviewer` (oracle safety + MEV + upgradeability are critical). Currently web3 only goes through generic security.

**Gap #G2 — No `gate:cost` for AI archetypes.** mlops, ai-system, agent-product can blow through token budgets in production. A human gate after cost forecast (before ship) would prevent runaway-cost incidents.

**Gap #G3 — Gate naming inconsistency.** `gate:edtech-review` and `gate:gov-review` exist with archetype prefix, but `gate:pci-review` doesn't. Inconsistent.

**Gap #G4 — No documentation of "which gates fire for which archetype + project_size combination".** The matrix above is reverse-engineered from agent prompts. Should be a typed table in `archetypes.ts` or a `GATES.md`.

**Gap #G5 — No tests asserting gate-count expectations.** Gap #X also: a test that runs e.g. fintech-medium and confirms exactly 5 gates open would catch silent pipeline changes.

---

## Priority recommendations

### 🔴 Critical (do first)

1. **#A3 + #G4** — Create typed `archetype → [reviewers, gates]` mapping in `archetypes.ts`. Single source of truth.
2. **#T1** — Add Bash access to all 10 reviewer agents (at least git, grep, bd).
3. **#X6** — Write regression tests for each archetype reviewer (seed vulnerable stub → assert BLOCKED).

### 🟡 High (next sprint)

4. **#S1** — Audit which skills resolve on fresh install. Document or bundle missing ones.
5. **#X4** — Multi-platform parity test (Claude Code vs Cursor vs Codex receive same agent prompt).
6. **#A1** — Create `healthcare-reviewer` (HIPAA + FHIR + audit-log + BAA).
7. **#G2** — Add `gate:cost` for AI archetypes.

### 🟢 Medium (later)

8. **#A2** — Rename or document reviewer-name aliases.
9. **#T3 + #T4** — Add WebFetch/WebSearch to pm + continuous-learner.
10. **#S3** — Extract shared `archetype-review-base` skill.
11. **#G1** — Add `gate:oracle-review` for web3.
12. **#X1, #X2, #X3** — TDD cycle test, lessons-extraction test, devops deploy-path tests.

### ℹ️ Documentation only

13. **#G3** — Standardise gate names. Pick: `gate:<archetype>-review` everywhere or drop prefix.
14. **#T2** — Add MCP `memory_*` to ai-eval-engineer.
15. **#X8** — Cost-budget regression in CI.

---

## Summary table

| Area | # gaps | Severity | Effort to close |
|---|---|---|---|
| Agents | 3 (A1-A3) | Med-High | 1-2 days |
| Tools | 4 (T1-T4) | Med | 0.5 day |
| Skills | 3 (S1-S3) | Med-High | 1 day |
| Testing | 8 (X1-X8) | Med-High | 3-5 days |
| Gates | 5 (G1-G5) | Med | 1 day |
| **Total** | **23 gaps** | | **~7-9 days of work** |

Most painful gaps: **#A3** (no typed reviewer map), **#X4** (no multi-platform parity test), **#X6** (no reviewer regression tests). These three would prevent ~80% of category-changing regressions.
