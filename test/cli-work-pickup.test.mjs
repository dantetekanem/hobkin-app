import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, readItems, updateItem } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const brief = 'Evidence, who benefits, the first change, the proof.';

// Backups.

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-pickup-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout, reviews: join(base, 'auto-review') };
}

const survey = (h, now = NOW) => surveyUnmerged(h.root, { now, gh: async () => '[]', reviews: h.reviews });
const read = (h, { id }) => readItems(h.root, 'api').find(found => found.id === id);
const openBranches = h => readUnmerged(h.root).projects.api.open.map(({ branch }) => branch);

function filedAs(h, key, change, kind = 'fix') {
  const { id } = fileItem(h.root, 'api', { key, kind, title: key, brief }, NOW);
  return updateItem(h.root, 'api', id, change, NOW);
}

/** What a run saves before it rewrites a branch: a copy under the names found in real repositories. */
const backUp = (h, branch, copy) => git(h.checkout, 'branch', copy, branch);

test('a backup a run made of a branch is no work: no unit, no item of its own and no rebase', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc-fix', 'app.txt');
  filedAs(h, 'work', { state: 'branch', branch: 'hobkin/abc-fix' });
  backUp(h, 'hobkin/abc-fix', 'hobkin/abc-fix-before-c289e6');
  backUp(h, 'hobkin/abc-fix', 'hobkin/abc-before-rebase-b9be7852');
  commit(h.checkout, 'app.txt', 'main moved\n');

  const { adopted } = await survey(h);
  await survey(h, NOW + 1000);

  assert.deepEqual(adopted, []);
  assert.deepEqual(openBranches(h), ['hobkin/abc-fix']);
  assert.deepEqual(readItems(h.root, 'api').map(({ kind, branch }) => [kind, branch]), [['fix', 'hobkin/abc-fix'], ['pr-fix', 'hobkin/abc-fix']]);
});

test('what the survey filed for a backup is dropped at the next survey with its branch kept, and nothing anyone else filed changes', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc-fix');
  backUp(h, 'hobkin/abc-fix', 'hobkin/abc-fix-before-c289e6');
  backUp(h, 'hobkin/abc-fix', 'hobkin/abc-before-rebase-b9be7852');
  const stray = filedAs(h, 'branch:hobkin/abc-fix-before-c289e6', { state: 'branch', branch: 'hobkin/abc-fix-before-c289e6' }, 'chore');
  const rebase = filedAs(h, 'ship:rebase:hobkin/abc-before-rebase-b9be7852:1234567', { branch: 'hobkin/abc-before-rebase-b9be7852', ships: stray.id }, 'pr-fix');
  const closed = filedAs(h, 'ship:rebase:hobkin/abc-fix-before-c289e6:7654321', { state: 'done', branch: 'hobkin/abc-fix-before-c289e6' }, 'pr-fix');
  const byAnAgent = filedAs(h, 'bugs:the copy', { branch: 'hobkin/abc-fix-before-c289e6' });
  const byTheUser = filedAs(h, 'hand:look at the copy', { branch: 'hobkin/abc-before-rebase-b9be7852' }, 'improvement');
  const realStray = filedAs(h, 'branch:hobkin/abc-fix', { state: 'branch', branch: 'hobkin/abc-fix' }, 'chore');

  const { retired } = await survey(h);

  assert.deepEqual(retired.map(({ id }) => id), [stray.id, rebase.id]);
  for (const backup of [stray, rebase]) {
    const { state, branch, reason } = read(h, backup);
    assert.deepEqual([state, branch], ['dropped', backup.branch]);
    assert.match(reason, /backup/);
  }
  const untouched = [closed, byAnAgent, byTheUser, realStray].map(found => read(h, found));
  assert.deepEqual(untouched.map(({ state }) => state), ['done', 'open', 'open', 'branch']);
  assert.deepEqual(untouched.map(({ reason }) => reason), [undefined, undefined, undefined, undefined]);
});

test('a backup outside hobkin\'s branches is not where the work it copies landed', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc-fix');
  const work = filedAs(h, 'work', { state: 'branch', branch: 'hobkin/abc-fix' });
  backUp(h, 'hobkin/abc-fix', 'backup/abc-before-rebase-20261102');

  await survey(h);

  const [unit] = readUnmerged(h.root).projects.api.open;
  assert.deepEqual([unit.branch, unit.landedOn], ['hobkin/abc-fix', null]);
  assert.equal(readyItems(h.root).find(row => row.item === work.id).gap, 'land');
});
