import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');

/** A temporary home whose main chat is a fake Pi. It goes once every app opened on it has closed. */
function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-schedules-app-')));
  const opened = [];
  t.after(async () => {
    await Promise.all(opened.map(app => app.close()));
    rmSync(root, { recursive: true, force: true });
  });
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePi(root);
  const notHere = { status: 'failed', cost: null, error: 'Not in this test.' };
  const open = async options => {
    const app = await HobkinApplication.open(root, { createMain: fake.createMain, intervalMs: 60000, runHarness: async () => notHere, ...options });
    opened.push(app);
    return app;
  };
  return { root, open };
}

test('the snapshot carries every schedule as agentSchedules, and the window may cancel, pause or run a live one and is refused for an ended or unknown one', async t => {
  const h = home(t);
  let clock = NOW;
  const app = await h.open({ now: () => clock });
  const fresh = await app.refresh();
  assert.deepEqual(fresh.agentSchedules, []);
  assert.equal(existsSync(join(h.root, 'runtime/agent-schedules.json')), false, 'a home that never schedules keeps no file');

  const made = app.agentSchedules.make({ kind: 'main' }, h.root, { name: 'Look again', in: '10m', note: 'Read the deploy log.' });
  const [shown] = (await app.refresh()).agentSchedules;
  assert.deepEqual([shown.id, shown.owner, shown.ownerTitle, shown.name, shown.does, shown.state, shown.nextAt, shown.maxWakes],
    [made.id, { kind: 'main' }, 'hobkin', 'Look again', 'wake', 'waiting', new Date(NOW + 10 * 60000).toISOString(), 12]);

  assert.deepEqual(await app.pauseAgentSchedule(made.id, true), { ok: true });
  assert.equal((await app.refresh()).agentSchedules[0].state, 'paused');
  assert.deepEqual(await app.pauseAgentSchedule(made.id, false), { ok: true });
  assert.deepEqual(await app.runAgentSchedule(made.id), { ok: true });
  assert.equal(app.agentSchedules.wakes().length, 1, 'run now fired it');
  assert.equal((await app.refresh()).agentSchedules[0].state, 'done');

  for (const answer of [await app.cancelAgentSchedule(made.id), await app.pauseAgentSchedule(made.id, true), await app.runAgentSchedule(made.id)]) {
    assert.deepEqual(answer, { ok: false, reason: 'That schedule has already ended.' });
  }
  assert.deepEqual(await app.cancelAgentSchedule('missing'), { ok: false, reason: 'There is no schedule with that id.' });
  assert.deepEqual(await app.pauseAgentSchedule(made.id, 'yes'), { ok: false, reason: 'Say whether to pause it or let it go on.' });

  const other = app.agentSchedules.make({ kind: 'main' }, h.root, { every: '5m', in: '5m', note: 'Look.' });
  assert.deepEqual(await app.cancelAgentSchedule(other.id), { ok: true });
  assert.equal((await app.refresh()).agentSchedules.find(item => item.id === other.id).endedWhy, 'the user cancelled it from the window');

  clock = NOW + 2 * 3600000;
  assert.deepEqual((await app.refresh()).agentSchedules, [], 'an ended one shows for an hour');
});

test("a failure in the schedules' tick is kept and the runtime's tick goes on", async t => {
  const h = home(t);
  const app = await h.open({ now: () => NOW });
  app.agentSchedules.make({ kind: 'main' }, h.root, { every: '5m', note: 'Look.' });
  app.agentSchedules.tick = () => { throw Error('The disk is full.'); };
  await app.tickAgentSchedules();
  assert.equal(app.agentSchedulesError, 'The disk is full.');
  await app.runner.tick();
  assert.equal(app.runner.lastError, null);
});
