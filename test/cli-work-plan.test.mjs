import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetFor, estimateRun, costHistory, firstGuess } from '../src/cli/work/budget.mjs';
import { ideasWanted, planWork } from '../src/cli/work/plan.mjs';
import { chooseProject, fileItem, paths, recordTokens, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const now = new Date(2026, 5, 1, 12).getTime();
const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (key, details = {}) => ({ key, kind: 'fix', title: key, brief, ...details });

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-plan-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeMode(root, { enabled: true });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: now + 3 * 24 * HOUR } });
  return root;
}

/** A project past its study, with nothing due but what a test files. */
function project(root, slug, level = 'important') {
  chooseProject(root, `/repos/${slug}`, level, now);
  mkdirSync(paths(root, slug).directory, { recursive: true });
  writeFileSync(paths(root, slug).project, '# What it is\n');
  writeState(root, slug, { lastLensAt: new Date(now).toISOString(), lastIdeasAt: new Date(now).toISOString() });
}

const plan = (root, options = {}) => planWork(root, { now, ...options });
const titles = entries => entries.map(entry => entry.title);

test('a quick high-value fix beats a slow low-value one, whatever order they were filed in', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('slow', { impact: 'low', effort: 'large' }), now - HOUR);
  fileItem(root, 'api', item('quick', { impact: 'high', effort: 'small' }), now);

  assert.deepEqual(titles(plan(root).entries), ['quick', 'slow']);
});

test('the same work ranks by how much the project matters', t => {
  const root = dataRoot(t);
  project(root, 'site', 'casual');
  project(root, 'billing', 'critical');
  project(root, 'tool', 'important');
  for (const slug of ['site', 'billing', 'tool']) fileItem(root, slug, item(`fix ${slug}`, { impact: 'medium', effort: 'small' }), now);

  assert.deepEqual(titles(plan(root).entries), ['fix billing', 'fix tool', 'fix site']);
});

test('small work with a visible benefit goes ahead of large work on a more critical project', t => {
  const root = dataRoot(t);
  project(root, 'tool', 'important');
  project(root, 'billing', 'critical');
  fileItem(root, 'billing', item('big rewrite', { impact: 'medium', effort: 'large' }), now);
  fileItem(root, 'tool', item('small win', { impact: 'high', effort: 'small' }), now);

  assert.deepEqual(titles(plan(root).entries), ['small win', 'big rewrite']);
});

test('urgency lifts an item above everything of its size', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'site', 'casual');
  fileItem(root, 'billing', item('routine', { impact: 'high', effort: 'small' }), now);
  fileItem(root, 'site', item('main is broken', { urgent: true, impact: 'high', effort: 'medium' }), now);

  const [first, second] = plan(root).entries;
  assert.deepEqual([first.title, second.title], ['routine', 'main is broken'], 'a casual site does not outrank a critical quick fix');

  fileItem(root, 'billing', item('billing is broken', { urgent: true, impact: 'high', effort: 'medium' }), now);
  assert.equal(plan(root).entries[0].title, 'billing is broken');
});

test('an older item with no impact or effort still gets a place, from its kind', t => {
  const root = dataRoot(t);
  project(root, 'api', 'important');
  fileItem(root, 'api', { key: 'old-feature', kind: 'feature', title: 'old feature', brief }, now);
  fileItem(root, 'api', { key: 'old-security', kind: 'security', title: 'old security', brief }, now);

  const entries = plan(root).entries;

  assert.deepEqual(titles(entries), ['old security', 'old feature']);
  assert.ok(entries.every(entry => Number.isFinite(entry.estimate.fresh)));
});

test('what only the user can do is never planned', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', { key: 'token', kind: 'attention', title: 'Rotate the token', brief }, now);

  assert.deepEqual(plan(root).entries, []);
});

test('a first study takes the rank of what it unlocks, so a project with a real fix waiting is studied first', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/quiet', 'critical', now);
  chooseProject(root, '/repos/broken', 'casual', now);
  fileItem(root, 'broken', item('main is broken', { urgent: true, impact: 'high', effort: 'small' }), now);

  const { entries } = plan(root);

  assert.deepEqual(entries.filter(entry => entry.kind === 'study').map(entry => entry.slug), ['broken', 'quiet']);
  const waiting = entries.find(entry => entry.kind === 'item');
  assert.equal(waiting.waiting, 'needs its study');
});

test('with nothing filed, a study ranks by the level of its project', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/site', 'casual', now);
  chooseProject(root, '/repos/billing', 'critical', now);

  assert.deepEqual(plan(root).entries.map(entry => entry.slug), ['billing', 'site']);
});

test('a study that is not done yet waits before it tries again', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/api', 'critical', now);
  writeState(root, 'api', { lastLookAt: new Date(now - HOUR / 8).toISOString() });
  assert.deepEqual(plan(root).entries, []);

  writeState(root, 'api', { lastLookAt: new Date(now - HOUR).toISOString() });
  assert.deepEqual(plan(root).entries.map(entry => entry.kind), ['study']);
});

test('a look comes up as often as the level says, and the longer overdue, the higher it ranks', t => {
  const root = dataRoot(t);
  project(root, 'late');
  project(root, 'barely');
  writeState(root, 'late', { lastLensAt: new Date(now - 47 * HOUR).toISOString() });
  writeState(root, 'barely', { lastLensAt: new Date(now - 25 * HOUR).toISOString() });

  const { entries } = plan(root);

  assert.deepEqual(entries.map(entry => [entry.slug, entry.focus]), [['late', 'security'], ['barely', 'security']]);
});

test('new commits bring a look forward and up the plan, and start nothing by themselves', t => {
  const root = dataRoot(t);
  project(root, 'moved');
  project(root, 'still');
  writeState(root, 'moved', { lastLensAt: new Date(now - 13 * HOUR).toISOString(), newCommits: 4 });
  writeState(root, 'still', { lastLensAt: new Date(now - 13 * HOUR).toISOString() });

  const { entries } = plan(root);

  assert.deepEqual(entries.map(entry => entry.slug), ['moved'], 'the other is not due yet');
  assert.match(entries[0].why, /new commits/);
});

test('ideas are low in the plan, and fewer when there is work open or the day is half gone', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  writeState(root, 'api', { lastIdeasAt: null });
  fileItem(root, 'api', item('fix', { impact: 'medium', effort: 'medium' }), now);

  assert.deepEqual(plan(root).entries.map(entry => entry.kind), ['item', 'ideas']);
  assert.equal(ideasWanted(root, 'api', { used: 0, limit: 100 }), 3);
  assert.equal(ideasWanted(root, 'api', { used: 60, limit: 100 }), 1);
  for (const key of ['a', 'b', 'c', 'd']) fileItem(root, 'api', item(key), now);
  assert.equal(ideasWanted(root, 'api', { used: 0, limit: 100 }), 0);
});

test('an interrupted item finishes before another starts in that project, because its work is in the tree', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  const started = fileItem(root, 'api', item('started', { impact: 'low', effort: 'medium' }), now);
  updateItem(root, 'api', started.id, { state: 'doing', branch: 'hobkin/started' }, now);
  fileItem(root, 'api', item('quick', { impact: 'high', effort: 'small' }), now);

  const { entries, next } = plan(root);

  assert.equal(next.title, 'started');
  assert.equal(entries.find(entry => entry.title === 'quick').waiting, 'after its started item');
});

test('a run on a project makes small work there wait, and medium work may share it from a worktree', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  fileItem(root, 'api', item('small', { impact: 'high', effort: 'small' }), now);
  fileItem(root, 'api', item('medium', { impact: 'high', effort: 'medium' }), now);
  const running = [{ slug: 'api', lane: 'look' }];

  const { entries, next } = plan(root, { running });

  assert.equal(entries.find(entry => entry.title === 'small').waiting, 'another run here');
  assert.equal(next.title, 'medium');
});

test('a project has one item running at a time', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  fileItem(root, 'api', item('one', { impact: 'high', effort: 'medium' }), now);
  const running = [{ slug: 'api', lane: 'do' }];

  const { entries, next } = plan(root, { running });

  assert.equal(next, null);
  assert.equal(entries[0].waiting, 'one item at a time here');
});

test('the item a running agent holds is not in the plan twice', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  const held = fileItem(root, 'api', item('held'), now);
  updateItem(root, 'api', held.id, { state: 'doing' }, now);

  assert.deepEqual(plan(root, { running: [{ slug: 'api', lane: 'do', item: held.id }] }).entries, []);
});

test('only as many agents run as the mode allows, and scheduled checks take their places', t => {
  const root = dataRoot(t);
  project(root, 'one');
  project(root, 'two');
  fileItem(root, 'one', item('a'), now);
  fileItem(root, 'two', item('b'), now);
  const running = [{ slug: 'three', lane: 'do' }];

  assert.ok(plan(root, { running }).next, 'two agents by default, and one is running');
  assert.equal(plan(root, { running, checks: 1 }).next, null);
  assert.equal(plan(root, { checks: 2 }).next, null);
});

test('nothing starts while Chat is busy, and the plan says so', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);

  const { next, waitingOn } = plan(root, { chatBusy: true });

  assert.equal(next, null);
  assert.match(waitingOn, /Chat/);
});

test('work starts spaced out, and the plan says when the next one can', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);

  const { next, nextStartAt } = plan(root, { lastStartAt: now - 60000 });

  assert.equal(next, null);
  assert.equal(Date.parse(nextStartAt), now - 60000 + 5 * 60000);
  assert.ok(plan(root, { lastStartAt: now - 5 * 60000 }).next);
});

test('with no reading of the subscription, one agent runs at a time, because the token limit alone cannot protect it', t => {
  const root = dataRoot(t);
  rmSync(join(root, 'work', 'subscription.json'));
  project(root, 'one');
  project(root, 'two');
  fileItem(root, 'one', item('a'), now);
  fileItem(root, 'two', item('b'), now);

  const blind = plan(root, { running: [{ slug: 'three', lane: 'do' }] });

  assert.equal(blind.agents, 1);
  assert.equal(blind.next, null);
  assert.equal(blind.subscription.known, false);
});

test('a harness Hobkin cannot measure runs one agent at a time', t => {
  const root = dataRoot(t);
  writeMode(root, { harness: 'claude' });

  assert.equal(plan(root).agents, 1);
});

const dayLimited = (root, used, limit = 1000000) => {
  writeMode(root, { dailyTokens: limit });
  recordTokens(root, { slug: 'api', lane: 'do', tokens: used }, now - 2 * HOUR);
};

test('a run that would not fit what is left of the day waits, and says so', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix', { effort: 'medium' }), now);
  dayLimited(root, 900000);

  const { entries, next } = plan(root);

  assert.equal(next, null);
  assert.equal(entries[0].waiting, 'over today\'s budget');
});

test('a smaller run further down still fits, so the plan does not stall on the top of the list', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  project(root, 'site', 'casual');
  fileItem(root, 'api', item('big', { impact: 'high', effort: 'small' }), now);
  writeState(root, 'site', { lastLensAt: new Date(now - 100 * HOUR).toISOString() });
  dayLimited(root, 700000);

  const { entries, next } = plan(root);

  assert.equal(entries[0].waiting, 'over today\'s budget');
  assert.equal(next.slug, 'site');
});

test('running agents count against what is left, so the plan never promises the same tokens twice', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix', { effort: 'small' }), now);
  writeMode(root, { dailyTokens: 2000000 });
  const running = [{ slug: 'other', lane: 'do', estimate: { fresh: 1500000 }, tokens: 0 }];

  assert.equal(plan(root, { running }).next, null);

  const spent = [{ slug: 'other', lane: 'do', estimate: { fresh: 1500000 }, tokens: 1400000 }];
  assert.equal(budgetFor(root, { ...plan(root).mode, dailyTokens: 2000000 }, now, spent).reserved, 100000);
});

test('tokens a running agent has spent show now, and nothing is counted twice when it ends', t => {
  const root = dataRoot(t);
  writeMode(root, { dailyTokens: 10000000 });
  const mode = plan(root).mode;
  const running = [{ slug: 'api', lane: 'do', estimate: { fresh: 1000 }, tokens: 3000, cached: 90000 }];

  const during = budgetFor(root, mode, now, running);
  assert.deepEqual([during.used, during.cached, during.hourUsed, during.reserved], [3000, 90000, 3000, 0]);

  recordTokens(root, { slug: 'api', lane: 'do', tokens: 3000, cached: 90000 }, now);
  const after = budgetFor(root, mode, now, []);
  assert.deepEqual([after.used, after.cached], [3000, 90000]);
});

test('an hourly pause gives the real numbers and says which limit was hit, and never only the day\'s', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);
  writeMode(root, { dailyTokens: 100000000 });
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 1400000 }, now - 5 * HOUR);
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 8400000 }, now - HOUR / 2);

  const { pause, entries } = plan(root);

  assert.equal(pause.kind, 'hour');
  assert.match(pause.line, /^Paused for the hour: 8\.4m of the 8\.3m hourly share used\./);
  assert.match(pause.line, /Today 9\.8m of 100m\./);
  assert.match(pause.line, /Resumes around 12:30 today\./);
  assert.equal(entries[0].waiting, 'over this hour\'s share');
});

test('tokens only held for running agents make a row wait, and never a pause', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix', { effort: 'small' }), now);
  writeMode(root, { dailyTokens: 12000000 });
  const running = [{ slug: 'other', lane: 'do', estimate: { fresh: 900000 }, tokens: 0 }];

  const { entries, pause } = plan(root, { running });

  assert.equal(entries[0].waiting, 'over this hour\'s share');
  assert.equal(pause, null);
});

test('an hourly pause says when the next run will really fit', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix', { effort: 'small' }), now);
  writeMode(root, { dailyTokens: 12000000 });
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 500000 }, now - HOUR / 2);
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 400000 }, now - HOUR / 4);

  const { pause } = plan(root);

  assert.equal(pause.kind, 'hour');
  assert.match(pause.line, /Resumes around 12:45 today\./);
});

test('a daily pause says so, with the day\'s real numbers', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);
  dayLimited(root, 1000000);

  const { pause } = plan(root);

  assert.equal(pause.kind, 'day');
  assert.equal(pause.line, 'Paused for today: 1m of the 1m daily limit used. Resumes tomorrow.');
});

test('with little of the day left and nothing that fits, that counts as the day being over', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix', { effort: 'medium' }), now);
  dayLimited(root, 950000);

  assert.equal(plan(root).pause.kind, 'day');
});

test('urgent work on a critical project skips the hourly share and never the daily limit', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'site', 'casual');
  fileItem(root, 'billing', item('main is broken', { urgent: true, effort: 'small' }), now);
  fileItem(root, 'site', item('site is broken', { urgent: true, effort: 'small' }), now);
  writeMode(root, { dailyTokens: 10000000 });
  recordTokens(root, { slug: 'billing', lane: 'do', tokens: 900000 }, now - HOUR / 2);

  assert.equal(plan(root).next.title, 'main is broken');
  assert.equal(plan(root).entries.find(entry => entry.slug === 'site').waiting, 'over this hour\'s share');

  recordTokens(root, { slug: 'billing', lane: 'do', tokens: 9100000 }, now - HOUR / 2);
  assert.equal(plan(root).next, null, 'the daily limit holds for everything');
});

test('the first run in an empty hour may be bigger than the share, or a low limit could never start anything', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix', { effort: 'medium' }), now);
  writeMode(root, { dailyTokens: 4000000 });

  assert.ok(plan(root).next);
});

test('a usage limit stops everything until it lifts, whatever else fits', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);
  const until = new Date(now + HOUR).toISOString();
  writeMode(root, { usagePause: { at: new Date(now).toISOString(), until, reason: 'Rate limit reached', strikes: 1 } });

  const { next, pause } = plan(root);
  assert.equal(next, null);
  assert.equal(pause.kind, 'usage');
  assert.match(pause.line, /13:00 today/);

  assert.ok(plan(root, { now: now + HOUR + 1 }).next, 'it can try again once the time has passed');
});

test('a real reading past the reserve stops new work, and says which window and how much', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);
  writeJson(join(root, 'work', 'subscription.json'), { primary: { usedPercent: 72, windowMinutes: 300, resetAt: now + HOUR } });

  const { next, pause, subscription } = plan(root);

  assert.equal(next, null);
  assert.equal(pause.kind, 'reserve');
  assert.match(pause.line, /5h/);
  assert.match(pause.line, /72%/);
  assert.deepEqual(subscription.windows, [{ label: '5h', usedPercent: 72 }]);
});

test('similar runs set the estimate, by kind and level, and a safe guess stands in until there are enough', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  const before = estimateRun(costHistory(root), { kind: 'do', level: 'critical' });
  assert.deepEqual(before, firstGuess.do);

  for (const tokens of [100000, 200000, 300000, 400000]) {
    recordTokens(root, { slug: 'api', lane: 'do', kind: 'do', level: 'critical', tokens, cached: tokens * 10 }, now - HOUR);
  }

  assert.deepEqual(estimateRun(costHistory(root), { kind: 'do', level: 'critical' }), { fresh: 400000, cached: 4000000 });
});

test('runs of the same kind at another level stand in before a level has its own', t => {
  const root = dataRoot(t);
  project(root, 'api', 'casual');
  project(root, 'site', 'critical');
  for (const tokens of [100000, 100000, 100000]) recordTokens(root, { slug: 'api', lane: 'look', kind: 'look', level: 'casual', tokens }, now - HOUR);

  assert.equal(estimateRun(costHistory(root), { kind: 'look', level: 'critical' }).fresh, 100000);
});

test('entries from before this version count by their lane and the project\'s level, and show no cached figure', t => {
  const root = dataRoot(t);
  project(root, 'api', 'important');
  for (const tokens of [50000, 60000, 70000]) recordTokens(root, { slug: 'api', lane: 'look', tokens }, now - HOUR);

  const estimate = estimateRun(costHistory(root), { kind: 'look', level: 'important' });

  assert.equal(estimate.fresh, 70000);
  assert.equal(estimate.cached, firstGuess.look.cached);
  assert.equal(budgetFor(root, plan(root).mode, now, []).cached, 0);
});

test('a guessed run is never history, so a pane nobody could measure cannot teach the plan its own guess', t => {
  const root = dataRoot(t);
  project(root, 'api', 'important');
  for (let index = 0; index < 4; index++) recordTokens(root, { slug: 'api', lane: 'do', kind: 'do', level: 'important', tokens: 5, estimated: true }, now - HOUR);

  assert.deepEqual(estimateRun(costHistory(root), { kind: 'do', level: 'important' }), firstGuess.do);
});

test('first guesses sit above what real sessions cost', () => {
  // The worst of today's real sessions, in fresh tokens, with cached reads beside them.
  const worst = { look: [220228, 1897216], do: [990046, 2479616], discover: [263122, 9158912] };
  for (const [kind, [fresh, cached]] of Object.entries(worst)) {
    assert.ok(firstGuess[kind].fresh > fresh, kind);
    assert.ok(firstGuess[kind].cached > cached, kind);
  }
});
