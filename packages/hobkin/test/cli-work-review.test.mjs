import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { REVIEW_EVERY_MS, reviewDue, reviewMessage, reviewView } from '../src/cli/work/review.mjs';
import {
  chooseProject, dropProject, fileItem, proposeProject, readItems, recordTokens, setProjectPaused, setProjectPriority, skipProject, updateItem, writeMode,
} from '../src/cli/work/store.mjs';

const DAY_MS = 86400000;
const now = Date.parse('2026-06-15T12:00:00.000Z');
const daysAgo = days => now - days * DAY_MS;
const iso = time => new Date(time).toISOString();

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-work-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function workingRoot(t) {
  const root = dataRoot(t);
  writeMode(root, { enabled: true });
  return root;
}

// Chosen a month ago unless a test says otherwise, so no project here is too new to judge by accident.
const choose = (root, name, { level = 'important', at = daysAgo(30) } = {}) => chooseProject(root, `/repos/${name}`, level, at).slug;

function addItem(root, slug, state, { at = daysAgo(1), ...change } = {}) {
  const key = `item:${readItems(root, slug).length}`;
  const { id } = fileItem(root, slug, { key, kind: 'fix', title: key, brief: 'Evidence and first change.' }, daysAgo(20));
  return updateItem(root, slug, id, { state, ...change }, at);
}

const spend = (root, slug, tokens, at = daysAgo(1)) => recordTokens(root, { slug, lane: 'do', tokens }, at);

/** Only an item says a branch is finished, so a branch with none gets one, from before the week so it is not this week's progress. */
function writeSurvey(root, projects) {
  for (const [slug, { open }] of Object.entries(projects)) {
    for (const { branch } of open) {
      if (!readItems(root, slug).some(item => item.branch === branch)) addItem(root, slug, 'branch', { branch, at: daysAgo(20) });
    }
  }
  writeFileSync(join(root, 'work', 'unmerged.json'), JSON.stringify({ at: iso(now), projects }));
}

const forEachProject = (values, survey) => Object.fromEntries(Object.entries(values).map(([slug, value]) => [slug, survey(value)]));

const surveyMerges = (root, merges) => writeSurvey(root, forEachProject(merges, at => ({ open: [], lastMergeAt: iso(at) })));

/** What the last survey found open, as how many days old each piece of work is, for each project. */
const surveyOpen = (root, ages) => writeSurvey(root, forEachProject(ages, days => ({
  open: days.map((age, index) => ({ kind: index % 2 ? 'pr' : 'branch', branch: `hobkin/${index}`, openedAt: iso(daysAgo(age)) })),
  lastMergeAt: null,
})));

const rowOf = (view, slug) => view.projects.find(project => project.slug === slug);
const staleness = ({ stale, why }) => ({ stale, why });

const filesUnder = root => readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath, entry.name))
  .map(file => [file, readFileSync(file, 'utf8')]);

test('a review comes a full week after the last, and the first waits for the clock to be stamped', () => {
  assert.equal(REVIEW_EVERY_MS, 7 * DAY_MS);

  assert.equal(reviewDue({}, now), false);
  assert.equal(reviewDue({ lastReviewAt: null }, now), false);
  assert.equal(reviewDue({ lastReviewAt: iso(daysAgo(7) + 1) }, now), false);
  assert.equal(reviewDue({ lastReviewAt: iso(daysAgo(7)) }, now), true);
  assert.equal(reviewDue({ lastReviewAt: iso(daysAgo(30)) }, now), true);
});

test('work mode that is off says so, whatever ran before it stopped', t => {
  const root = dataRoot(t);
  const api = choose(root, 'api');
  spend(root, api, 1000);
  addItem(root, api, 'pr');

  const { on, verdict, runs, finished } = reviewView(root, now);

  assert.deepEqual({ on, verdict, runs, finished }, { on: false, verdict: 'off', runs: 1, finished: 1 });
});

test('hobkin work review gives the week at any time', async t => {
  const root = workingRoot(t);
  choose(root, 'api');

  const { verdict, projects } = await runWorkCommand(root, ['review']);

  assert.equal(verdict, 'idle');
  assert.deepEqual(projects.map(({ slug }) => slug), ['api']);
});

test('finished work waiting for a merge is not stale, however long it has waited, because that wait is the user\'s', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  addItem(root, api, 'branch', { at: daysAgo(10), branch: 'hobkin/0' });
  surveyOpen(root, { [api]: [10] });

  const view = reviewView(root, now);

  assert.deepEqual(view.stale, []);
  assert.equal(rowOf(view, api).waiting, 1);
});

test('with work mode off no project is called stale, because nothing was meant to run', t => {
  const root = dataRoot(t);
  const api = choose(root, 'api');

  const view = reviewView(root, now);

  assert.deepEqual(view.stale, []);
  assert.deepEqual(staleness(rowOf(view, api)), { stale: false, why: null });
});

test('work mode that is on with no runs is idle', t => {
  const root = workingRoot(t);
  choose(root, 'api');

  const { on, verdict, runs, tokens } = reviewView(root, now);

  assert.deepEqual({ on, verdict, runs, tokens }, { on: true, verdict: 'idle', runs: 0, tokens: 0 });
});

test('runs that finished nothing are stalled', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  spend(root, api, 1000);
  addItem(root, api, 'open');

  const { verdict, runs, finished } = reviewView(root, now);

  assert.deepEqual({ verdict, runs, finished }, { verdict: 'stalled', runs: 1, finished: 0 });
});

test('runs that finished something are progressing', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  spend(root, api, 1000);
  addItem(root, api, 'done');

  const { verdict, runs, finished } = reviewView(root, now);

  assert.deepEqual({ verdict, runs, finished }, { verdict: 'progressing', runs: 1, finished: 1 });
});

test('the totals add up the week before now', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  const site = choose(root, 'site');
  spend(root, api, 1500);
  spend(root, api, 500);
  spend(root, site, 1000);
  addItem(root, api, 'branch');
  addItem(root, api, 'pr');
  addItem(root, site, 'merged');
  addItem(root, site, 'done');
  surveyMerges(root, { api: daysAgo(2) });

  const { since, until, runs, tokens, finished, merged } = reviewView(root, now);

  assert.deepEqual({ since, until }, { since: iso(daysAgo(7)), until: iso(now) });
  assert.deepEqual({ runs, tokens, finished, merged }, { runs: 3, tokens: 3000, finished: 4, merged: 2 });
});

test('every run counts toward what the week spent, even a look for projects or a project dropped since', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  const gone = choose(root, 'gone');
  spend(root, api, 100);
  spend(root, gone, 20);
  addItem(root, gone, 'done');
  dropProject(root, gone, daysAgo(1));
  recordTokens(root, { lane: 'discover', tokens: 3 }, daysAgo(1));

  const { runs, tokens, finished } = reviewView(root, now);

  assert.deepEqual({ runs, tokens, finished }, { runs: 3, tokens: 123, finished: 0 });
});

test('the week takes in now and leaves out what is exactly seven days old, so back to back reviews count nothing twice', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  const edges = [daysAgo(7), daysAgo(7) + 1, now, now + 1];
  edges.forEach((at, index) => spend(root, api, 10 ** index, at));
  edges.forEach(at => addItem(root, api, 'done', { at }));

  const thisWeek = reviewView(root, now);
  const lastWeek = reviewView(root, daysAgo(7));

  assert.deepEqual([thisWeek.runs, thisWeek.tokens, thisWeek.finished], [2, 110, 2]);
  assert.deepEqual([lastWeek.runs, lastWeek.tokens, lastWeek.finished], [1, 1, 1]);
});

test('a merge counts only inside the same week', t => {
  const root = workingRoot(t);
  const merges = { before: daysAgo(7), first: daysAgo(7) + 1, last: now, after: now + 1 };
  for (const name of Object.keys(merges)) choose(root, name);
  surveyMerges(root, merges);

  const view = reviewView(root, now);

  assert.deepEqual(Object.keys(merges).map(slug => rowOf(view, slug).merged), [false, true, true, false]);
  assert.equal(view.merged, 2);
});

test('a project that merged, by the survey or by an item, shows it on its row', t => {
  const root = workingRoot(t);
  const surveyed = choose(root, 'surveyed');
  const itemised = choose(root, 'itemised');
  const neither = choose(root, 'neither');
  surveyMerges(root, { surveyed: daysAgo(3) });
  addItem(root, itemised, 'merged', { at: daysAgo(3) });
  addItem(root, neither, 'pr', { at: daysAgo(3) });

  const view = reviewView(root, now);

  assert.deepEqual([surveyed, itemised, neither].map(slug => rowOf(view, slug).merged), [true, true, false]);
  assert.equal(view.merged, 2);
});

test('each row counts what its project holds, and only its own runs', t => {
  const root = workingRoot(t);
  proposeProject(root, { name: 'Finboard API', path: '/repos/finboard-api', level: 'critical' }, daysAgo(40));
  const { slug } = chooseProject(root, 'finboard-api', undefined, daysAgo(30));
  spend(root, slug, 2000);
  spend(root, choose(root, 'site'), 9000);
  for (const state of ['open', 'doing', 'stuck', 'waiting', 'noted', 'declined', 'dropped']) addItem(root, slug, state);
  addItem(root, slug, 'branch', { left: 'Rebase it by hand.' });
  addItem(root, slug, 'pr', { at: daysAgo(20) });
  addItem(root, slug, 'pr');
  addItem(root, slug, 'open', { left: 'Needs a key only the user has.' });

  assert.deepEqual(rowOf(reviewView(root, now), slug), {
    project: 'Finboard API',
    slug,
    priority: 'P0',
    level: 'critical',
    runs: 1,
    tokens: 2000,
    finished: 2,
    merged: false,
    open: 4,
    branches: 1,
    prs: 2,
    left: 2,
    waiting: 0,
    oldestDays: null,
    stale: false,
    why: null,
  });
});

test('the review counts what is waiting to merge across projects, and how old the oldest is', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  const site = choose(root, 'site');
  surveyOpen(root, { api: [9, 2, 1], site: [4, 0.5] });

  const view = reviewView(root, now);

  assert.deepEqual([view.waiting, view.oldestDays], [5, 9]);
  assert.deepEqual([rowOf(view, api).waiting, rowOf(view, api).oldestDays], [3, 9]);
  assert.deepEqual([rowOf(view, site).waiting, rowOf(view, site).oldestDays], [2, 4]);
});

test('with nothing surveyed, nothing is waiting', t => {
  const root = workingRoot(t);
  choose(root, 'api');

  const { waiting, oldestDays } = reviewView(root, now);

  assert.deepEqual({ waiting, oldestDays }, { waiting: 0, oldestDays: null });
});

test('a branch still being worked on or given up on is not waiting to merge, and a dropped project does not count', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  dropProject(root, choose(root, 'gone'), daysAgo(1));
  addItem(root, api, 'doing', { branch: 'hobkin/0' });
  addItem(root, api, 'dropped', { branch: 'hobkin/1' });
  addItem(root, api, 'branch', { branch: 'hobkin/2' });
  surveyOpen(root, { api: [30, 20, 3], gone: [60] });

  const { waiting, oldestDays } = reviewView(root, now);

  assert.deepEqual({ waiting, oldestDays }, { waiting: 1, oldestDays: 3 });
});

test('the review says plainly how much is waiting and how old the oldest is', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  spend(root, api, 1000);
  addItem(root, api, 'done');
  surveyOpen(root, { api: [9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1] });

  const [first] = reviewMessage(reviewView(root, now)).split('\n');

  assert.match(first, /^Weekly review: work mode is progressing\. .* tokens\. 12 waiting to merge, the oldest 9 days old\.$/);
});

test('one piece of work waiting is spoken of as one, and new work is not called zero days old', () => {
  const week = { verdict: 'progressing', runs: 1, finished: 1, merged: 0, tokens: 1000, projects: [], stale: [] };
  const last = details => reviewMessage({ ...week, ...details }).split('\n')[0].split('tokens. ')[1];

  assert.equal(last({ waiting: 1, oldestDays: 3 }), '1 waiting to merge, 3 days old.');
  assert.equal(last({ waiting: 1, oldestDays: 1 }), '1 waiting to merge, 1 day old.');
  assert.equal(last({ waiting: 2, oldestDays: 0 }), '2 waiting to merge, the oldest less than a day old.');
});

test('with nothing waiting the first line says nothing about it', t => {
  const root = workingRoot(t);
  choose(root, 'api');

  assert.doesNotMatch(reviewMessage(reviewView(root, now)), /waiting to merge/);
});

test('only chosen projects get a row, the highest priority first and then by name', t => {
  const root = workingRoot(t);
  const levels = [['zeta', 'critical'], ['beta', 'important'], ['alpha', 'important'], ['omega', 'casual'], ['vital', 'max']];
  for (const [name, level] of levels) choose(root, name, { level });
  dropProject(root, choose(root, 'gone'), daysAgo(1));
  skipProject(root, choose(root, 'later'), daysAgo(1));
  proposeProject(root, { name: 'Maybe', path: '/repos/maybe', level: 'critical' }, daysAgo(30));

  const { projects, stale } = reviewView(root, now);

  assert.deepEqual(projects.map(({ slug }) => slug), ['vital', 'zeta', 'alpha', 'beta', 'omega']);
  assert.deepEqual(stale, ['vital', 'zeta', 'alpha', 'beta', 'omega']);
});

test('a project\'s own priority outranks what its level would give it', t => {
  const root = workingRoot(t);
  setProjectPriority(root, choose(root, 'zeta', { level: 'casual' }), 'P0');
  setProjectPriority(root, choose(root, 'alpha', { level: 'critical' }), 'P3');
  choose(root, 'beta');

  const { projects } = reviewView(root, now);

  assert.deepEqual(projects.map(({ slug, priority }) => [slug, priority]), [['zeta', 'P0'], ['beta', 'P1'], ['alpha', 'P3']]);
});

test('tokens spent with nothing finished make a project stale, and the row says how much', t => {
  const root = workingRoot(t);
  const busy = choose(root, 'busy');
  for (const tokens of [100000, 200000, 300000, 400000, 500000, 600000]) spend(root, busy, tokens);
  addItem(root, busy, 'open');
  spend(root, choose(root, 'once'), 400000);

  const view = reviewView(root, now);

  assert.deepEqual(staleness(rowOf(view, busy)), { stale: true, why: 'Spent 2.1m tokens on 6 runs and finished nothing.' });
  assert.equal(rowOf(view, 'once').why, 'Spent 400k tokens on 1 run and finished nothing.');
  assert.deepEqual(view.stale, ['busy', 'once']);
});

test('a project where nothing ran is stale, and the row says what is sitting there', t => {
  const root = workingRoot(t);
  const backlog = choose(root, 'backlog');
  for (let count = 0; count < 4; count += 1) addItem(root, backlog, 'open');
  addItem(root, choose(root, 'single'), 'doing');
  choose(root, 'empty');

  const view = reviewView(root, now);

  assert.deepEqual(staleness(rowOf(view, backlog)), { stale: true, why: '4 items open and nothing ran.' });
  assert.equal(rowOf(view, 'single').why, '1 item open and nothing ran.');
  assert.equal(rowOf(view, 'empty').why, 'Nothing ran and nothing is open.');
});

test('finishing anything in the week keeps a project from being stale, and so does a merge', t => {
  const root = workingRoot(t);
  for (const state of ['branch', 'pr', 'merged', 'done']) addItem(root, choose(root, state), state);
  spend(root, choose(root, 'merger'), 5000);
  surveyMerges(root, { merger: daysAgo(3) });

  const { projects, stale } = reviewView(root, now);

  assert.deepEqual(stale, []);
  for (const row of projects) assert.deepEqual(staleness(row), { stale: false, why: null }, row.slug);
});

test('what finished or merged before the week keeps nothing from being stale', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  addItem(root, api, 'done', { at: daysAgo(8) });
  addItem(root, api, 'merged', { at: daysAgo(8) });
  surveyMerges(root, { api: daysAgo(8) });

  const view = reviewView(root, now);

  assert.deepEqual([rowOf(view, api).finished, rowOf(view, api).merged], [0, false]);
  assert.deepEqual(view.stale, [api]);
});

test('a project chosen this week is too new to judge', t => {
  const root = workingRoot(t);
  choose(root, 'fresh', { at: daysAgo(3) });
  choose(root, 'edge', { at: daysAgo(7) });
  choose(root, 'old', { at: daysAgo(7) - 1 });

  const view = reviewView(root, now);

  assert.deepEqual(view.stale, ['old']);
  assert.deepEqual(staleness(rowOf(view, 'fresh')), { stale: false, why: null });
  assert.deepEqual(staleness(rowOf(view, 'edge')), { stale: false, why: null });
});

test('a paused project is not stale, because nothing was meant to run there', t => {
  const root = workingRoot(t);
  const paused = choose(root, 'paused');
  const resumed = choose(root, 'resumed');
  setProjectPaused(root, paused, true);
  setProjectPaused(root, resumed, true);
  setProjectPaused(root, resumed, false);

  const view = reviewView(root, now);

  assert.deepEqual(staleness(rowOf(view, paused)), { stale: false, why: null });
  assert.deepEqual(view.stale, [resumed]);
});

test('the first line says how work mode is doing, with the real numbers', () => {
  const week = { verdict: 'progressing', runs: 41, finished: 18, merged: 3, tokens: 62000000, projects: [], stale: [] };

  const [first] = reviewMessage(week).split('\n');

  assert.equal(first, 'Weekly review: work mode is progressing. 41 runs, 18 items finished, 3 projects merged something, 62m tokens.');
});

test('each other verdict says what is wrong, with the same numbers', () => {
  const week = { runs: 1, finished: 0, merged: 1, tokens: 4100000, projects: [], stale: [] };
  const first = verdict => reviewMessage({ ...week, verdict }).split('\n')[0];

  assert.match(first('off'), /work mode is off/);
  assert.match(first('idle'), /nothing ran/);
  assert.match(first('stalled'), /nothing finished/);
  for (const verdict of ['off', 'idle', 'stalled']) assert.match(first(verdict), /\. 1 run, 0 items finished, 1 project merged something, 4\.1m tokens\.$/);
});

test('with nothing stale the message says so in one line, and names no command', t => {
  const root = workingRoot(t);
  const api = choose(root, 'api');
  spend(root, api, 1000);
  addItem(root, api, 'done');

  const lines = reviewMessage(reviewView(root, now)).split('\n').filter(Boolean);

  assert.equal(lines.length, 3, 'with the scoreboard last');
  assert.match(lines[1], /stale/i);
  assert.doesNotMatch(lines[1], /hobkin work/);
});

test('each stale project comes with why and the exact command, and the line after says what dropping keeps', t => {
  const root = workingRoot(t);
  const name = { name: 'Old Site', path: '/repos/old-site', level: 'critical' };
  proposeProject(root, name, daysAgo(40));
  chooseProject(root, 'old-site', undefined, daysAgo(30));
  for (const tokens of [1000000, 1100000]) spend(root, 'old-site', tokens);
  addItem(root, choose(root, 'backlog'), 'open');
  addItem(root, choose(root, 'healthy'), 'done');

  const lines = reviewMessage(reviewView(root, now)).split('\n').filter(Boolean);

  assert.equal(lines.length, 5, 'with the scoreboard last');
  assert.match(lines[0], /^Weekly review: /);
  for (const fact of ['Old Site', 'Spent 2.1m tokens on 2 runs and finished nothing.', '`hobkin work drop old-site`']) assert.ok(lines[1].includes(fact), fact);
  for (const fact of ['backlog', '1 item open and nothing ran.', '`hobkin work drop backlog`']) assert.ok(lines[2].includes(fact), fact);
  assert.match(lines[3], /each of these is worth dropping/i);
  assert.match(lines[3], /branches and PRs/);
});

test('one stale project is not spoken of as several', t => {
  const root = workingRoot(t);
  choose(root, 'api');

  const lines = reviewMessage(reviewView(root, now)).split('\n').filter(Boolean);

  assert.match(lines[2], /^This one is worth dropping/);
  assert.match(lines[2], /branches and PRs/);
});

test('a review reports and changes nothing, even with a project worth dropping', t => {
  const root = workingRoot(t);
  spend(root, choose(root, 'api'), 1000);
  surveyMerges(root, { other: daysAgo(30) });
  const before = filesUnder(root);

  const view = reviewView(root, now);
  reviewMessage(view);

  assert.deepEqual(view.stale, ['api']);
  assert.deepEqual(filesUnder(root), before);
});
