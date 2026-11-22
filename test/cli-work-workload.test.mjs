import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workStatus } from '../src/cli/work/commands.mjs';
import { forecastAndOutlook, forecastWork } from '../src/cli/work/forecast.mjs';
import { holdingOf, planWork } from '../src/cli/work/plan.mjs';
import { readUnmerged } from '../src/cli/work/unmerged.mjs';
import { recordSignals } from '../src/cli/work/signals.mjs';
import {
  chooseProject, fileItem, paths, pickNext, readMode, recordLaunch, recordTokens, retryItem, setChangesADay, setShipFirstAt, setShipFirstOn, setWorkHours, setWorkload, updateItem, writeMode,
  writeState,
} from '../src/cli/work/store.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
// 20:00 local on a Monday: outside a working day's hours, with runs already started that morning.
const evening = new Date(2026, 5, 1, 20).getTime();
const at = time => new Date(time).toISOString();
const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (key, details = {}) => ({ key, kind: 'fix', title: key, brief, ...details });

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-workload-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeMode(root, { enabled: true, autoPick: true, machinesLook: false });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: evening + 3 * 24 * HOUR } });
  return root;
}

/** A project past its study that has just had its looks, so nothing is due on it but what a test files. */
function project(root, slug, time) {
  chooseProject(root, `/repos/${slug}`, 'important', time);
  mkdirSync(paths(root, slug).directory, { recursive: true });
  writeFileSync(paths(root, slug).project, '# What it is\n');
  writeState(root, slug, { lastLensAt: at(time), lastIdeasAt: at(time), lastSignalsAt: at(time), lastMachinesAt: at(time) });
}

/** Item runs that started and ended earlier today, as the token record keeps them. */
function ranToday(root, slug, starts) {
  for (const start of starts) recordTokens(root, { slug, lane: 'do', kind: 'do', tokens: 1000, startedAt: at(start) }, start + 10 * MINUTE);
}

/** Finished changes waiting on a project, as the last survey read them and Done lists them. */
function finishedOn(root, slug, count, time) {
  const rows = Array.from({ length: count }, (_row, index) => {
    const branch = `hobkin/${slug}-${index}`;
    const { id } = fileItem(root, slug, item(`finished on ${branch}`), time);
    return updateItem(root, slug, id, { state: 'branch', branch, proof: 'It failed, then it passed.' }, time);
  });
  const { projects } = readUnmerged(root);
  const open = rows.map(({ branch }) => ({ kind: 'branch', branch, sha: `sha-${branch}`, conflict: false, size: { additions: 1, deletions: 0, files: 1 } }));
  writeJson(join(root, 'work', 'unmerged.json'), { at: at(time), projects: { ...projects, [slug]: { lastMergeAt: null, trees: 0, open } } });
}

/** The same home every time: two projects, three item runs this morning, an urgent fix, two new fixes and a feature. */
function busyHome(t, { waiting = 0, urgent = true } = {}) {
  const root = dataRoot(t);
  const morning = new Date(2026, 5, 1, 8).getTime();
  project(root, 'api', morning);
  project(root, 'web', morning);
  ranToday(root, 'api', [new Date(2026, 5, 1, 9).getTime(), new Date(2026, 5, 1, 10).getTime()]);
  ranToday(root, 'web', [new Date(2026, 5, 1, 11).getTime()]);
  if (waiting) finishedOn(root, 'web', waiting, morning);
  fileItem(root, 'api', item('Fix login'), morning);
  fileItem(root, 'api', item('Add export', { kind: 'feature' }), morning);
  if (urgent) fileItem(root, 'web', item('Fix the outage', { urgent: true }), morning);
  fileItem(root, 'web', item('Fix the footer'), morning);
  return root;
}

const plan = (root, options = {}) => planWork(root, { now: evening, ...options });
const waits = ({ entries }) => entries.map(({ title, waiting }) => [title, waiting]);
const NEW_SETTINGS = ['changesADay', 'hours', 'shipFirst', 'shipFirstAt', 'reviewPulls'];

test('a home that set none of the workload starts work exactly as before', t => {
  const root = busyHome(t);
  const running = [{ slug: 'web', lane: 'do', item: 'zzzzzz', startedAt: at(evening - 5 * MINUTE) }];
  const free = plan(root, { running, lastStartAt: evening - MINUTE });

  assert.equal(free.next.title, 'Fix login');
  assert.equal(free.pause, null);
  assert.deepEqual(waits(free), [
    ['Fix the outage', 'one item at a time here'],
    ['Fix login', null],
    ['Fix the footer', 'one item at a time here'],
    ['Add export', null],
  ]);
  assert.equal(forecastWork(root, free, { now: evening, running }).line, 'Next 8h: about 4 jobs · 1 P0 · 2 P1 · 1 P2 · 2 agents at a time.');

  // Eight finished changes wait, so new work holds and what still runs at the bar goes on.
  const held = plan(busyHome(t, { waiting: 8 }), { lastStartAt: evening - MINUTE });
  assert.equal(held.next.title, 'Fix the outage');
  assert.deepEqual(held.shipFirst, { pile: 8, bar: 8, holding: true, line: 'Shipping first: 8 finished and waiting. New work starts under 8.' });
  assert.deepEqual(waits(held).filter(([, waiting]) => waiting === 'shipping first').map(([title]) => title), ['Fix login', 'Fix the footer', 'Add export']);

  const kept = JSON.parse(readFileSync(join(root, 'work', 'mode.json'), 'utf8'));
  assert.deepEqual(NEW_SETTINGS.filter(name => name in kept), [], 'nothing of the workload is written for a home that set none of it');
});

const midnight = new Date(2026, 5, 2).getTime();
const outlookAt = (root, planned, now) => forecastAndOutlook(root, planned, { now }).outlook;
const keyOf = (root, title) => plan(root).entries.find(entry => entry.title === title).key;

test('with a cap of 3 changes a day, a fourth run does not start that day and starts the next', t => {
  const root = busyHome(t, { urgent: false });
  setChangesADay(root, 3);

  const capped = plan(root);
  assert.equal(capped.next, null);
  assert.deepEqual(waits(capped).map(([, waiting]) => waiting), Array(3).fill('3 of 3 changes today, the day\'s cap'));
  assert.equal(capped.pause, null, 'it stops nothing: what runs finishes');
  assert.equal(plan(root, { now: midnight }).next.title, 'Fix login', 'a new day starts with none');

  // The forecast promises nothing more today, and the next change when the plan starts it.
  assert.deepEqual(outlookAt(root, capped, evening), { startedToday: 3, moreToday: 0, nextAt: at(midnight) });
  assert.equal(outlookAt(root, plan(root, { now: midnight }), midnight).nextAt, at(midnight));

  // A run going now counts, and a look does not: the cap is on changes.
  setChangesADay(root, 4);
  recordTokens(root, { slug: 'api', lane: 'look', kind: 'look', tokens: 1000, startedAt: at(evening - HOUR) }, evening - HOUR / 2);
  assert.equal(plan(root).next.title, 'Fix the footer', 'api ran last, so web goes first');
  const running = [{ slug: 'web', lane: 'do', item: 'zzzzzz', startedAt: at(evening - 5 * MINUTE) }];
  assert.equal(plan(root, { running }).next, null);

  // A pick is the user's own word: it starts at the cap.
  pickNext(root, keyOf(root, 'Add export'));
  assert.equal(plan(root, { running }).next.title, 'Add export');
});

test('with hours of 09:00 to 18:00, nothing new starts at 20:00, running agents finish, and work starts again at 09:00', t => {
  const root = busyHome(t, { urgent: false });
  setWorkHours(root, { from: '09:00', to: '18:00' });
  const opens = new Date(2026, 5, 2, 9).getTime();

  const closed = plan(root);
  assert.equal(closed.next, null);
  assert.equal(closed.pause, null, 'it stops nothing: what runs finishes');
  assert.deepEqual(waits(closed).map(([, waiting]) => waiting), Array(3).fill('outside work hours until 09:00 tomorrow'));
  assert.equal(plan(root, { now: opens - MINUTE }).next, null);
  assert.ok(plan(root, { now: opens }).next, 'at 09:00 work starts again');

  // The forecast promises nothing outside the hours, and the first start at 09:00.
  const tonight = forecastWork(root, closed, { now: evening });
  assert.deepEqual([tonight.jobs, tonight.limit, tonight.line], [0, 'hours', 'Next 8h: nothing starts. Work hours hold it.']);
  assert.deepEqual(outlookAt(root, closed, evening), { startedToday: 3, moreToday: 0, nextAt: null });
  const early = new Date(2026, 5, 2, 8).getTime();
  assert.deepEqual(outlookAt(root, plan(root, { now: early }), early), { startedToday: 0, moreToday: 3, nextAt: at(opens) });

  // Hours that cross midnight hold the day instead.
  setWorkHours(root, { from: '19:00', to: '07:00' });
  assert.equal(plan(root).next.title, 'Fix login');
  // A pick is the user's own word: it starts outside the hours.
  setWorkHours(root, { from: '09:00', to: '18:00' });
  pickNext(root, keyOf(root, 'Add export'));
  assert.equal(plan(root).next.title, 'Add export');
});

test('with ship first off, new work starts while 8 finished changes wait, and the bar is the user\'s number', t => {
  const root = busyHome(t, { waiting: 8 });
  const running = [{ slug: 'web', lane: 'do', item: 'zzzzzz', startedAt: at(evening - 5 * MINUTE) }];
  assert.equal(plan(root, { running }).next, null, 'on by default: new work holds at 8');

  setShipFirstOn(root, false);
  const open = plan(root, { running });
  assert.equal(open.shipFirst.holding, false);
  assert.equal(open.next.title, 'Fix login');
  assert.deepEqual(waits(open).filter(([, waiting]) => waiting === 'shipping first'), []);
  assert.notEqual(forecastWork(root, open, { now: evening, running }).limit, 'ship');

  setShipFirstOn(root, true);
  setShipFirstAt(root, 10);
  assert.deepEqual(plan(root, { running }).shipFirst, { pile: 8, bar: 10, holding: false, line: null });
  setShipFirstAt(root, 8);
  assert.equal(plan(root, { running }).shipFirst.holding, true);
});

test('a director with work hours lets its running agent finish and starts nothing new once the hours end', async t => {
  const h = director(t);
  const release = Promise.withResolvers();
  h.agent = async request => {
    if (request.purpose === 'work-do') await release.promise;
  };
  studied(h, 'api');
  studied(h, 'web');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  fileItem(h.root, 'web', item('Fix the footer'), h.clock);
  const clock = time => `${String(new Date(time).getHours()).padStart(2, '0')}:${String(new Date(time).getMinutes()).padStart(2, '0')}`;
  setWorkHours(h.root, { from: clock(h.clock - HOUR), to: clock(h.clock + HOUR) });

  await h.startedRun();
  assert.equal(h.calls.filter(call => call.purpose === 'work-do').length, 1);

  h.clock += 2 * HOUR;
  await h.director.tick();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(h.calls.filter(call => call.purpose === 'work-do').length, 1, 'nothing new starts outside the hours');
  assert.equal(h.director.running().length, 1, 'the running agent goes on');

  release.resolve();
  await h.settled();
  assert.equal(h.director.running().length, 0);
  assert.equal(Object.values(h.runtime.data.runs).find(run => run.work?.lane === 'do').status, 'completed', 'and it finishes as it would have');
});

test('the work state says what holds work mode, until when, in one sentence', t => {
  const holding = (root, options = {}) => holdingOf(plan(root, options), options.now ?? evening);
  const twoRunning = [{ slug: 'web', lane: 'do', item: 'zzzzzz', startedAt: at(evening) }, { slug: 'api', lane: 'look', startedAt: at(evening) }];

  assert.equal(holding(busyHome(t)), null, 'nothing holds it while something starts');
  assert.deepEqual(holding(busyHome(t), { running: twoRunning }), { kind: 'agents-busy', until: null, line: 'All 2 agents are busy, so the next start waits for one to finish.' });

  const capped = busyHome(t, { urgent: false });
  setChangesADay(capped, 3);
  assert.deepEqual(holding(capped), { kind: 'cap', until: at(midnight), line: '3 of today\'s 3 changes have started, so the next starts at 00:00 tomorrow.' });

  const evenings = busyHome(t, { urgent: false });
  setWorkHours(evenings, { from: '09:00', to: '18:00' });
  assert.deepEqual(holding(evenings), { kind: 'hours', until: at(new Date(2026, 5, 2, 9).getTime()), line: 'Work hours are 09:00 to 18:00, so nothing new starts until 09:00 tomorrow.' });

  const shipping = busyHome(t, { waiting: 8 });
  assert.deepEqual(holding(shipping, { running: twoRunning.slice(0, 1) }), {
    kind: 'ship-first', until: null, line: '8 finished changes wait for you, so new work holds until fewer than 8 wait.',
  });

  const picking = busyHome(t);
  writeMode(picking, { autoPick: false });
  assert.deepEqual(holding(picking), { kind: 'auto-pick-off', until: null, line: 'Auto-pick is off, so only what you start runs.' });

  const spent = busyHome(t);
  writeMode(spent, { dailyTokens: 3000 });
  assert.deepEqual(holding(spent), { kind: 'tokens', until: at(midnight), line: '3k of today\'s 3k tokens are used, so nothing new starts until 00:00 tomorrow.' });

  // An urgent fix may pass the hour's share, so this home has none.
  const hourly = dataRoot(t);
  project(hourly, 'api', evening - 2 * HOUR);
  fileItem(hourly, 'api', item('Fix login'), evening - 2 * HOUR);
  recordTokens(hourly, { slug: 'api', lane: 'do', kind: 'do', tokens: 9000000, startedAt: at(evening - 30 * MINUTE) }, evening - 20 * MINUTE);
  assert.deepEqual(holding(hourly), {
    kind: 'hourly-share', until: at(evening + 40 * MINUTE), line: 'This hour\'s share of 8.3m tokens is used, so nothing new starts until about 20:40 today.',
  });

  const limited = busyHome(t);
  writeMode(limited, { usagePause: { at: at(evening), until: at(evening + HOUR), reason: 'Rate limit reached', strikes: 1 } });
  assert.deepEqual(holding(limited), { kind: 'usage-limit', until: at(evening + HOUR), line: 'A usage limit holds new work until 21:00 today.' });

  const paused = busyHome(t);
  writeMode(paused, { pausedAt: at(evening) });
  assert.deepEqual(holding(paused), { kind: 'paused', until: null, line: 'Paused by hand, so nothing new starts until work mode resumes.' });

  const off = busyHome(t);
  writeMode(off, { enabled: false });
  assert.deepEqual(holding(off), { kind: 'off', until: null, line: 'Work mode is off, so nothing starts by itself.' });

  const empty = dataRoot(t);
  project(empty, 'api', evening);
  assert.deepEqual(holding(empty), { kind: 'nothing-queued', until: null, line: 'Nothing is queued, so nothing starts.' });
});

test('the work state publishes the workload as it stands, what holds it, the outlook and an open allowance request', async t => {
  const root = busyHome(t, { urgent: false });
  setWorkload(root, { changesADay: 3, reviewPulls: 'mine' });

  const status = workStatus(root, { now: evening });
  assert.deepEqual(status.workload, {
    agents: 2, autoPick: true, changesADay: 3, dailyTokens: 100000000, hours: null, shipFirst: true, shipFirstAt: 8, reviewOnFinish: false, reviewPulls: 'mine',
  });
  assert.equal(status.holding.kind, 'cap');
  assert.deepEqual(status.outlook, { startedToday: 3, moreToday: 0, nextAt: at(midnight) });
  assert.equal(status.allowanceRequest, null);
  // The words that were there stay.
  assert.match(status.forecast.line, /^Next 8h: /);

  writeMode(root, { allowanceRequest: { day: new Date().toDateString(), limit: 100000000, proposed: 200000000, used: 100000000, at: new Date().toISOString() } });
  assert.equal(workStatus(root).allowanceRequest.proposed, 200000000);
});

/** A project hobkin can watch, with a change that went live at 18:30 and trouble suspected after it. */
function watchedHome(t) {
  const root = dataRoot(t);
  const morning = new Date(2026, 5, 1, 8).getTime();
  const live = new Date(2026, 5, 1, 18, 30).getTime();
  project(root, 'api', morning);
  recordSignals(root, 'api', { type: 'service', deploy: proof, logs: proof }, morning);
  recordLaunch(root, 'api', { item: 'landed', sha: 'abc1234', stage: 'pushed', mergedAt: at(live), pushedAt: at(live), suspectedAt: at(live + 15 * MINUTE) }, live);
  return root;
}
const proof = { command: 'kamal app version', saw: 'abc1234' };

test('the hours and the cap hold only new work that starts by itself: a watch, work on finished changes, urgent work and the user\'s pick go, and a pick hobkin made does not', t => {
  const root = watchedHome(t);
  setWorkHours(root, { from: '09:00', to: '18:00' });
  const feature = fileItem(root, 'api', item('Add export', { kind: 'feature' }), evening - HOUR);
  const finished = updateItem(root, 'api', fileItem(root, 'api', item('Fix login'), evening - 2 * HOUR).id, { state: 'branch', branch: 'hobkin/login', reviewAsked: true }, evening - HOUR);
  const urgent = fileItem(root, 'api', item('Fix the outage', { urgent: true }), evening - HOUR);
  const rows = () => Object.fromEntries(plan(root).entries.map(entry => [entry.title, entry.waiting]));

  // The look after a deploy YOLO mode made at 18:30, with trouble suspected, goes at 20:00 like a review or an urgent fix.
  assert.ok(plan(root).next);
  assert.equal(plan(root).entries.find(entry => entry.key === 'watch:api').grade, 'P0');
  assert.equal(rows()['watch look'], null);
  assert.equal(rows()['Add export'], 'outside work hours until 09:00 tomorrow');

  // hobkin puts the review of a finished change first itself, and that pick is its own: it starts as finishing work, never as the user's word.
  retryItem(root, 'api', finished.id, evening);
  assert.deepEqual(readMode(root).queueByHobkin, [`item:api:${finished.id}`]);
  assert.notEqual(rows()['Fix login'], 'outside work hours until 09:00 tomorrow');
  assert.equal(rows()['Fix the outage'] === 'outside work hours until 09:00 tomorrow', false);

  // A pick of new work hobkin made waits for the hours. The user's own pick of it starts.
  pickNext(root, `item:api:${feature.id}`, { by: 'hobkin' });
  assert.equal(rows()['Add export'], 'outside work hours until 09:00 tomorrow');
  pickNext(root, `item:api:${feature.id}`);
  assert.equal(rows()['Add export'], null);
  assert.deepEqual(readMode(root).queueByHobkin, [`item:api:${finished.id}`], 'the user\'s word takes the mark off');
  assert.ok(urgent);
});

test('the cap counts new changes only: a review or a fix of finished work and a second run of an item are no new change, so with scoring on 3 new changes still start', t => {
  const root = dataRoot(t);
  const morning = new Date(2026, 5, 1, 8).getTime();
  project(root, 'api', morning);
  const first = fileItem(root, 'api', item('First change'), morning);
  const second = fileItem(root, 'api', item('Second change'), morning);
  const yesterday = fileItem(root, 'api', item('Started yesterday'), morning);
  const fix = fileItem(root, 'api', item('Fix for a finished branch', { kind: 'pr-fix' }), morning);
  const run = (id, hour) => recordTokens(root, { slug: 'api', lane: 'do', kind: 'do', item: id, tokens: 1000, startedAt: at(new Date(2026, 5, 1, hour).getTime()) }, new Date(2026, 5, 1, hour, 30).getTime());
  recordTokens(root, { slug: 'api', lane: 'do', kind: 'do', item: yesterday.id, tokens: 1000, startedAt: at(evening - 24 * HOUR) }, evening - 23 * HOUR);
  run(first.id, 9);
  // Its review, which scoring on gives each finished change, is a second run of the same item.
  run(first.id, 10);
  run(fix.id, 11);
  run(yesterday.id, 12);
  run(second.id, 13);
  for (const { id } of [first, second, yesterday]) updateItem(root, 'api', id, { state: 'branch', branch: `hobkin/${id}` }, evening - HOUR);
  updateItem(root, 'api', fix.id, { state: 'done' }, evening - HOUR);
  fileItem(root, 'api', item('Third change'), morning);
  setChangesADay(root, 3);

  assert.equal(plan(root).budget.changes, 2, 'two new changes started today');
  assert.equal(plan(root).next.title, 'Third change', 'so the third starts');
  // A run of it going now is the third.
  const running = [{ slug: 'api', lane: 'do', item: 'thirdx', startedAt: at(evening - MINUTE) }];
  assert.equal(plan(root, { running }).budget.changes, 3);
  assert.equal(forecastAndOutlook(root, plan(root), { now: evening }).outlook.moreToday, 1, 'the forecast counts the same way');
});

test('what holds work mode is the hold that ends last, with the time work really starts again', t => {
  const holding = (root, options = {}) => holdingOf(plan(root, options), options.now ?? evening);
  const afternoon = new Date(2026, 5, 1, 14).getTime();
  const opens = at(new Date(2026, 5, 2, 9).getTime());

  // The cap is reached at 14:00 inside hours of 09:00 to 18:00: it lifts at midnight, and the hours hold until 09:00.
  const capped = busyHome(t, { urgent: false });
  setWorkload(capped, { changesADay: 3, hours: { from: '09:00', to: '18:00' } });
  assert.deepEqual(holding(capped, { now: afternoon }), {
    kind: 'cap', until: opens, line: '3 of today\'s 3 changes have started, so the next starts at 09:00 tomorrow, when work hours begin.',
  });

  // With every agent busy as well, the cap still lasts longer than a run.
  const busy = busyHome(t, { urgent: false });
  setChangesADay(busy, 3);
  const twoRunning = [{ slug: 'web', lane: 'look', startedAt: at(evening) }, { slug: 'api', lane: 'look', startedAt: at(evening) }];
  assert.equal(holding(busy, { running: twoRunning }).kind, 'cap');

  // The day's tokens spent outside the hours: the hours end last.
  const spent = busyHome(t);
  setWorkHours(spent, { from: '09:00', to: '18:00' });
  writeMode(spent, { dailyTokens: 3000 });
  assert.deepEqual(holding(spent), { kind: 'hours', until: opens, line: 'Work hours are 09:00 to 18:00, so nothing new starts until 09:00 tomorrow.' });
  // Spent at 17:00, inside them: the tokens hold until midnight and the hours after it.
  assert.deepEqual(holding(spent, { now: new Date(2026, 5, 1, 17).getTime() }), {
    kind: 'tokens', until: opens, line: '3k of today\'s 3k tokens are used, so nothing new starts until 09:00 tomorrow, when work hours begin.',
  });
});
