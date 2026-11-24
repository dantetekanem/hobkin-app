import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { answerDecision, fileDecision, openDecisions } from '../src/cli/decisions.mjs';
import { main } from '../src/cli/main.mjs';
import { answerPair, bringPair, setShipFirst, watchPile } from '../src/cli/work/pairs.mjs';
import { planWork, startsNewWork } from '../src/cli/work/plan.mjs';
import { readyItems, statusView } from '../src/cli/work/reads.mjs';
import { pileOf, SHIP_FIRST_AT, shipFirst } from '../src/cli/work/ship.mjs';
import { chooseProject, fileItem, paths, pickNext, readItems, readMode, recordTokens, setProjectPaused, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository, writeJson } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const now = new Date(2026, 5, 1, 12).getTime();
const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (key, details = {}) => ({ key, kind: 'fix', title: key, brief, ...details });
const proved = { proof: 'It failed, then it passed.' };
const unproved = {};

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-ship-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeMode(root, { enabled: true });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: now + 3 * 24 * HOUR } });
  return root;
}

/** A project past its study, with nothing due but what a test files. */
function project(root, slug) {
  chooseProject(root, `/repos/${slug}`, 'important', now);
  mkdirSync(paths(root, slug).directory, { recursive: true });
  writeFileSync(paths(root, slug).project, '# What it is\n');
  writeState(root, slug, { lastLensAt: new Date(now).toISOString(), lastIdeasAt: new Date(now).toISOString() });
  recordTokens(root, { slug, lane: 'do', tokens: 1 }, now - HOUR);
}

/** Rows as the last survey read them, each at a commit of its own, beside whatever else it read. */
function surveyed(root, slug, rows, unit = {}) {
  const { projects } = readUnmerged(root);
  const named = new Set(rows.map(({ branch }) => branch));
  const kept = (projects[slug]?.open ?? []).filter(({ branch }) => !named.has(branch));
  const read = rows.map(({ branch }) => ({
    kind: 'branch',
    branch,
    sha: `sha-${branch}`,
    conflict: false,
    size: { additions: 1, deletions: 0, files: 1 },
    ...unit,
  }));

  writeJson(join(root, 'work', 'unmerged.json'), {
    at: new Date(now).toISOString(),
    projects: { ...projects, [slug]: { lastMergeAt: null, trees: 0, ...projects[slug], open: [...kept, ...read] } },
  });
}

/** Finished rows on a project, as the survey and Done see them, each with its proof unless a test says otherwise. */
function finishedOn(root, slug, count, change = proved) {
  const rows = Array.from({ length: count }, (_row, index) => {
    const branch = `hobkin/${index}`;
    const { id } = fileItem(root, slug, item(`finished on ${branch}`), now);
    return updateItem(root, slug, id, { state: 'branch', branch, ...change }, now);
  });
  surveyed(root, slug, rows);
  return rows;
}

const plan = (root, options = {}) => planWork(root, { now, ...options });
const rowTitled = (root, title) => plan(root).entries.find(entry => entry.title === title);

test('a pile at the bar, counted across projects, starts no new work, and each row says why', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'web');
  finishedOn(root, 'api', SHIP_FIRST_AT - 3);
  finishedOn(root, 'web', 3);
  fileItem(root, 'api', item('New feature', { kind: 'feature' }), now);
  writeState(root, 'web', { lastLensAt: new Date(now - 240 * HOUR).toISOString() });

  const { next, shipFirst: shipping, entries } = plan(root);

  assert.equal(next, null);
  assert.equal(shipping.holding, true);
  assert.equal(shipping.pile, SHIP_FIRST_AT);
  assert.equal(rowTitled(root, 'New feature').waiting, 'shipping first');
  assert.equal(entries.find(entry => entry.kind === 'look').waiting, 'shipping first');
});

test('one under the bar, the queue carries on by itself', t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', SHIP_FIRST_AT);
  fileItem(root, 'api', item('New feature', { kind: 'feature' }), now);
  assert.equal(plan(root).next, null);

  const [{ id }] = readItems(root, 'api');
  updateItem(root, 'api', id, { state: 'declined' }, now);

  assert.equal(plan(root).shipFirst.holding, false);
  assert.notEqual(rowTitled(root, 'New feature').waiting, 'shipping first');
  assert.ok(plan(root).next);
});

test('new ideas and the daily look for projects wait too', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'web');
  finishedOn(root, 'web', SHIP_FIRST_AT);
  writeState(root, 'api', { lastIdeasAt: new Date(now - 240 * HOUR).toISOString() });
  writeMode(root, { folder: '/repos', lastDiscoveryAt: new Date(now - 48 * HOUR).toISOString() });

  const { entries } = plan(root);

  assert.equal(entries.find(entry => entry.kind === 'ideas').waiting, 'shipping first');
  assert.equal(entries.find(entry => entry.kind === 'discover').waiting, 'shipping first');
});

test('what closes a gap, urgent work and attention still start at the bar', t => {
  for (const details of [{ kind: 'pr-fix' }, { urgent: true }, { kind: 'attention' }]) {
    const root = dataRoot(t);
    project(root, 'api');
    finishedOn(root, 'api', SHIP_FIRST_AT);
    fileItem(root, 'api', item('Keeps going', details), now);

    assert.equal(plan(root).next?.title, 'Keeps going', JSON.stringify(details));
  }
});

test('a review the user asked for and a note sent back still start at the bar', t => {
  for (const change of [{ reviewAsked: true }, { workNote: 'Keep the old flag.' }]) {
    const root = dataRoot(t);
    project(root, 'api');
    finishedOn(root, 'api', SHIP_FIRST_AT);
    const { id } = fileItem(root, 'api', item('Goes back'), now);
    updateItem(root, 'api', id, change, now);

    assert.equal(plan(root).next?.title, 'Goes back');
  }
});

test('the user\'s own pick still starts, and a started item carries on', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'web');
  finishedOn(root, 'api', SHIP_FIRST_AT);
  const { id } = fileItem(root, 'api', item('Their pick'), now);
  pickNext(root, `item:api:${id}`);
  assert.equal(plan(root).next?.title, 'Their pick');

  writeMode(root, { queueNext: [] });
  const started = fileItem(root, 'web', item('Under way'), now);
  updateItem(root, 'web', started.id, { state: 'doing', branch: 'hobkin/under-way' }, now);
  assert.equal(plan(root).next?.title, 'Under way');
});

test('a held study does not hold back closing work that would wait for it', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/api', 'important', now);
  finishedOn(root, 'api', SHIP_FIRST_AT);
  const { id } = fileItem(root, 'api', item('Goes back'), now);
  updateItem(root, 'api', id, { reviewAsked: true }, now);

  const { next, entries } = plan(root);

  assert.equal(entries.find(entry => entry.kind === 'study').waiting, 'shipping first');
  assert.equal(next?.title, 'Goes back');
});

test('watch looks keep running and every other look is new work', () => {
  assert.equal(startsNewWork({ kind: 'look', focus: 'watch' }), false);
  assert.equal(startsNewWork({ kind: 'look', focus: 'signals' }), true);
  assert.equal(startsNewWork({ kind: 'look', focus: 'security' }), true);
  assert.equal(startsNewWork({ kind: 'discover' }), true);
  assert.equal(startsNewWork({ kind: 'item', item: { kind: 'feature', state: 'open' } }), true);
});

test('the pile counts what can move, and a layer waiting on the one under it does not count', () => {
  const rows = [{ gap: 'land' }, { gap: 'rebase' }, { gap: 'unlanded' }, { gap: 'stacked' }, { gap: 'closing' }, { gap: 'yours' }, { gap: 'elsewhere' }];

  assert.equal(pileOf(rows).length, 3);
  assert.equal(shipFirst(rows, {}, now).holding, false);
});

test('the pile is every finished row, however long the list the tab reads', t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', 60);

  assert.equal(readyItems(root).length, 50);
  assert.equal(plan(root).shipFirst.pile, 60);
});

test('status says it plainly, and the line carries the real count', t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', 46);
  writeFileSync(join(root, 'runtime.lock'), '');

  assert.match(statusView(root).next, /Shipping first: 46 finished and waiting\. New work starts under 8\./);
});

// With real git for what a pair merges.
function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-pair-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  mkdirSync(root, { recursive: true });
  writeMode(root, { enabled: true });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', now);
  return { base, root, checkout, reviews: join(base, 'auto-review') };
}

function reviewed(h, head, grade = 'safe', rating = 'A') {
  const folder = join(h.reviews, 'session');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${head.slice(0, 8)}.review.json`), JSON.stringify({ status: 'complete', preflight: { head }, grades: { merge: { grade, rating, reason: 'It reads well.' }, deploy: null } }));
}

function realBranch(h, name) {
  branched(h.checkout, name, `${name.replaceAll('/', '-')}.txt`, `${name}\n`);
  const { id } = fileItem(h.root, 'api', item(`Finish ${name}`), now);
  return updateItem(h.root, 'api', id, { state: 'branch', branch: name, ...proved }, now);
}

const tipOf = (h, name) => git(h.checkout, 'rev-parse', name);
const survey = h => surveyUnmerged(h.root, { now, gh: async () => '[]', reviews: h.reviews });
const stateOf = (h, { id }) => readItems(h.root, 'api').find(entry => entry.id === id);
const pair = root => openDecisions(root).find(({ key }) => key === 'pair');
async function answered(root, value, at = now) {
  const { id, answerTo } = pair(root);
  const result = await answerPair(root, value, answerTo.rows, at);
  answerDecision(root, id, value, at);
  return result;
}

/** One real branch rated safe A, then a pile of proved rows with no grade behind it. */
async function pileWithOneRated(h, rest = SHIP_FIRST_AT) {
  const rated = realBranch(h, 'hobkin/rated');
  reviewed(h, tipOf(h, 'hobkin/rated'));
  await survey(h);
  return { rated, rows: finishedOn(h.root, 'api', rest) };
}

/** Two real proved branches, one rated safe A and one with no grade, on a pile with no proof, which no yes can merge. */
async function twoRealOnAPile(h) {
  const rated = realBranch(h, 'hobkin/rated');
  const ungraded = realBranch(h, 'hobkin/ungraded');
  reviewed(h, tipOf(h, 'hobkin/rated'));
  await survey(h);
  finishedOn(h.root, 'api', SHIP_FIRST_AT, unproved);
  return { rated, ungraded };
}

test('a pair is the top two in Done order, says what yes does to each and how many are left, with the harmless choice first', async t => {
  const h = workspace(t);
  const { rated, rows } = await pileWithOneRated(h);

  bringPair(h.root, now);

  const { question, tldr, choices, answerTo } = pair(h.root);
  assert.deepEqual(choices.map(({ value }) => value), ['later', 'go', 'read', 'new']);
  assert.deepEqual(choices.map(({ label }) => label), ['Later', 'Do these two', 'Read them first', 'Start new work anyway']);
  assert.deepEqual(answerTo.rows.map(({ item: id, step }) => [id, step]), [[rated.id, 'land'], [rows[0].id, 'land']]);
  assert.equal(answerTo.rows[0].head, tipOf(h, 'hobkin/rated'));
  assert.match(question, /Finish hobkin\/rated/);
  assert.match(question, /finished on hobkin\/0/);
  assert.match(question, /7 more/);
  assert.ok(tldr.length <= 100);
});

test('a row with an open offer stays out of the pair, and only one pair is open', async t => {
  const h = workspace(t);
  const { rated, rows } = await pileWithOneRated(h);
  fileDecision(h.root, { key: `offer:api:${rated.id}`, from: 'Work mode', question: 'Merge it?', choices: [{ value: 'later', label: 'Later' }, { value: 'merge', label: 'Merge it' }] }, now);

  bringPair(h.root, now);
  bringPair(h.root, now + HOUR);

  assert.deepEqual(pair(h.root).answerTo.rows.map(({ item: id }) => id), [rows[0].id, rows[1].id]);
  assert.equal(openDecisions(h.root).filter(({ key }) => key === 'pair').length, 1);
});

test('a row the survey has not read stays out of a pair, because no commit pins a yes to it', t => {
  const root = dataRoot(t);
  project(root, 'api');
  const rows = finishedOn(root, 'api', SHIP_FIRST_AT);
  const unread = fileItem(root, 'api', item('Not read yet'), now);
  updateItem(root, 'api', unread.id, { state: 'branch', branch: 'hobkin/unread', ...proved }, now);

  bringPair(root, now);

  assert.deepEqual(pair(root).answerTo.rows.map(({ item: id }) => id), [rows[0].id, rows[1].id]);
});

test('under the bar no pair is brought', t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', SHIP_FIRST_AT - 1);

  bringPair(root, now);

  assert.equal(pair(root), undefined);
});

test('go merges work with proof here, graded or not, and pushes nothing', async t => {
  const h = workspace(t);
  const { rated, ungraded } = await twoRealOnAPile(h);
  bringPair(h.root, now);
  assert.deepEqual(pair(h.root).answerTo.rows.map(({ item: id, step }) => [id, step]), [[rated.id, 'land'], [ungraded.id, 'land']]);

  const { message } = await answered(h.root, 'go');

  assert.deepEqual([stateOf(h, rated).state, stateOf(h, ungraded).state], ['merged', 'merged']);
  const onMain = git(h.checkout, 'ls-tree', '--name-only', 'main').split('\n');
  assert.ok(['hobkin-rated.txt', 'hobkin-ungraded.txt'].every(file => onMain.includes(file)));
  assert.match(message, /Nothing was pushed/);
});

test('a row a review rated below safe at its commit gets a review on the user\'s yes', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  const rows = finishedOn(root, 'api', SHIP_FIRST_AT);
  surveyed(root, 'api', rows, { safety: { grade: 'medium', rating: 'B' } });
  bringPair(root, now);
  assert.deepEqual(pair(root).answerTo.rows.map(({ step }) => step), ['review', 'review']);

  await answered(root, 'go');

  const [first] = readItems(root, 'api');
  assert.deepEqual([first.state, first.reviewAsked], ['open', true]);
  assert.ok(readMode(root).queueNext.includes(`item:api:${first.id}`));
});

test('with work mode off a pair\'s review still waits in work mode\'s queue, so no card is held for a session nobody starts', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  writeMode(root, { enabled: false });
  const rows = finishedOn(root, 'api', SHIP_FIRST_AT);
  surveyed(root, 'api', rows, { safety: { grade: 'medium', rating: 'B' } });
  bringPair(root, now);

  await answered(root, 'go');

  const [first] = readItems(root, 'api');
  assert.deepEqual([first.reviewAsked, first.withMainAgent ?? null], [true, null]);
  assert.ok(readMode(root).queueNext.includes(`item:api:${first.id}`));
});

test('a row with a conflict gets its rebase on the user\'s yes', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  const rows = finishedOn(root, 'api', SHIP_FIRST_AT);
  surveyed(root, 'api', rows, { conflict: true });
  bringPair(root, now);
  assert.deepEqual(pair(root).answerTo.rows.map(({ step }) => step), ['rebase', 'rebase']);

  await answered(root, 'go');

  const [back] = readItems(root, 'api');
  assert.equal(back.state, 'open');
  assert.match(back.workNote, /rebase/i);
  assert.ok(readMode(root).queueNext.includes(`item:api:${back.id}`));
});

test('a merge that fails leaves that one in place, says why, and the other still goes', async t => {
  const h = workspace(t);
  const { rated, ungraded } = await twoRealOnAPile(h);
  writeFileSync(join(h.checkout, 'hobkin-rated.txt'), 'mine, not committed\n');
  bringPair(h.root, now);

  const { message } = await answered(h.root, 'go');

  assert.equal(stateOf(h, rated).state, 'branch');
  assert.equal(stateOf(h, ungraded).state, 'merged');
  assert.match(message, /uncommitted/);
  assert.match(readMode(h.root).ship.notice.line, /uncommitted/);
});

test('a branch that moved after the pair was filed does not merge', async t => {
  const h = workspace(t);
  const { rated } = await pileWithOneRated(h);
  bringPair(h.root, now);
  git(h.checkout, 'switch', '-q', 'hobkin/rated');
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');

  const { message } = await answered(h.root, 'go');

  assert.equal(stateOf(h, rated).state, 'branch');
  assert.match(message, /moved/);
});

test('later holds pairs for two hours, then the same two come back', async t => {
  const h = workspace(t);
  await pileWithOneRated(h);
  bringPair(h.root, now);
  const before = pair(h.root).answerTo.rows;

  await answered(h.root, 'later');

  bringPair(h.root, now + HOUR);
  assert.equal(pair(h.root), undefined);
  bringPair(h.root, now + 2 * HOUR);
  assert.deepEqual(pair(h.root).answerTo.rows, before);
});

test('the next pair comes once both of the last one have moved', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  const rows = finishedOn(root, 'api', SHIP_FIRST_AT + 2);
  surveyed(root, 'api', rows, { safety: { grade: 'risky', rating: 'D' } });
  bringPair(root, now);
  await answered(root, 'go');
  const backFromItsReview = ({ id }) => updateItem(root, 'api', id, { state: 'branch', reviewAsked: false }, now);

  backFromItsReview(rows[0]);
  bringPair(root, now + 1);
  assert.equal(pair(root), undefined, 'one of the two is still in its review');

  backFromItsReview(rows[1]);
  bringPair(root, now + 2);

  assert.deepEqual(pair(root).answerTo.rows.map(({ item: id }) => id), [rows[2].id, rows[3].id], 'a row a pair just took is not brought again at that commit');
});

test('a row whose merge failed does not stop the next pair, and is not brought again at that commit', async t => {
  const h = workspace(t);
  const { rated, rows } = await pileWithOneRated(h);
  writeFileSync(join(h.checkout, 'hobkin-rated.txt'), 'mine, not committed\n');
  bringPair(h.root, now);
  await answered(h.root, 'go');
  updateItem(h.root, 'api', rows[0].id, { state: 'declined' }, now);

  bringPair(h.root, now + 1);

  const ids = pair(h.root).answerTo.rows.map(({ item: id }) => id);
  assert.ok(!ids.includes(rated.id));
  assert.deepEqual(ids, [rows[1].id, rows[2].id]);
});

test('a project dropped or paused under a pair does not hold the next one', async t => {
  const h = workspace(t);
  const { rated, rows } = await pileWithOneRated(h, SHIP_FIRST_AT + 2);
  bringPair(h.root, now);
  await answered(h.root, 'go');
  assert.equal(stateOf(h, rated).state, 'merged');
  setProjectPaused(h.root, 'api', true);

  bringPair(h.root, now + 1);

  assert.ok(pair(h.root).answerTo.rows.every(({ item: id }) => id !== rows[0].id));
});

test('read waits for the pair to move, and two hours at most', async t => {
  const h = workspace(t);
  const { rated, rows } = await pileWithOneRated(h, SHIP_FIRST_AT + 2);
  bringPair(h.root, now);
  await answered(h.root, 'read');

  bringPair(h.root, now + HOUR);
  assert.equal(pair(h.root), undefined);

  updateItem(h.root, 'api', rated.id, { state: 'declined' }, now);
  updateItem(h.root, 'api', rows[0].id, { state: 'dropped' }, now);
  bringPair(h.root, now + HOUR + 1);
  assert.deepEqual(pair(h.root).answerTo.rows.map(({ item: id }) => id), [rows[1].id, rows[2].id]);
});

test('after read a pair that never moved comes back in two hours', async t => {
  const h = workspace(t);
  await pileWithOneRated(h);
  bringPair(h.root, now);
  await answered(h.root, 'read');

  bringPair(h.root, now + 2 * HOUR);

  assert.ok(pair(h.root));
});

test('new lets new work start until the end of that day and stays quiet about pairs', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', SHIP_FIRST_AT);
  fileItem(root, 'api', item('New feature', { kind: 'feature' }), now);
  bringPair(root, now);
  await answered(root, 'new');

  assert.equal(plan(root).shipFirst.holding, false);
  assert.notEqual(rowTitled(root, 'New feature').waiting, 'shipping first');
  bringPair(root, now + HOUR);
  assert.equal(pair(root), undefined);

  const tomorrow = new Date(2026, 5, 2, 9).getTime();
  assert.equal(planWork(root, { now: tomorrow }).shipFirst.holding, true);
  bringPair(root, tomorrow);
  assert.ok(pair(root));
});

test('ship off is the same as new and closes the open pair, and ship on holds again', t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', SHIP_FIRST_AT);
  bringPair(root, now);

  setShipFirst(root, 'off', now);

  assert.equal(pair(root), undefined);
  assert.equal(plan(root).shipFirst.holding, false);

  setShipFirst(root, 'on', now);

  assert.equal(plan(root).shipFirst.holding, true);
  assert.throws(() => setShipFirst(root, 'maybe', now), /ship on or ship off/);
});

test('crossing the bar with the mode on says so once and files the first pair', t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', SHIP_FIRST_AT);

  watchPile(root, plan(root).shipFirst, now);
  const { notice } = readMode(root).ship;
  watchPile(root, plan(root).shipFirst, now + 1000);

  assert.match(notice.line, /Shipping first: 8 finished/);
  assert.deepEqual(readMode(root).ship.notice, notice);
  assert.ok(pair(root));
});

test('falling under the bar and crossing it again says so again', t => {
  const root = dataRoot(t);
  project(root, 'api');
  const [first] = finishedOn(root, 'api', SHIP_FIRST_AT);
  watchPile(root, plan(root).shipFirst, now);

  updateItem(root, 'api', first.id, { state: 'declined' }, now);
  watchPile(root, plan(root).shipFirst, now + 1);
  updateItem(root, 'api', first.id, { state: 'branch' }, now);
  watchPile(root, plan(root).shipFirst, now + 2);

  assert.equal(readMode(root).ship.notice.at, new Date(now + 2).toISOString());
});

async function hobkin(root, ...args) {
  let text = '';
  await main(['work', ...args, '--home', root], { write: chunk => { text += chunk; } }, { input: Readable.from([]) });
  return JSON.parse(text);
}

test('hobkin work start says the real count and files the first pair at once', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', 46);
  writeMode(root, { enabled: false, folder: root });

  const { message } = await hobkin(root, 'start');

  assert.match(message, /Shipping first: 46 finished and waiting/);
  assert.ok(pair(root));
});

test('hobkin work start with a small pile files nothing', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', 2);
  writeMode(root, { enabled: false, folder: root });

  const { message } = await hobkin(root, 'start');

  assert.doesNotMatch(message, /Shipping first/);
  assert.equal(pair(root), undefined);
});

test('hobkin work ship reads the pile, and off and on change it', async t => {
  const root = dataRoot(t);
  project(root, 'api');
  finishedOn(root, 'api', 9);

  assert.equal((await hobkin(root, 'ship')).pile, 9);
  assert.equal((await hobkin(root, 'ship', 'off')).ok, true);
  assert.equal((await hobkin(root, 'ship')).holding, false);
});
