import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientNotice, clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { initialize } from '../src/cli/config.mjs';
import { readWaiting } from '../src/cli/pending-read.mjs';
import { afterMerges } from '../src/cli/work/after-merge.mjs';
import { cardActionNotice, cardActionsToPost, markCardActionsPosted, recordCardAction } from '../src/cli/work/card-actions.mjs';
import { mergeItem, mergePullRequest } from '../src/cli/work/controls.mjs';
import { mergeGroup } from '../src/cli/work/merge-group.mjs';
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
  const filing = { key: `gh-issue:acme/api#${number}`, kind: 'fix', title: `Issue ${number}`, brief: 'What goes wrong.', issue };
  const { id } = fileItem(h.root, 'api', filing, NOW);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, ...proved, ...change }, NOW);
}

const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
const lines = h => clientNoticesToPost(h.root).map(({ line, tone }) => [line, tone]);
const survey = (h, pulls = []) => surveyUnmerged(h.root, { now: NOW, gh: async () => JSON.stringify(pulls) });

/** gh as the test plays it: it writes down what it was asked, and answers an issue's state as told. Given `closeError`, the close fails as gh does. */
function fakeGh({ state = 'OPEN', closeError = null } = {}) {
  const asked = [];
  const gh = async args => {
    asked.push(args);
    if (args[0] !== 'issue') throw Error(`Not an issue command: ${args.join(' ')}`);
    if (args[1] === 'view') return JSON.stringify({ state });
    if (closeError) throw closeError;
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
  await afterMerges(h.root, { now: NOW + 1000, gh: neverGh });
  await afterMerges(h.root, { now: NOW + 2000, gh: neverGh });
  const waiting = readWaiting(h.root, { now: NOW + 2000, reports: [] });

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
  // The PR open on its branch is the one it names, and it merged.
  const host = async args => {
    if (args[1] === 'list') return JSON.stringify([{ url: PR }]);
    return args[1] === 'view' ? JSON.stringify(merged) : '';
  };
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
  const { gh, asked } = fakeGh({ closeError: refused });

  await mergeItem(h.root, 'api', item.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await afterMerges(h.root, { now: NOW + 2000, gh });

  assert.equal(asked.length, 2, 'it is not tried again by itself');
  assert.deepEqual(lines(h), [['Merged "Issue 12" on api. hobkin could not close acme/api#12 on GitHub: HTTP 403: Resource not accessible by personal access token', 'blocked']]);
  assert.deepEqual([read(h, item).state, read(h, item).afterMerge.issue], ['merged', 'failed']);
});

test('an issue whose change landed through other work is closed naming that merge and that work, and what its run left is told once', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/112-fix', 'sale.txt', 'reject negative quantities\n', 'Reject negative sale quantities');
  branched(h.checkout, 'hobkin/129-fix', 'sale.txt', 'reject negative quantities\n', 'Return an error for selling more than owned');
  const first = fromIssue(h, 112, 'hobkin/112-fix');
  const duplicate = fromIssue(h, 129, 'hobkin/129-fix', { left: 'Watch the sale errors after the deploy.' });
  const { gh, asked } = fakeGh();

  await mergeItem(h.root, 'api', first.id, { now: NOW });
  const { sha } = read(h, first).landed;
  await survey(h);
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await afterMerges(h.root, { now: NOW + 2000, gh });

  assert.deepEqual(asked.filter(args => args[1] === 'close').map(args => args.at(-1)), [
    `Fixed by ${sha}, merged by hobkin.`,
    `Fixed by ${sha}, which landed the same change as #112, merged by hobkin.`,
  ]);
  assert.deepEqual(lines(h), [
    ['Merged "Issue 112" on api. Closed acme/api#112 on GitHub.', 'useful'],
    ['Merged "Issue 129" on api. Closed acme/api#129 on GitHub. Still for you: Watch the sale errors after the deploy.', 'useful'],
  ]);
  assert.equal(read(h, duplicate).afterMerge.issue, 'closed');
});

test('work merged before this pass existed is left alone, and a note that only says what was not delivered is not told', async t => {
  const h = workspace(t);
  const before = fromIssue(h, 3, 'hobkin/3-fix', { state: 'merged', left: 'Deploy it.' });
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const receipt = finished(h, 'hobkin/abc', { left: 'Nothing pushed, opened, merged, deployed or released' });

  await mergeItem(h.root, 'api', receipt.id, { now: NOW });
  const followed = await afterMerges(h.root, { now: NOW + 1000, gh: neverGh });

  assert.deepEqual(followed.map(({ id }) => id), [receipt.id]);
  assert.deepEqual(lines(h), []);
  assert.equal(read(h, before).afterMerge, undefined);
});

test("the director's tick follows every merge by itself, and a slow gh holds back neither the tick nor another merge's line", async t => {
  const h = director(t);
  studied(h, 'api');
  const merged = (title, change) => {
    const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence.' }, h.clock);
    updateItem(h.root, 'api', id, { state: 'merged', ...AFTER_MERGE, ...change }, h.clock);
  };
  merged('From an issue', { issue: { repo: 'acme/api', number: 9, url: 'https://github.invalid/acme/api/issues/9' } });
  merged('Merged one', { left: 'Tell the team.' });
  let answerTheIssue = () => {};
  h.gh = args => (args[0] === 'issue'
    ? new Promise(resolve => { answerTheIssue = () => resolve(JSON.stringify({ state: 'CLOSED' })); })
    : Promise.reject(Error('This repository has no remote.')));

  await h.director.tick();
  const whileGhWorks = lines(h);
  answerTheIssue();
  await h.director.settlingMerges;
  await h.director.surveying;

  assert.deepEqual(whileGhWorks, [['Merged "Merged one" on api. Still for you: Tell the team.', 'useful']]);
  assert.deepEqual(lines(h).map(([line]) => line), [
    'Merged "Merged one" on api. Still for you: Tell the team.',
    'Merged "From an issue" on api. GitHub had already closed acme/api#9.',
  ]);
});

// A merge from a card says itself in Chat as the user's own line. What follows it, its issue closing, joins that line rather than repeating the merge.

/** Chat as the app builds it from what is waiting: the user's lines from cards, then hobkin's own. Each as its words, role and tone. */
const chat = (h, now) => [...cardActionsToPost(h.root, now).map(cardActionNotice), ...clientNoticesToPost(h.root).map(clientNotice)]
  .map(({ content, role, tone }) => [content, role, tone ?? null]);
// The longest a merge's line waits for its issue: longer than gh may take to read and close it.
const HOLD_MS = 150000;

/** The user's merge from a card, told as the app tells it. */
async function mergeFromCard(h, item, at = NOW) {
  const merged = await mergeItem(h.root, 'api', item.id, { now: at });
  recordCardAction(h.root, merged.told, at);
  return merged;
}

test('a merge from its card is one line in Chat, and the issue it closed is said in that line', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/37-fix', 'import.txt', 'import\n');
  const item = fromIssue(h, 37, 'hobkin/37-fix');
  const { gh } = fakeGh();

  await mergeFromCard(h, item);
  const whileGhWorks = chat(h, NOW + 500);
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.deepEqual(chat(h, NOW + 1000), [['Merged "Issue 37" into main on api. Nothing was pushed. Closed acme/api#37 on GitHub.', 'system', null]]);
  assert.deepEqual(whileGhWorks, [], 'the line waits for its issue, so the merge is said once');
});

test('an issue that could not close is said in the merge\'s own line, which reads as blocked', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/12-fix', 'login.txt', 'login\n');
  const item = fromIssue(h, 12, 'hobkin/12-fix');
  const { gh } = fakeGh({ closeError: Object.assign(Error('Command failed: gh issue close'), { stderr: 'HTTP 403: Forbidden' }) });

  await mergeFromCard(h, item);
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.deepEqual(chat(h, NOW + 1000), [
    ['Merged "Issue 12" into main on api. Nothing was pushed. hobkin could not close acme/api#12 on GitHub: HTTP 403: Forbidden', 'notice', 'blocked'],
  ]);
});

test('a merge with nothing to follow it is said at once, as before', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc');

  await mergeFromCard(h, item);

  assert.deepEqual(chat(h, NOW), [['Merged "work 0" into main on api. Nothing was pushed.', 'system', null]]);
});

test('a merge waits for its issue only so long, and a closing that comes after it says its own line', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/12-fix', 'login.txt', 'login\n');
  const item = fromIssue(h, 12, 'hobkin/12-fix');
  const { gh } = fakeGh();

  await mergeFromCard(h, item);
  const stillWaiting = chat(h, NOW + HOLD_MS - 1);
  markCardActionsPosted(h.root, cardActionsToPost(h.root, NOW + HOLD_MS));
  await afterMerges(h.root, { now: NOW + HOLD_MS + 1000, gh });

  assert.deepEqual(stillWaiting, []);
  assert.deepEqual(chat(h, NOW + HOLD_MS + 1000), [['Merged "Issue 12" on api. Closed acme/api#12 on GitHub.', 'notice', 'useful']]);
});

test('merging a group keeps its lines in order: each row with its issue, then the line that sums them up', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix');
  branched(h.checkout, 'hobkin/2-fix');
  const rows = [fromIssue(h, 1, 'hobkin/1-fix'), fromIssue(h, 2, 'hobkin/2-fix')].map(({ id }) => ({ slug: 'api', item: id, how: 'merge' }));
  const { gh } = fakeGh();

  const answer = await mergeGroup(h.root, rows, { now: NOW });
  for (const told of answer.told) recordCardAction(h.root, told, NOW);
  const whileGhWorks = chat(h, NOW + 500);
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.deepEqual(whileGhWorks, []);
  assert.deepEqual(chat(h, NOW + 1000).map(([line]) => line), [
    'Merged "Issue 1" into main on api. Nothing was pushed. Closed acme/api#1 on GitHub.',
    'Merged "Issue 2" into main on api. Nothing was pushed. Closed acme/api#2 on GitHub.',
    'Merged all 2 here, with nothing pushed.',
  ]);
});
