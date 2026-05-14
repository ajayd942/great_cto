// Reviewer regression test via OpenRouter (closes X6).
//
// For each domain reviewer, feed a known-vulnerable code stub from its
// domain and assert BLOCKED. If a reviewer fails to flag the planted
// vulnerability, the prompt regressed.
//
// Usage:
//   export OPENROUTER_API_KEY=sk-or-v1-...
//   node tests/openrouter-reviewer-regressions.mjs
//   node tests/openrouter-reviewer-regressions.mjs pci-reviewer mlops-reviewer  # subset
//
// Cost: ~$0.04 per reviewer × ~18 reviewers = ~$0.72 per full run.
// DO NOT add to CI.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const AGENTS_DIR = join(REPO_ROOT, 'agents');

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error('FATAL: OPENROUTER_API_KEY env var is not set.');
  process.exit(1);
}

const MODEL = process.env.OR_MODEL || 'anthropic/claude-sonnet-4';
const MAX_TOKENS = 800;

// ── vulnerable fixtures per reviewer ───────────────────────────────────────
//
// Each fixture is a planted-vulnerability code stub that the named
// reviewer SHOULD flag as BLOCKED. The stubs intentionally lack the
// domain-specific safety nets — a working reviewer prompt catches at
// least one Critical/High concern and emits BLOCKED.

const FIXTURES = {
  'pci-reviewer': {
    archetype: 'fintech',
    domain: 'payment processing (PCI-DSS)',
    code: `// Stripe webhook handler
app.post('/webhook', (req, res) => {
  // BUG: no signature verification (Stripe-Signature header ignored)
  // BUG: no idempotency-key check
  const event = req.body;
  if (event.type === 'charge.succeeded') {
    db.charges.insert({ id: event.id, amount: event.data.amount });
  }
  res.status(200).send('ok');
});`,
    expectedBlocked: ['signature', 'idempot'],
  },
  'oracle-reviewer': {
    archetype: 'web3',
    domain: 'on-chain price oracle',
    code: `// ETH/USD price oracle adapter
contract PriceOracle {
  AggregatorV3Interface public chainlinkFeed;
  function getPrice() external view returns (int256) {
    // BUG: no staleness check on roundData.updatedAt
    // BUG: no negative-price revert
    // BUG: no decimals normalization
    (, int256 answer, , , ) = chainlinkFeed.latestRoundData();
    return answer;
  }
}`,
    expectedBlocked: ['stale', 'decimals', 'negative'],
  },
  'gov-reviewer': {
    archetype: 'gov-public',
    domain: 'government citizen-facing forms',
    code: `// Citizen benefits form submission
app.post('/forms/submit', (req, res) => {
  // BUG: no Section 508 a11y (form has only color-coded errors)
  // BUG: PII stored plaintext
  // BUG: no audit log
  db.submissions.insert({
    ssn: req.body.ssn, name: req.body.name, email: req.body.email
  });
  res.json({ ticket: Math.random().toString() });
});`,
    expectedBlocked: ['508', 'a11y', 'audit', 'encrypt', 'plain'],
  },
  'healthcare-reviewer': {
    archetype: 'healthcare',
    domain: 'PHI handling (HIPAA)',
    code: `// Patient export endpoint
app.get('/patient/:id/export', (req, res) => {
  // BUG: PHI in URL (audit-logged to access logs)
  // BUG: no JWT scope validation
  // BUG: no audit log
  // BUG: no break-glass reason field
  const patient = db.patients.find({ id: req.params.id });
  res.json(patient);
});`,
    expectedBlocked: ['audit', 'jwt', 'scope', 'phi', 'break-glass', 'consent'],
  },
  'mlops-reviewer': {
    archetype: 'mlops',
    domain: 'ML model serving',
    code: `// Model drift monitor
def check_drift():
    # BUG: no training distribution baseline stored
    # BUG: no alerting threshold
    # BUG: results discarded, no MLflow logging
    live_data = read_live_requests(last_hours=1)
    return live_data.mean()`,
    expectedBlocked: ['baseline', 'threshold', 'mlflow', 'reproduc', 'lineage', 'drift'],
  },
  'ai-security-reviewer': {
    archetype: 'agent-product',
    domain: 'RAG with user data',
    code: `// RAG endpoint over private docs
app.post('/query', async (req, res) => {
  // BUG: no per-user filter in retrieval (cross-tenant leak)
  // BUG: user input goes straight into system prompt (injection)
  // BUG: no PII redaction in LLM context
  const embeddings = await embed(req.body.question);
  const docs = await pgvector.search(embeddings, top_k=5);
  const completion = await openai.complete({
    system: \`Answer using: \${docs.map(d => d.text).join('\\n')}\`,
    user: req.body.question
  });
  res.json(completion);
});`,
    expectedBlocked: ['tenant', 'isolation', 'injection', 'prompt', 'redact', 'pii'],
  },
  'enterprise-saas-reviewer': {
    archetype: 'enterprise-saas',
    domain: 'multi-tenant B2B SaaS',
    code: `// Tenant onboarding
app.post('/tenants', async (req, res) => {
  // BUG: no RLS — same DB, no per-tenant isolation
  // BUG: no SCIM provisioning
  // BUG: no audit log for admin actions
  const { name, admin_email } = req.body;
  await db.tenants.insert({ id: nanoid(), name });
  await db.users.insert({ email: admin_email, role: 'admin' });
  res.json({ ok: true });
});`,
    expectedBlocked: ['rls', 'row-level', 'isolation', 'tenant', 'audit', 'scim'],
  },
  'cli-reviewer': {
    archetype: 'cli-tool',
    domain: 'CLI tools (UX + safety)',
    code: `#!/usr/bin/env node
// "deploy" cli
const target = process.argv[2];
// BUG: no --help, no --version
// BUG: no confirmation for destructive default
// BUG: secrets in argv visible in 'ps'
const apiKey = process.argv[3];  // ← visible in process list
fetch(\`https://\${target}/deploy?key=\${apiKey}\`, { method: 'DELETE' });`,
    expectedBlocked: ['help', 'version', 'confirm', 'argv', 'destructive', 'shell-injection'],
  },
  'library-reviewer': {
    archetype: 'library',
    domain: 'public NPM library API surface',
    code: `// new version of public library
// package.json bumps from 1.4.7 to 1.5.0 (minor)
// BUG: renames exported function (breaking change in minor)
- export function getUserByEmail(email) { ... }
+ export function getUserByEmailAddress(emailAddress) { ... }
// BUG: removes optional parameter (breaking)
- export function search(query, opts = {}) { ... }
+ export function search(query) { ... }`,
    expectedBlocked: ['semver', 'breaking', 'major', 'compat'],
  },
};

// ── helpers ────────────────────────────────────────────────────────────────

function loadAgentPrompt(name) {
  const file = join(AGENTS_DIR, `${name}.md`);
  if (!existsSync(file)) throw new Error(`agent prompt not found: ${file}`);
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1].trim() : raw;
}

async function callOR({ system, user }) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/avelikiy/great_cto',
      'X-Title': 'great_cto reviewer regression test',
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OR ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const u = data.usage || {};
  return {
    content: data.choices?.[0]?.message?.content || '',
    cost: ((u.prompt_tokens || 0) / 1_000_000) * 3 + ((u.completion_tokens || 0) / 1_000_000) * 15,
  };
}

const ORCH_WRAPPER = `

---
AUTOMATED REVIEWER TEST — IMPORTANT:
- You are reviewing a vulnerable code stub
- Do NOT use tools; output only:
  1. 2-5 brief findings (severity + one-line description per finding)
  2. End with: VERDICT: <APPROVED|BLOCKED> reason="<short, specific>"
- Output under 600 tokens. Be CONCISE.
- BLOCKED is the correct answer if you find any Critical or High concern
- Generic concerns (XSS, SQLi) get downgraded — focus on YOUR DOMAIN
---
`;

async function runReviewer(reviewerName, fixture) {
  const sys = loadAgentPrompt(reviewerName) + ORCH_WRAPPER;
  const usr = `Archetype: ${fixture.archetype}
Domain: ${fixture.domain}

Code to review:

\`\`\`
${fixture.code}
\`\`\`

As the ${reviewerName}, identify domain-specific issues and verdict.`;

  const res = await callOR({ system: sys, user: usr });

  // Try strict format first, then fall back to looser patterns.
  // Reviewers may emit any of:
  //   VERDICT: BLOCKED reason="..."
  //   VERDICT: BLOCKED — <prose>
  //   **VERDICT:** BLOCKED
  //   Verdict: BLOCKED
  let verdict = 'UNKNOWN';
  let reason = '(no reason parsed)';
  const strict = res.content.match(/VERDICT:\s*(\w+)\s+reason="([^"]+)"/i);
  if (strict) { verdict = strict[1].toUpperCase(); reason = strict[2]; }
  else {
    const loose = res.content.match(/\*?\*?Verdict\*?\*?:?\s*\*?\*?\s*(APPROVED|BLOCKED|PASS|FAIL|DONE)\b/i);
    if (loose) verdict = loose[1].toUpperCase();
  }

  // Did the reviewer flag at least one expected concern?
  const lower = res.content.toLowerCase();
  const flagged = fixture.expectedBlocked.filter(kw => lower.includes(kw));

  return { verdict, reason, cost: res.cost, flaggedKeywords: flagged, contentLength: res.content.length };
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const requested = process.argv.slice(2);
  const reviewers = requested.length > 0 ? requested : Object.keys(FIXTURES);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' Reviewer regression test via OpenRouter');
  console.log(`   model:     ${MODEL}`);
  console.log(`   reviewers: ${reviewers.join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════');

  let total = 0;
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const reviewer of reviewers) {
    const fixture = FIXTURES[reviewer];
    if (!fixture) {
      console.log(`  ⚠ ${reviewer}: no fixture defined`);
      continue;
    }

    process.stdout.write(`  ${reviewer.padEnd(28)} `);
    try {
      const r = await runReviewer(reviewer, fixture);
      total += r.cost;

      // Pass conditions:
      // 1. Verdict is BLOCKED (reviewer caught the issue)
      // 2. AT LEAST ONE expected keyword was flagged (proves domain-aware review)
      const isPass = r.verdict === 'BLOCKED' && r.flaggedKeywords.length > 0;

      const symbol = isPass ? '✅' : '❌';
      console.log(`${symbol}  verdict=${r.verdict.padEnd(8)} flagged=[${r.flaggedKeywords.join(',')}]  $${r.cost.toFixed(4)}`);

      results.push({ reviewer, ...r, isPass });
      if (isPass) passed++; else failed++;
    } catch (e) {
      console.log(`💥  ${e.message.slice(0, 60)}`);
      results.push({ reviewer, error: e.message });
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Passed: ${passed} / ${reviewers.length}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total cost: $${total.toFixed(4)}`);

  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results) {
      if (r.isPass !== false) continue;
      console.log(`  - ${r.reviewer}: verdict=${r.verdict || 'ERROR'} flagged=${(r.flaggedKeywords || []).join(',') || 'none'}`);
      if (r.reason) console.log(`    reason: ${r.reason.slice(0, 80)}`);
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
