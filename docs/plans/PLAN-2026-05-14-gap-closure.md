# Plan — close 23 pipeline gaps

Source: `docs/analysis/2026-05-14-pipeline-gaps.md` (23 gaps across agents,
tools, skills, tests, gates).

## Strategy

- Phase 1 (foundation) blocks Phase 2 (coverage). Phase 3 is polish.
- Cost-free work first (code changes), real-LLM work last (real tests cost $).
- Each phase ends with all existing 44 E2E tests still passing.
- Each significant change opens a verdict + bd task for traceability.

---

## Phase 1 — Foundation (Critical, ~3-4 hours)

Closes the gaps that everything else depends on.

### Task 1.1 — Typed archetype map (A3 + G4)

**Files:** `packages/cli/src/archetypes.ts`

Add two exported constants:

```typescript
export const REVIEWERS_BY_ARCHETYPE: Record<Archetype, string[]> = {
  fintech:         ['pci-reviewer', 'regulated-reviewer'],
  healthcare:      ['security-officer'],       // until healthcare-reviewer ships
  // ... 25 entries
};

export const GATES_BY_ARCHETYPE: Record<Archetype, { gates: string[]; bySize: Record<ProjectSize, number> }> = {
  fintech:         { gates: ['plan','qa','security','ship','compliance'], bySize: {nano:1,small:2,medium:5,large:5,enterprise:6} },
  // ... 25 entries
};
```

**Acceptance:**
- `import { REVIEWERS_BY_ARCHETYPE } from './archetypes'` returns 25 entries
- `npm run build` passes
- Existing 26 archetype-e2e tests still pass

### Task 1.2 — Bash access for 10 reviewers (T1)

**Files:** `agents/{ai-security,cms,edtech,firmware,game,gov,insurance,marketplace,mobile-store,oracle}-reviewer.md`

Add scoped Bash patterns to each reviewer's frontmatter:
```
tools: Read, Write, Edit, Glob, Grep, WebFetch, WebSearch,
       Bash(git:*), Bash(bd:*), Bash(grep:*), Bash(ls:*), Bash(cat:*), Bash(find:*),
       advisor_20260301
```

**Acceptance:**
- 34 lint passes (`scripts/lint-agents.mjs`)
- Multi-archetype test still works (verify in Phase 2)

### Task 1.3 — Skill resolution audit (S1)

**Files:** `skills/*/SKILL.md` + new `docs/analysis/2026-05-14-skill-resolution.md`

For each of 12 unique skills referenced in agent frontmatter:
1. Check if in `skills/` (3 are)
2. Check if shipped by superpowers, anthropic-skills, gstack
3. Document resolution path

**Acceptance:** every skill has a documented resolution OR is added to `skills/`.

### Task 1.4 — Commit + verify Phase 1

```
git commit -m "fix: typed archetype map + Bash for reviewers + skill audit (Phase 1)"
node --test tests/cost-correctness.test.mjs tests/board-gate.test.mjs \
            tests/pipeline-e2e.test.mjs tests/resume-e2e.test.mjs
node tests/run-archetype-e2e.mjs
```

All 44 automated tests must still pass.

---

## Phase 2 — Coverage (High, ~5-6 hours)

Adds the highest-value missing tests + the healthcare reviewer.

### Task 2.1 — Healthcare reviewer agent (A1)

**Files:** `agents/healthcare-reviewer.md` (new)

Build on the existing `regulated-reviewer.md` template. Key sections:
- HIPAA Security Rule (45 CFR 164.308–318)
- BAA requirements
- FHIR + HL7 implementation gotchas
- PHI access logging (immutable audit)
- HITECH breach-notification timelines

**Update:**
- `REVIEWERS_BY_ARCHETYPE.healthcare = ['healthcare-reviewer']`
- `tests/run-archetype-e2e.mjs` — assert healthcare-reviewer is attached

### Task 2.2 — Reviewer regression tests (X6)

**Files:** `tests/reviewer-regressions.test.mjs` (new)

For each of 18 reviewer agents: seed a known-vulnerable stub for the agent's
domain, run the agent (via Task tool or OpenRouter at test time), assert BLOCKED:

```javascript
test('pci-reviewer blocks plaintext card-PAN handling', async () => {
  const fixture = `function processPayment(pan) { db.insert({ pan }); }`;
  const verdict = await runReviewerOnFixture('pci-reviewer', fixture);
  assert.equal(verdict, 'BLOCKED');
});
```

**Approach:** lightweight — uses OpenRouter, 18 tests × $0.04 = ~$0.72.
DO NOT add to CI. Run before agent-prompt changes.

### Task 2.3 — Multi-platform parity test (X4)

**Files:** `tests/multi-platform-parity.test.mjs` (new)

For each platform (Claude Code, Cursor, Codex, Aider, Continue):
1. Run `great-cto init --platform=<X>` in tmp dir
2. Read the generated agent prompt for `architect`
3. Compare hash with Claude Code's version
4. Assert all 5 prompts identical (or document the deltas)

**Acceptance:** test runs in CI (no LLM), under 5 sec.

### Task 2.4 — `gate:cost` for AI archetypes (G2)

**Files:** `agents/architect.md` + `agents/devops.md` + `GATES_BY_ARCHETYPE`

For archetypes `mlops`, `ai-system`, `agent-product`: pipeline opens
`gate:cost` after architect's cost forecast, before ship. Human must
approve forecasted monthly burn.

**Acceptance:** OpenRouter test for an AI archetype shows `gate:cost`
in /api/inbox after architect runs.

### Task 2.5 — Commit + verify Phase 2

```
git commit -m "feat: healthcare-reviewer + reviewer regressions + gate:cost (Phase 2)"
```

44 automated + new reviewer-regression suite passes.

---

## Phase 3 — Polish (Medium, ~6-8 hours)

Lower-priority but cumulatively important.

### Task 3.1 — Reviewer-name documentation (A2)

**Files:** `docs/agents/REVIEWER-NAMING.md` (new)

Document the 4 alias mappings (pci/firmware/web-store/mobile-store) and
the rationale. Or: rename to canonical `<archetype>-reviewer` form.

**Decision required:** rename (breaking) or document (non-breaking)?
Recommend: document. Rename in v3.0.

### Task 3.2 — Web access for pm + continuous-learner (T3, T4)

**Files:** `agents/pm.md` and `agents/continuous-learner.md`

Add `WebFetch, WebSearch` to tools allowlist.

### Task 3.3 — Shared archetype-review-base skill (S3)

**Files:** `skills/archetype-review-base/SKILL.md` (new)

Common mandatory sections that every archetype reviewer should follow:
- Domain heading
- Mandatory checks (3-7 bullets)
- Regulatory citations
- BLOCKED criteria
- Verdict format

Each of 18 reviewers references this skill, drops duplicated boilerplate.

### Task 3.4 — `gate:oracle-review` for web3 (G1)

**Files:** `agents/oracle-reviewer.md` + `GATES_BY_ARCHETYPE.web3`

Add explicit gate after oracle-reviewer. Web3 archetype gate-count
goes from 4 to 5.

### Task 3.5 — Remaining tests (X1, X2, X3, X5, X7, X8)

Each ~2-3 hours:
- **X1** — TDD-cycle test for senior-dev (use mock LLM with deterministic responses)
- **X2** — continuous-learner extraction test
- **X3** — devops dry-run deploy paths (Vercel, Fly.io)
- **X5** — /audit on a real-shaped tmp codebase
- **X7** — schema validator for verdict + file-block formats
- **X8** — cost-budget regression (assert mock-pipeline total < $5)

### Task 3.6 — Commit + verify Phase 3

All 44+ tests still pass. Final commit.

---

## Phase 4 — Documentation (~1-2 hours)

### Task 4.1 — Gate naming standardization (G3)

Pick a convention. Document. Don't break existing prefixes (would require
data migration on all live boards).

### Task 4.2 — Update README + CHANGELOG

Note the new typed archetype map + healthcare-reviewer in CHANGELOG.

---

## Execution order

| Order | Task | Effort | LLM cost | Blocker for |
|---|---|---|---|---|
| 1 | 1.1 typed map | 2h | $0 | 1.4, 2.1, 2.4 |
| 2 | 1.2 Bash for reviewers | 30m | $0 | 2.2 |
| 3 | 1.3 skill audit | 1h | $0 | 3.3 |
| 4 | 1.4 Phase 1 commit + verify | 30m | $0 | Phase 2 |
| 5 | 2.1 healthcare-reviewer | 2h | $0 (creating prompt) | nothing |
| 6 | 2.2 reviewer regressions | 3h | ~$0.72 | nothing |
| 7 | 2.3 multi-platform parity | 1h | $0 | nothing |
| 8 | 2.4 gate:cost | 2h | $0 | nothing |
| 9 | 2.5 Phase 2 commit + verify | 30m | $0 | Phase 3 |
| 10 | 3.1 - 3.6 | 6-8h | $0-1 | nothing |
| 11 | 4.1 - 4.2 | 1-2h | $0 | nothing |

**Total: ~24-28 hours of focused work, ~$1.50 LLM costs for testing.**

## Starting now

Execute Phase 1 tasks 1.1 → 1.2 → 1.3 → 1.4 in this session. Phases 2-4
follow in future sessions.
