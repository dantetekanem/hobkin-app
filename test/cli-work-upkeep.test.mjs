import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents, recordEvent } from '../src/cli/events.mjs';
import { startsNewWork } from '../src/cli/work/plan.mjs';
import { chooseProject, dropProject, readItems, readMode, updateItem } from '../src/cli/work/store.mjs';
import { lookAfterHarness, repeatedFailures, upkeepDue } from '../src/cli/work/upkeep.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-02T12:00:00Z');
const iso = time => new Date(time).toISOString();
const hoursAgo = hours => iso(NOW - hours * HOUR);

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-upkeep-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const checkout = join(base, 'hobkin');
  for (const folder of [root, checkout]) mkdirSync(folder);
  return { base, root, checkout, pass: (options = {}) => lookAfterHarness(root, { now: NOW, checkout, ...options }) };
}

const choose = (root, path, at = NOW - 30 * DAY) => chooseProject(root, path, 'important', at).slug;
const shown = (from, count, facts = {}) => Array.from({ length: count }, (_, index) => ({ at: hoursAgo(index + 1), type: 'error_shown', from, ...facts }));
const failedRuns = (count, facts = {}) => Array.from({ length: count }, (_, index) => ({ at: hoursAgo(index + 1), type: 'run_finished', id: `run-${index}`, status: 'failed', ...facts }));
const namesOf = events => repeatedFailures(events).map(({ name }) => name);
const fixesOn = (root, slug) => readItems(root, slug).filter(({ key }) => key.startsWith('harness:'));

test('errors on screen group by where they came from, and a class takes three in the day', () => {
  const failures = repeatedFailures([...shown('Send', 3), ...shown('Work mode', 2), ...shown('main', 4)]);

  assert.deepEqual(failures.map(({ name, count }) => [name, count]), [['error:send', 3], ['error:main', 4]]);
});

test('failed runs group by what failed: a lane across projects, a routine, the main turn and compaction', () => {
  const failures = repeatedFailures([
    ...failedRuns(2, { lane: 'do', routine: 'work.site.do', project: 'site' }),
    ...failedRuns(1, { lane: 'do', routine: 'work.api.do', project: 'api' }),
    ...failedRuns(3, { routine: 'digest' }),
    ...failedRuns(3, { kind: 'reflection' }),
    ...Array.from({ length: 3 }, () => ({ at: hoursAgo(1), type: 'turn_finished', status: 'failed' })),
    ...Array.from({ length: 3 }, () => ({ at: hoursAgo(1), type: 'compaction_finished', status: 'failed' })),
  ]);

  assert.deepEqual(failures.map(({ name, count }) => [name, count]), [['run:do', 3], ['run:digest', 3], ['run:reflection', 3], ['run:main', 3], ['compaction', 3]]);
});

test('what ended any other way is no failure, and neither is a provider saying stop', () => {
  const ended = status => failedRuns(3, { routine: 'digest', status });
  const turns = status => Array.from({ length: 3 }, () => ({ at: hoursAgo(1), type: 'turn_finished', status }));

  assert.deepEqual(namesOf([...ended('completed'), ...ended('interrupted'), ...ended('incomplete'), ...turns('completed'), ...turns('incomplete')]), []);
  assert.deepEqual(namesOf(failedRuns(5, { routine: 'digest', limited: true })), []);
});

test('a class that repeats files one fix on the project that is hobkin, with what to look at and how to prove it', t => {
  const { root, checkout, pass } = workspace(t);
  const slug = choose(root, checkout);
  choose(root, join(root, 'elsewhere'));

  const { filed } = pass({ events: [...failedRuns(2, { lane: 'do', project: 'site', item: 'abc123' }), ...failedRuns(1, { lane: 'do', project: 'api' })] });

  assert.equal(filed.length, 1);
  const [fix] = readItems(root, slug);
  assert.equal(fix.key, 'harness:run:do');
  assert.equal(fix.kind, 'fix');
  assert.equal(fix.state, 'open');
  assert.match(fix.brief, /3 times/);
  assert.match(fix.brief, /harness:run:do/);
  assert.match(fix.brief, /run_finished run-0 at .*site.*abc123/);
  assert.match(fix.brief, /runtime\/events/);
  assert.match(fix.brief, /test that fails now/);
});

test('a brief names the newest events and says how many more there are', t => {
  const { root, checkout, pass } = workspace(t);
  const slug = choose(root, checkout);

  pass({ events: shown('Send', 12) });

  const [{ brief }] = readItems(root, slug);
  assert.match(brief, new RegExp(hoursAgo(1)));
  assert.doesNotMatch(brief, new RegExp(hoursAgo(12)));
  assert.match(brief, /and 4 more/);
});

test('a repeat files nothing, whatever became of the first fix', t => {
  const { root, checkout, pass } = workspace(t);
  const slug = choose(root, checkout);
  const events = shown('Send', 3);

  pass({ events });
  const { filed } = pass({ events, now: NOW + DAY });
  assert.deepEqual(filed, []);

  updateItem(root, slug, fixesOn(root, slug)[0].id, { state: 'declined' }, NOW);
  assert.deepEqual(pass({ events, now: NOW + 2 * DAY }).filed, []);
  assert.equal(fixesOn(root, slug).length, 1);
});

test('filing starts nothing and takes no shortcut: the item waits behind the pile like new work', t => {
  const { root, checkout, pass } = workspace(t);
  const slug = choose(root, checkout);

  pass({ events: shown('Send', 3) });

  const [fix] = readItems(root, slug);
  assert.equal(fix.urgent, false);
  assert.equal(startsNewWork({ item: fix }), true);
  assert.deepEqual(readMode(root).queueNext, []);
});

test('what was filed goes on the record, so the scoreboard can count it', t => {
  const { root, checkout, pass } = workspace(t);
  const slug = choose(root, checkout);

  pass({ events: shown('Send', 3) });

  const [recorded] = readEvents(root).filter(({ type }) => type === 'harness_filed');
  assert.equal(recorded.name, 'error:send');
  assert.equal(recorded.count, 3);
  assert.equal(recorded.project, slug);
  assert.equal(recorded.item, fixesOn(root, slug)[0].id);
});

test('with hobkin not chosen, Chat gets one quiet line for each class, once, and nothing is filed', t => {
  const { root, checkout, pass } = workspace(t);
  const other = choose(root, join(root, 'elsewhere'));
  const dropped = choose(root, checkout);
  dropProject(root, dropped, NOW - DAY);

  const first = pass({ events: [...shown('Send', 3), ...shown('main', 3)] });
  assert.deepEqual(first.filed, []);
  assert.deepEqual(first.told.map(({ key }) => key), ['harness:error:send', 'harness:error:main']);
  const { harnessLines } = readMode(root);
  assert.equal(harnessLines.length, 2);
  assert.match(harnessLines[0].line, /^hobkin's own harness/);
  assert.match(harnessLines[0].line, /3 times/);
  assert.match(harnessLines[0].line, /not a chosen project/);
  assert.equal(harnessLines[0].at, iso(NOW));

  const next = pass({ events: [...shown('Send', 5), ...shown('Kill', 3)], now: NOW + DAY });
  assert.deepEqual(next.told.map(({ key }) => key), ['harness:error:kill']);
  assert.deepEqual(readMode(root).harnessLines.map(({ key }) => key), ['harness:error:kill']);

  assert.deepEqual(readItems(root, other), []);
  assert.deepEqual(readItems(root, dropped), []);
});

test('a class Chat heard about is still filed once hobkin is chosen', t => {
  const { root, checkout, pass } = workspace(t);
  const events = shown('Send', 3);
  pass({ events });

  const slug = choose(root, checkout);
  pass({ events, now: NOW + DAY });

  assert.deepEqual(fixesOn(root, slug).map(({ key }) => key), ['harness:error:send']);
  assert.deepEqual(readMode(root).harnessLines, []);
});

test('a quiet day says nothing and files nothing', t => {
  const { root, checkout, pass } = workspace(t);
  const slug = choose(root, checkout);

  assert.deepEqual(pass({ events: shown('Send', 2) }), { filed: [], told: [] });
  assert.deepEqual(readItems(root, slug), []);
});

test('hobkin is found through a link to its folder, and a project with no path or a lost one is no match', t => {
  const { base, root, checkout, pass } = workspace(t);
  const link = join(base, 'link');
  symlinkSync(checkout, link);
  chooseProject(root, join(base, 'gone'), 'important', NOW - DAY);
  const slug = choose(root, link);

  pass({ events: shown('Send', 3) });

  assert.equal(fixesOn(root, slug).length, 1);
});

test('with no checkout named, the folder hobkin runs from is the one compared', t => {
  const { root, pass } = workspace(t);
  const slug = choose(root, realpathSync(fileURLToPath(new URL('..', import.meta.url))));

  pass({ events: shown('Send', 3), checkout: undefined });

  assert.equal(fixesOn(root, slug).length, 1);
});

test('with no events named, the pass reads the last day from disk and no further', t => {
  const { root, checkout, pass } = workspace(t);
  const slug = choose(root, checkout);
  for (const at of [NOW - DAY - 1, NOW - DAY + 1, NOW - HOUR, NOW]) recordEvent(root, 'error_shown', { from: 'Send' }, at);

  pass();

  assert.match(fixesOn(root, slug)[0].brief, /3 times/);
});

test('the pass is due on a first look, then once a day', () => {
  assert.equal(upkeepDue({}, NOW), true);
  assert.equal(upkeepDue({ upkeepAt: iso(NOW - DAY + 1) }, NOW), false);
  assert.equal(upkeepDue({ upkeepAt: iso(NOW - DAY) }, NOW), true);
});
