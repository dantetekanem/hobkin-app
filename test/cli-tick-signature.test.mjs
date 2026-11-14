import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
