import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { chooseProject } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

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
const unit = (h, name, slug = 'api') => readUnmerged(h.root).projects[slug].open.find(({ branch }) => branch === name);
const sleep = ms => new Promise(done => setTimeout(done, ms));

/** Changes what the last survey wrote down, so a survey that reads a branch again says so by writing what git says instead. */
function rewriteSaved(h, change) {
  const file = join(h.root, 'work', 'unmerged.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  for (const project of Object.values(saved.projects)) project.open = project.open.map(change);
  writeFileSync(file, JSON.stringify(saved));
}

function commitOn(checkout, branch, file, text) {
  git(checkout, 'switch', '-q', branch);
  commit(checkout, file, text);
  git(checkout, 'switch', '-q', 'main');
}

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

/** `work` with a `git` on PATH that fails every command whose arguments hold `failing`, and runs the real one for the rest. */
async function withGitFailing(t, failing, work) {
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-git-failing-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, 'bin'));
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const shim = join(folder, 'bin', 'git');
  const script = [
    '#!/bin/sh',
    `case "$*" in *"${failing}"*) exit 128 ;; esac`,
    `exec "${realGit}" "$@"`,
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
}

test('a branch that has not moved since the last survey keeps what was read of it, and one that moved is read again', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/still');
  branched(h.checkout, 'hobkin/moving');
  await survey(h);
  rewriteSaved(h, saved => ({ ...saved, title: 'kept' }));
  commitOn(h.checkout, 'hobkin/moving', 'more.txt', 'more\n');

  await survey(h);

  assert.equal(unit(h, 'hobkin/still').title, 'kept');
  assert.equal(unit(h, 'hobkin/moving').title, 'more');
});

test('a default branch that moved has every branch read again', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/still');
  await survey(h);
  rewriteSaved(h, saved => ({ ...saved, title: 'kept' }));
  commit(h.checkout, 'app.txt', 'main moved\n');

  await survey(h);

  assert.equal(unit(h, 'hobkin/still').title, 'hobkin/still');
  assert.equal(unit(h, 'hobkin/still').behind, 1);
});

test('a branch git could not read in full is read again at the next survey', async t => {
  const h = workspace(t);
  mkdirSync(join(h.checkout, 'test'));
  commit(h.checkout, 'test/a.test.js', 'a\n');
  git(h.checkout, 'switch', '-qc', 'hobkin/drops-a-test');
  git(h.checkout, 'rm', '-q', 'test/a.test.js');
  git(h.checkout, 'commit', '-qm', 'Drop a test');
  git(h.checkout, 'switch', '-q', 'main');
  await withGitFailing(t, '--diff-filter=D', () => survey(h));
  assert.deepEqual(unit(h, 'hobkin/drops-a-test').deletedTests, []);

  await survey(h);

  assert.deepEqual(unit(h, 'hobkin/drops-a-test').deletedTests, ['test/a.test.js']);
});

test('whether another branch of the user holds a change is asked once for the two heads, and again when either moves', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/copied', 'copied.txt', 'copied\n');
  git(h.checkout, 'switch', '-q', '-c', 'release/now');
  // -x makes the copy its own commit, even within the second the branch's was made.
  git(h.checkout, 'cherry-pick', '-x', 'hobkin/copied');
  git(h.checkout, 'switch', '-q', 'main');
  await survey(h);
  assert.equal(unit(h, 'hobkin/copied').landedOn, 'release/now');
  rewriteSaved(h, saved => ({ ...saved, landedOn: null }));

  await survey(h);
  assert.equal(unit(h, 'hobkin/copied').landedOn, null);

  commitOn(h.checkout, 'release/now', 'release.txt', 'release\n');
  await survey(h);
  assert.equal(unit(h, 'hobkin/copied').landedOn, 'release/now');
});

test('a survey of many branches runs at most two git commands at once', async t => {
  const h = workspace(t);
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) branched(h.checkout, `hobkin/${index}`);

  const most = await mostGitAtOnce(t, () => survey(h));

  assert.ok(most <= 2, `${most} git commands ran at once`);
  assert.equal(readUnmerged(h.root).projects.api.open.length, 8);
});

test('a survey of a repository with specs still runs at most two git commands at once', async t => {
  const h = workspace(t);
  mkdirSync(join(h.checkout, '_specs', 'tla', 'work'), { recursive: true });
  for (const name of ['One', 'Two', 'Three']) commit(h.checkout, `_specs/tla/work/${name}.tla`, `---- MODULE ${name} ----\n====\n`);
  for (const index of [1, 2, 3, 4]) branched(h.checkout, `hobkin/${index}`);

  const most = await mostGitAtOnce(t, () => survey(h));

  assert.ok(most <= 2, `${most} git commands ran at once`);
});

test('hobkin work sync with a project surveys only that project, and the others keep what they had', async t => {
  const h = workspace(t);
  const web = repository(h.base, 'web');
  chooseProject(h.root, web, 'important', NOW);
  branched(h.checkout, 'hobkin/api-work');
  branched(web, 'hobkin/web-work');
  await survey(h);
  rewriteSaved(h, saved => ({ ...saved, title: 'kept' }));
  commit(h.checkout, 'app.txt', 'main moved\n');
  commit(web, 'app.txt', 'main moved\n');

  const { message } = await runWorkCommand(h.root, ['sync', 'web']);

  assert.match(message, /^Checked web\./);
  assert.equal(unit(h, 'hobkin/web-work', 'web').title, 'hobkin/web-work');
  assert.equal(unit(h, 'hobkin/api-work').title, 'kept');
});

test('a survey of one project goes into the record as it stands when it ends, so what was written meanwhile stays', async t => {
  const h = workspace(t);
  const web = repository(h.base, 'web');
  chooseProject(h.root, web, 'important', NOW);
  branched(h.checkout, 'hobkin/api-work');
  branched(web, 'hobkin/web-work');
  await survey(h);
  const writesMeanwhile = async () => {
    rewriteSaved(h, saved => (saved.branch === 'hobkin/api-work' ? { ...saved, title: 'written meanwhile' } : saved));
    return '[]';
  };

  await surveyUnmerged(h.root, { now: NOW, gh: writesMeanwhile, reviews: join(h.base, 'auto-review'), only: 'web' });

  assert.equal(unit(h, 'hobkin/api-work').title, 'written meanwhile');
  assert.equal(unit(h, 'hobkin/web-work', 'web').title, 'hobkin/web-work');
});

test('hobkin work sync with a project it does not know says so', async t => {
  const h = workspace(t);

  await assert.rejects(runWorkCommand(h.root, ['sync', 'nope']), /Unknown project: nope/);
});

test('two surveys of one home take turns', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc');
  const spans = [];
  const slowGh = async () => {
    const start = Date.now();
    await sleep(300);
    spans.push([start, Date.now()]);
    return '[]';
  };

  await Promise.all([survey(h, slowGh), survey(h, slowGh)]);

  const [first, second] = spans.toSorted(([a], [b]) => a - b);
  assert.ok(second[0] >= first[1], 'the second survey asked its host while the first still was');
});

test('a survey lock left by a holder long gone does not hold a survey up', { timeout: 20000 }, async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc');
  const lock = join(h.root, 'work', 'survey.lock');
  mkdirSync(lock, { recursive: true });
  const longAgo = new Date(Date.now() - 10 * 60000);
  utimesSync(lock, longAgo, longAgo);

  await survey(h);

  assert.ok(unit(h, 'hobkin/abc'));
});
