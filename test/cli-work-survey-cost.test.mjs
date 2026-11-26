import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseProject } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-survey-cost-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout };
}

const survey = (h, gh = async () => '[]') => surveyUnmerged(h.root, { now: NOW, gh, reviews: join(h.base, 'auto-review') });

/** The most `git` commands `work` had running at once, counted by a `git` on PATH that holds a slot while the real one runs. */
async function mostGitAtOnce(t, work) {
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-git-count-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const slots = join(folder, 'slots');
  const counts = join(folder, 'counts');
  mkdirSync(slots);
  mkdirSync(join(folder, 'bin'));
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const shim = join(folder, 'bin', 'git');
  const script = [
    '#!/bin/sh',
    `mkdir "${slots}/$$"`,
    `ls "${slots}" | wc -l >> "${counts}"`,
    `"${realGit}" "$@"`,
    'status=$?',
    `rmdir "${slots}/$$"`,
    'exit $status',
  ];
  writeFileSync(shim, `${script.join('\n')}\n`);
  chmodSync(shim, 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${join(folder, 'bin')}:${path}`;
  try {
    await work();
  } finally {
    process.env.PATH = path;
  }
  return Math.max(...readFileSync(counts, 'utf8').split('\n').filter(Boolean).map(Number));
}

test('a survey of many branches runs at most two git commands at once', async t => {
  const h = workspace(t);
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) branched(h.checkout, `hobkin/${index}`);

  const most = await mostGitAtOnce(t, () => survey(h));

  assert.ok(most <= 2, `${most} git commands ran at once`);
  assert.equal(readUnmerged(h.root).projects.api.open.length, 8);
});
