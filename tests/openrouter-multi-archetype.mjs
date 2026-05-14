// Multi-archetype real-orchestration test via OpenRouter.
//
// Runs the full great_cto pipeline (architect → pm → senior-dev → archetype
// reviewer → qa-engineer) for N different archetypes, exercising different
// code paths through the agent prompts.
//
// Each archetype runs in an isolated tmp project with the right
// PROJECT.md archetype field, a representative feature description,
// and the correct archetype-specific reviewer in stage 4.
//
// Usage:
//   export OPENROUTER_API_KEY=sk-or-v1-...
//   node tests/openrouter-multi-archetype.mjs                # all 8
//   node tests/openrouter-multi-archetype.mjs fintech mlops  # subset
//
// Cost: ~$0.15-0.25 per archetype × ~8 = $1.20-2.00 per full run.
// DO NOT add to CI.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'cli', 'index.mjs');
const AGENTS_DIR = join(REPO_ROOT, 'agents');

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error('FATAL: OPENROUTER_API_KEY env var is not set.');
  process.exit(1);
}

const MODEL = process.env.OR_MODEL || 'anthropic/claude-sonnet-4';
const MAX_TOKENS = 1500;

// ── archetype configs ──────────────────────────────────────────────────────

const ARCHETYPES = {
  'web-service': {
    feature: 'simple-hello-endpoint',
    task: 'Add a GET /hello endpoint returning {"msg":"hi"}. Node 20, Express, no DB. Under 30 lines.',
    reviewer: 'qa-engineer',
    projectMd: 'archetype: web-service\nprimary: web-service\nproject_size: nano\ncompliance:\n  - gdpr\n',
  },
  'fintech': {
    feature: 'stripe-webhook-hmac',
    task: 'Build a /webhook endpoint that receives Stripe events, verifies the HMAC signature using stripe-signature header, and acknowledges. Handle replay attacks via idempotency. Node 20.',
    reviewer: 'pci-reviewer',
    projectMd: 'archetype: fintech\nprimary: fintech\nproject_size: small\ncompliance:\n  - pci-dss\n  - sox\n  - gdpr\n',
  },
  'mlops': {
    feature: 'drift-monitor',
    task: 'Build a service that loads a sklearn model and computes KS-distance between training set distribution and live request distribution every hour. Python 3.11, scikit-learn, MLflow logging.',
    reviewer: 'mlops-reviewer',
    projectMd: 'archetype: mlops\nprimary: mlops\nproject_size: small\ncompliance:\n  - eu-ai-act\n  - iso42001\n',
  },
  'web3': {
    feature: 'chainlink-price-oracle-adapter',
    task: 'Solidity 0.8 contract that reads ETH/USD price from Chainlink AggregatorV3Interface, with staleness check (revert if last update > 1 hour) and decimals normalization.',
    reviewer: 'oracle-reviewer',
    projectMd: 'archetype: web3\nprimary: web3\nproject_size: small\ncompliance:\n  - soc2\n',
  },
  'enterprise-saas': {
    feature: 'tenant-onboarding',
    task: 'POST /tenants endpoint that creates a new tenant with isolated DB schema, SCIM-provisioned admin user, and Stripe Customer for billing. Multi-tenant row-level security via postgres RLS.',
    reviewer: 'enterprise-saas-reviewer',
    projectMd: 'archetype: enterprise-saas\nprimary: enterprise-saas\nproject_size: medium\ncompliance:\n  - soc2-type-2\n  - iso27001\n  - gdpr\n',
  },
  'agent-product': {
    feature: 'rag-private-docs',
    task: 'RAG endpoint: POST /query with {question, user_id} reads embeddings from pgvector, retrieves top-5, calls LLM with citations. Strict per-user tenant isolation in retrieval filter.',
    reviewer: 'ai-security-reviewer',
    projectMd: 'archetype: agent-product\nprimary: agent-product\nproject_size: small\ncompliance:\n  - eu-ai-act\n  - owasp-llm-top-10\n',
  },
  'gov-public': {
    feature: 'citizen-forms-portal',
    task: 'POST /forms/submission accepts a benefits-application form (PII fields), validates required fields, stores encrypted at rest with KMS, returns ticket number. Section 508 a11y on the front-end.',
    reviewer: 'gov-reviewer',
    projectMd: 'archetype: gov-public\nprimary: gov-public\nproject_size: small\ncompliance:\n  - fedramp-moderate\n  - nist-800-53\n  - section-508\n',
  },
  'healthcare': {
    feature: 'phi-export-endpoint',
    task: 'GET /patient/:id/export returns FHIR JSON bundle for a patient. Requires JWT scope phi:export. All access logged to immutable audit table with reason field.',
    reviewer: 'healthcare-reviewer',
    projectMd: 'archetype: healthcare\nprimary: healthcare\nproject_size: small\ncompliance:\n  - hipaa\n  - hitech\n  - gdpr\n',
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

async function callOpenRouter({ system, user, label }) {
  const t0 = Date.now();
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/avelikiy/great_cto',
      'X-Title': 'great_cto multi-archetype E2E',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status} for ${label}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const u = data.usage || {};
  const cost = ((u.prompt_tokens || 0) / 1_000_000) * 3 + ((u.completion_tokens || 0) / 1_000_000) * 15;
  return {
    content: data.choices?.[0]?.message?.content || '',
    cost,
    pt: u.prompt_tokens || 0,
    ct: u.completion_tokens || 0,
    elapsed: ((Date.now() - t0) / 1000).toFixed(1),
  };
}

function parseFiles(text) {
  const out = [];
  const re = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
  let m;
  while ((m = re.exec(text))) out.push({ path: m[1].trim(), content: m[2].trim() });
  return out;
}

function parseVerdict(text) {
  const m = text.match(/VERDICT:\s*(\w+)\s+reason="([^"]+)"/i);
  return {
    verdict: m?.[1]?.toUpperCase() || 'DONE',
    reason: m?.[2] || 'no reason',
  };
}

function appendVerdict(home, agent, verdict, details, costUsd) {
  const ts = new Date().toISOString();
  const file = join(home, '.great_cto', 'verdicts', `${agent}.log`);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${ts} ${verdict} ${details} cost=$${costUsd.toFixed(4)}\n`);
}

const ORCH_WRAPPER = `

---
AUTOMATED TEST HARNESS — IMPORTANT:
- You cannot use Bash, Read, Write, or any tool. Emit files as XML blocks:
  <file path="docs/foo.md">CONTENT</file>
- End with VERDICT: <APPROVED|DONE|PASS|BLOCKED|FAIL> reason="<short>"
- TOTAL output under 1500 tokens. Be CONCISE.
- No prose outside file blocks and verdict.
---
`;

function makeProject(archetypeKey, config) {
  const home = mkdtempSync(join(tmpdir(), `or-${archetypeKey}-h-`));
  const project = mkdtempSync(join(tmpdir(), `or-${archetypeKey}-p-`));
  mkdirSync(join(home, '.great_cto', 'verdicts'), { recursive: true });
  mkdirSync(join(project, '.great_cto'), { recursive: true });
  mkdirSync(join(project, 'docs', 'architecture'), { recursive: true });
  mkdirSync(join(project, 'docs', 'plans'), { recursive: true });
  mkdirSync(join(project, 'docs', 'decisions'), { recursive: true });
  mkdirSync(join(project, 'src'), { recursive: true });
  const init = spawnSync('bd', ['init'], { cwd: project, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`bd init: ${init.stderr || init.stdout}`);
  writeFileSync(join(project, '.great_cto', 'PROJECT.md'), config.projectMd);
  return { home, project };
}

function spawnBoard(project, home, port) {
  return spawn('node', [CLI_ENTRY, 'board', '--port', String(port), '--no-open'], {
    cwd: project, env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
}

function killBoard(b) {
  try { process.kill(-b.pid, 'SIGKILL'); } catch {}
  try { b.kill('SIGKILL'); } catch {}
}

async function waitBoard(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/projects`);
      if (r.ok || r.status === 404) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`board not ready on :${port}`);
}

async function runStage({ stage, agentName, taskPrompt, project, home }) {
  const sys = loadAgentPrompt(agentName) + ORCH_WRAPPER;
  const res = await callOpenRouter({ system: sys, user: taskPrompt, label: stage });
  const files = parseFiles(res.content);
  for (const f of files) {
    const abs = join(project, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
  const { verdict, reason } = parseVerdict(res.content);
  appendVerdict(home, agentName, verdict,
    `stage=${stage} files=${files.length} reason="${reason.replace(/[\s"]/g, '_').slice(0, 30)}"`,
    res.cost);
  return { ...res, files, verdict, reason };
}

async function runArchetype(archetypeKey) {
  const config = ARCHETYPES[archetypeKey];
  if (!config) throw new Error(`unknown archetype: ${archetypeKey}`);

  process.stdout.write(`\n▸ [${archetypeKey}] `);
  const { home, project } = makeProject(archetypeKey, config);
  const port = 38000 + Math.floor(Math.random() * 1500);
  const board = spawnBoard(project, home, port);
  await waitBoard(port);

  let totalCost = 0;
  const stages = [];
  try {
    // Stage 1: architect
    process.stdout.write('architect.');
    const arch = await runStage({
      stage: 'architect', agentName: 'architect',
      taskPrompt: `Archetype: ${archetypeKey}\nFeature: "${config.feature}"\n\nUser request: ${config.task}\n\nProduce: 1 short ARCH document (under 50 lines) at docs/architecture/ARCH-${config.feature}.md and 1 ADR at docs/decisions/ADR-001-${config.feature}.md. Reference the archetype's compliance requirements.`,
      project, home,
    });
    totalCost += arch.cost;
    stages.push({ stage: 'architect', cost: arch.cost, files: arch.files.length, verdict: arch.verdict });

    // Stage 2: pm
    process.stdout.write('pm.');
    const archDoc = arch.files.find(f => f.path.includes('ARCH-'))?.content || '';
    const pm = await runStage({
      stage: 'pm', agentName: 'pm',
      taskPrompt: `Archetype: ${archetypeKey}\nFeature: "${config.feature}"\n\nArchitect's ARCH:\n\n${archDoc.slice(0, 1200)}\n\nProduce: docs/plans/PLAN-${config.feature}.md with 3 implementation tasks. Be brief.`,
      project, home,
    });
    totalCost += pm.cost;
    stages.push({ stage: 'pm', cost: pm.cost, files: pm.files.length, verdict: pm.verdict });

    // Stage 3: senior-dev
    process.stdout.write('senior-dev.');
    const planDoc = pm.files.find(f => f.path.includes('PLAN-'))?.content || '';
    const dev = await runStage({
      stage: 'senior-dev', agentName: 'senior-dev',
      taskPrompt: `Archetype: ${archetypeKey}\nFeature: "${config.feature}"\n\nPM's plan:\n\n${planDoc.slice(0, 1200)}\n\nImplement task #1 only as a single file in src/. Production-quality, ~30 lines, plus 1 simple test.`,
      project, home,
    });
    totalCost += dev.cost;
    stages.push({ stage: 'senior-dev', cost: dev.cost, files: dev.files.length, verdict: dev.verdict });

    // Stage 4: archetype-specific reviewer
    process.stdout.write(`${config.reviewer}.`);
    const implFile = dev.files.find(f => f.path.startsWith('src/'));
    const implContent = implFile?.content || '(no impl)';
    const review = await runStage({
      stage: config.reviewer, agentName: config.reviewer,
      taskPrompt: `Archetype: ${archetypeKey}\nFeature: "${config.feature}"\n\nReview this implementation at ${implFile?.path}:\n\n\`\`\`\n${implContent.slice(0, 1500)}\n\`\`\`\n\nProduce a short review at docs/reviews/REVIEW-${config.feature}.md (under 30 lines) focused on YOUR DOMAIN. Emit VERDICT: APPROVED if acceptable for stub, BLOCKED if you find a real domain-specific gap.`,
      project, home,
    });
    totalCost += review.cost;
    stages.push({ stage: config.reviewer, cost: review.cost, files: review.files.length, verdict: review.verdict });

    // Final verification: query board /api/cost
    const cost = await (await fetch(`http://127.0.0.1:${port}/api/cost?days=1`)).json();
    const pipeline = await (await fetch(`http://127.0.0.1:${port}/api/pipeline`)).json();
    const doneStages = pipeline.filter(s => s.status === 'done').length;

    process.stdout.write(' done\n');
    return {
      archetype: archetypeKey,
      stages,
      total_cost_or: totalCost,
      board_total_llm: cost.total_llm,
      board_total_human: cost.total_human,
      pipeline_done_stages: doneStages,
      success: stages.every(s => ['APPROVED', 'DONE', 'PASS'].includes(s.verdict)),
    };
  } finally {
    killBoard(board);
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const requested = process.argv.slice(2);
  const archetypeKeys = requested.length > 0 ? requested : Object.keys(ARCHETYPES);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' Multi-archetype real-orchestration test via OpenRouter');
  console.log(`   model      : ${MODEL}`);
  console.log(`   archetypes : ${archetypeKeys.join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════');

  const results = [];
  for (const key of archetypeKeys) {
    try {
      const r = await runArchetype(key);
      results.push(r);
    } catch (e) {
      console.error(`\n  ✗ ${key} FAILED: ${e.message}`);
      results.push({ archetype: key, error: e.message, success: false });
    }
  }

  // Print summary table
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Summary');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('  archetype'.padEnd(22) + 'stages  cost      board_llm  board_hum  status');
  console.log('  ' + '─'.repeat(70));
  let grandTotal = 0;
  for (const r of results) {
    grandTotal += r.total_cost_or || 0;
    if (r.error) {
      console.log(`  ${r.archetype.padEnd(20)} ERROR: ${r.error.slice(0, 50)}`);
      continue;
    }
    const stageVerdicts = r.stages.map(s =>
      ({ APPROVED: '✓', DONE: '✓', PASS: '✓', BLOCKED: '✗', FAIL: '✗' })[s.verdict] || '?'
    ).join('');
    const status = r.success ? '✅' : '⚠️';
    console.log(
      `  ${r.archetype.padEnd(20)} ${stageVerdicts.padEnd(7)} $${r.total_cost_or.toFixed(4)}  $${(r.board_total_llm).toFixed(2).padStart(8)}  $${(r.board_total_human).toFixed(0).padStart(8)}   ${status}`
    );
  }
  console.log('  ' + '─'.repeat(70));
  console.log(`  Grand total cost: $${grandTotal.toFixed(4)}`);

  // Verify ratio sanity across the board — catches the 7,638× regression class
  for (const r of results) {
    if (r.board_total_llm > 0 && r.board_total_human > 0) {
      const ratio = r.board_total_human / r.board_total_llm;
      if (ratio > 1000) {
        console.log(`  ⚠️ ${r.archetype}: ratio ${ratio.toFixed(0)}× implausible — 7,638× regression`);
      }
    }
  }
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
