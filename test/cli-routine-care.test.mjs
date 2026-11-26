import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDecisions } from '../src/cli/decisions.mjs';
import { tickRoutineCare } from '../src/cli/routine-care.mjs';

const MINUTE_MS = 60000;
const NOW = Date.parse('2026-11-10T12:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-routine-care-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const routine = (id, details = {}) => ({ id, title: 'News digest', cadence: 'daily', enabled: true, at: '07:00', timezone: 'UTC', harness: 'pi', effort: 'low', model: null, cwd: '/tmp', context: [], prompt: 'Look.', path: `/home/routines/daily/${id}.md`, ...details });
const seen = (scheduleId, details = {}) => ({ scheduleId, title: scheduleId, reports: 10, read: 1, critical: 0, nothingNew: 2, usd: 1.2, lastReadAt: null, ignored: true, ...details });
const routineItems = root => openDecisions(root).filter(({ answerTo }) => answerTo?.kind === 'routines');

test('the tick looks after routines once an hour, from the routines as loaded and the attention rollup', t => {
  const root = home(t);
  const loaded = { schedules: [routine('news')], errors: [] };

  assert.equal(tickRoutineCare(root, { loaded, attention: [seen('news')], now: NOW }).filed.length, 1);
  assert.equal(routineItems(root).length, 1);

  const wanted = [seen('news', { ignored: false })];
  assert.equal(tickRoutineCare(root, { loaded, attention: wanted, now: NOW + 59 * MINUTE_MS }), null, 'within the hour it does not look');
  assert.equal(routineItems(root).length, 1);
  assert.equal(tickRoutineCare(root, { loaded, attention: wanted, now: NOW + 60 * MINUTE_MS }).settled.length, 1);
  assert.deepEqual(routineItems(root), []);
});

test('with no rollup yet it does not look, so the next tick does', t => {
  const root = home(t);
  const loaded = { schedules: [routine('news')], errors: [] };

  assert.equal(tickRoutineCare(root, { loaded, attention: undefined, now: NOW }), null);
  assert.equal(tickRoutineCare(root, { loaded, attention: [seen('news')], now: NOW + 1000 }).filed.length, 1);
});

test('a routine file that did not load keeps its item, and a loaded routine that failed to start does not count as one', t => {
  const root = home(t);
  tickRoutineCare(root, { loaded: { schedules: [routine('news')], errors: [] }, attention: [seen('news')], now: NOW });

  const unreadable = { schedules: [], errors: [{ path: routine('news').path, message: 'unreadable' }] };
  assert.deepEqual(tickRoutineCare(root, { loaded: unreadable, attention: [seen('news')], now: NOW + 60 * MINUTE_MS }).settled, []);
  assert.equal(routineItems(root).length, 1);

  const startFailed = { schedules: [routine('disk')], errors: [{ path: routine('disk').path, message: 'could not start' }] };
  assert.equal(tickRoutineCare(root, { loaded: startFailed, attention: [], now: NOW + 120 * MINUTE_MS }).settled.length, 1);
});

test('a problem looking costs this look and never reaches the tick', t => {
  const missing = join(home(t), 'gone');

  assert.equal(tickRoutineCare(missing, { loaded: { schedules: [routine('news')], errors: [] }, attention: [seen('news')], now: NOW }), null);
});
