import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetFor, estimateRun, costHistory, firstGuess } from '../src/cli/work/budget.mjs';
import { workStatus } from '../src/cli/work/commands.mjs';
import { countsAgainst, ideasWanted, itemGrade, planWork } from '../src/cli/work/plan.mjs';
import { itemsView, queueView, searchView } from '../src/cli/work/reads.mjs';
import {
  chooseProject, fileItem, lenses, nextLookAt, paths, pickNext, pickNow, proposeProject, readMode, readProject, setAgents, recordDiscovery, recordTokens, setProjectPaused, setProjectPriority, skipInQueue, updateItem, writeMode, writeState,
} from '../src/cli/work/store.mjs';
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
  writeState(root, slug, { lastLensAt: new Date(now).toISOString(), lastIdeasAt: new Date(now).toISOString(), lastSignalsAt: new Date(now).toISOString(), lastMachinesAt: new Date(now).toISOString() });
}

const plan = (root, options = {}) => planWork(root, { now, ...options });
const titles = entries => entries.map(entry => entry.title);
const ranRecently = (root, ...slugs) => slugs.forEach(slug => recordTokens(root, { slug, lane: 'do', tokens: 1 }, now - HOUR));

/** A branch the last survey found, with the finished item that makes it wait on a merge. */
function finishedBranch(root, slug, index) {
  const branch = `hobkin/${index}`;
  const { id } = fileItem(root, slug, item(`finished on ${branch}`), now);
  updateItem(root, slug, id, { state: 'branch', branch }, now);
  return { kind: 'branch', branch, openedAt: new Date(now).toISOString() };
}

/** What the last survey found waiting to merge, as a count for each project. */
const waitingToMerge = (root, counts) => writeJson(join(root, 'work', 'unmerged.json'), {
  at: new Date(now).toISOString(),
  projects: Object.fromEntries(Object.entries(counts).map(([slug, count]) => [slug, {
    open: Array.from({ length: count }, (_unit, index) => finishedBranch(root, slug, index)),
    lastMergeAt: null,
    trees: 0,
  }])),
});
const gradeOf = (root, title) => plan(root).entries.find(entry => entry.title === title).grade;

test('an item starts from its project\'s priority and moves down with its impact, and nothing goes below P3', () => {
  const important = { level: 'important' };

  assert.deepEqual(['high', 'medium', 'low'].map(impact => itemGrade(important, { kind: 'fix', impact })), ['P1', 'P2', 'P3']);
  assert.equal(itemGrade({ level: 'casual' }, { kind: 'fix', impact: 'low' }), 'P3');
  assert.equal(itemGrade({ level: 'casual', priority: 'P0' }, { kind: 'fix', impact: 'medium' }), 'P1', 'a priority set by hand beats the level');
  assert.equal(itemGrade({ level: 'casual' }, { kind: 'fix', impact: 'medium', max: true }), 'P1', 'max starts from the top');
  assert.equal(itemGrade(important, { kind: 'chore' }), 'P3', 'an older item takes its impact from its kind');
});

test('urgent work and attention rows are P0, and the user\'s own grade beats both', () => {
  const casual = { level: 'casual' };

  assert.equal(itemGrade(casual, { kind: 'fix', impact: 'low', urgent: true }), 'P0');
  assert.equal(itemGrade(casual, { kind: 'attention' }), 'P0');
  assert.equal(itemGrade(casual, { kind: 'attention', urgent: true, grade: 'P3' }), 'P3');
  assert.equal(itemGrade(casual, { kind: 'fix', impact: 'high', grade: null }), 'P2', 'a cleared grade goes back to working it out');
});

test('a look runs at its project\'s own priority whatever its lens, so the pace holds, and ideas sit two below', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  const lens = lensIndex => {
    writeState(root, 'api', { lastLensAt: null, lensIndex });
    const [{ focus, grade }] = plan(root).entries;
    return [focus, grade];
  };

  assert.deepEqual(lenses.map((_focus, index) => lens(index)), lenses.map(focus => [focus, 'P0']));

  writeState(root, 'api', { lastLensAt: new Date(now).toISOString(), lastIdeasAt: null });
  assert.deepEqual(plan(root).entries.map(({ kind, grade }) => [kind, grade]), [['ideas', 'P2']]);
});

test('a due P0 look goes ahead of lower work, even a chores look behind a P1 fix', t => {
  const root = dataRoot(t);
  project(root, 'first', 'important');
  setProjectPriority(root, 'first', 'P0');
  project(root, 'other', 'important');
  fileItem(root, 'other', item('Fix login', { impact: 'high', effort: 'small' }), now);
  writeState(root, 'first', { lastLensAt: new Date(now - 2 * HOUR).toISOString(), lensIndex: lenses.indexOf('chores') });

  const [top, next] = plan(root).entries;

  assert.deepEqual([top.slug, top.focus], ['first', 'chores']);
  assert.equal(next.title, 'Fix login');
});

test('a first look for projects is P0, and the daily one comes after everything else', t => {
  const root = dataRoot(t);
  writeMode(root, { folder: '/repos' });
  assert.deepEqual(plan(root).entries.map(({ kind, grade }) => [kind, grade]), [['discover', 'P0']]);

  project(root, 'site', 'casual');
  ranRecently(root, 'site');
  fileItem(root, 'site', item('tidy', { impact: 'low' }), now);
  writeMode(root, { lastDiscoveryAt: new Date(now - 25 * HOUR).toISOString() });

  assert.deepEqual(plan(root).entries.map(({ kind, grade }) => [kind, grade]), [['item', 'P3'], ['discover', 'P3']]);
});

test('a finished look ends the search of that folder, and a look that did not finish keeps coming round', t => {
  const root = dataRoot(t);
  writeMode(root, { folder: '/repos', lastDiscoveryAt: new Date(now - 25 * HOUR).toISOString() });
  const kinds = () => plan(root).entries.map(({ kind }) => kind);

  for (const status of ['failed', 'unfinished', 'cancelled', 'interrupted']) {
    recordDiscovery(root, { status, folder: '/repos', startedAt: new Date(now - 25 * HOUR).toISOString() });
    assert.deepEqual(kinds(), ['discover'], status);
  }

  recordDiscovery(root, { status: 'finished', folder: '/repos', startedAt: new Date(now - 25 * HOUR).toISOString() });
  assert.deepEqual(kinds(), []);
  assert.deepEqual(plan(root, { now: now + 30 * 24 * HOUR }).entries.filter(({ kind }) => kind === 'discover'), [], 'not the next day, and not a month on');
  assert.equal(workStatus(root).nextDiscoveryAt, null, 'nothing says a look is coming');

  writeMode(root, { folder: '/elsewhere' });
  assert.deepEqual(kinds(), ['discover'], 'another folder has its own look');
});

test('a trigger still looks at a folder that is done, because that is the user\'s own word', t => {
  const root = dataRoot(t);
  writeMode(root, { folder: '/repos', lastDiscoveryAt: new Date(now - 25 * HOUR).toISOString() });
  recordDiscovery(root, { status: 'finished', folder: '/repos', startedAt: new Date(now - 25 * HOUR).toISOString() });

  pickNext(root, 'discover');

  assert.equal(plan(root).next.kind, 'discover');
});

test('grade decides before how much the project matters', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'site', 'casual');
  ranRecently(root, 'billing', 'site');
  fileItem(root, 'billing', item('billing chore', { impact: 'low' }), now);
  fileItem(root, 'site', item('site fix', { impact: 'high' }), now);
  setProjectPriority(root, 'billing', 'P2');

  assert.deepEqual(plan(root).entries.map(({ title, grade }) => [title, grade]), [['site fix', 'P2'], ['billing chore', 'P3']]);
});

test('each failed try moves an item down a grade, stopping at P3, and the user\'s own grade does not move', () => {
  const important = { level: 'important' };

  assert.equal(itemGrade(important, { kind: 'fix', impact: 'high', attempts: 1 }), 'P2');
  assert.equal(itemGrade(important, { kind: 'fix', impact: 'high', attempts: 9 }), 'P3');
  assert.equal(itemGrade(important, { kind: 'attention', attempts: 1 }), 'P1');
  assert.equal(itemGrade(important, { kind: 'fix', urgent: true, attempts: 2 }), 'P2');
  assert.equal(itemGrade(important, { kind: 'fix', impact: 'high', attempts: 9, grade: 'P0' }), 'P0');
});

test('an item that keeps failing cannot hold the front of the queue, so a healthy row on another project goes first', t => {
  const root = dataRoot(t);
  project(root, 'failing');
  project(root, 'healthy', 'casual');
  ranRecently(root, 'failing', 'healthy');
  const failing = fileItem(root, 'failing', item('always fails', { impact: 'high' }), now);
  updateItem(root, 'failing', failing.id, { attempts: 2 }, now);
  fileItem(root, 'healthy', item('healthy fix', { impact: 'high' }), now);

  assert.deepEqual(plan(root).entries.map(({ title, grade }) => [title, grade]), [['healthy fix', 'P2'], ['always fails', 'P3']]);
});

test('a P0 item that failed leaves the P0 band: a project of its priority left alone goes ahead of it, and it no longer skips the hourly share', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'site', 'critical');
  const failing = fileItem(root, 'billing', item('main is broken', { urgent: true, effort: 'small' }), now);
  updateItem(root, 'billing', failing.id, { attempts: 1 }, now - HOUR);
  fileItem(root, 'site', item('tidy', { impact: 'low', effort: 'small' }), now);
  writeMode(root, { dailyTokens: 10000000 });
  recordTokens(root, { slug: 'billing', lane: 'do', tokens: 900000 }, now - HOUR / 2);

  const { entries } = plan(root);

  assert.deepEqual(entries.map(({ title, grade }) => [title, grade]), [['tidy', 'P2'], ['main is broken', 'P1']]);
  assert.equal(entries[1].waiting, 'over this hour\'s share');
});

test('at P3 a failing item comes round behind the others, says so, and nothing holds it', t => {
  const root = dataRoot(t);
  project(root, 'api', 'casual');
  ranRecently(root, 'api');
  const failing = fileItem(root, 'api', item('tried', { impact: 'high', effort: 'small' }), now);
  updateItem(root, 'api', failing.id, { attempts: 3 }, now - 2 * HOUR);
  fileItem(root, 'api', item('fresh', { impact: 'low', effort: 'large' }), now);

  const { entries } = plan(root);

  assert.deepEqual(titles(entries), ['fresh', 'tried']);
  assert.match(entries[1].why, /tried 3 times/);
  assert.equal(entries[1].waiting, null);

  updateItem(root, 'api', failing.id, { attempts: 1 }, now);
  assert.match(plan(root).entries.find(entry => entry.title === 'tried').why, /tried 1 time$/);
});

test('within a grade and a number of tries the project\'s priority comes first, then worth', t => {
  const root = dataRoot(t);
  project(root, 'tool', 'important');
  project(root, 'billing', 'critical');
  ranRecently(root, 'tool', 'billing');
  fileItem(root, 'tool', item('small win', { impact: 'high', effort: 'small' }), now);
  fileItem(root, 'billing', item('big rewrite', { impact: 'medium', effort: 'large' }), now);
  fileItem(root, 'billing', item('quick tweak', { impact: 'medium', effort: 'small' }), now);

  assert.deepEqual(titles(plan(root).entries), ['quick tweak', 'big rewrite', 'small win']);
});

test('work runs by its project\'s priority, so a P0 project\'s chore goes ahead of a P1 project\'s fix, and a P3 project left alone waits its turn', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'tool', 'important');
  project(root, 'toy', 'casual');
  setProjectPriority(root, 'toy', 'P3');
  ranRecently(root, 'billing', 'tool');
  fileItem(root, 'tool', item('tool fix', { impact: 'high' }), now);
  fileItem(root, 'billing', item('billing chore', { impact: 'low' }), now);
  fileItem(root, 'toy', item('toy chore', { impact: 'low' }), now);

  assert.deepEqual(plan(root).entries.map(({ title, grade }) => [title, grade]), [['billing chore', 'P2'], ['tool fix', 'P1'], ['toy chore', 'P3']]);
});

test('the queue runs the user\'s picks, then P0, then each project priority in turn with a project left alone first within it, then what was skipped', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'tool', 'important');
  project(root, 'site', 'casual');
  ranRecently(root, 'billing', 'tool');
  fileItem(root, 'tool', item('routine', { impact: 'high' }), now);
  const picked = fileItem(root, 'tool', item('picked', { impact: 'low' }), now);
  const skipped = fileItem(root, 'tool', item('skipped', { impact: 'high' }), now);
  fileItem(root, 'billing', item('first', { impact: 'high' }), now);
  fileItem(root, 'site', item('alone', { impact: 'low', effort: 'small' }), now);
  fileItem(root, 'site', item('alone too', { impact: 'low', effort: 'large' }), now);
  pickNext(root, `item:tool:${picked.id}`);
  skipInQueue(root, `item:tool:${skipped.id}`);

  assert.deepEqual(titles(plan(root).entries), ['picked', 'first', 'routine', 'alone', 'alone too', 'skipped']);
});

test('a project with no run for a day, or none ever, puts its top row up among its own priority, and that row says why', t => {
  const root = dataRoot(t);
  project(root, 'busy', 'casual');
  project(root, 'quiet', 'casual');
  project(root, 'new', 'casual');
  ranRecently(root, 'busy');
  recordTokens(root, { slug: 'quiet', lane: 'do', tokens: 1 }, now - 25 * HOUR);
  fileItem(root, 'busy', item('busy fix', { impact: 'high' }), now);
  fileItem(root, 'quiet', item('quiet chore', { impact: 'low' }), now);
  fileItem(root, 'new', item('new chore', { impact: 'low' }), now);

  const { entries } = plan(root);

  assert.deepEqual(titles(entries), ['quiet chore', 'new chore', 'busy fix']);
  assert.match(entries[0].why, /^left alone, low impact/);
  assert.match(entries[1].why, /^left alone/);
  assert.doesNotMatch(entries[2].why, /left alone/);
});

test('within a priority and grade projects take turns, the one that ran longest ago first, so one project\'s rows cannot fill the front', t => {
  const root = dataRoot(t);
  for (const slug of ['busy', 'quiet', 'middle']) project(root, slug);
  recordTokens(root, { slug: 'busy', lane: 'do', tokens: 1 }, now - HOUR);
  recordTokens(root, { slug: 'middle', lane: 'do', tokens: 1 }, now - 2 * HOUR);
  recordTokens(root, { slug: 'quiet', lane: 'do', tokens: 1 }, now - 3 * HOUR);
  fileItem(root, 'busy', item('busy one', { impact: 'high', effort: 'small' }), now);
  fileItem(root, 'busy', item('busy two', { impact: 'high', effort: 'small' }), now);
  fileItem(root, 'quiet', item('quiet one', { impact: 'high', effort: 'large' }), now);
  fileItem(root, 'quiet', item('quiet two', { impact: 'high', effort: 'large' }), now);
  fileItem(root, 'middle', item('middle one', { impact: 'high', effort: 'medium' }), now);

  assert.deepEqual(titles(plan(root).entries), ['quiet one', 'middle one', 'busy one', 'quiet two', 'busy two']);
  assert.deepEqual(titles(plan(root, { running: [{ slug: 'quiet', lane: 'look' }] }).entries), ['middle one', 'busy one', 'quiet one', 'busy two', 'quiet two']);
});

test('a run going now means a project is not left alone', t => {
  const root = dataRoot(t);
  project(root, 'site', 'casual');
  fileItem(root, 'site', item('tidy', { impact: 'low', effort: 'large' }), now);

  assert.match(plan(root).entries[0].why, /^left alone/);
  assert.doesNotMatch(plan(root, { running: [{ slug: 'site', lane: 'look' }] }).entries[0].why, /left alone/);
});

test('a P0 row needs no lift, and a project whose top row is picked gets none', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'tool', 'important');
  fileItem(root, 'billing', item('first', { impact: 'high' }), now);
  fileItem(root, 'billing', item('second', { impact: 'low' }), now);
  const picked = fileItem(root, 'tool', item('picked', { impact: 'high' }), now);
  fileItem(root, 'tool', item('next', { impact: 'medium' }), now);
  pickNext(root, `item:tool:${picked.id}`);

  const { entries } = plan(root);

  assert.deepEqual(titles(entries), ['picked', 'first', 'second', 'next']);
  assert.ok(entries.every(entry => !entry.why.startsWith('left alone')));
});

test('a paused project stays where it is, and a skipped row hands its place to the next one', t => {
  const root = dataRoot(t);
  project(root, 'busy', 'casual');
  project(root, 'paused', 'casual');
  project(root, 'skipping', 'casual');
  ranRecently(root, 'busy');
  fileItem(root, 'busy', item('busy fix', { impact: 'high' }), now);
  fileItem(root, 'paused', item('paused chore', { impact: 'low' }), now);
  const skipped = fileItem(root, 'skipping', item('not this', { impact: 'high' }), now);
  fileItem(root, 'skipping', item('this one', { impact: 'low' }), now);
  setProjectPaused(root, 'paused', true);
  skipInQueue(root, `item:skipping:${skipped.id}`);

  assert.deepEqual(titles(plan(root).entries), ['this one', 'busy fix', 'paused chore', 'not this']);
});

test('a project left alone puts up the row that can start, and not one waiting behind its started item', t => {
  const root = dataRoot(t);
  project(root, 'busy', 'casual');
  project(root, 'site', 'casual');
  ranRecently(root, 'busy');
  fileItem(root, 'busy', item('busy fix', { impact: 'high' }), now);
  const started = fileItem(root, 'site', item('started', { impact: 'low' }), now);
  updateItem(root, 'site', started.id, { state: 'doing', branch: 'hobkin/started' }, now);
  fileItem(root, 'site', item('waits for it', { impact: 'high' }), now);

  const { entries } = plan(root);

  assert.deepEqual(titles(entries), ['started', 'busy fix', 'waits for it']);
  assert.equal(entries[2].waiting, 'after its started item');
});

test('what was left for the user runs like any other row, at the front', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'site', 'casual');
  ranRecently(root, 'billing', 'site');
  fileItem(root, 'billing', item('routine', { impact: 'medium' }), now);
  fileItem(root, 'site', { key: 'token', kind: 'attention', title: 'Rotate the token', brief }, now);

  const { entries, next } = plan(root);

  assert.deepEqual(entries.map(({ title, grade }) => [title, grade]), [['Rotate the token', 'P0'], ['routine', 'P1']]);
  assert.equal(next.title, 'Rotate the token');
  assert.ok(Number.isFinite(next.score));
});

test('an item an older version left stuck runs again', t => {
  const root = dataRoot(t);
  project(root, 'api');
  const old = fileItem(root, 'api', item('old'), now);
  updateItem(root, 'api', old.id, { state: 'stuck', stuckReason: 'It ended twice.' }, now);

  assert.equal(plan(root).next.title, 'old');
});

test('a study that has failed holds nothing back: the items run, and it comes round again at the project\'s own grade', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/api', 'casual', now);
  fileItem(root, 'api', item('main is broken', { urgent: true }), now);
  assert.equal(plan(root).entries.find(entry => entry.kind === 'item').waiting, 'needs its study');

  writeState(root, 'api', { lastLookAt: new Date(now - HOUR / 8).toISOString() });
  assert.equal(plan(root).next.title, 'main is broken');

  writeState(root, 'api', { lastLookAt: new Date(now - HOUR).toISOString() });
  const { entries } = plan(root);
  assert.deepEqual(entries.map(({ kind, grade, waiting }) => [kind, grade, waiting]), [['item', 'P0', null], ['study', 'P2', null]]);
});

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

test('urgent work is P0, and within P0 the project that matters most goes first', t => {
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

test('a first study takes the best grade of what it unlocks, so a project with a real fix waiting is studied first', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/quiet', 'important', now);
  chooseProject(root, '/repos/broken', 'casual', now);
  fileItem(root, 'broken', item('main is broken', { urgent: true, impact: 'high', effort: 'small' }), now);

  const { entries } = plan(root);

  assert.deepEqual(entries.filter(entry => entry.kind === 'study').map(({ slug, grade }) => [slug, grade]), [['broken', 'P0'], ['quiet', 'P1']]);
  const waiting = entries.find(entry => entry.kind === 'item');
  assert.equal(waiting.waiting, 'needs its study');
});

test('a study never sits below its own project, whatever it unlocks', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/api', 'important', now);
  fileItem(root, 'api', item('tidy', { impact: 'low' }), now);

  assert.equal(plan(root).entries.find(entry => entry.kind === 'study').grade, 'P1');
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

const dueSlugs = root => plan(root).entries.map(entry => entry.slug);
const lastLookedAt = (root, slug, hoursAgo) => writeState(root, slug, { lastLensAt: new Date(now - hoursAgo * HOUR).toISOString() });

test('priority decides how often a project is looked at: P0 every hour, P1 every day, P2 every 3 days and P3 every week', t => {
  const root = dataRoot(t);
  const hoursBetweenLooks = { P0: 1, P1: 24, P2: 72, P3: 168 };

  for (const [priority, hours] of Object.entries(hoursBetweenLooks)) {
    const slug = `at-${priority.toLowerCase()}`;
    project(root, slug);
    setProjectPriority(root, slug, priority);

    lastLookedAt(root, slug, hours - 1);
    assert.ok(!dueSlugs(root).includes(slug), `${priority} is not due after ${hours - 1} hours`);

    lastLookedAt(root, slug, hours);
    assert.ok(dueSlugs(root).includes(slug), `${priority} is due after ${hours} hours`);
    lastLookedAt(root, slug, 0);
  }
});

test('a project\'s level sets how hard it thinks, and its priority alone sets how often it runs', t => {
  const root = dataRoot(t);
  project(root, 'critical-but-low', 'critical');
  setProjectPriority(root, 'critical-but-low', 'P3');
  project(root, 'casual-but-urgent', 'casual');
  setProjectPriority(root, 'casual-but-urgent', 'P0');
  lastLookedAt(root, 'critical-but-low', 9);
  lastLookedAt(root, 'casual-but-urgent', 9);

  assert.deepEqual(dueSlugs(root), ['casual-but-urgent']);
});

test('with no priority set, a project takes its pace from its level', t => {
  const root = dataRoot(t);
  project(root, 'critical', 'critical');
  project(root, 'important', 'important');
  project(root, 'casual', 'casual');
  for (const slug of ['critical', 'important', 'casual']) lastLookedAt(root, slug, 2);

  assert.deepEqual(dueSlugs(root), ['critical']);
});

test('a max project still waits 12 hours between looks, because each is the dearest run there is', t => {
  const root = dataRoot(t);
  project(root, 'dear', 'max');

  lastLookedAt(root, 'dear', 9);
  assert.deepEqual(dueSlugs(root), []);

  lastLookedAt(root, 'dear', 12);
  assert.deepEqual(dueSlugs(root), ['dear']);
});

test('every project gets a state-machines look once a week, whatever its priority, and it comes before its next lens', t => {
  const root = dataRoot(t);
  project(root, 'app', 'casual');
  // Never looked at for its state machines: due now, on the first night.
  writeState(root, 'app', { lastMachinesAt: null, lastLensAt: null });
  assert.deepEqual(plan(root).entries.map(entry => [entry.key, entry.kind, entry.focus, entry.title]), [['machines:app', 'machines', 'state-machines', 'state machines look']]);

  // Done six days ago: the week is not up, so the lens that is due goes.
  writeState(root, 'app', { lastMachinesAt: new Date(now - 6 * 24 * HOUR).toISOString() });
  assert.deepEqual(plan(root).entries.map(entry => entry.kind), ['look']);
  writeState(root, 'app', { lastMachinesAt: new Date(now - 7 * 24 * HOUR).toISOString() });
  assert.deepEqual(plan(root).entries.map(entry => entry.kind), ['machines']);
});

test('new ideas come every eighth look, so they follow the priority too', t => {
  const root = dataRoot(t);
  project(root, 'first', 'important');
  setProjectPriority(root, 'first', 'P0');
  project(root, 'last', 'important');
  setProjectPriority(root, 'last', 'P3');
  for (const slug of ['first', 'last']) {
    writeState(root, slug, { lastLensAt: new Date(now).toISOString(), lastIdeasAt: new Date(now - 24 * HOUR).toISOString() });
  }

  assert.deepEqual(plan(root).entries.map(entry => [entry.slug, entry.kind]), [['first', 'ideas']]);

  writeState(root, 'last', { lastIdeasAt: new Date(now - 8 * 168 * HOUR).toISOString() });
  assert.deepEqual(dueSlugs(root).toSorted(), ['first', 'last']);
});

test('the next look a project shows follows its priority', t => {
  const root = dataRoot(t);
  project(root, 'api');
  setProjectPriority(root, 'api', 'P3');

  assert.equal(nextLookAt(root, readProject(root, 'api')), new Date(now + 168 * HOUR).toISOString());
});

test('the longer a look is overdue, the higher it ranks', t => {
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

test('with 5 waiting to merge, features and improvements move down one grade and say why, and with 4 nothing moves', t => {
  const root = dataRoot(t);
  project(root, 'api');
  ranRecently(root, 'api');
  fileItem(root, 'api', item('feature', { kind: 'feature', impact: 'high' }), now);
  fileItem(root, 'api', item('improvement', { kind: 'improvement', impact: 'high' }), now);

  waitingToMerge(root, { api: 4 });
  assert.deepEqual(['feature', 'improvement'].map(title => gradeOf(root, title)), ['P1', 'P1']);
  assert.ok(plan(root).entries.every(entry => !entry.why.includes('shipping first')));

  waitingToMerge(root, { api: 5 });
  assert.deepEqual(['feature', 'improvement'].map(title => gradeOf(root, title)), ['P2', 'P2']);
  assert.ok(plan(root).entries.every(entry => /^shipping first, /.test(entry.why)));
});

test('shipping first moves nothing else: ship items, security, fixes and the rest keep their grade, and so does another project', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'quiet');
  ranRecently(root, 'api', 'quiet');
  const kinds = ['pr-fix', 'security', 'fix', 'update', 'chore', 'attention'];
  for (const kind of kinds) fileItem(root, 'api', item(kind, { kind }), now);
  fileItem(root, 'quiet', item('quiet feature', { kind: 'feature', impact: 'high' }), now);
  const graded = () => [...kinds, 'quiet feature'].map(title => gradeOf(root, title));
  const before = graded();

  waitingToMerge(root, { api: 50 });

  assert.deepEqual(graded(), before);
  assert.ok(plan(root).entries.every(entry => !entry.why.includes('shipping first')));
});

test('what was marked by hand stays where it was marked, with the project shipping first', t => {
  const root = dataRoot(t);
  project(root, 'api');
  ranRecently(root, 'api');
  const graded = fileItem(root, 'api', item('graded', { kind: 'feature' }), now);
  updateItem(root, 'api', graded.id, { grade: 'P1' }, now);
  fileItem(root, 'api', item('urgent', { kind: 'feature', urgent: true }), now);
  const max = fileItem(root, 'api', item('max', { kind: 'feature', impact: 'medium' }), now);
  updateItem(root, 'api', max.id, { max: true }, now);
  waitingToMerge(root, { api: 5 });

  assert.deepEqual(['graded', 'urgent', 'max'].map(title => gradeOf(root, title)), ['P1', 'P0', 'P1']);
  assert.ok(plan(root).entries.every(entry => !entry.why.includes('shipping first')));
});

test('a feature already at P3 has no lower to go, and still starts', t => {
  const root = dataRoot(t);
  project(root, 'site', 'casual');
  fileItem(root, 'site', item('feature', { kind: 'feature', impact: 'low' }), now);
  waitingToMerge(root, { site: 5 });

  assert.equal(gradeOf(root, 'feature'), 'P3');
  assert.equal(plan(root).next.title, 'feature');
});

test('under the bar a project with plenty to merge still starts its top row', t => {
  const root = dataRoot(t);
  project(root, 'api');
  ranRecently(root, 'api');
  fileItem(root, 'api', item('feature', { kind: 'feature', impact: 'high', effort: 'small' }), now);
  writeState(root, 'api', { lastLensAt: null });
  waitingToMerge(root, { api: 7 });

  const { entries, next, pause, waitingOn } = plan(root);

  assert.equal(next.title, 'security look');
  assert.equal(pause, null);
  assert.equal(waitingOn, null);
  assert.deepEqual(entries.map(entry => [entry.title, entry.waiting]), [['security look', null], ['feature', null]]);
});

test('a ship item goes ahead of the same grade of anything else, and new work behind it on a project shipping first', t => {
  const root = dataRoot(t);
  project(root, 'api');
  ranRecently(root, 'api');
  fileItem(root, 'api', item('feature', { kind: 'feature', impact: 'high', effort: 'small' }), now);
  fileItem(root, 'api', item('fix', { kind: 'fix', impact: 'high', effort: 'medium' }), now);
  fileItem(root, 'api', item('Rebase hobkin/abc onto main', { kind: 'pr-fix', impact: 'high', effort: 'small' }), now);
  waitingToMerge(root, { api: 5 });

  assert.deepEqual(titles(plan(root).entries), ['Rebase hobkin/abc onto main', 'fix', 'feature']);
});

test('work that finishes what is already done goes ahead of new work at any priority, and only P0 goes before it', t => {
  const root = dataRoot(t);
  project(root, 'tool');
  project(root, 'site', 'casual');
  project(root, 'toy', 'casual');
  setProjectPriority(root, 'toy', 'P3');
  ranRecently(root, 'tool', 'site', 'toy');
  fileItem(root, 'tool', item('new work at P1', { impact: 'high' }), now);
  fileItem(root, 'tool', item('main is broken', { urgent: true }), now);
  fileItem(root, 'site', item('Describe hobkin/abc at P2', { kind: 'pr-fix', impact: 'high', effort: 'small' }), now);
  const sentBack = fileItem(root, 'toy', item('a note sent back at P3', { impact: 'low' }), now);
  updateItem(root, 'toy', sentBack.id, { workNote: 'Keep the old flag.' }, now);

  assert.deepEqual(titles(plan(root).entries), ['main is broken', 'Describe hobkin/abc at P2', 'a note sent back at P3', 'new work at P1']);
});

test('with auto-pick off, work that finishes what is already done still starts by itself, and new work waits for a pick', t => {
  const root = dataRoot(t);
  project(root, 'site', 'casual');
  fileItem(root, 'site', item('new work', { impact: 'high' }), now);
  writeMode(root, { autoPick: false });
  assert.equal(plan(root).next, null);

  fileItem(root, 'site', item('Rebase hobkin/abc onto main', { kind: 'pr-fix' }), now);

  assert.equal(plan(root).next.title, 'Rebase hobkin/abc onto main');
});

test('the ideas row does not appear with 5 waiting to merge, and 4 still lets it', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  writeState(root, 'api', { lastIdeasAt: null });

  waitingToMerge(root, { api: 4 });
  assert.deepEqual(plan(root).entries.map(entry => entry.kind), ['ideas']);

  waitingToMerge(root, { api: 5 });
  assert.deepEqual(plan(root).entries, []);
});

test('work waiting to merge counts toward how many ideas a project wants, with its open items', t => {
  const root = dataRoot(t);
  project(root, 'api');
  const wanted = () => ideasWanted(root, 'api', { used: 0, limit: 100 });

  assert.equal(wanted(), 3);
  waitingToMerge(root, { api: 2 });
  assert.equal(wanted(), 1);
  fileItem(root, 'api', item('one'), now);
  fileItem(root, 'api', item('two'), now);
  assert.equal(wanted(), 1);
  fileItem(root, 'api', item('three'), now);
  assert.equal(wanted(), 0);
});

test('hobkin work items and search show the grade the queue uses', t => {
  const root = dataRoot(t);
  project(root, 'api');
  ranRecently(root, 'api');
  fileItem(root, 'api', item('feature', { kind: 'feature', impact: 'high' }), now);
  waitingToMerge(root, { api: 5 });

  const [row] = itemsView(root);

  assert.equal(queueView(root).find(entry => entry.item).grade, 'P2');
  assert.equal(row.grade, 'P2');
  assert.equal(itemsView(root, 'api')[0].grade, 'P2');
  assert.equal(searchView(root, 'feature').find(({ type }) => type === 'item').grade, 'P2');
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

// A row only waits on one that can itself start. Anything else would wait for ever.

const notStudied = (root, title = 'fix') => {
  chooseProject(root, '/repos/api', 'casual', now);
  return fileItem(root, 'api', item(title, { impact: 'high', effort: 'small' }), now);
};
const startedAhead = root => {
  project(root, 'api', 'critical');
  const started = fileItem(root, 'api', item('started', { impact: 'high', effort: 'small' }), now);
  updateItem(root, 'api', started.id, { state: 'doing', branch: 'hobkin/started' }, now);
  return { started, behind: fileItem(root, 'api', item('behind', { impact: 'low', effort: 'large' }), now) };
};

test('a picked item does not wait for its study, with auto-pick off, where nothing else would start that study', t => {
  const root = dataRoot(t);
  const filed = notStudied(root);
  writeMode(root, { autoPick: false });
  assert.equal(plan(root).next, null);

  pickNext(root, `item:api:${filed.id}`);

  const { next, entries } = plan(root);
  assert.equal(next.title, 'fix');
  assert.equal(entries.find(entry => entry.kind === 'item').waiting, null);
});

test('a picked item does not wait for its study with auto-pick on either', t => {
  const root = dataRoot(t);
  pickNext(root, `item:api:${notStudied(root).id}`);

  assert.equal(plan(root).next.title, 'fix');
});

test('a skipped study holds nothing, so the item behind it is next', t => {
  const root = dataRoot(t);
  notStudied(root);
  assert.equal(plan(root).next.kind, 'study');

  skipInQueue(root, 'study:api');

  const { next, entries } = plan(root);
  assert.equal(next.title, 'fix');
  assert.deepEqual(entries.map(({ kind, waiting }) => [kind, waiting]), [['item', null], ['study', 'skipped']]);
});

test('with auto-pick off a study nobody picked says nothing about the items, and a picked study still goes first', t => {
  const root = dataRoot(t);
  notStudied(root, 'other');
  writeMode(root, { autoPick: false });
  assert.equal(plan(root).entries.find(entry => entry.kind === 'item').waiting, null);

  pickNext(root, 'study:api');

  const { next, entries } = plan(root);
  assert.equal(next.kind, 'study');
  assert.equal(entries.find(entry => entry.kind === 'item').waiting, 'needs its study');
});

test('a skipped started item holds nothing, so the row behind it is next', t => {
  const root = dataRoot(t);
  const { started } = startedAhead(root);

  skipInQueue(root, `item:api:${started.id}`);

  const { next, entries } = plan(root);
  assert.equal(next.title, 'behind');
  assert.equal(entries.find(entry => entry.title === 'behind').waiting, null);
});

test('with auto-pick off a started item nobody picked holds nothing, so the pick behind it is next', t => {
  const root = dataRoot(t);
  const { behind } = startedAhead(root);
  writeMode(root, { autoPick: false });
  pickNext(root, `item:api:${behind.id}`);

  const { next, entries } = plan(root);

  assert.equal(next.title, 'behind');
  assert.equal(entries.find(entry => entry.title === 'behind').waiting, null);
});

test('with auto-pick off a started item that was picked still goes first, and what is behind it waits', t => {
  const root = dataRoot(t);
  const { started, behind } = startedAhead(root);
  writeMode(root, { autoPick: false });
  pickNext(root, `item:api:${behind.id}`);
  pickNext(root, `item:api:${started.id}`);

  const { next, entries } = plan(root);

  assert.equal(next.title, 'started');
  assert.equal(entries.find(entry => entry.title === 'behind').waiting, 'after its started item');
});

test('a project left alone puts up the row behind a skipped started item, because that row can go', t => {
  const root = dataRoot(t);
  project(root, 'busy', 'casual');
  project(root, 'site', 'casual');
  ranRecently(root, 'busy');
  fileItem(root, 'busy', item('busy fix', { impact: 'high' }), now);
  const started = fileItem(root, 'site', item('started', { impact: 'low' }), now);
  updateItem(root, 'site', started.id, { state: 'doing', branch: 'hobkin/started' }, now);
  fileItem(root, 'site', item('behind', { impact: 'low', effort: 'large' }), now);
  skipInQueue(root, `item:site:${started.id}`);

  const { entries } = plan(root);

  assert.deepEqual(titles(entries), ['behind', 'busy fix', 'started']);
  assert.match(entries[0].why, /^left alone/);
});

test('a max row waits for nothing else, and is next', t => {
  const root = dataRoot(t);
  project(root, 'api', 'max');
  fileItem(root, 'api', item('fix'), now);

  const { next, entries } = plan(root);

  assert.equal(next.title, 'fix');
  assert.equal(entries[0].waiting, null);
});

test('a max project with no study yet can start', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/api', 'max', now);

  assert.equal(plan(root).next.kind, 'study');
});

test('max keeps its limits', t => {
  const root = dataRoot(t);
  project(root, 'api', 'max');
  fileItem(root, 'api', item('fix'), now);

  const running = [{ slug: 'other', lane: 'do', level: 'max' }];
  assert.equal(plan(root, { running }).entries[0].waiting, 'one max run at a time');

  for (let run = 0; run < 6; run++) recordTokens(root, { slug: 'other', lane: 'do', level: 'max', tokens: 1000 }, now - HOUR);
  const { next, entries } = plan(root);
  assert.equal(entries[0].waiting, '6 max runs a day');
  assert.equal(next, null);
});

test('a look on a project holds no item or step back', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  fileItem(root, 'api', item('small', { impact: 'high', effort: 'small' }), now);
  fileItem(root, 'api', item('medium', { impact: 'high', effort: 'medium' }), now);
  const running = [{ slug: 'api', lane: 'look' }];

  const { entries, next } = plan(root, { running });

  assert.deepEqual(entries.map(entry => entry.waiting), [null, null]);
  assert.equal(next.title, 'small');

  proposeProject(root, { name: 'novel', path: '/repos/novel', level: 'critical', kind: 'goal' });
  chooseProject(root, 'novel');
  mkdirSync(paths(root, 'novel').directory, { recursive: true });
  writeFileSync(paths(root, 'novel').project, '# What it is\n');
  writeState(root, 'novel', { lastLensAt: new Date(now).toISOString(), lastIdeasAt: new Date(now).toISOString() });
  fileItem(root, 'novel', item('step', { impact: 'high', effort: 'small' }), now);
  const goal = plan(root, { running: [{ slug: 'novel', lane: 'look' }] }).entries.find(entry => entry.title === 'step');
  assert.equal(goal.waiting, null);
});

test('a project runs as many items or steps at once as there are free workers', t => {
  const root = dataRoot(t);
  setAgents(root, 4);
  project(root, 'api', 'critical');
  for (const name of ['one', 'two', 'three', 'four']) fileItem(root, 'api', item(name, { impact: 'high', effort: 'medium' }), now);
  const running = [{ slug: 'api', lane: 'do', item: 'zzzzz1', branch: 'hobkin/zzzzz1-x', ships: 'zzzzz1' }, { slug: 'api', lane: 'do', item: 'zzzzz2', branch: 'hobkin/zzzzz2-x', ships: 'zzzzz2' }];

  const { entries, next, free } = plan(root, { running });

  assert.equal(free, 2);
  assert.deepEqual(entries.map(entry => entry.waiting), [null, null, null, null]);
  assert.ok(next, 'a third item starts beside the two');

  const full = plan(root, { running: [...running, { slug: 'api', lane: 'do', item: 'zzzzz3' }, { slug: 'api', lane: 'do', item: 'zzzzz4' }] });
  assert.equal(full.next, null, 'four workers are the only ceiling');

  proposeProject(root, { name: 'novel', path: '/repos/novel', level: 'critical', kind: 'goal' });
  chooseProject(root, 'novel');
  mkdirSync(paths(root, 'novel').directory, { recursive: true });
  writeFileSync(paths(root, 'novel').project, '# What it is\n');
  writeState(root, 'novel', { lastLensAt: new Date(now).toISOString(), lastIdeasAt: new Date(now).toISOString() });
  fileItem(root, 'novel', item('step', { impact: 'high', effort: 'medium' }), now);
  const goal = plan(root, { running: [{ slug: 'novel', lane: 'do', item: 'zzzzz9' }] }).entries.find(entry => entry.title === 'step');
  assert.equal(goal.waiting, null, 'a goal\'s steps go as wide as its agents too');
});

test('a Start now pick on an item starts at once while another item of its project runs and a worker is free', t => {
  const root = dataRoot(t);
  setAgents(root, 4);
  project(root, 'api', 'critical');
  fileItem(root, 'api', item('one', { impact: 'high', effort: 'medium' }), now);
  const picked = fileItem(root, 'api', item('two', { impact: 'low', effort: 'medium' }), now);
  pickNow(root, `item:api:${picked.id}`);

  const { next } = plan(root, { running: [{ slug: 'api', lane: 'do', item: 'zzzzz1', branch: 'hobkin/zzzzz1-x', ships: 'zzzzz1' }] });

  assert.equal(next.title, 'two');
});

test('an item on a branch another run holds waits for it, whoever else is running', t => {
  const root = dataRoot(t);
  project(root, 'api', 'critical');
  const fix = fileItem(root, 'api', item('Rebase hobkin/abc onto main', { kind: 'pr-fix', impact: 'high', effort: 'small' }), now);
  updateItem(root, 'api', fix.id, { branch: 'hobkin/abc', ships: 'parent' }, now);

  const sameBranch = plan(root, { running: [{ slug: 'api', lane: 'do', item: 'parent', branch: 'hobkin/abc', ships: 'parent' }] });
  assert.equal(sameBranch.entries[0].waiting, 'another item is on this branch');

  const sameDescription = plan(root, { running: [{ slug: 'api', lane: 'do', item: 'parent', branch: 'hobkin/other', ships: 'parent' }] });
  assert.equal(sameDescription.entries[0].waiting, 'another item is on this branch');
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
  assert.match(plan(root, { checks: 2 }).waitingOn, /Scheduled checks/);
});

test('a hundred agents can run at once: the 100th is admitted and the 101st waits for a free worker', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);
  setAgents(root, 100, now - HOUR);
  writeMode(root, { dailyTokens: 10000000000 });
  const running = n => Array.from({ length: n }, (_run, index) => ({ slug: `other-${index}`, lane: 'look' }));

  const hundredth = plan(root, { running: running(99), lastStartAt: now - 30000 });
  assert.equal(hundredth.agents, 100);
  assert.equal(hundredth.next.title, 'fix');
  const full = plan(root, { running: running(100), lastStartAt: now - 30000 });
  assert.equal(full.free, 0);
  assert.equal(full.next, null);
});

test('with a free worker and room in the budget the second start comes 30 seconds after the first, not five minutes', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'site');
  fileItem(root, 'api', item('fix'), now);
  const running = [{ slug: 'site', lane: 'look' }];

  const { next, nextStartAt } = plan(root, { running, lastStartAt: now - 10000 });

  assert.equal(next, null);
  assert.equal(Date.parse(nextStartAt), now - 10000 + 30000);
  assert.equal(plan(root, { running, lastStartAt: now - 30000 }).next.title, 'fix');
});

test('a home that saved the old five-minute wait waits 30 seconds too, and a row over the hour\'s share still waits and says so', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'site');
  fileItem(root, 'api', item('fix'), now);
  const running = [{ slug: 'site', lane: 'look' }];
  // Every write of the mode carried the default whole, so a home from before has it saved.
  writeMode(root, { startGapMs: 300000 });

  assert.equal(readMode(root).startGapMs, 30000);
  assert.equal(plan(root, { running, lastStartAt: now - 30000 }).next.title, 'fix');

  writeMode(root, { dailyTokens: 100000000 });
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 8400000 }, now - HOUR / 2);
  const held = plan(root, { running, lastStartAt: now - 30000 });
  assert.equal(held.next, null);
  assert.equal(held.entries[0].waiting, 'over this hour\'s share');
});

test('room the user adds is filled right away: the gap between starts does not hold what the new workers take', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'site');
  fileItem(root, 'api', item('fix'), now);
  const running = [{ slug: 'site', lane: 'look' }];
  assert.equal(plan(root, { running, lastStartAt: now - 10000 }).next, null, 'a start ten seconds ago holds the next one');

  // The user raises the number of agents: they made room because they want more running now.
  setAgents(root, 4, now);
  assert.deepEqual(readMode(root).roomAdded, { count: 2, at: new Date(now).toISOString() });
  const filled = plan(root, { running, lastStartAt: now - 10000 });
  assert.equal(filled.next.title, 'fix');
  assert.equal(filled.nextStartAt, null);

  // Once the added room is taken, starts are spaced again. Room nobody took within ten minutes is no longer waiting to be filled.
  writeMode(root, { roomAdded: { count: 0, at: new Date(now).toISOString() } });
  assert.equal(plan(root, { running, lastStartAt: now - 10000 }).next, null);
  writeMode(root, { roomAdded: { count: 2, at: new Date(now - 11 * 60000).toISOString() } });
  assert.equal(plan(root, { running, lastStartAt: now - 10000 }).next, null);
  // Taking room away asks for nothing to start.
  setAgents(root, 2, now);
  assert.equal(readMode(root).roomAdded, null);
});

test('with nothing running a free worker does not sit out the gap, because no cost is left to wait for', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);

  assert.equal(plan(root, { lastStartAt: now - 10000 }).next, null, 'it still takes a breath, so a run that dies at once cannot spin');
  assert.ok(plan(root, { lastStartAt: now - 30000 }).next);
});

test('while a run is going the whole gap holds however long the queue, and a pick waits it out too', t => {
  const root = dataRoot(t);
  project(root, 'api');
  project(root, 'site');
  const filed = Array.from({ length: 60 }, (_row, index) => fileItem(root, 'api', { ...item(`fix ${index}`), key: `fix:${index}` }, now));
  const running = [{ slug: 'site', lane: 'look' }];

  assert.equal(plan(root, { running, lastStartAt: now - 20000 }).next, null, 'sixty rows do not shorten it');
  pickNext(root, `item:api:${filed[59].id}`);
  assert.equal(plan(root, { running, lastStartAt: now - 20000 }).next, null, 'nor does a pick');
  assert.equal(plan(root, { running, lastStartAt: now - 30000 }).next.title, 'fix 59', 'and once it is over the pick goes first');
});

test('a row that keeps failing waits its own turn longer, and everything else goes past it', t => {
  const root = dataRoot(t);
  project(root, 'api');
  const failing = fileItem(root, 'api', { ...item('failing'), key: 'failing' }, now);
  updateItem(root, 'api', failing.id, { attempts: 2, lastError: 'It broke.' }, now - 60000);

  const alone = plan(root);
  assert.match(alone.entries[0].waiting, /^tries again at /);
  assert.equal(alone.next, null);

  fileItem(root, 'api', { ...item('healthy'), key: 'healthy' }, now);
  assert.equal(plan(root).next.title, 'healthy');

  assert.equal(planWork(root, { now: now + 21 * 60000 }).entries.find(entry => entry.title === 'failing').waiting, null, 'it always comes round');
  pickNext(root, `item:api:${failing.id}`);
  assert.equal(plan(root).next.title, 'failing', 'and a pick is the user\'s own word');
});

// P1 and P2 fill available slots; P3 retains its rolling weekly start limit.

/** Runs that started by themselves and spent their priority's runs, each so many hours ago. */
const startedBefore = (root, ...starts) => writeMode(root, {
  countedStarts: starts.map(([priority, hoursAgo]) => ({ at: new Date(now - hoursAgo * HOUR).toISOString(), priority })),
});
const waits = root => Object.fromEntries(plan(root).entries.map(({ title, waiting }) => [title, waiting]));

test('P1 and P2 histories leave eligible work ready in priority order', t => {
  const root = dataRoot(t);
  project(root, 'tool');
  project(root, 'web');
  project(root, 'site', 'casual');
  ranRecently(root, 'tool', 'web', 'site');
  fileItem(root, 'tool', item('tool fix', { impact: 'high' }), now);
  fileItem(root, 'web', item('web fix', { impact: 'high' }), now);
  fileItem(root, 'site', item('site fix', { impact: 'high' }), now);

  startedBefore(root, ['P1', 1], ['P1', 2], ['P1', 23]);
  assert.equal(plan(root).next.title, 'tool fix', 'priority order holds with existing starts');

  startedBefore(root, ['P1', 1], ['P1', 2], ['P1', 5], ['P1', 23], ['P2', 1]);
  assert.equal(plan(root).next.title, 'tool fix');
  assert.deepEqual(waits(root), {
    'tool fix': null,
    'web fix': null,
    'site fix': null,
  });
});

test('P3 waits for its rolling week while P1 and P2 remain eligible', t => {
  const root = dataRoot(t);
  project(root, 'tool');
  project(root, 'site', 'casual');
  project(root, 'toy', 'casual');
  setProjectPriority(root, 'toy', 'P3');
  ranRecently(root, 'tool', 'site', 'toy');
  fileItem(root, 'tool', item('tool fix', { impact: 'high' }), now);
  fileItem(root, 'site', item('site fix', { impact: 'high' }), now);
  fileItem(root, 'toy', item('toy fix', { impact: 'high' }), now);

  startedBefore(root, ['P1', 1], ['P1', 2], ['P1', 3], ['P1', 23.9], ['P2', 23.9], ['P3', 167.9]);
  assert.deepEqual(waits(root), {
    'tool fix': null,
    'site fix': null,
    'toy fix': 'P3 has had its run this week',
  });

  startedBefore(root, ['P1', 1], ['P1', 2], ['P1', 3], ['P1', 24], ['P2', 24], ['P3', 168]);
  assert.deepEqual(waits(root), { 'tool fix': null, 'site fix': null, 'toy fix': null });
});

test('discovery spends the runs of its own grade, so the daily look at P3 waits out P3\'s week, and one carrying on where it stopped spends none', t => {
  const root = dataRoot(t);
  project(root, 'site', 'casual');
  writeMode(root, { folder: '/repos', lastDiscoveryAt: new Date(now - 25 * HOUR).toISOString() });
  startedBefore(root, ['P3', 24]);

  assert.deepEqual(waits(root), { 'find projects': 'P3 has had its run this week' });
  for (const status of ['continuing', 'interrupted']) {
    recordDiscovery(root, { status, folder: '/repos', startedAt: new Date(now - HOUR).toISOString() });
    assert.deepEqual(waits(root), { 'find projects': null }, status);
  }
});

test('picks, closing work and P0 keep their order with P1 history and auto-pick choices', t => {
  const root = dataRoot(t);
  project(root, 'tool');
  project(root, 'web');
  project(root, 'billing', 'critical');
  ranRecently(root, 'tool', 'web', 'billing');
  const picked = fileItem(root, 'tool', item('picked', { impact: 'low' }), now);
  fileItem(root, 'tool', item('new work', { impact: 'high' }), now);
  fileItem(root, 'tool', item('main is broken', { urgent: true }), now);
  fileItem(root, 'tool', { key: 'token', kind: 'attention', title: 'Rotate the token', brief }, now);
  fileItem(root, 'tool', item('Rebase hobkin/abc onto main', { kind: 'pr-fix' }), now);
  const noted = fileItem(root, 'tool', item('noted', { impact: 'low' }), now);
  updateItem(root, 'tool', noted.id, { workNote: 'Close whatever stops this merging.' }, now);
  const started = fileItem(root, 'web', item('started', { impact: 'low' }), now);
  updateItem(root, 'web', started.id, { state: 'doing', branch: 'hobkin/started' }, now);
  fileItem(root, 'billing', item('billing fix', { impact: 'high' }), now);
  pickNext(root, `item:tool:${picked.id}`);
  startedBefore(root, ['P1', 1], ['P1', 2], ['P1', 3], ['P1', 4]);

  assert.deepEqual(waits(root), {
    picked: null,
    'main is broken': null,
    'Rotate the token': null,
    'Rebase hobkin/abc onto main': null,
    noted: null,
    started: null,
    'billing fix': null,
    'new work': null,
  });
  assert.equal(countsAgainst({ kind: 'watch', focus: 'watch', priority: 'P1' }), null, 'a watch looks after what already landed');

  writeMode(root, { autoPick: false });
  assert.equal(waits(root)['new work'], null);
});

test('an eligible first study keeps its order before the item after four P1 starts', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/api', 'important', now);
  fileItem(root, 'api', item('main is broken', { urgent: true }), now);
  startedBefore(root, ['P1', 1], ['P1', 2], ['P1', 3], ['P1', 4]);

  const { next, entries } = plan(root);

  assert.equal(next.title, 'first study');
  assert.deepEqual(entries.map(({ kind, waiting }) => [kind, waiting]), [['study', null], ['item', 'needs its study']]);
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

test('a P0 row skips the hourly share, whatever made it P0, and nothing skips the daily limit', t => {
  const root = dataRoot(t);
  project(root, 'billing', 'critical');
  project(root, 'site', 'casual');
  project(root, 'tool', 'casual');
  fileItem(root, 'billing', item('main is broken', { effort: 'small' }), now);
  fileItem(root, 'site', item('site is broken', { urgent: true, effort: 'small' }), now);
  const graded = fileItem(root, 'tool', item('tool fix', { effort: 'small' }), now);
  writeMode(root, { dailyTokens: 10000000 });
  recordTokens(root, { slug: 'billing', lane: 'do', tokens: 900000 }, now - HOUR / 2);
  const waitOf = title => plan(root).entries.find(entry => entry.title === title).waiting;

  assert.equal(plan(root).next.title, 'main is broken');
  assert.equal(waitOf('site is broken'), null);
  assert.equal(waitOf('tool fix'), 'over this hour\'s share');

  updateItem(root, 'tool', graded.id, { grade: 'P0' }, now);
  assert.equal(waitOf('tool fix'), null);

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

test('a reading ahead of the subscription\'s pace never stops new work by itself, and the plan says how far ahead it is', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);
  writeJson(join(root, 'work', 'subscription.json'), { primary: { usedPercent: 72, windowMinutes: 300, resetAt: now + HOUR } });

  const { next, pause, subscription } = plan(root);

  assert.ok(next, 'work carries on');
  assert.equal(pause, null);
  assert.deepEqual([subscription.ahead.label, subscription.ahead.usedPercent], ['5h', 72]);
  assert.deepEqual(subscription.windows.map(({ label, usedPercent }) => [label, usedPercent]), [['5h', 72]]);
});

test('a pause the user chose to protect the subscription holds new work until its time, and says so', t => {
  const root = dataRoot(t);
  project(root, 'api');
  fileItem(root, 'api', item('fix'), now);
  writeMode(root, { subscriptionPause: { at: new Date(now).toISOString(), until: new Date(now + HOUR).toISOString() } });

  const held = plan(root);
  const after = plan(root, { now: now + HOUR + 1 });

  assert.equal(held.next, null);
  assert.equal(held.pause.kind, 'chosen');
  assert.match(held.pause.line, /^Paused until \d\d:\d\d today to protect the subscription, as you chose\./);
  assert.ok(after.next, 'it ends by itself at its time');
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

test('Work descendant incomplete holds expire only outside both budget windows', { timeout: 10000 }, t => {
  const root = dataRoot(t), mode = { dailyTokens: 1000000 };
  const at = new Date(2026, 5, 1, 23, 50).getTime();
  recordTokens(root, { kind: 'look', tokens: 9, cached: 4, usageIncomplete: true }, at);
  assert.equal(budgetFor(root, mode, at + 20 * 60000).helperHold, true, 'rolling hour crosses midnight');
  assert.equal(budgetFor(root, mode, at + HOUR).helperHold, false, 'both windows expired at the exact hour');
  recordTokens(root, { kind: 'look', tokens: 3, usageIncomplete: true }, now);
  assert.equal(budgetFor(root, mode, now + 2 * HOUR).helperHold, true, 'same local day survives hour expiry');
  assert.equal(budgetFor(root, mode, at + HOUR).helperHold, false);
  assert.deepEqual(costHistory(root), [], 'partial lower bounds cannot train full-run estimates');
  recordTokens(root, { tokens: 7, usageIncomplete: true, incompleteEvents: { child: new Date(now).toISOString() } }, at + HOUR);
  const expired = budgetFor(root, mode, at + HOUR);
  assert.equal(expired.helperHold, false, 'parent settlement must not restart the child window');
  assert.equal(expired.used, 7, 'the lower bound still spends in its settlement day');
  recordTokens(root, { tokens: 0, cleanupUnknown: true, usageIncomplete: true }, now - 3 * 24 * HOUR);
  assert.equal(budgetFor(root, mode, at + HOUR).helperHold, true, 'unknown cleanup never expires with spend windows');
});
