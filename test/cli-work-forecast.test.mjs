import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../src/cli/main.mjs';
import { forecastEachMinute, forecastWork } from '../src/cli/work/forecast.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import { SHIP_FIRST_AT } from '../src/cli/work/ship.mjs';
import { chooseProject, fileItem, paths, pickNext, recordTokens, setProjectPriority, tokenEvents, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const now = new Date(2026, 5, 1, 12).getTime();
const at = time => new Date(time).toISOString();
const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (key, details = {}) => ({ key, kind: 'fix', title: key, brief, impact: 'high', ...details });

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-forecast-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // The weekly state-machines look is off here, so each test counts only the work it sets up.
  writeMode(root, { enabled: true, machinesLook: false });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: now + 3 * 24 * HOUR } });
  return root;
}

/** A project past its study that has just had a look, so its next comes round at its own pace: an hour at P0, a day at P1, 3 days at P2. */
function project(root, slug, level = 'important', time = now) {
  chooseProject(root, `/repos/${slug}`, level, time);
  mkdirSync(paths(root, slug).directory, { recursive: true });
  writeFileSync(paths(root, slug).project, '# What it is\n');
  writeState(root, slug, { lastLensAt: at(time), lastIdeasAt: at(time), lastSignalsAt: at(time) });
}

const forecast = root => forecastWork(root, planWork(root, { now }), { now });

/** Three items that each took this long, a day ago, so the forecast times the next ones by them. */
function itemsTook(root, length) {
  for (let index = 0; index < 3; index++) {
    const ended = now - 30 * HOUR + index * 3 * HOUR;
    recordTokens(root, { slug: 'api', lane: 'do', kind: 'do', tokens: 1000, startedAt: at(ended - length) }, ended);
  }
}

test('what is ready now and the looks that come due later both count, by grade', t => {
  const root = dataRoot(t);
  project(root, 'api', 'important', now - 20 * HOUR);
  writeState(root, 'api', { lastSignalsAt: at(now) });
  fileItem(root, 'api', item('Fix login'), now);
  fileItem(root, 'api', item('Tidy the copy', { impact: 'medium' }), now);

  const { jobs, grades, limit, line } = forecast(root);

  assert.deepEqual(grades, { P0: 0, P1: 2, P2: 1, P3: 0 }, 'two items, and a P1 look at 16:00, a day after the last');
  assert.deepEqual([jobs, limit], [3, null]);
  assert.equal(line, 'Next 8h: about 3 jobs · 2 P1 · 1 P2 · 2 agents at a time.');
});

test('runs take as long as the last ones like them did, and two agents fit only so many', t => {
  const root = dataRoot(t);
  for (const slug of ['api', 'web']) {
    project(root, slug, 'critical');
    for (let index = 0; index < 5; index++) fileItem(root, slug, item(`${slug} fix ${index}`), now);
  }
  itemsTook(root, 2 * HOUR);

  const { jobs, grades, limit, line } = forecast(root);

  assert.deepEqual([jobs, grades.P0, limit], [8, 8, 'pace'], 'four two-hour runs for each agent, and no room left for the hourly looks');
  assert.match(line, /More is due than fits\.$/);
});

test('the hourly share stops it when the hours are full', t => {
  const root = dataRoot(t);
  for (const slug of ['api', 'web', 'docs', 'site']) {
    project(root, slug, 'casual');
    for (let index = 0; index < 5; index++) pickNext(root, `item:${slug}:${fileItem(root, slug, item(`${slug} fix ${index}`), now).id}`);
  }
  writeMode(root, { dailyTokens: 24000000 });

  const { jobs, limit, line } = forecast(root);

  assert.deepEqual([jobs, limit], [16, 'hour'], 'two runs of a million fit each hour, and picks spend no priority\'s runs');
  assert.match(line, /The hourly share caps it\.$/);
});

test('the daily budget stops it near what it can pay for', t => {
  const root = dataRoot(t);
  for (const slug of ['api', 'web', 'docs']) {
    project(root, slug);
    fileItem(root, slug, item(`${slug} fix`), now);
    fileItem(root, slug, item(`${slug} fix again`), now);
  }
  writeMode(root, { dailyTokens: 3500000 });

  const { jobs, limit, line } = forecast(root);

  assert.deepEqual([jobs, limit], [3, 'day'], 'a first guess is a million a run');
  assert.match(line, /The daily budget caps it\.$/);
});

test('a day with its budget used up starts again at midnight', t => {
  const root = dataRoot(t);
  const late = new Date(2026, 5, 1, 20).getTime();
  for (const slug of ['api', 'web']) {
    project(root, slug, 'important', late);
    fileItem(root, slug, item(`${slug} fix`), late);
  }
  writeMode(root, { dailyTokens: 10000000 });
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 10000000 }, late - 2 * HOUR);

  const plan = planWork(root, { now: late });
  const { jobs, limit } = forecastWork(root, plan, { now: late });

  assert.equal(plan.pause.kind, 'day');
  assert.deepEqual([jobs, limit], [2, null]);
  writeMode(root, { usagePause: { at: at(late), until: at(late + 5 * HOUR), reason: 'The provider said stop.' } });
  const after = forecastWork(root, planWork(root, { now: late }), { now: late });
  assert.deepEqual([after.jobs, after.limit], [2, 'usage'], 'a limit that ends after midnight starts in the new day');
});

test('paused by hand, nothing starts, and it says what ends that', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('Fix login'), now);
  writeMode(root, { pausedAt: at(now) });

  const { jobs, limit, line } = forecast(root);

  assert.deepEqual([jobs, limit], [0, 'hand']);
  assert.equal(line, 'Next 8h: nothing starts. Paused by hand until hobkin work resume.');
});

test('a usage limit holds every start until it ends', t => {
  const root = dataRoot(t);
  for (const slug of ['api', 'web', 'docs']) {
    project(root, slug);
    fileItem(root, slug, item(`${slug} fix`), now);
  }
  itemsTook(root, 2 * HOUR);
  writeMode(root, { usagePause: { at: at(now), until: at(now + 7.75 * HOUR), reason: 'The provider said stop.' } });

  const { jobs, limit, until, line } = forecast(root);

  assert.equal(jobs, 2, 'the quarter hour after it ends has two starts five minutes apart, and both agents stay busy');
  assert.deepEqual([limit, until], ['usage', at(now + 7.75 * HOUR)]);
  assert.match(line, /Paused by a usage limit until 19:45 today\.$/);
});

test('shipping first holds new work and its looks, and what still runs at the bar counts', t => {
  const root = dataRoot(t);
  project(root, 'api');
  for (let index = 0; index < SHIP_FIRST_AT; index++) {
    const { id } = fileItem(root, 'api', item(`finished ${index}`), now);
    updateItem(root, 'api', id, { state: 'branch', branch: `hobkin/${index}` }, now);
  }
  fileItem(root, 'api', item('New feature', { kind: 'feature' }), now);
  fileItem(root, 'api', item('Urgent fix', { urgent: true }), now);

  const { jobs, grades, limit, line } = forecast(root);

  assert.deepEqual([jobs, grades.P0, limit], [1, 1, 'ship']);
  assert.equal(line, 'Next 8h: about 1 job · 1 P0 · 2 agents at a time.', 'the shipping first line beside it already says why');
});

test('with auto-pick off it counts work that finishes what is already done, and no new work', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('New work'), now);
  fileItem(root, 'api', item('Describe hobkin/abc', { kind: 'pr-fix' }), now);
  writeMode(root, { autoPick: false });

  const { jobs, grades, limit } = forecast(root);

  assert.deepEqual([jobs, grades.P1, limit], [1, 1, 'picks']);
});

test('with the mode off it counts what turning it on would start, which ends a pause by hand', t => {
  const root = dataRoot(t);
  project(root, 'api', 'casual');
  fileItem(root, 'api', item('Fix login'), now);
  writeMode(root, { enabled: false, pausedAt: at(now) });

  assert.equal(forecast(root).line, 'Next 8h: about 1 job · 1 P2 · 2 agents at a time.');
});

const countedAgo = (priority, hours) => ({ at: at(now - hours * HOUR), priority });

test('a pile of 21 projects fills slots beyond the former daily caps and retains the P3 weekly cap', t => {
  const root = dataRoot(t);
  const pile = [...Array(14).fill('important'), ...Array(7).fill('casual')];
  for (const [index, level] of pile.entries()) {
    project(root, `project-${index}`, level);
    for (let count = 0; count < 3; count++) fileItem(root, `project-${index}`, item(`fix ${count}`), now);
  }
  setProjectPriority(root, 'project-20', 'P3');

  const { jobs, grades, limit, line } = forecast(root);

  assert.ok(grades.P1 > 4);
  assert.ok(grades.P2 > 1);
  assert.equal(grades.P3, 1);
  assert.equal(jobs, grades.P1 + grades.P2 + grades.P3);
  assert.equal(limit, 'pace');
  assert.match(line, /More is due than fits\.$/);
});

test('P3 starts become eligible as their rolling week ends inside the forecast', t => {
  const root = dataRoot(t);
  project(root, 'api');
  setProjectPriority(root, 'api', 'P3');
  for (let index = 0; index < 2; index++) fileItem(root, 'api', item(`fix ${index}`), now);
  writeMode(root, { countedStarts: [countedAgo('P3', 167)] });

  const { jobs, grades, limit } = forecast(root);

  assert.deepEqual([jobs, grades.P3, limit], [1, 1, 'priority'], 'one place frees at 13:00, then the next waits a week');
});

test('old P1 and P2 histories allow ready work in both the plan and forecast', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'site', 'casual');
  fileItem(root, 'api', item('New work'), now);
  fileItem(root, 'api', item('Urgent fix', { urgent: true }), now);
  fileItem(root, 'site', item('Site work'), now);
  writeMode(root, { countedStarts: [...[1, 2, 3, 4].map(hours => countedAgo('P1', hours)), countedAgo('P2', 1)] });

  const plan = planWork(root, { now });
  const { jobs, grades, limit, line } = forecastWork(root, plan, { now });

  assert.equal(plan.next.title, 'Urgent fix');
  assert.deepEqual(plan.entries.map(({ title, waiting }) => [title, waiting]), [
    ['Urgent fix', null],
    ['New work', null],
    ['Site work', null],
  ]);
  assert.deepEqual([jobs, grades, limit], [3, { P0: 1, P1: 1, P2: 1, P3: 0 }, null]);
  assert.equal(line, 'Next 8h: about 3 jobs · 1 P0 · 1 P1 · 1 P2 · 2 agents at a time.');
});

test('the status works it out once a minute, and a change it counts shows at once', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('Fix login'), now);
  const second = now + 1000;

  const first = forecastEachMinute(root, planWork(root, { now }), { now });
  const again = forecastEachMinute(root, planWork(root, { now: second }), { now: second });
  writeMode(root, { pausedAt: at(second) });
  const paused = forecastEachMinute(root, planWork(root, { now: second }), { now: second });

  assert.equal(again, first, 'the same minute and the same queue reuse the answer');
  assert.deepEqual([first.limit, paused.limit], [null, 'hand']);
});

test('a run that ends says when it began, so the next ones like it can be timed', async t => {
  const h = director(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  const began = h.clock;
  h.agent = request => {
    h.clock += 20 * MINUTE;
    writeFileSync(request.sessionFile, `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 10, output: 10 } } })}\n`);
  };

  await h.tick();

  const [{ startedAt, at: ended }] = tokenEvents(h.root);
  assert.equal(startedAt, at(began));
  assert.equal(Date.parse(ended) - began, 20 * MINUTE);
});

async function hobkin(root, ...args) {
  let text = '';
  await main(['work', ...args, '--home', root], { write: chunk => { text += chunk; } }, { input: Readable.from([]) });
  return JSON.parse(text);
}

test('the reply to start and the status the main agent reads both carry it', async t => {
  const root = dataRoot(t);
  writeMode(root, { enabled: false });

  const { message } = await hobkin(root, 'start', root, '--auto');
  const { forecast: status } = await hobkin(root, 'status');

  const line = 'Next 8h: about 1 job · 1 P0 · 2 agents at a time.';
  assert.ok(message.endsWith(line), message);
  assert.deepEqual(status, { hours: 8, jobs: 1, grades: { P0: 1, P1: 0, P2: 0, P3: 0 }, agents: 2, limit: null, until: null, line });
});
