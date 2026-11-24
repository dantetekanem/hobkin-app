import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerDecision, openDecisions } from '../src/cli/decisions.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { answerPickUp, filePickUp } from '../src/cli/work/pick-up.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, readItems, readMode, retryItem, skipInQueue, startWork, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (title, details = {}) => ({ key: title, kind: 'fix', title, brief, impact: 'high', effort: 'small', ...details });

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
  backUp(h, 'hobkin/abc-fix', 'hobkin/abc-before-refresh-66899b65');
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
  backUp(h, 'hobkin/abc-fix', 'hobkin/abc-before-refresh-66899b65');
  const refresh = filedAs(h, 'branch:hobkin/abc-before-refresh-66899b65', { state: 'branch', branch: 'hobkin/abc-before-refresh-66899b65' }, 'chore');
  const stray = filedAs(h, 'branch:hobkin/abc-fix-before-c289e6', { state: 'branch', branch: 'hobkin/abc-fix-before-c289e6' }, 'chore');
  const rebase = filedAs(h, 'ship:rebase:hobkin/abc-before-rebase-b9be7852:1234567', { branch: 'hobkin/abc-before-rebase-b9be7852', ships: stray.id }, 'pr-fix');
  const closed = filedAs(h, 'ship:rebase:hobkin/abc-fix-before-c289e6:7654321', { state: 'done', branch: 'hobkin/abc-fix-before-c289e6' }, 'pr-fix');
  const byAnAgent = filedAs(h, 'bugs:the copy', { branch: 'hobkin/abc-fix-before-c289e6' });
  const byTheUser = filedAs(h, 'hand:look at the copy', { branch: 'hobkin/abc-before-refresh-66899b65' }, 'improvement');
  const realStray = filedAs(h, 'branch:hobkin/abc-fix', { state: 'branch', branch: 'hobkin/abc-fix' }, 'chore');

  const { retired } = await survey(h);

  assert.deepEqual(retired.map(({ id }) => id), [refresh.id, stray.id, rebase.id]);
  for (const backup of [refresh, stray, rebase]) {
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
  backUp(h, 'hobkin/abc-fix', 'backup/abc-before-refresh-66899b65');

  await survey(h);

  const [unit] = readUnmerged(h.root).projects.api.open;
  assert.deepEqual([unit.branch, unit.landedOn], ['hobkin/abc-fix', null]);
  assert.equal(readyItems(h.root).find(row => row.item === work.id).gap, 'land');
});

// Picking what runs.

test('turning work mode on starts nothing by itself, and only what the user picks runs', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  writeMode(h.root, { enabled: false, folder: h.base });

  const { message } = await runWorkCommand(h.root, ['start']);
  await h.ticks(2);

  assert.deepEqual([readMode(h.root).enabled, readMode(h.root).autoPick], [true, false]);
  assert.match(message, /only picks and work on finished branches start/);
  assert.deepEqual(h.calls, []);

  await runWorkCommand(h.root, ['trigger', 'api', filed.id]);
  await h.tick();

  assert.deepEqual(h.calls.map(call => h.work(call).item.title), ['Fix login']);
});

test('start --auto is the old start, where the top of the queue starts by itself', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  writeMode(h.root, { enabled: false, autoPick: false });

  const { message } = await runWorkCommand(h.root, ['start', '--auto', h.base]);
  await h.tick();

  assert.deepEqual([readMode(h.root).folder, readMode(h.root).autoPick], [h.base, true]);
  assert.doesNotMatch(message, /only picks and work on finished branches start/);
  assert.deepEqual(h.calls.map(call => h.work(call).item.title), ['Fix login']);
});

test('the user\'s word on auto-pick stands each time work mode turns on, and start --auto goes past it for that start alone', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  writeMode(h.root, { enabled: false, folder: h.base });
  const autoPickAfterRestart = async (...args) => {
    await runWorkCommand(h.root, ['stop']);
    await runWorkCommand(h.root, ['start', ...args]);
    return readMode(h.root).autoPick;
  };

  await runWorkCommand(h.root, ['start']);
  const pickUp = openDecisions(h.root).find(({ key }) => key === 'pickup');
  answerPickUp(h.root, 'auto', pickUp.answerTo.keys);
  answerDecision(h.root, pickUp.id, 'auto');
  // The dashboard turns work mode off and on this way.
  writeMode(h.root, { enabled: false });
  startWork(h.root);

  assert.equal(readMode(h.root).autoPick, true);
  assert.equal(filePickUp(h.root), false, 'nothing asks again');

  await runWorkCommand(h.root, ['auto', 'off']);

  assert.equal(await autoPickAfterRestart(), false, 'off stands too');
  assert.equal(await autoPickAfterRestart('--auto'), true);
  assert.equal(await autoPickAfterRestart(), false, 'the user\'s off stands again after the start --auto');
});

test('a retry puts an item back in the queue, and only a review or a fix for finished work goes to the front by itself', t => {
  const h = workspace(t);
  const plain = filedAs(h, 'plain', { attempts: 3, lastError: 'The tests would not start.' });
  const review = filedAs(h, 'review', { reviewAsked: true });
  const note = filedAs(h, 'note', { workNote: 'Keep the old flag.' });
  const fix = filedAs(h, 'ship:rebase', {}, 'pr-fix');
  skipInQueue(h.root, `item:api:${plain.id}`);

  for (const { id } of [plain, review, note, fix]) retryItem(h.root, 'api', id, NOW);

  assert.deepEqual([read(h, plain).state, read(h, plain).attempts, read(h, plain).lastError], ['open', 0, null]);
  assert.deepEqual(readMode(h.root).queueSkipped, []);
  assert.deepEqual(readMode(h.root).queueNext, [review, note, fix].map(({ id }) => `item:api:${id}`));
});

test('hobkin work start leaves what to pick up first in Action Items, and start --auto asks nothing', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  writeMode(h.root, { enabled: false, folder: h.base });

  const { message } = await runWorkCommand(h.root, ['start']);

  const pickUp = openDecisions(h.root).find(({ key }) => key === 'pickup');
  assert.match(pickUp.question, /Fix login/);
  assert.match(message, /What to start first waits in Action Items\./);

  answerDecision(h.root, pickUp.id, 'later');
  const auto = await runWorkCommand(h.root, ['start', '--auto']);

  assert.equal(openDecisions(h.root).some(({ key }) => key === 'pickup'), false);
  assert.doesNotMatch(auto.message, /waits in Action Items/);
});

test('with auto-pick off a fix that gets a branch merged starts by itself, so the pick-up offers only new work', async t => {
  const h = director(t);
  const checkout = studied(h, 'api', 'critical');
  git(checkout, 'branch', 'hobkin/old');
  const fix = fileItem(h.root, 'api', item('Fix login'), h.clock);
  const rebase = fileItem(h.root, 'api', item('Rebase hobkin/old', { kind: 'pr-fix' }), h.clock);
  updateItem(h.root, 'api', rebase.id, { branch: 'hobkin/old' }, h.clock);
  writeMode(h.root, { enabled: false, folder: h.base });

  await runWorkCommand(h.root, ['start']);
  await h.tick();

  const pickUp = openDecisions(h.root).find(({ key }) => key === 'pickup');
  // The pick-up reads the real clock, so the project's looks are due there too.
  const offeredItems = pickUp.answerTo.keys.filter(key => key.startsWith('item:'));
  assert.deepEqual(offeredItems, [`item:api:${fix.id}`]);
  assert.deepEqual(h.calls.map(call => h.work(call).item.title), ['Rebase hobkin/old']);
});

test('a retry says where it went: back in line, or to the front for a review or a note', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const plain = fileItem(h.root, 'api', item('Fix login'), h.clock);
  const noted = fileItem(h.root, 'api', item('Fix logout'), h.clock);
  updateItem(h.root, 'api', noted.id, { workNote: 'Keep the old flag.' }, h.clock);

  const back = await runWorkCommand(h.root, ['retry', 'api', plain.id]);
  const front = await runWorkCommand(h.root, ['retry', 'api', noted.id]);

  assert.match(back.message, /back in the queue with its tries at zero/);
  assert.match(front.message, /front of the queue with its tries at zero/);
});

test('with auto-pick off a plain retry waits for a pick', async t => {
  const h = director(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  updateItem(h.root, 'api', filed.id, { attempts: 2, lastError: 'The tests would not start.' }, h.clock);
  writeMode(h.root, { autoPick: false });

  await runWorkCommand(h.root, ['retry', 'api', filed.id]);
  await h.ticks(2);

  assert.deepEqual(h.calls, []);
  assert.equal(read(h, filed).attempts, 0);
});

