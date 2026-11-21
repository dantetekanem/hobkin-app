import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spanOf, workMetrics } from '../src/cli/work/metrics.mjs';

// Every time is local, so the days come out the same in any time zone. Today is 21 November 2026, at 15:00.
const now = new Date(2026, 10, 21, 15).getTime();
const HOUR = 3600000;
/** A local time some days before today, at noon unless said. */
const daysAgo = (days, hour = 12) => new Date(2026, 10, 21 - days, hour).toISOString();
const dayName = days => new Date(2026, 10, 21 - days, 12).toLocaleDateString('en-CA');

function home(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-metrics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const append = (path, ...records) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    appendFileSync(join(root, path), records.map(record => `${typeof record === 'string' ? record : JSON.stringify(record)}\n`).join(''));
  };
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  // Events go to the file of their month, as `recordEvent` writes them.
  const event = (type, at, facts = {}) => append(`runtime/events/${at.slice(0, 7)}.jsonl`, { at, type, ...facts });
  append('work/projects.jsonl',
    { slug: 'api', name: 'API', state: 'proposed', level: 'important', at: daysAgo(40) },
    { slug: 'api', name: 'API', state: 'chosen', level: 'important', at: daysAgo(40) },
    { slug: 'web', name: 'Web', state: 'chosen', level: 'casual', at: daysAgo(40) },
    { slug: 'docs', name: 'Docs', state: 'proposed', level: 'casual', at: daysAgo(40) });
  return { root, append, write, event };
}

const filed = (id, at) => ({ id, key: `fix:${id}`, kind: 'fix', title: `Fix ${id}`, brief: 'A fix.', urgent: false, state: 'open', attempts: 0, at });
const update = (id, at, change) => ({ ...change, id, updatedAt: at });
const landed = (route, at) => ({ sha: 'abc1234', at, route, read: 'none', readMs: 0 });
const pick = (days, field) => days.map(day => day[field]);
const series = (metrics, slug) => (slug ? metrics.projects.find(project => project.slug === slug) : metrics.all);
/** The value of a field on each of the last `count` days, oldest first. */
const lastDays = (metrics, slug, field, count = 6) => pick(series(metrics, slug).days.slice(-count), field);

test('work.metrics has one day for each local day of the period, zeros included, for all projects and for each', t => {
  const { root } = home(t);

  const week = workMetrics(root, { days: 7, now });

  const days = [6, 5, 4, 3, 2, 1, 0].map(dayName);
  assert.deepEqual([week.from, week.to], [days[0], days[6]]);
  assert.equal(week.at, new Date(now).toISOString());
  assert.deepEqual(pick(week.all.days, 'day'), days);
  assert.deepEqual(week.projects.map(({ slug, name }) => ({ slug, name })), [{ slug: 'api', name: 'API' }, { slug: 'web', name: 'Web' }]);
  for (const own of [week.all, ...week.projects]) {
    assert.deepEqual(pick(own.days, 'day'), days);
    for (const day of own.days) assert.ok(Object.entries(day).every(([field, value]) => field === 'day' || value === 0), JSON.stringify(day));
    assert.deepEqual(own.spans, { waitForYou: spanOf([]), startToMerge: spanOf([]), aiReview: spanOf([]) });
  }
  assert.deepEqual(week.gaps, []);

  // Thirty days unless asked, through the change of clocks on 1 November, and 180 at most.
  const month = workMetrics(root, { now });
  assert.deepEqual(pick(month.all.days, 'day'), Array.from({ length: 30 }, (_, index) => dayName(29 - index)));
  assert.equal(new Set(pick(month.all.days, 'day')).size, 30);
  assert.equal(workMetrics(root, { days: 500, now }).all.days.length, 180);
});

test('a line or a file that cannot be read is named in gaps, and the rest still counts', t => {
  const { root, append, write, event } = home(t);
  event('run_started', daysAgo(1), { id: 'work:api:do:1', lane: 'do', project: 'api', item: 'a1' });
  append(`runtime/events/${daysAgo(1).slice(0, 7)}.jsonl`, '{"at": "cut short');
  event('run_started', daysAgo(1), { id: 'work:api:look:2', lane: 'look', project: 'api' });
  append('work/api/items.jsonl', filed('a1', daysAgo(3)), 'not json', update('a1', daysAgo(2), { state: 'branch' }));
  // A folder where the token record should be cannot be read at all.
  mkdirSync(join(root, 'work', 'tokens.jsonl'), { recursive: true });
  write('proofs/20261120-120000-workitem-ab12/result.json', '{"outcome": "holds"');
  // An append still under way has no newline yet, and is no gap.
  append('work/web/items.jsonl', filed('w1', daysAgo(2)));
  appendFileSync(join(root, 'work', 'web', 'items.jsonl'), '{"id": "w1", "sta');

  const metrics = workMetrics(root, { days: 7, now });

  assert.deepEqual(lastDays(metrics, null, 'started', 2), [2, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'finished', 3), [1, 0, 0]);
  const month = daysAgo(1).slice(0, 7);
  assert.deepEqual(metrics.gaps.toSorted(), [
    "A line of API's work items (work/api/items.jsonl) could not be read, so it is not counted.",
    `A line of the events of ${month} (runtime/events/${month}.jsonl) could not be read, so it is not counted.`,
    'The proof run 20261120-120000-workitem-ab12 (proofs/20261120-120000-workitem-ab12/result.json) could not be read, so it is not counted.',
    'The record of tokens (work/tokens.jsonl) could not be read, so nothing in it is counted.',
  ]);
});

test('a change merged by YOLO mode counts as merged by itself and any other as merged by the user, and one merged after being sent back is not first pass', t => {
  const { root, append } = home(t);
  append('work/api/items.jsonl',
    filed('a1', daysAgo(5)), filed('a2', daysAgo(5)), filed('a3', daysAgo(5)), filed('a4', daysAgo(5)),
    update('a1', daysAgo(5), { state: 'doing' }), update('a1', daysAgo(4), { state: 'branch' }),
    update('a1', daysAgo(3), { state: 'merged', mergedAt: daysAgo(3), landed: landed('yolo', daysAgo(3)) }),
    update('a2', daysAgo(5), { state: 'doing' }), update('a2', daysAgo(4), { state: 'branch' }),
    update('a2', daysAgo(2), { state: 'merged', mergedAt: daysAgo(2), landed: landed('key', daysAgo(2)) }),
    // Sent back once with the user's words, finished again, then merged from Chat.
    update('a3', daysAgo(5), { state: 'doing' }), update('a3', daysAgo(4), { state: 'branch' }),
    update('a3', daysAgo(3), { workNote: 'Add a test.', pushbacks: [{ at: daysAgo(3), area: null }] }),
    update('a3', daysAgo(3, 13), { state: 'doing' }), update('a3', daysAgo(2), { state: 'branch' }),
    update('a3', daysAgo(1), { state: 'merged', mergedAt: daysAgo(1), landed: landed('chat', daysAgo(1)) }),
    // A no writes a pushback of its own, which is no sending back.
    update('a4', daysAgo(2), { state: 'branch' }),
    update('a4', daysAgo(1), { state: 'declined', pushbacks: [{ at: daysAgo(1), area: null }] }));
  append('work/web/items.jsonl', filed('w1', daysAgo(3)), update('w1', daysAgo(1), { state: 'merged', mergedAt: daysAgo(1), landed: landed('remote', daysAgo(1)) }));

  const metrics = workMetrics(root, { days: 7, now });

  assert.deepEqual(lastDays(metrics, 'api', 'mergedByItself'), [0, 0, 1, 0, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'mergedByYou'), [0, 0, 0, 1, 1, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'declined'), [0, 0, 0, 0, 1, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'sentBack'), [0, 0, 1, 0, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'firstPass'), [0, 0, 1, 1, 1, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'finished'), [0, 3, 0, 2, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'web', 'mergedByYou'), [0, 0, 0, 0, 1, 0]);
  assert.deepEqual(lastDays(metrics, 'web', 'firstPass'), [0, 0, 0, 0, 1, 0]);
  assert.deepEqual(lastDays(metrics, null, 'mergedByYou'), [0, 0, 0, 1, 2, 0]);
  assert.deepEqual(lastDays(metrics, null, 'firstPass'), [0, 0, 1, 1, 2, 0]);
});

test('how long a change waited for the user and took from its first run to its merge is measured over the period', t => {
  const { root, append } = home(t);
  append('work/api/items.jsonl',
    filed('a1', daysAgo(9)), update('a1', daysAgo(9), { state: 'doing' }), update('a1', daysAgo(8), { state: 'branch' }),
    // Merged before the period, so it measures nothing.
    update('a1', daysAgo(8, 14), { state: 'merged', landed: landed('key', daysAgo(8, 14)) }),
    filed('a2', daysAgo(5)), update('a2', daysAgo(5), { state: 'doing' }), update('a2', daysAgo(4), { state: 'branch' }),
    update('a2', daysAgo(2), { state: 'merged', landed: landed('key', daysAgo(2)) }),
    // Merged by itself: nobody was waited for, but it still took its time from start to merge.
    filed('a3', daysAgo(5)), update('a3', daysAgo(5), { state: 'doing' }), update('a3', daysAgo(4), { state: 'branch' }),
    update('a3', daysAgo(4, 18), { state: 'merged', landed: landed('yolo', daysAgo(4, 18)) }),
    filed('a4', daysAgo(3)), update('a4', daysAgo(3), { state: 'branch' }), update('a4', daysAgo(2), { state: 'declined', pushbacks: [{ at: daysAgo(2) }] }));

  const { all, projects } = workMetrics(root, { days: 7, now });

  assert.deepEqual(all.spans.waitForYou, { median: 36 * HOUR, p90: Math.round(45.6 * HOUR), count: 2 });
  assert.deepEqual(all.spans.startToMerge, { median: 51 * HOUR, p90: Math.round(67.8 * HOUR), count: 2 });
  assert.deepEqual(projects.find(({ slug }) => slug === 'api').spans, all.spans);
  assert.deepEqual(projects.find(({ slug }) => slug === 'web').spans.waitForYou, spanOf([]));
});

test('each count of a day comes from the record that keeps it, and only what falls in the period counts', t => {
  const { root, append, write, event } = home(t);
  event('run_started', daysAgo(2), { id: 'work:api:do:1', kind: 'background', lane: 'do', project: 'api', item: 'a1' });
  event('run_started', daysAgo(2), { id: 'work:discover:discover:2', kind: 'background', lane: 'discover' });
  // A routine's run is no work.
  event('run_started', daysAgo(2), { id: 'routine:3', kind: 'background', routine: 'news' });
  event('run_started', daysAgo(40), { id: 'work:api:do:4', lane: 'do', project: 'api' });
  event('work_stopped', daysAgo(1), { id: 'work:web:do:5', project: 'web', item: 'w1', lane: 'do', how: 'later' });
  event('decision_filed', daysAgo(1), { id: 'q1', source: 'merge' });
  event('decision_filed', daysAgo(1), { id: 'q2', source: 'subscription' });
  event('decision_filed', daysAgo(1), { id: 'q3', source: 'reminder' });
  append('decisions.jsonl', { id: 'q1', question: 'Merge it?', answerTo: { kind: 'merge', slug: 'api', item: 'a1' }, at: daysAgo(1) }, { id: 'q1', shown: true });
  append('work/tokens.jsonl',
    { at: daysAgo(2), slug: 'api', lane: 'do', item: 'a1', tokens: 1200 },
    { at: daysAgo(2), lane: 'discover', tokens: 300 },
    { at: daysAgo(1), slug: 'web', lane: 'look', tokens: 50 });
  write('proofs/20261119-120000-workitem-ab12/result.json', { id: '20261119-120000-workitem-ab12', project: 'api', outcome: 'holds', started: daysAgo(2, 11), finished: daysAgo(2) });
  write('proofs/20261119-130000-workitem-cd34/result.json', { id: '20261119-130000-workitem-cd34', project: 'api', outcome: 'broken', started: daysAgo(2, 12), finished: daysAgo(2, 13) });
  write('proofs/20261120-120000-workitem-ef56/result.json', { id: '20261120-120000-workitem-ef56', project: 'web', outcome: 'stopped', started: daysAgo(1), finished: daysAgo(1) });
  // A run still going has no result yet, and is no gap.
  write('proofs/20261121-120000-workitem-gh78/events.jsonl', '');
  append('work/yolo.jsonl',
    { at: daysAgo(3), slug: 'api', item: 'a1', head: 'abc', target: 'def', kind: 'bug-fix', rate: 8 },
    { at: daysAgo(2), slug: 'api', item: 'a1', after: { minutes: 30 }, regressed: ['errors'] },
    { at: daysAgo(1), slug: 'api', item: 'a1', after: { minutes: 30 }, regressed: ['latency'] },
    { at: daysAgo(2), slug: 'web', item: 'w1', after: { minutes: 30 }, regressed: [] });

  const metrics = workMetrics(root, { days: 7, now });

  // Two days ago, yesterday and today.
  assert.deepEqual(lastDays(metrics, null, 'started', 3), [2, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'started', 3), [1, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'web', 'stops', 3), [0, 1, 0]);
  assert.deepEqual(lastDays(metrics, null, 'questions', 3), [0, 2, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'questions', 3), [0, 1, 0]);
  assert.deepEqual(lastDays(metrics, null, 'tokens', 3), [1500, 50, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'tokens', 3), [1200, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'proofsHold', 3), [1, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'proofsBroken', 3), [1, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'web', 'proofsBroken', 3), [0, 0, 0]);
  assert.deepEqual(lastDays(metrics, 'api', 'regressed', 3), [1, 0, 0]);
  assert.deepEqual(lastDays(metrics, null, 'regressed', 3), [1, 0, 0]);
  assert.deepEqual(metrics.gaps, []);
});

test('a span is the median and 90th percentile of what was measured, in whole milliseconds', () => {
  assert.deepEqual(spanOf([]), { median: null, p90: null, count: 0 });
  assert.deepEqual(spanOf([5000]), { median: 5000, p90: 5000, count: 1 });
  assert.deepEqual(spanOf([4000, 1000, 3000, 2000]), { median: 2500, p90: 3700, count: 4 });
});
