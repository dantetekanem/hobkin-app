import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { carryOutAnswer } from '../src/cli/answer.mjs';
import { PROMOTION_STREAK, noteOutcome, readAutonomy } from '../src/cli/autonomy.mjs';
import { initialize } from '../src/cli/config.mjs';
import { markAlways, openDecisions } from '../src/cli/decisions.mjs';
import { endSessionJob } from '../src/cli/session-log.mjs';
import { startSession } from '../src/cli/session.mjs';
import { readStandingRules } from '../src/cli/standing-rules.mjs';
import { answerOffer, askAgent, declineItem, declineStopped, mergeItem, mergePullRequest } from '../src/cli/work/controls.mjs';
import { pulseLaunches } from '../src/cli/work/launches.mjs';
import { chooseProject, fileItem, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { branched, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-11-26T20:00:00Z');
const HOUR = 3600000;
const BRANCH_WORK = 'code-branch:api';

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-autonomy-outcomes-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A home with one code project, `api`, on a real repository. */
function workspace(t) {
  const base = home(t);
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout };
}

function finished(h, branch, change = {}) {
  const { id } = fileItem(h.root, 'api', { key: branch, kind: 'fix', title: branch, brief: 'Evidence and first change.' }, NOW);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, ...change }, NOW);
}

const cleanRuns = (root, taskClass, count) => {
  for (let run = 0; run < count; run += 1) noteOutcome(root, taskClass, { clean: true }, NOW + run);
};
const promotionCards = root => openDecisions(root).filter(({ answerTo }) => answerTo?.kind === 'autonomy');

test('a clean run that makes a class due files its promotion question once, as a card no rule can settle', t => {
  const root = home(t);

  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK + 2);

  const cards = promotionCards(root);
  assert.equal(cards.length, 1, 'one question, however many clean runs follow it');
  const [card] = cards;
  assert.deepEqual(card.answerTo, { kind: 'autonomy', taskClass: 'code-fix:api' });
  assert.equal(card.kind, 'autonomy');
  assert.equal(card.learn, null);
  assert.equal(card.recommended, 'yes');
  assert.deepEqual(card.choices.map(({ value }) => value), ['yes', 'no']);
  assert.throws(() => markAlways(root, [card.id]), /no rule could answer it again/);
  assert.equal(readAutonomy(root)['code-fix:api'].level, 'recommend', 'asking changes nothing');
});

test('a class with its question open gets no second one, even once its level has moved', t => {
  const root = home(t);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);

  noteOutcome(root, 'code-fix:api', { clean: false, override: true }, NOW);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);

  assert.equal(readAutonomy(root)['code-fix:api'].level, 'draft');
  assert.equal(promotionCards(root).length, 1);
});

test('only a clean run asks, and only for its own class', t => {
  const root = home(t);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK - 1);

  noteOutcome(root, 'code-fix:api', { clean: true, checksPassed: false }, NOW);
  cleanRuns(root, 'code-fix:web', PROMOTION_STREAK);

  assert.deepEqual(promotionCards(root).map(({ answerTo }) => answerTo.taskClass), ['code-fix:web']);
});

test('the user\'s yes moves the class one level and their no keeps it there, and neither keeps a standing rule', async t => {
  const root = home(t);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);
  const [asked] = promotionCards(root);

  const yes = await carryOutAnswer(root, asked.id, { value: 'yes' }, NOW);

  assert.equal(readAutonomy(root)['code-fix:api'].level, 'deadline');
  assert.match(yes.message, /code-fix:api now acts at a deadline unless you object/);
  assert.deepEqual(promotionCards(root), []);

  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);
  const [again] = promotionCards(root);
  assert.notEqual(again.id, asked.id);
  const no = await carryOutAnswer(root, again.id, { value: 'no' }, NOW);

  const row = readAutonomy(root)['code-fix:api'];
  assert.deepEqual([row.level, row.cleanStreak], ['deadline', 0]);
  assert.match(no.message, /code-fix:api still acts at a deadline unless you object/);
  assert.deepEqual(readStandingRules(root), []);
});

test('an outcome the ledger cannot take never stops the work it records', t => {
  const root = home(t);

  assert.equal(noteOutcome(root, 'Not A Class', { clean: true }, NOW), null);
});

test('a local merge is a clean run of the project\'s branch work, with the minutes the user took to read it', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/1-fix', 'fix.txt', 'fix\n');
  const item = finished(h, 'hobkin/1-fix');

  await mergeItem(h.root, 'api', item.id, { read: 'diff', readMs: 3 * 60000, now: NOW });

  const row = readAutonomy(h.root)[BRANCH_WORK];
  assert.deepEqual([row.level, row.runs, row.cleanStreak, row.reviewMinutes.recent], ['report', 1, 1, [3]]);
});

test('a PR merged from its card or by YOLO mode is a clean run', async t => {
  const h = workspace(t);
  const item = finished(h, 'hobkin/7-fix', { state: 'pr', pr: 'https://example.invalid/pull/7' });
  const merged = { state: 'MERGED', mergedAt: '2026-11-26T21:00:00Z', mergeCommit: { oid: 'abc123' }, headRefName: 'hobkin/7-fix' };
  const gh = async args => {
    if (args[1] === 'list') return JSON.stringify([{ url: 'https://example.invalid/pull/7' }]);
    return args[1] === 'view' ? JSON.stringify(merged) : '';
  };

  await mergePullRequest(h.root, 'api', item.id, { gh, now: NOW });

  const row = readAutonomy(h.root)[BRANCH_WORK];
  assert.deepEqual([row.runs, row.cleanStreak, row.overrides], [1, 1, 0]);
});

test('the user\'s no, from a card or a stopped run, and a branch sent back are overrides that move the class back a level at once', t => {
  const h = workspace(t);
  writeMode(h.root, { enabled: true });
  const declined = finished(h, 'hobkin/no');
  const stopped = finished(h, 'hobkin/stopped');
  const sentBack = finished(h, 'hobkin/back');

  declineItem(h.root, 'api', declined.id, NOW);
  assert.deepEqual([readAutonomy(h.root)[BRANCH_WORK].level, readAutonomy(h.root)[BRANCH_WORK].overrides], ['deadline', 1]);

  declineStopped(h.root, 'api', stopped.id, NOW);
  askAgent(h.root, 'api', sentBack.id, 'Rename it.', { now: NOW });

  const row = readAutonomy(h.root)[BRANCH_WORK];
  assert.deepEqual([row.level, row.runs, row.overrides, row.cleanStreak], ['draft', 3, 3, 0]);
});

test('the user\'s no to an offer of several branches is one override, however many branches it named', async t => {
  const h = workspace(t);
  const [one, two, three] = ['one', 'two', 'three'].map(name => finished(h, `hobkin/${name}`));
  const offered = { slug: 'api', item: one.id, head: 'tip', also: [{ item: two.id, head: 'tip' }, { item: three.id, head: 'tip' }] };

  await answerOffer(h.root, offered, 'no', NOW);

  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['declined', 'declined', 'declined']);
  const row = readAutonomy(h.root)[BRANCH_WORK];
  assert.deepEqual([row.level, row.runs, row.overrides], ['deadline', 1, 1]);
});

test('a run\'s own question answered sends the agent on and says nothing against the work', t => {
  const h = workspace(t);
  writeMode(h.root, { enabled: true });
  const item = finished(h, 'hobkin/asked');

  askAgent(h.root, 'api', item.id, 'Yes, go on.', { answering: true, now: NOW });

  assert.equal(readAutonomy(h.root)[BRANCH_WORK], undefined);
});

test('a revert of a landed change is one undo, however many pulses see it', async t => {
  const h = workspace(t);
  const pulse = now => pulseLaunches(h.root, { now, gh: async () => '[]', fetch: async () => ({ ok: true }) });
  branched(h.checkout, 'hobkin/1-change', 'change.txt', 'changed\n');
  git(h.checkout, 'merge', '-q', '--no-ff', '--no-edit', '-m', 'Merge: Change', 'hobkin/1-change');
  const sha = git(h.checkout, 'rev-parse', 'HEAD');
  const { id } = fileItem(h.root, 'api', { key: 'change', kind: 'fix', title: 'Change', brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'merged', branch: 'hobkin/1-change', landed: { sha, at: new Date(NOW).toISOString(), route: 'key' } }, NOW);
  await pulse(NOW + HOUR);
  assert.equal(readAutonomy(h.root)[BRANCH_WORK], undefined, 'a merge no one undid is no undo');

  git(h.checkout, 'revert', '--no-edit', '-m', '1', sha);
  await pulse(NOW + 2 * HOUR);
  await pulse(NOW + 3 * HOUR);

  const row = readAutonomy(h.root)[BRANCH_WORK];
  assert.deepEqual([row.undos, row.runs, row.level], [1, 0, 'deadline']);
});

test('a session whose brief names its task class counts its end there: clean once it completed, an override when the user stopped it', async t => {
  const root = home(t);
  const brief = 'Fix the flaky test.\n\nTask class: code-fix:hobkin\n';

  const done = await startSession({ root, cwd: root, brief, approved: true, now: NOW });
  endSessionJob(root, done, { id: 'run-1', status: 'completed', result: { text: 'Fixed it.' } });
  let row = readAutonomy(root)['code-fix:hobkin'];
  assert.deepEqual([row.runs, row.cleanStreak, row.overrides], [1, 1, 0]);

  const stopped = await startSession({ root, cwd: root, brief, approved: true, now: NOW });
  endSessionJob(root, stopped, { id: 'run-2', status: 'interrupted', userStop: { reason: 'Stopped from the agent view.' }, result: { text: '' } });
  row = readAutonomy(root)['code-fix:hobkin'];
  assert.deepEqual([row.runs, row.cleanStreak, row.overrides], [2, 0, 1]);

  const failed = await startSession({ root, cwd: root, brief, approved: true, now: NOW });
  endSessionJob(root, failed, { id: 'run-3', status: 'failed', result: { status: 'failed', error: 'It broke.' } });
  row = readAutonomy(root)['code-fix:hobkin'];
  assert.deepEqual([row.runs, row.overrides], [3, 1], 'a failed run is no clean one, and no override either');
});

test('a session whose brief names no task class counts nowhere, and one naming a class hobkin cannot read is refused', async t => {
  const root = home(t);

  const plain = await startSession({ root, cwd: root, brief: 'Look into the slow page.', approved: true, now: NOW });
  endSessionJob(root, plain, { id: 'run-1', status: 'completed', result: { text: 'Found it.' } });

  assert.deepEqual(Object.keys(readAutonomy(root)), ['code-branch']);
  await assert.rejects(startSession({ root, cwd: root, brief: 'Fix it.\nTask class: Code Fix\n', approved: true, now: NOW }), /task class is a lowercase kind/);
});
