import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { compactionDue, compactAtForceLevel, nextRunIn } from '../src/cli/compaction.mjs';

const HOUR = 3600000;
const MINUTE = 60000;
const now = Date.parse('2026-11-02T12:00:00Z');

/** A main session worth compacting by the smart rule, with one thing to change per test. */
const context = (change = {}) => ({
  percent: 85,
  auto: true,
  free: true,
  quietMs: 10 * MINUTE,
  agentsRunning: false,
  nextRunInMs: 3 * HOUR,
  ...change,
});

test('at 80% or more the chat compacts ahead of time when the next run is hours away', () => {
  assert.equal(compactionDue(context()), 'smart');
  assert.equal(compactionDue(context({ percent: 80 })), 'smart');
  assert.equal(compactionDue(context({ nextRunInMs: null })), 'smart', 'nothing is scheduled at all');
});

test('at 80% or more it also compacts while other agents run, whenever the next check is', () => {
  assert.equal(compactionDue(context({ nextRunInMs: 5 * MINUTE, agentsRunning: true })), 'smart');
});

test('with a run coming soon and no agents working, it waits', () => {
  assert.equal(compactionDue(context({ nextRunInMs: 30 * MINUTE })), null);
});

test('below 80% there is nothing to do', () => {
  assert.equal(compactionDue(context({ percent: 79.9 })), null);
  assert.equal(compactionDue(context({ percent: null })), null, 'just after a compaction nothing is known yet');
});

test('the smart one never takes the chat from someone using it', () => {
  assert.equal(compactionDue(context({ free: false })), null);
  assert.equal(compactionDue(context({ quietMs: MINUTE })), null, 'a reply may be on its way');
});

test('at 95% it is forced, whatever else is going on', () => {
  const forced = context({ percent: 95, quietMs: 0, nextRunInMs: MINUTE });

  assert.equal(compactionDue(forced), 'force');
  assert.equal(compactionDue({ ...forced, percent: 99 }), 'force');
});

test('with auto-compact off in Pi, hobkin leaves the session alone', () => {
  assert.equal(compactionDue(context({ percent: 97, auto: false })), null);
});

test('a compaction that failed is not tried again for a while, so it cannot hold anything up', () => {
  const failed = { status: 'failed', at: new Date(now - 5 * MINUTE).toISOString() };

  assert.equal(compactionDue(context({ percent: 97, last: failed, now })), null);
  assert.equal(compactionDue(context({ percent: 97, last: failed, now: now + 10 * MINUTE })), 'force');
});

test('a compaction that finished does not count as a failure', () => {
  const finished = { status: 'completed', at: new Date(now - MINUTE).toISOString() };

  assert.equal(compactionDue(context({ percent: 97, last: finished, now })), 'force');
});

test('the next run is the soonest one still to come, and a paused schedule has none', () => {
  const schedules = [
    { nextRun: { state: 'scheduled', at: new Date(now + 5 * HOUR).toISOString() } },
    { nextRun: { state: 'scheduled', at: new Date(now + 2 * HOUR).toISOString() } },
    { nextRun: { state: 'paused', at: null } },
    { nextRun: { state: 'scheduled', at: new Date(now - HOUR).toISOString() } },
  ];

  assert.equal(nextRunIn(schedules, now), 2 * HOUR);
  assert.equal(nextRunIn([{ nextRun: { state: 'paused', at: null } }], now), null);
  assert.equal(nextRunIn(undefined, now), null);
});

const model = (id, contextWindow) => ({ provider: 'openai', id, contextWindow });

test('Pi compacts at 95% for this session only, and small windows keep the room Pi needs', () => {
  const settings = SettingsManager.inMemory();
  const large = model('large', 500000);
  const small = model('small', 200000);

  compactAtForceLevel(settings, [large, small]);

  assert.equal(settings.getCompactionSettings(large).reserveTokens, 25000);
  assert.equal(settings.getCompactionSettings(small).reserveTokens, 16384);
});
