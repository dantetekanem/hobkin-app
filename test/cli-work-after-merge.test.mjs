import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { initialize } from '../src/cli/config.mjs';
import { readWaiting } from '../src/cli/pending-read.mjs';
import { afterMerges } from '../src/cli/work/after-merge.mjs';
import { mergeItem, mergePullRequest } from '../src/cli/work/controls.mjs';
import { chooseProject, fileItem, readItems, updateItem } from '../src/cli/work/store.mjs';
import { AFTER_MERGE, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { branched, pull, repository } from './helpers/work-fixture.mjs';

// A merge ends the work, whatever way it merged: nothing waits for the user to mark it done. What its run left for them is told once in Chat,
// and the GitHub issue it came from is closed. Nothing here reaches GitHub: gh is always the test's, and every address is on .invalid.

const NOW = Date.parse('2026-06-01T12:00:00Z');
const proved = { proof: 'It failed, then it passed.' };
const PR = 'https://github.invalid/acme/api/pull/7';

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-after-merge-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout };
}

/** Finished work on its own branch, as a run leaves it. */
function finished(h, branch, change = {}) {
  const key = `work ${readItems(h.root, 'api').length}`;
  const { id } = fileItem(h.root, 'api', { key, kind: 'fix', title: key, brief: 'Evidence and first change.' }, NOW);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, ...proved, ...change }, NOW);
}

/** Finished work filed for issue acme/api#`number`, as the GitHub page or a project's pick-up files it. */
function fromIssue(h, number, branch, change = {}) {
  const issue = { repo: 'acme/api', number, url: `https://github.invalid/acme/api/issues/${number}` };
  const { id } = fileItem(h.root, 'api', { key: `gh-issue:acme/api#${number}`, kind: 'fix', title: `Issue ${number}`, brief: 'What goes wrong.', issue }, NOW);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, ...proved, ...change }, NOW);
}

const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
const lines = h => clientNoticesToPost(h.root).map(({ line, tone }) => [line, tone]);
const survey = (h, pulls = []) => surveyUnmerged(h.root, { now: NOW, gh: async () => JSON.stringify(pulls) });

/** gh as the test plays it: it writes down what it was asked, and answers an issue's state as told. A close it throws on fails like gh does. */
function fakeGh({ state = 'OPEN', close = null } = {}) {
  const asked = [];
  const gh = async args => {
    asked.push(args);
    if (args[0] !== 'issue') throw Error(`Not an issue command: ${args.join(' ')}`);
    if (args[1] === 'view') return JSON.stringify({ state });
    if (close) throw close;
    return '';
  };
  return { gh, asked };
}

const neverGh = async args => assert.fail(`gh was asked ${args.join(' ')}`);

test('a merge ends the work at once: nothing waits for the user, and what its run left is told in Chat once', async t => {
  const h = workspace(t);
  const left = 'Push main and deploy the site.';
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc', { left });
  await survey(h);

  await mergeItem(h.root, 'api', item.id, { now: NOW });
  const waiting = readWaiting(h.root, { now: NOW, reports: [] });
  await afterMerges(h.root, { now: NOW + 1000, gh: neverGh });
  await afterMerges(h.root, { now: NOW + 2000, gh: neverGh });

  assert.equal(read(h, item).state, 'merged');
  assert.deepEqual([...waiting.branches, ...waiting.yours].map(row => row.item), [], 'no card asks to mark it done');
  assert.deepEqual(lines(h), [[`Merged "work 0" on api. Still for you: ${left}`, 'useful']]);
});

test('a merged item from an issue closes the issue on GitHub, naming the commit that fixed it, once', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/12-fix', 'login.txt', 'login\n');
  const item = fromIssue(h, 12, 'hobkin/12-fix');
  const { gh, asked } = fakeGh();

  await mergeItem(h.root, 'api', item.id, { now: NOW });
  const { sha } = read(h, item).landed;
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await afterMerges(h.root, { now: NOW + 2000, gh });

  assert.deepEqual(asked, [
    ['issue', 'view', '12', '--repo', 'acme/api', '--json', 'state'],
    ['issue', 'close', '12', '--repo', 'acme/api', '--reason', 'completed', '--comment', `Fixed by ${sha}, merged by hobkin.`],
  ]);
  assert.deepEqual(lines(h), [['Merged "Issue 12" on api. Closed acme/api#12 on GitHub.', 'useful']]);
  assert.deepEqual([read(h, item).state, read(h, item).afterMerge.issue], ['merged', 'closed']);
});

test('an issue whose PR merged is closed naming the PR, with what its run left in the same line', async t => {
  const h = workspace(t);
  const item = fromIssue(h, 7, 'hobkin/7-fix', { state: 'pr', pr: PR, left: 'Announce it in the changelog.' });
  const merged = pull(7, { url: PR, state: 'MERGED', mergedAt: '2026-06-01T11:00:00Z', mergeCommit: { oid: 'abc1234' } });
  const host = async args => (args[1] === 'view' ? JSON.stringify(merged) : '');
  const { gh, asked } = fakeGh();

  await mergePullRequest(h.root, 'api', item.id, { gh: host, now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.deepEqual(asked.at(-1), ['issue', 'close', '7', '--repo', 'acme/api', '--reason', 'completed', '--comment', `Fixed by ${PR}, merged by hobkin.`]);
  assert.deepEqual(lines(h), [['Merged "Issue 7" on api. Closed acme/api#7 on GitHub. Still for you: Announce it in the changelog.', 'useful']]);
});

test('an issue GitHub already closed, as a PR that fixes it does once it merges, is left as it is and said so', async t => {
  const h = workspace(t);
  const item = fromIssue(h, 7, 'hobkin/7-fix', { state: 'pr', pr: PR });
  const { gh, asked } = fakeGh({ state: 'CLOSED' });

  // The survey finds the PR merged on GitHub: the same pass follows that merge.
  await survey(h, [pull(7, { url: PR, state: 'MERGED', mergedAt: '2026-06-01T11:00:00Z' })]);
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.equal(read(h, item).state, 'merged');
  assert.deepEqual(asked, [['issue', 'view', '7', '--repo', 'acme/api', '--json', 'state']], 'nothing is closed twice');
  assert.deepEqual(lines(h), [['Merged "Issue 7" on api. GitHub had already closed acme/api#7.', 'useful']]);
  assert.equal(read(h, item).afterMerge.issue, 'already');
});

test('a gh that cannot close the issue is told once in plain words, and the merge stands', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/12-fix', 'login.txt', 'login\n');
  const item = fromIssue(h, 12, 'hobkin/12-fix');
  const refused = Object.assign(Error('Command failed: gh issue close'), { stderr: 'HTTP 403: Resource not accessible by personal access token\nmore detail' });
  const { gh, asked } = fakeGh({ close: refused });

  await mergeItem(h.root, 'api', item.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await afterMerges(h.root, { now: NOW + 2000, gh });

  assert.equal(asked.length, 2, 'it is not tried again by itself');
  assert.deepEqual(lines(h), [['Merged "Issue 12" on api. hobkin could not close acme/api#12 on GitHub: HTTP 403: Resource not accessible by personal access token', 'blocked']]);
  assert.deepEqual([read(h, item).state, read(h, item).afterMerge.issue], ['merged', 'failed']);
});

test('work merged before this pass existed is left alone, and a note that only says what was not delivered is not told', async t => {
  const h = workspace(t);
  const before = fromIssue(h, 3, 'hobkin/3-fix', { state: 'merged', left: 'Deploy it.' });
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const receipt = finished(h, 'hobkin/abc', { left: 'Nothing pushed, opened, merged, deployed or released' });

  await mergeItem(h.root, 'api', receipt.id, { now: NOW });
  const settled = await afterMerges(h.root, { now: NOW + 1000, gh: neverGh });

  assert.deepEqual(settled.map(({ id }) => id), [receipt.id]);
  assert.deepEqual(lines(h), []);
  assert.equal(read(h, before).afterMerge, undefined);
});

test("the director's tick follows every merge, without gh holding the tick", async t => {
  const h = director(t);
  studied(h, 'api');
  const { id } = fileItem(h.root, 'api', { key: 'merged one', kind: 'fix', title: 'Merged one', brief: 'Evidence.' }, h.clock);
  updateItem(h.root, 'api', id, { state: 'merged', left: 'Tell the team.', ...AFTER_MERGE }, h.clock);

  await h.director.tick();
  await h.director.settlingMerges;

  assert.deepEqual(lines(h), [['Merged "Merged one" on api. Still for you: Tell the team.', 'useful']]);
});
