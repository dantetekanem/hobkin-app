import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const WEEK_MINUTES = 7 * 24 * 60;

// A bare application over a real home, as cli-activity-refresh.test.mjs builds one: only the tick's own work runs.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-tick-signature-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'work'), { recursive: true });
  const clock = { now: Date.parse('2026-11-13T12:00:30.000Z') };
  const app = new HobkinApplication();
  let refreshes = 0;
  app.now = () => clock.now;
  app.runtime = { directory: root };
  app.moods = { notice() {} };
  app.learner = { enabled: () => false };
  app.director = { tick: async () => {}, outlook: () => ({ now: clock.now }) };
  app.requestRefresh = () => { refreshes += 1; };
  // A weekly window as Codex reports it, with `elapsed` percent of its time gone at the clock's time.
  const usage = (usedPercent, elapsed) => writeFileSync(join(root, 'work', 'subscription.json'), JSON.stringify({
    at: new Date(clock.now).toISOString(),
    primary: { usedPercent, windowMinutes: WEEK_MINUTES, resetAt: Math.round(clock.now + (1 - elapsed / 100) * WEEK_MINUTES * MINUTE) },
  }));
  const tick = async (after = 0) => {
    clock.now += after;
    await app.tickWork();
    return refreshes;
  };
  return { usage, tick };
}

test('the clock of a usage window alone does not refresh the dashboard on every tick', async t => {
  const h = fixture(t);
  h.usage(7, 50.2);
  assert.equal(await h.tick(), 1);
  assert.equal(await h.tick(SECOND), 1);
  assert.equal(await h.tick(SECOND), 1);
});

test('a new whole percent of the window, a new used percent and a new minute each refresh the dashboard', async t => {
  const h = fixture(t);
  h.usage(7, 50.2);
  assert.equal(await h.tick(), 1);
  h.usage(7, 50.7);
  assert.equal(await h.tick(), 2, 'the time gone reads 51% now');
  h.usage(8, 50.7);
  assert.equal(await h.tick(), 3, 'more of the window is used');
  assert.equal(await h.tick(MINUTE), 4, 'once a minute, for what moves with the clock alone');
  assert.equal(await h.tick(SECOND), 4);
});

test('the refresh a tick asks for shows Work as that tick read it, and a refresh for anything else reads it again', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-tick-refresh-'));
  mkdirSync(join(root, 'work'), { recursive: true });
  const survey = join(root, 'work', 'unmerged.json');
  writeFileSync(survey, JSON.stringify({ at: null, projects: {} }));
  // One read of the survey is one read of Work's status.
  let reads = 0;
  const { readFileSync } = fs;
  t.mock.method(fs, 'readFileSync', (...args) => {
    if (String(args[0]) === survey) reads += 1;
    return readFileSync(...args);
  });
  syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  });
  const app = new HobkinApplication();
  app.now = () => Date.parse('2026-11-13T12:00:30.000Z');
  app.runtime = { directory: root, helpers: () => ({}), mainActivity: () => [] };
  app.runner = {};
  app.moods = { notice() {} };
  app.learner = { enabled: () => false };
  app.director = { tick: async () => {}, outlook: () => ({}), running: () => [] };
  const shown = [];
  app.project = async work => { shown.push(app.workView(work)); };
  const settle = async () => {
    t.mock.timers.tick(25);
    await app.refreshing;
  };

  await app.tickWork();
  await settle();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].enabled, false);
  assert.equal(shown[0].discovering, false);
  assert.equal(reads, 1, 'the refresh used what the tick read');

  app.requestRefresh();
  await settle();
  assert.equal(shown.length, 2);
  assert.equal(reads, 2, 'a refresh for something else reads Work again');

  // A user's action refreshes at once, while the tick's own refresh still waits: it must show the action.
  app.workSignature = null;
  await app.tickWork();
  await app.refresh();
  assert.equal(reads, 4, 'a refresh called straight after a change reads Work again');
  await settle();
  assert.equal(shown.length, 3, 'the tick\'s refresh is already covered');
});
