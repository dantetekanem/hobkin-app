import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { syncWork } from '../src/cli/work/controls.mjs';
import { readReviewGrades } from '../src/cli/work/grades.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, prFile, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t, mode = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-reviews-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  writeMode(root, { enabled: true, ...mode });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout, reviews: join(base, 'auto-review') };
}

/** Work finished on its own branch, described and proved, so a grade is all it can lack. */
function finished(h, name, { file = `${name}.txt`, text = `${name}\n`, ...change } = {}) {
  const branch = `hobkin/${name}`;
  branched(h.checkout, branch, file, text);
  const { id } = fileItem(h.root, 'api', { key: name, kind: 'fix', title: `Fix ${name}`, brief: 'Evidence and first change.' }, NOW);
  mkdirSync(dirname(prFile(h.root, 'api', id)), { recursive: true });
  writeFileSync(prFile(h.root, 'api', id), `Fix ${name}\n`);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'It failed, then it passed.', ...change }, NOW);
}

/** A finished review as pi-auto-review leaves it. `read` holds the fields that say which commits it read. */
function reviewed(h, name, read, grade = 'safe', rating = 'A') {
  const folder = join(h.reviews, 'session');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${name}.review.json`);
  writeFileSync(file, JSON.stringify({ status: 'complete', ...read, grades: { merge: { grade, rating, reason: 'It reads well.' }, deploy: null } }));
  return file;
}

function onBranch(h, branch, file, text) {
  git(h.checkout, 'switch', '-q', branch);
  commit(h.checkout, file, text);
  git(h.checkout, 'switch', '-q', 'main');
}

const tipOf = (h, name) => git(h.checkout, 'rev-parse', name);
const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
const safetyOf = (h, { id }) => readyItems(h.root).find(({ item }) => item === id).safety;
const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: h.reviews });

// Which commit a grade belongs to.

test('a grade goes to the commit a review read up to, not the one it started from', async t => {
  const h = workspace(t);
  const item = finished(h, 'abc', { file: 'first.txt' });
  const started = tipOf(h, 'hobkin/abc');
  onBranch(h, 'hobkin/abc', 'second.txt', 'second\n');
  reviewed(h, 'abc', { preflight: { head: started }, reviewedRange: `main..${tipOf(h, 'hobkin/abc')}` });

  await survey(h);

  const { grade, rating, stale } = safetyOf(h, item);
  assert.deepEqual([grade, rating, stale], ['safe', 'A', undefined]);
});

test('a newer review of another commit leaves a branch its own grade, whatever commit that review started from', async t => {
  const h = workspace(t);
  const item = finished(h, 'abc');
  const tip = tipOf(h, 'hobkin/abc');
  const own = reviewed(h, 'own', { preflight: { head: tip } });
  utimesSync(own, new Date(NOW - HOUR), new Date(NOW - HOUR));
  reviewed(h, 'release-prep', { preflight: { head: tip }, reviewedRange: { base: tip, head: 'c90e6b02' } }, 'risky', 'D');

  await survey(h);

  const { grade, rating, stale } = safetyOf(h, item);
  assert.deepEqual([grade, rating, stale], ['safe', 'A', undefined]);
  assert.equal(readReviewGrades({ folder: h.reviews, now: NOW }).get('c90e6b02').grade, 'risky');
});

test('with no range a review goes to the revision it names, and only then to the commit it started from', t => {
  const h = workspace(t);
  reviewed(h, 'revision', { revision: 'bbb222', preflight: { head: 'aaa111' } });
  reviewed(h, 'started', { preflight: { head: 'ccc333' } });

  const grades = readReviewGrades({ folder: h.reviews, now: NOW });

  assert.deepEqual([...grades.keys()].toSorted(), ['bbb222', 'ccc333']);
});

test('sync reads saved grades independently of the review directory', async t => {
  const h = workspace(t);
  const graded = finished(h, 'graded');
  const ungraded = finished(h, 'ungraded');
  reviewed(h, 'graded', { preflight: { head: tipOf(h, graded.branch) } });
  const { PATH, PI_CODING_AGENT_DIR } = process.env;
  t.after(() => {
    process.env.PATH = PATH;
    if (PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = PI_CODING_AGENT_DIR;
  });
  writeFileSync(join(h.base, 'gh'), '#!/bin/sh\nprintf "[]"\n', { mode: 0o755 });
  process.env.PATH = `${h.base}:${PATH}`;
  process.env.PI_CODING_AGENT_DIR = h.base;

  const synced = await syncWork(h.root);

  assert.equal(safetyOf(h, graded)?.grade, 'safe');
  assert.equal(safetyOf(h, ungraded), null);
  assert.deepEqual(synced.settled, []);
});

