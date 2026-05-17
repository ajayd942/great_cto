// Tests for scripts/hooks/session-end.mjs
//
// Run with:  node --test tests/hooks/session-end.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../scripts/hooks/session-end.mjs');

/** A throwaway project dir + a throwaway HOME (so symlink registration never touches the real home). */
function makeSandbox() {
  const base = join(tmpdir(), `gc-sessionend-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const project = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { base, project, home };
}

/** Run the hook in `project` with the SessionEnd JSON payload on stdin. */
function run(project, home, { payload = { session_id: 'abcd1234', reason: 'normal' }, env = {} } = {}) {
  const r = spawnSync('node', [SCRIPT], {
    cwd: project,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: { ...process.env, HOME: home, ...env },
  });
  return { exit: r.status, stdout: r.stdout, stderr: r.stderr };
}

function sessionLog(project) {
  const dir = join(project, '.great_cto', 'logs');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((n) => /^session-.*-end\.md$/.test(n));
  return f ? join(dir, f) : null;
}

test('seeds brain.md and lessons.md when they are missing', () => {
  const { base, project, home } = makeSandbox();
  try {
    const r = run(project, home);
    assert.equal(r.exit, 0);

    const brain = join(project, '.great_cto', 'brain.md');
    const lessons = join(project, '.great_cto', 'lessons.md');
    assert.ok(existsSync(brain), 'brain.md should be seeded');
    assert.ok(existsSync(lessons), 'lessons.md should be seeded');
    assert.match(readFileSync(brain, 'utf8'), /# Project Brain —/);
    assert.match(readFileSync(lessons, 'utf8'), /run `\/learn`/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('does not overwrite an existing brain.md / lessons.md', () => {
  const { base, project, home } = makeSandbox();
  try {
    mkdirSync(join(project, '.great_cto'), { recursive: true });
    writeFileSync(join(project, '.great_cto', 'brain.md'), 'SENTINEL-BRAIN');
    writeFileSync(join(project, '.great_cto', 'lessons.md'), 'SENTINEL-LESSONS');

    run(project, home);

    assert.equal(readFileSync(join(project, '.great_cto', 'brain.md'), 'utf8'), 'SENTINEL-BRAIN');
    assert.equal(readFileSync(join(project, '.great_cto', 'lessons.md'), 'utf8'), 'SENTINEL-LESSONS');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('writes a session snapshot log without the stale "Phase 2 placeholder" text', () => {
  const { base, project, home } = makeSandbox();
  try {
    run(project, home);
    const log = sessionLog(project);
    assert.ok(log, 'a session log should be written');
    const body = readFileSync(log, 'utf8');
    assert.match(body, /# Session ended \(auto-capture\)/);
    assert.match(body, /Next: capture lessons/);
    assert.doesNotMatch(body, /Phase 2 placeholder/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('drops a .learn-pending marker when the session did real work', () => {
  const { base, project, home } = makeSandbox();
  try {
    // A git repo with an untracked file → `git status --short` is non-empty
    // → the hook treats the session as having done work.
    spawnSync('git', ['init', '-q'], { cwd: project });
    writeFileSync(join(project, 'work.txt'), 'uncommitted change');

    run(project, home);

    const marker = join(project, '.great_cto', '.learn-pending');
    assert.ok(existsSync(marker), '.learn-pending should be created');
    const log = sessionLog(project);
    assert.ok(log, 'session log should exist');
    // The marker lists the session log it corresponds to.
    assert.match(readFileSync(marker, 'utf8'), /session-.*-end\.md/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('does not drop a marker for a trivial session with no work', () => {
  const { base, project, home } = makeSandbox();
  try {
    // Not a git repo, no commits, no uncommitted changes → no marker.
    run(project, home);
    assert.equal(
      existsSync(join(project, '.great_cto', '.learn-pending')),
      false,
      '.learn-pending should not be created when nothing happened',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('GREAT_CTO_DISABLE_SESSION_LEARNING=1 is a clean no-op', () => {
  const { base, project, home } = makeSandbox();
  try {
    const r = run(project, home, { env: { GREAT_CTO_DISABLE_SESSION_LEARNING: '1' } });
    assert.equal(r.exit, 0);
    assert.equal(existsSync(join(project, '.great_cto', 'brain.md')), false);
    assert.equal(existsSync(join(project, '.great_cto', 'logs')), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
