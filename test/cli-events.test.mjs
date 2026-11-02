import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventRollup, readEvents, recordEvent } from '../src/cli/events.mjs';
import { main } from '../src/cli/main.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-events-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const folder = root => join(root, 'runtime', 'events');
const at = (day, hour = 12) => new Date(2026, 10, day, hour).getTime();
const event = (type, day, facts = {}) => ({ at: new Date(at(day)).toISOString(), type, ...facts });

test('an event is one private line in the month it happened, from nothing at all', t => {
  const root = dataRoot(t);
  const when = Date.parse('2026-11-02T10:00:00Z');

  recordEvent(root, 'run_started', { id: 'one', lane: 'do' }, when);
  recordEvent(root, 'app_opened', {}, when + 1000);

  const file = join(folder(root), '2026-11.jsonl');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(file, 'utf8').split('\n').slice(0, 2).map(line => JSON.parse(line)), [
    { at: '2026-11-02T10:00:00.000Z', type: 'run_started', id: 'one', lane: 'do' },
    { at: '2026-11-02T10:00:01.000Z', type: 'app_opened' },
  ]);
});

test('a write problem never reaches the caller', t => {
  const root = dataRoot(t);
  writeFileSync(join(root, 'runtime'), 'not a folder');

  assert.doesNotThrow(() => recordEvent(root, 'app_opened'));
});

test('a new month keeps the newest six', t => {
  const root = dataRoot(t);
  mkdirSync(folder(root), { recursive: true });
  for (const month of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
    writeFileSync(join(folder(root), `${month}.jsonl`), '');
  }
  writeFileSync(join(folder(root), 'notes.txt'), 'someone else put this here');

  recordEvent(root, 'app_opened', {}, Date.parse('2026-09-15T12:00:00Z'));

  assert.deepEqual(readdirSync(folder(root)).sort(), ['2026-04.jsonl', '2026-05.jsonl', '2026-06.jsonl', '2026-07.jsonl', '2026-08.jsonl', '2026-09.jsonl', 'notes.txt']);
});

test('reading goes through the months in order, skips what is older and survives a damaged line', t => {
  const root = dataRoot(t);
  const october = Date.parse('2026-10-20T12:00:00Z');
  const november = Date.parse('2026-11-02T12:00:00Z');
  recordEvent(root, 'old', {}, Date.parse('2026-09-01T12:00:00Z'));
  recordEvent(root, 'run_started', { id: 'two' }, november);
  recordEvent(root, 'run_started', { id: 'one' }, october);
  appendFileSync(join(folder(root), '2026-11.jsonl'), '{"at":"2026-11-02T12:00:00Z","typ\n[]\n{"type":"no time"}\n');

  assert.deepEqual(readEvents(root, { since: october }).map(({ id }) => id), ['one', 'two']);
  assert.equal(readEvents(root).length, 3);
});

test('reading a home that recorded nothing finds nothing, and a link is not read', t => {
  const root = dataRoot(t);
  assert.deepEqual(readEvents(root), []);

  const elsewhere = join(root, 'elsewhere.jsonl');
  writeFileSync(elsewhere, `${JSON.stringify(event('secret', 2))}\n`);
  mkdirSync(folder(root), { recursive: true });
  symlinkSync(elsewhere, join(folder(root), '2026-11.jsonl'));

  assert.deepEqual(readEvents(root), []);
});

test('the rollup counts by type and day, and totals runs by routine and by project', () => {
  const rollup = eventRollup([
    event('app_opened', 2),
    event('run_finished', 2, { id: 'a', routine: 'digest', status: 'completed', ms: 1000, usd: 0.5, tokens: 100, triage: 'useful' }),
    event('run_finished', 3, { id: 'b', routine: 'digest', status: 'failed', ms: 3000, usd: 0.25, tokens: 50 }),
    event('run_finished', 3, { id: 'c', routine: 'work.site.do', project: 'site', lane: 'do', status: 'completed', ms: 2000, usd: 1 }),
    event('run_tokens', 3, { id: 'c', tokens: 900, cached: 40 }),
  ]);

  assert.equal(rollup.events, 5);
  assert.deepEqual(rollup.byType, { app_opened: 1, run_finished: 3, run_tokens: 1 });
  assert.deepEqual(Object.values(rollup.byDay), [{ app_opened: 1, run_finished: 1 }, { run_finished: 2, run_tokens: 1 }]);
  assert.deepEqual(rollup.routines, {
    digest: { runs: 2, statuses: { completed: 1, failed: 1 }, triage: { useful: 1 }, usd: 0.75, tokens: 150, meanMs: 2000 },
  });
  assert.deepEqual(rollup.projects, {
    site: { runs: 1, statuses: { completed: 1 }, triage: {}, usd: 1, tokens: 900, meanMs: 2000 },
  });
});

test('the rollup gives mean durations, and what reached the user beside what they did with it', () => {
  const rollup = eventRollup([
    event('turn_finished', 2, { ms: 1000 }),
    event('turn_finished', 2, { ms: 3000 }),
    event('run_finished', 2, { routine: 'digest', ms: 5000 }),
    event('notice_posted', 2, { tone: 'useful', source: 'report' }),
    event('notice_posted', 2, { tone: 'critical', source: 'report' }),
    event('report_read', 2, { id: 'a', ms: 8000 }),
    event('report_messaged', 2, { id: 'a' }),
    event('question_shown', 2),
    event('question_shown', 2),
    event('question_ended', 2, { how: 'answered', choice: 1, ms: 2000 }),
    event('question_ended', 2, { how: 'expired', ms: 30000 }),
    event('decision_filed', 2, { id: 'one' }),
    event('decision_answered', 2, { id: 'one', ms: 60000 }),
    event('done_page', 2, { project: 'site', item: 'x', ms: 4000 }),
    event('done_merged', 2, { project: 'site', item: 'x' }),
    event('done_declined', 2, { project: 'site', item: 'y' }),
    event('done_sent_back', 2, { project: 'site', item: 'z' }),
  ]);

  assert.deepEqual(rollup.meanMs, { turn: 2000, run: 5000, question: 16000, decision: 60000, report: 8000, donePage: 4000 });
  assert.deepEqual(rollup.reached, { notices: 2, questions: 2, decisions: 1, donePages: 1 });
  assert.deepEqual(rollup.acted, { reports: 1, questions: 1, decisions: 1, merged: 1, declined: 1, sentBack: 1 });
});

test('a rollup of nothing is empty rather than wrong', () => {
  const rollup = eventRollup([]);

  assert.equal(rollup.events, 0);
  assert.deepEqual(rollup.routines, {});
  assert.equal(rollup.meanMs.turn, null);
});

const printed = () => {
  const chunks = [];
  return { write: text => chunks.push(text), text: () => chunks.join('') };
};

test('hobkin telemetry prints the rollup of its days as JSON and changes nothing', async t => {
  const root = dataRoot(t);
  recordEvent(root, 'run_finished', { routine: 'digest', status: 'completed', ms: 10 }, Date.now() - 3 * 86400000);
  recordEvent(root, 'run_finished', { routine: 'digest', status: 'completed', ms: 30 }, Date.now() - 86400000);
  const before = readdirSync(root);

  const week = printed();
  assert.equal(await main(['telemetry', '--days', '7', '--home', root], week), 0);
  assert.equal(JSON.parse(week.text()).routines.digest.runs, 2);

  const today = printed();
  assert.equal(await main(['telemetry', '--days', '2', '--home', root], today), 0);
  assert.equal(JSON.parse(today.text()).routines.digest.runs, 1);

  assert.deepEqual(readdirSync(root), before);
});

test('hobkin telemetry works on a home that recorded nothing, and creates nothing there', async t => {
  const root = dataRoot(t);
  const output = printed();

  assert.equal(await main(['telemetry', '--home', root], output), 0);

  assert.equal(JSON.parse(output.text()).events, 0);
  assert.equal(existsSync(join(root, 'runtime')), false);
});

test('hobkin telemetry refuses days that are not a whole number', async t => {
  const root = dataRoot(t);

  for (const days of ['0', '1.5', 'week']) {
    await assert.rejects(main(['telemetry', '--days', days, '--home', root], printed()), { message: 'Usage: hobkin telemetry [--days n]' });
  }
});

test('help names telemetry', async () => {
  const output = printed();
  await main(['--help'], output);
  assert.match(output.text(), /telemetry \[--days n\]/);
});

test('a private folder stays private when an event lands in it', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'runtime'), { mode: 0o700 });

  recordEvent(root, 'app_opened');

  assert.equal(statSync(folder(root)).mode & 0o777, 0o700);
});
