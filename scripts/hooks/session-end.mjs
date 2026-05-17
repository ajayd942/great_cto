#!/usr/bin/env node
/**
 * SessionEnd hook.
 *
 * Three jobs, all best-effort, never blocking:
 *   1. Capture a session snapshot into .great_cto/logs/.
 *   2. Seed the memory files (brain.md, lessons.md) if missing, so the
 *      board's memory tab is never blank — it shows a real file that
 *      explains how to populate it.
 *   3. Drop a .great_cto/.learn-pending marker (when the session did real
 *      work) so the next SessionStart can nudge the user to run /learn.
 *
 * What this hook deliberately does NOT do: run the continuous-learner
 * agent. A SessionEnd hook executes in a sandbox with no access to the
 * agent fleet, so it physically cannot do the extraction. lessons.md is
 * populated when the user runs /learn (or /save) — this hook only makes
 * that need visible. The marker is cleared by /learn.
 *
 * Hook protocol:
 *   stdin:  { session_id, reason }    (Claude Code SessionEnd payload)
 *   stdout: nothing
 *   exit:   0 always (never block session shutdown)
 *
 * Opt-out: GREAT_CTO_DISABLE_SESSION_LEARNING=1
 *
 * @see docs/HOOKS.md
 * @see docs/LEARNING.md
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const LOG_DIR = '.great_cto/logs';
const HOME = homedir();
const GLOBAL_PROJECTS_DIR = join(HOME, '.great_cto', 'projects');
const LEARN_PENDING = '.great_cto/.learn-pending';
const BRAIN_FILE = '.great_cto/brain.md';
const LESSONS_FILE = '.great_cto/lessons.md';

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function nowParts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

function safeRun(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5_000 });
    return r.status === 0 ? (r.stdout || '').trim() : '';
  } catch { return ''; }
}

function captureGitState() {
  return {
    branch: safeRun('git', ['branch', '--show-current']) || 'unknown',
    lastCommit: safeRun('git', ['log', '--oneline', '-1']) || 'none',
    uncommitted: (safeRun('git', ['status', '--short']) || '').split('\n').filter(Boolean).length,
    commitsToday: (safeRun('git', ['log', '--oneline', '--since=8 hours ago']) || '').split('\n').filter(Boolean).length,
  };
}

function captureBeadsState() {
  return {
    open: (safeRun('bd', ['list', '--status', 'open']) || '').split('\n').filter(Boolean).length,
    blocked: (safeRun('bd', ['list', '--status', 'blocked']) || '').split('\n').filter(Boolean).length,
  };
}

function captureCostHint() {
  // Tail .great_cto/cost-history.log if it exists
  try {
    const txt = readFileSync('.great_cto/cost-history.log', 'utf8');
    const lines = txt.trim().split('\n');
    return lines.slice(-5).join('\n');
  } catch { return ''; }
}

/** Best-effort project name: first `# ` heading in PROJECT.md, else cwd basename. */
function projectName() {
  try {
    const txt = readFileSync('.great_cto/PROJECT.md', 'utf8');
    const m = txt.match(/^#\s+(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* fall through */ }
  return basename(process.cwd()) || 'project';
}

/**
 * Seed brain.md / lessons.md with honest placeholder content if they do
 * not exist. This is what keeps the board's memory tab from showing a
 * blank/missing file — the seeded file states exactly how to populate it.
 * Never overwrites an existing file.
 */
function seedMemoryFiles(name) {
  if (!existsSync(BRAIN_FILE)) {
    const brain = `# Project Brain — ${name}
> Compiled truth. Updated by /digest (dream cycle). Read by architect before designing.
> Do NOT edit manually. Evidence is appended; synthesis is recomputed from evidence.

## Current Synthesis

### Architecture Patterns in Use
_No data yet — run \`/digest\` to compile synthesis from session evidence._

### What Has Failed / Avoid
_No data yet_

### Tech Debt
_No data yet_

### Team Patterns
_No data yet_

---

## Evidence Timeline
_Appended by agents and /digest. Oldest at bottom, newest at top._
`;
    try { writeFileSync(BRAIN_FILE, brain); } catch { /* never block */ }
  }

  if (!existsSync(LESSONS_FILE)) {
    const lessons = `# Lessons — ${name}
> Append-only project lessons, written by the continuous-learner agent.
> Run \`/learn\` at the end of a working session to extract repeatable
> patterns, decisions and cost outliers into this file.
> The learner de-dupes by \`pattern:\` slug and never edits existing entries.

_No lessons captured yet — run \`/learn\`._
`;
    try { writeFileSync(LESSONS_FILE, lessons); } catch { /* never block */ }
  }
}

/**
 * Append this session's log to the .learn-pending marker so the next
 * SessionStart can surface "N session(s) not yet learned — run /learn".
 * Kept to the most recent 20 entries so it cannot grow unbounded.
 * /learn clears this file once the learner has run.
 */
function markLearnPending(sessionLog) {
  try {
    let lines = [];
    try {
      lines = readFileSync(LEARN_PENDING, 'utf8').split('\n').filter(Boolean);
    } catch { /* first pending session */ }
    if (!lines.includes(sessionLog)) lines.push(sessionLog);
    writeFileSync(LEARN_PENDING, lines.slice(-20).join('\n') + '\n');
  } catch { /* never block */ }
}

function main() {
  if (process.env.GREAT_CTO_DISABLE_SESSION_LEARNING === '1') return process.exit(0);

  const raw = readStdin();
  let payload = {};
  try { payload = JSON.parse(raw); } catch { /* tolerate empty stdin */ }

  const sessionId = (payload.session_id || 'unknown').slice(0, 8);
  const reason = payload.reason || 'normal';

  const { date, time } = nowParts();
  const git = captureGitState();
  const beads = captureBeadsState();
  const costHint = captureCostHint();

  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ok */ }

  const filename = `${LOG_DIR}/session-${date}-${time.replace(':', '')}-end.md`;
  const content = `---
date: ${date}
time: ${time}
session-id: ${sessionId}
reason: ${reason}
---

# Session ended (auto-capture)

## Git
- Branch: \`${git.branch}\`
- Last commit: \`${git.lastCommit}\`
- Uncommitted changes: ${git.uncommitted} files
- Commits in last 8h: ${git.commitsToday}

## Beads
- Open: ${beads.open}
- Blocked: ${beads.blocked}

## Cost (last 5 entries)
\`\`\`
${costHint || '(no cost log)'}
\`\`\`

## Next: capture lessons

This file is a snapshot, not an analysis. To extract repeatable patterns,
decisions and cost outliers from this session into \`.great_cto/lessons.md\`,
run **\`/learn\`**.

The SessionEnd hook cannot run the continuous-learner itself — it executes
in a sandbox with no agent access. A \`.great_cto/.learn-pending\` marker has
been left so the next session start reminds you. \`/learn\` clears it.
`;

  // Don't overwrite if a /save log already exists for this session.
  if (!existsSync(filename)) {
    try { writeFileSync(filename, content); } catch { /* never block */ }
  }

  // Seed memory files so the board's memory tab is never blank.
  seedMemoryFiles(projectName());

  // Flag the session for /learn — but only when real work happened, so
  // trivial / read-only sessions don't nag the user.
  if (git.commitsToday > 0 || git.uncommitted > 0) {
    markLearnPending(filename);
  }

  // --- Cross-project lessons registration ---
  // Register this project in ~/.great_cto/projects/<slug>/ via symlink to
  // its lessons.md, so lessons-merge.mjs can consolidate across projects.
  try {
    if (existsSync(LESSONS_FILE)) {
      mkdirSync(GLOBAL_PROJECTS_DIR, { recursive: true });
      const projectSlug = basename(process.cwd()).replace(/[^a-zA-Z0-9_-]/g, '-');
      const projectDir = join(GLOBAL_PROJECTS_DIR, projectSlug);
      mkdirSync(projectDir, { recursive: true });

      const linkPath = join(projectDir, 'lessons.md');
      const target = resolve(LESSONS_FILE);

      // Refresh symlink (target may have moved across runs)
      try { unlinkSync(linkPath); } catch { /* ok if doesn't exist */ }
      try { symlinkSync(target, linkPath); } catch { /* ok if FS doesn't support */ }
    }

    // Trigger lessons-merge in background (best-effort; failures silenced)
    const mergeScript = resolve(import.meta.dirname || '.', '..', 'lessons-merge.mjs');
    if (existsSync(mergeScript)) {
      const child = spawn('node', [mergeScript], {
        detached: true,
        stdio: 'ignore',
        timeout: 5_000,
      });
      child.unref();
    }
  } catch { /* never block session end */ }

  return process.exit(0);
}

main();
