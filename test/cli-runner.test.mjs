import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinRunner, dueOccurrence, nextOccurrence } from '../src/cli/runner.mjs';
import { initialize, MOST_CONCURRENCY, validateConfig } from '../src/cli/config.mjs';
import { scheduleDefinition } from '../src/cli/checks.mjs';
import { loadSchedules } from '../src/cli/schedules.mjs';
import { LegacySchedules } from '../src/cli/legacy-schedules.mjs';
import { sha256 } from '../src/cli/migration/inventory.mjs';

const base = {
  id: 'check',
  title: 'Check',
  at: '09:00',
  timezone: 'UTC',
  enabled: true,
  cadence: 'daily',
  harness: 'pi',
  model: 'test',
  effort: 'high',
  context: [],
  prompt: 'Check the selected sources.',
};
const config = { concurrency: 2, initializedAt: '2026-01-01T00:00:00Z' };

class MemoryRuntime {
  data = { main: null, runs: {}, lastTick: null };
  active = new Map();

  async state() { return structuredClone(this.data); }
  async change(fn) { return fn(this.data); }

  dispatch(request, effect, onAdmitted) {
    if (this.data.runs[request.id]) return Promise.resolve(this.data.runs[request.id]);
    const controller = new AbortController();
    const run = this.data.runs[request.id] = { ...request, status: 'running' };
    onAdmitted?.();
    const work = Promise.resolve()
      .then(() => effect(controller.signal))
      .catch(error => ({ status: 'failed', error: error.message }))
      .then(result => Object.assign(run, { status: result.status, result }))
      .finally(() => this.active.delete(request.id));
    this.active.set(request.id, { controller, work });
    return work;
  }

  async cancel(id) {
    this.active.get(id)?.controller.abort();
    await this.active.get(id)?.work;
  }

  async idle() {
    await Promise.all([...this.active.values()].map(item => item.work));
  }
}

async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hobkin-runner-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'routines/daily'), { recursive: true });

  const schedule = { ...base, cwd: root, ...options };
  const save = async (value = schedule) => {
    const { cadence, prompt, ...metadata } = value;
    const path = join(root, 'routines', cadence, `${value.id}.md`);
    await writeFile(path, `---\n${JSON.stringify(metadata)}\n---\n${prompt}\n`);
  };
  await save();
  return { root, schedule, save, runtime: new MemoryRuntime() };
}

test('enabling a routine admits no slot that had already passed, only the next one', async t => {
  const h = await fixture(t, { enabledAt: '2026-01-02T19:00:00Z' });
  let clock = new Date('2026-01-02T20:00:00Z');
  const runner = new HobkinRunner({ ...h, config, now: () => clock, runHarness: async () => ({ status: 'completed', text: 'ok' }) });
  await runner.tick();
  await h.runtime.idle();
  assert.deepEqual(Object.keys(h.runtime.data.runs), [], 'today 09:00 was before enabling');
  assert.equal((await runner.snapshot()).schedules[0].nextRun.at, '2026-01-03T09:00:00.000Z');

  clock = new Date('2026-01-03T09:00:30Z');
  await runner.tick();
  await h.runtime.idle();
  assert.deepEqual(Object.keys(h.runtime.data.runs), ['check:2026-01-03']);
});

test('a tick reads every run whole only for a routine that is due and has not run, and its index otherwise', async t => {
  const h = await fixture(t);
  const whole = h.runtime.state.bind(h.runtime);
  let wholeReads = 0, indexReads = 0;
  h.runtime.state = () => { wholeReads++; return whole(); };
  h.runtime.runIndex = async () => {
    indexReads++;
    const { runs } = await whole();
    return { runs: Object.fromEntries(Object.entries(runs).map(([id, { kind, status, scheduleId, scheduledAt, work, hobkin }]) =>
      [id, { id, kind, status, scheduleId, scheduledAt, work: Boolean(work), hobkin: Boolean(hobkin) }])) };
  };
  let clock = new Date('2026-01-02T08:00:00Z');
  const runner = new HobkinRunner({ ...h, config, now: () => clock, runHarness: async () => ({ status: 'completed', text: 'ok' }) });
  await runner.tick();
  assert.deepEqual([wholeReads, indexReads], [0, 1], 'nothing is due before 09:00');

  clock = new Date('2026-01-02T09:00:30Z');
  await runner.tick();
  await h.runtime.idle();
  assert.deepEqual(Object.keys(h.runtime.data.runs), ['check:2026-01-02']);
  assert.deepEqual([wholeReads, indexReads], [1, 2], 'the due routine is weighed against every run before it starts');

  clock = new Date('2026-01-02T09:01:30Z');
  await runner.tick();
  await h.runtime.idle();
  assert.deepEqual(Object.keys(h.runtime.data.runs), ['check:2026-01-02'], 'it runs once');
  assert.deepEqual([wholeReads, indexReads], [1, 3], 'once it has run, the index says so');
});

test('deletion serializes with admission and changes, preserving runtime history', async t => {
  const h = await fixture(t);
  const runner = new HobkinRunner({ ...h, config });
  const token = scheduleDefinition(loadSchedules(h.root).schedules[0]);
  h.runtime.data.runs.old = { scheduleId: 'check', status: 'completed', result: { text: 'Report' } };
  const before = structuredClone(h.runtime.data);
  const change = runner.change('check', { enabled: false });
  const stale = runner.change('check', { delete: token });
  await change;
  await assert.rejects(stale, /definition/);
  const current = scheduleDefinition(runner.loaded.schedules[0]);
  const deletion = runner.change('check', { delete: current });
  const start = runner.trigger('check', 'after-delete');
  assert.deepEqual(await deletion, { id: 'check', deleted: true });
  await assert.rejects(start, /Unknown exact native/);
  assert.deepEqual(h.runtime.data, before);
  assert.deepEqual(runner.loaded.schedules, []);
});

test('deletion refuses a running once receipt even without an in-memory job', async t => {
  const h = await fixture(t);
  await mkdir(join(h.root, 'routines/once'));
  await rm(join(h.root, 'routines/daily/check.md'));
  await h.save({ ...h.schedule, cadence: 'once', date: '2026-11-11' });
  h.runtime.data.runs.once = { scheduleId: 'check', status: 'running' };
  const runner = new HobkinRunner({ ...h, config });
  const token = scheduleDefinition(loadSchedules(h.root).schedules[0]);
  await assert.rejects(runner.change('check', { delete: token }), /already running/);
  assert.equal(loadSchedules(h.root).schedules[0].cadence, 'once');
});

test('deletion refuses a running routine admitted ahead of it', async t => {
  const h = await fixture(t);
  const finish = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const runner = new HobkinRunner({ ...h, config, runHarness: async () => {
    entered.resolve();
    return finish.promise;
  } });
  t.after(async () => { finish.resolve({ status: 'completed', text: 'Done' }); await h.runtime.idle(); });
  const token = scheduleDefinition(loadSchedules(h.root).schedules[0]);
  const start = runner.trigger('check', 'before-delete');
  const deletion = runner.change('check', { delete: token });
  await start;
  await assert.rejects(deletion, /already running/);
  await entered.promise;
  assert.equal(loadSchedules(h.root).schedules[0].id, 'check');
  finish.resolve({ status: 'completed', text: 'Done' });
  await h.runtime.idle();
  assert.deepEqual(await runner.change('check', { delete: token }), { id: 'check', deleted: true });
});

test('harness previews bind to occurrence IDs, not fresh harness UUIDs, and observers cannot fail work', async t => {
  const h = await fixture(t);
  const seen = [];
  const runner = new HobkinRunner({
    ...h, config, now: () => new Date('2026-01-02T10:00:00Z'),
    onActivity: (id, event) => {
      seen.push([id, event]);
      throw Error('UI failed');
    },
    runHarness: async (request, { onEvent }) => {
      assert.notEqual(request.id, 'check:2026-01-02');
      onEvent({ type: 'message_update' });
      return { status: 'completed', text: 'Done' };
    },
  });
  await runner.tick();
  await h.runtime.idle();
  assert.deepEqual(seen, [['check:2026-01-02', { type: 'message_update' }]]);
  assert.equal(h.runtime.data.runs['check:2026-01-02'].status, 'completed');
});

test('a run receives its check memory, log and the newest outcome, even when that run was manual and failed', async t => {
  const h = await fixture(t);
  await mkdir(join(h.root, 'checks/check'), { recursive: true });
  await writeFile(join(h.root, 'checks/check/memory.md'), '- Checkpoint: 2026-01-01\n');
  await writeFile(join(h.root, 'checks/check/log.md'), '- 2026-01-01T09:05:00.000Z | scheduled | completed | 5s | Nothing new.\n');
  Object.assign(h.runtime.data.runs, {
    'check:2026-01-01': {
      id: 'check:2026-01-01', scheduleId: 'check', kind: 'background', status: 'completed',
      scheduledAt: '2026-01-01T09:00:00.000Z', finishedAt: '2026-01-01T09:05:00.000Z',
      result: { status: 'completed', text: 'Nothing new.' },
    },
    'once:manual': {
      id: 'once:manual', scheduleId: 'check', kind: 'background', status: 'failed', trigger: 'manual',
      finishedAt: '2026-01-01T12:00:00.000Z', result: { status: 'failed', error: 'Gmail tools are unavailable.' },
    },
  });
  let envelope;
  const runner = new HobkinRunner({
    ...h, config, now: () => new Date('2026-01-02T10:00:00Z'),
    runHarness: async request => {
      envelope = JSON.parse(request.prompt);
      return { status: 'completed', text: 'Nothing new.' };
    },
  });

  await runner.tick();
  await h.runtime.idle();

  assert.deepEqual(envelope.latestOutcome, { status: 'failed', text: 'Gmail tools are unavailable.' });
  assert.deepEqual(envelope.checkMemory, {
    path: join(h.root, 'checks/check/memory.md'),
    text: '- Checkpoint: 2026-01-01\n',
    truncated: false,
  });
  assert.deepEqual(envelope.log, ['- 2026-01-01T09:05:00.000Z | scheduled | completed | 5s | Nothing new.']);
});

test('a check blocked twice stops being scheduled, shows when it resumes, and still runs on request', async t => {
  const h = await fixture(t, { at: undefined, window: { start: '09:00', end: '17:00', everyMinutes: 60 } });
  for (const hour of ['09', '10']) {
    const id = `check:2026-01-02:${hour}:00`;
    h.runtime.data.runs[id] = {
      id, scheduleId: 'check', kind: 'background', status: 'completed',
      scheduledAt: `2026-01-02T${hour}:00:00.000Z`, finishedAt: `2026-01-02T${hour}:01:00.000Z`,
      result: { status: 'completed', text: 'Blocked: Gmail tools are unavailable.' },
    };
  }
  let now = new Date('2026-01-02T11:00:00Z');
  let calls = 0;
  const runner = new HobkinRunner({
    ...h, config, now: () => now,
    runHarness: async () => {
      calls++;
      return { status: 'completed', text: 'Nothing new.' };
    },
  });

  await runner.tick();
  await h.runtime.idle();
  assert.equal(calls, 0);
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, {
    state: 'held',
    at: '2026-01-03T10:01:00.000Z',
    reason: 'Gmail tools are unavailable.',
    holdId: 'check:2026-01-02:10:00',
  });

  await runner.trigger('check', 'requested-by-user');
  await h.runtime.idle();
  assert.equal(calls, 1);

  // That success would clear the hold; drop it to prove the hold also ends by itself.
  for (const id of Object.keys(h.runtime.data.runs)) if (id.startsWith('once:')) delete h.runtime.data.runs[id];
  now = new Date('2026-01-03T10:02:00Z');
  await runner.tick();
  await h.runtime.idle();
  assert.equal(calls, 2);
  assert.equal(h.runtime.data.runs['check:2026-01-03:10:00'].status, 'completed');
});

test('a hold keeps its name through a failed retry, and only a working run or a schedule edit ends it', async t => {
  const h = await fixture(t, { at: '23:00' });
  const run = (id, hour, overrides = {}) => {
    h.runtime.data.runs[id] = {
      id, scheduleId: 'check', kind: 'background', status: 'completed', finishedAt: `2026-01-02T${hour}:00:00.000Z`,
      result: { status: 'completed', text: 'Blocked: Gmail tools are unavailable.' },
      ...overrides,
    };
  };
  const runner = new HobkinRunner({ ...h, config, now: () => new Date('2026-01-02T20:00:00Z') });
  const held = async () => (await runner.snapshot()).schedules[0].nextRun;
  await runner.tick();

  run('one', '09');
  assert.equal((await held()).state, 'scheduled', 'one bad run is no hold');

  run('two', '10');
  assert.equal((await held()).holdId, 'two');

  run('cancelled', '11', { status: 'interrupted', result: { status: 'interrupted' } });
  run('skipped', '12', { status: 'incomplete', result: { status: 'incomplete', noModel: true } });
  run('retry', '13');
  assert.equal((await held()).holdId, 'two', 'a retry that fails is the same hold');

  run('worked', '14', { result: { status: 'completed', text: 'Nothing new.' } });
  assert.equal((await held()).state, 'scheduled');

  run('three', '15');
  run('four', '16', { definition: scheduleDefinition(runner.loaded.schedules[0]) });
  assert.equal((await held()).holdId, 'four', 'after a working run it is a new hold');

  await h.save({ ...h.schedule, prompt: 'Check the sources differently.' });
  await runner.tick();
  assert.equal((await held()).state, 'scheduled', 'an edit ends the streak the runs were part of');
});

test('a hold that ends after hours resumes at the next allowed time', async t => {
  const h = await fixture(t, { at: undefined, window: { start: '09:00', end: '17:00', everyMinutes: 60 } });
  for (const hour of ['16', '17']) {
    const id = `check:2026-01-02:${hour}:00`;
    h.runtime.data.runs[id] = {
      id, scheduleId: 'check', kind: 'background', status: 'failed',
      scheduledAt: `2026-01-02T${hour}:00:00.000Z`, finishedAt: `2026-01-02T${hour}:30:00.000Z`,
      result: { status: 'failed', error: 'Model overloaded.' },
    };
  }
  const runner = new HobkinRunner({ ...h, config, now: () => new Date('2026-01-02T18:00:00Z') });

  await runner.tick();

  assert.equal((await runner.snapshot()).schedules[0].nextRun.at, '2026-01-04T09:00:00.000Z');
});

test('native dispatch rejects an explicit non-Pi binding before admission', async t => {
  const h = await fixture(t);
  const runner = new HobkinRunner({
    ...h, config,
    runHarness: async () => { throw Error('Unexpected provider dispatch'); },
  });
  await assert.rejects(
    runner.startNative({ ...h.schedule, harness: 'claude' }, {}, h.runtime.data),
    /explicit Pi binding/,
  );
  assert.deepEqual(h.runtime.data.runs, {});
});

test('local calendar occurrences skip missing times and use the first repeated instant', () => {
  const schedule = { ...base, timezone: 'America/New_York', at: '01:30' };

  const first = dueOccurrence(schedule, new Date('2026-11-01T05:30:00Z'));

  assert.equal(first.scheduledAt, '2026-11-01T05:30:00.000Z');
  assert.equal(dueOccurrence(schedule, new Date('2026-11-01T06:30:00Z')).id, first.id);
  assert.equal(dueOccurrence({ ...schedule, at: '02:30' }, new Date('2026-03-08T20:00:00Z')), null);
  assert.equal(dueOccurrence({ ...base, cadence: 'monthly', day: 31 }, new Date('2026-04-30T20:00:00Z')), null);
  assert.equal(dueOccurrence({ ...base, cadence: 'weekly', weekday: 0 }, new Date('2026-04-27T20:00:00Z')), null);
  assert.equal(dueOccurrence(base, new Date('2026-04-27T08:59:00Z')), null);
  assert.equal(dueOccurrence(base, new Date('2026-04-27T20:00:00Z'), { notBefore: '2026-04-27T10:00:00Z' }), null);
});

test('multiple times select only the latest eligible instant, including DST and calendar boundaries', () => {
  const schedule = { ...base, at: ['15:00', '09:00', '12:00'] };
  const at = (hour, extra = {}) => dueOccurrence({ ...schedule, ...extra }, new Date(`2026-04-27T${hour}:00Z`));
  assert.equal(at('08:59'), null);
  assert.equal(at('12:30').scheduledAt, '2026-04-27T12:00:00.000Z');
  assert.notEqual(at('12:30').id, at('16:00').id);
  assert.equal(at('16:00', { enabled: false }), null);
  assert.equal(at('16:00', { cadence: 'weekly', weekday: 0 }), null);
  assert.equal(at('16:00', { cadence: 'monthly', day: 28 }), null);
  assert.equal(dueOccurrence(schedule, new Date('2026-04-28T08:00:00Z')), null);
  assert.equal(dueOccurrence(schedule, new Date('2026-04-27T13:00:00Z'), { notBefore: '2026-04-27T12:30:00Z' }), null);
  const dst = { ...base, at: ['01:30', '02:30'], timezone: 'America/New_York' };
  assert.equal(dueOccurrence(dst, new Date('2026-11-01T05:30:00Z')).id,
    dueOccurrence(dst, new Date('2026-11-01T06:30:00Z')).id);
  assert.equal(dueOccurrence(dst, new Date('2026-03-08T20:00:00Z')).scheduledAt, '2026-03-08T06:30:00.000Z');
});

test('window checks stay within local hours, use an anchored interval and retain calendar/DST rules', () => {
  const schedule = { ...base, at: undefined, window: { start: '08:00', end: '17:30', everyMinutes: 60 } };
  const due = (hour, patch = {}) => dueOccurrence({ ...schedule, ...patch }, new Date(`2026-04-27T${hour}:00Z`));
  assert.equal(due('07:59'), null);
  assert.equal(due('08:00').scheduledAt, '2026-04-27T08:00:00.000Z');
  assert.equal(due('17:30').scheduledAt, '2026-04-27T17:00:00.000Z');
  assert.equal(due('17:31'), null);
  assert.equal(due('12:15', { enabled: false }), null);
  assert.equal(due('12:15', { cadence: 'weekly', weekday: 0 }), null);
  assert.equal(due('12:15', { cadence: 'monthly', day: 28 }), null);
  assert.equal(dueOccurrence(schedule, new Date('2026-04-27T12:15:00Z'),
    { notBefore: '2026-04-27T12:01:00Z' }), null);
  const dst = { ...schedule, timezone: 'America/New_York', window: { start: '01:30', end: '03:30', everyMinutes: 60 } };
  assert.equal(dueOccurrence(dst, new Date('2026-11-01T05:30:00Z')).id,
    dueOccurrence(dst, new Date('2026-11-01T06:30:00Z')).id);
  assert.equal(dueOccurrence(dst, new Date('2026-03-08T07:00:00Z')).scheduledAt, '2026-03-08T06:30:00.000Z');
  assert.equal(dueOccurrence(dst, new Date('2026-03-08T07:30:00Z')).scheduledAt, '2026-03-08T07:30:00.000Z');
});

test('multiple times and windows deduplicate across restart and single-time edits without replaying missed checks', async t => {
  const { HobkinRuntime } = await import('../src/cli/runtime.mjs');
  const h = await fixture(t);
  let now = '2026-04-27T09:00:00Z';
  let calls = 0;
  const options = {
    ...h,
    config,
    now: () => new Date(now),
    runHarness: async () => {
      calls++;
      return {
        status: 'completed',
        text: 'Checked',
      };
    },
  };
  let runtime = await HobkinRuntime.open(h.root, config);
  let runner = new HobkinRunner({ ...options, runtime });
  try {
    await runner.tick();
    await runtime.idle();
    assert.equal(calls, 1);
    await h.save({ ...h.schedule, at: ['09:00', '12:00', '15:00', '17:00'] });
    await runner.tick();
    await runtime.idle();
    assert.equal(calls, 1);
    now = '2026-04-27T16:00:00Z';
    await runner.tick();
    await runtime.idle();
    assert.equal(calls, 2); // Only 15:00, not the missed 12:00.
    await h.save({ ...h.schedule, at: undefined, window: { start: '09:00', end: '18:00', everyMinutes: 60 } });
    now = '2026-04-27T15:30:00Z';
    await runner.tick();
    await runtime.idle();
    assert.equal(calls, 2); // Changing the settings must not repeat 15:00.
    await runner.stop();
    await runtime.close();
    runtime = await HobkinRuntime.open(h.root, config);
    runner = new HobkinRunner({ ...options, runtime });
    await runner.tick();
    await runtime.idle();
    assert.equal(calls, 2);
    now = '2026-04-27T17:00:00Z';
    await runner.tick();
    await runtime.idle();
    assert.equal(calls, 3);
    await h.save({ ...h.schedule, enabled: false, at: ['18:00', '19:00'] });
    now = '2026-04-27T20:00:00Z';
    await runner.tick();
    await runtime.idle();
    assert.equal(calls, 3);
  } finally {
    await runner.stop();
    await runtime.close();
  }
});

test('a window expiring during admission cannot start a provider outside its hours', async t => {
  const h = await fixture(t, { at: undefined, window: { start: '09:00', end: '10:00', everyMinutes: 60 } });
  let now = '2026-04-27T09:30:00Z';
  let calls = 0;
  const dispatch = h.runtime.dispatch.bind(h.runtime);
  h.runtime.dispatch = (request, effect) => dispatch(request, signal => {
    now = '2026-04-27T10:01:00Z';
    return effect(signal);
  });
  const runner = new HobkinRunner({
    ...h,
    config,
    now: () => new Date(now),
    runHarness: async () => {
      calls++;
      return { status: 'completed', text: 'Late' };
    },
  });
  t.after(() => runner.stop());
  await runner.tick();
  await h.runtime.idle();
  assert.equal(calls, 0);
  const receipt = Object.values(h.runtime.data.runs)[0];
  assert.equal(receipt.status, 'incomplete');
  assert.equal(receipt.result.noModel, true);
});

test('upcoming occurrences respect admissions, windows and initialization without changing schedules', () => {
  const now = new Date('2026-04-27T10:15:00Z');
  const completed = [{
    id: 'old-single-time',
    scheduleId: 'check',
    scheduledAt: '2026-04-27T09:00:00.000Z',
    status: 'completed',
  }];
  const schedule = { ...base, at: undefined, window: { start: '09:00', end: '18:00', everyMinutes: 60 } };
  const original = structuredClone(schedule);

  assert.equal(nextOccurrence(base, now).scheduledAt, '2026-04-27T09:00:00.000Z');
  assert.equal(nextOccurrence(base, now, { runs: completed }).scheduledAt, '2026-04-28T09:00:00.000Z');
  assert.equal(nextOccurrence({ ...base, at: ['09:00', '12:00'] }, now, { runs: completed }).scheduledAt, '2026-04-27T12:00:00.000Z');
  assert.equal(nextOccurrence(schedule, new Date('2026-04-27T18:01:00Z')).scheduledAt, '2026-04-28T09:00:00.000Z');
  assert.equal(nextOccurrence(base, now, { notBefore: '2026-04-28T09:00:00Z' }).scheduledAt, '2026-04-29T09:00:00.000Z');
  assert.equal(nextOccurrence({ ...schedule, enabled: false }, now), null);
  assert.deepEqual(schedule, original);
});

test('upcoming dates preserve timezone transitions, weekly days and missing monthly dates', () => {
  const schedule = { ...base, timezone: 'America/Toronto', at: '02:30' };
  assert.equal(nextOccurrence(schedule, new Date('2026-03-08T05:00:00Z')).scheduledAt, '2026-03-09T06:30:00.000Z');
  const repeated = { ...schedule, at: '01:30' };
  const first = nextOccurrence(repeated, new Date('2026-11-01T04:00:00Z'));
  assert.equal(first.scheduledAt, '2026-11-01T05:30:00.000Z');
  assert.equal(nextOccurrence(repeated, new Date('2026-11-01T06:00:00Z'), {
    runs: [{ ...first, scheduleId: 'check', status: 'completed' }],
  }).scheduledAt, '2026-11-02T06:30:00.000Z');
  assert.equal(nextOccurrence({ ...base, cadence: 'monthly', day: 31 }, new Date('2026-04-01T00:00:00Z')).scheduledAt, '2026-05-31T09:00:00.000Z');
  assert.equal(nextOccurrence({ ...base, cadence: 'weekly', weekday: 5 }, new Date('2026-04-27T10:00:00Z')).scheduledAt, '2026-05-01T09:00:00.000Z');
});

test('weekday lists run Monday to Friday and skip the weekend', () => {
  const weekdays = { ...base, cadence: 'weekly', weekday: [1, 2, 3, 4, 5] };
  assert.equal(dueOccurrence(weekdays, new Date('2026-05-01T10:00:00Z')).scheduledAt, '2026-05-01T09:00:00.000Z');
  assert.equal(dueOccurrence(weekdays, new Date('2026-05-02T10:00:00Z')), null);
  assert.equal(dueOccurrence(weekdays, new Date('2026-05-03T10:00:00Z')), null);
  const friday = dueOccurrence(weekdays, new Date('2026-05-01T18:00:00Z'));
  assert.equal(nextOccurrence(weekdays, new Date('2026-05-01T18:00:00Z'), {
    runs: [{ ...friday, scheduleId: 'check', status: 'completed' }],
  }).scheduledAt, '2026-05-04T09:00:00.000Z');
  const window = { ...weekdays, at: undefined, window: { start: '09:00', end: '19:00', everyMinutes: 30 } };
  assert.equal(dueOccurrence(window, new Date('2026-04-27T19:00:30Z')).scheduledAt, '2026-04-27T19:00:00.000Z');
  assert.equal(dueOccurrence(window, new Date('2026-04-27T19:10:00Z')), null);
  assert.equal(dueOccurrence(window, new Date('2026-05-02T12:10:00Z')), null);
  assert.notEqual(dueOccurrence(window, new Date('2026-04-27T12:10:00Z')).id, dueOccurrence(window, new Date('2026-04-28T12:10:00Z')).id);
});

test('runner snapshots forecast only enabled, unblocked schedules and distinguish running work', async t => {
  const h = await fixture(t);
  await h.save({ ...h.schedule, id: 'paused', enabled: false });
  let now = new Date('2026-04-27T08:00:00Z');
  let changes = 0;
  const change = h.runtime.change.bind(h.runtime);
  h.runtime.change = async operation => { changes++; return change(operation); };
  const runner = new HobkinRunner({ ...h, config, now: () => now });
  t.after(() => runner.stop());
  await runner.tick();
  let snapshot = await runner.snapshot();
  assert.equal(snapshot.lastTick, now.toISOString());
  now = new Date(now.getTime() + 1000);
  await runner.tick();
  snapshot = await runner.snapshot();
  assert.equal(snapshot.lastTick, now.toISOString());
  assert.equal(changes, 0);
  assert.equal(snapshot.schedules.find(item => item.id === 'check').nextRun.at, '2026-04-27T09:00:00.000Z');
  assert.deepEqual(snapshot.schedules.find(item => item.id === 'paused').nextRun, { state: 'paused', at: null });
  h.runtime.data.runs.running = { scheduleId: 'check', status: 'running' };
  snapshot = await runner.snapshot();
  assert.deepEqual(snapshot.schedules.find(item => item.id === 'check').nextRun, { state: 'running', at: '2026-04-27T09:00:00.000Z' });
  delete h.runtime.data.runs.running;
  runner.loaded.errors.push({ path: h.schedule.path ?? join(h.root, 'routines/daily/check.md'), message: 'Missing context' });
  snapshot = await runner.snapshot();
  assert.deepEqual(snapshot.schedules.find(item => item.id === 'check').nextRun, { state: 'blocked', at: null });
  assert.equal(Object.keys(h.runtime.data.runs).length, 0);
});

test('a running recurring check keeps its next occurrence on the forecast', async t => {
  const h = await fixture(t, { at: undefined, window: { start: '09:00', end: '18:00', everyMinutes: 60 } });
  let now;
  const runner = new HobkinRunner({ ...h, config, now: () => now });
  t.after(() => runner.stop());
  const forecastWhileRunning = async (id, time, run) => {
    now = new Date(time);
    h.runtime.data.runs = { [id]: { id, scheduleId: 'check', status: 'running', ...run } };
    await runner.tick();
    return (await runner.snapshot()).schedules[0].nextRun;
  };

  const hourly = await forecastWhileRunning('check:2026-04-27:13:00', '2026-04-27T13:00:30Z', { scheduledAt: '2026-04-27T13:00:00.000Z' });
  assert.deepEqual(hourly, { state: 'running', at: '2026-04-27T14:00:00.000Z' });

  const lastOfDay = await forecastWhileRunning('check:2026-04-27:18:00', '2026-04-27T18:00:30Z', { scheduledAt: '2026-04-27T18:00:00.000Z' });
  assert.deepEqual(lastOfDay, { state: 'running', at: '2026-04-28T09:00:00.000Z' });

  const requested = await forecastWhileRunning('once:request', '2026-04-27T13:26:00Z', { trigger: 'manual' });
  assert.equal(requested.state, 'running');
  assert.ok(Date.parse(requested.at) <= Date.parse('2026-04-27T14:00:00.000Z'), `expected this hour or the next, got ${requested.at}`);
});

test('legacy forecasts use saved next runs but never hide uncertain earlier attempts', async t => {
  const h = await fixture(t);
  const runner = new HobkinRunner({ ...h, config, now: () => new Date('2026-04-27T08:00:00Z') });
  const task = { enabled: true, status: 'pending', nextRun: '2026-04-27T09:00:00Z' };
  runner.loaded.schedules = [{ ...h.schedule, cadence: 'compatibility', legacy: { legacy: task } }];
  assert.equal((await runner.snapshot()).schedules[0].nextRun.at, task.nextRun);
  h.runtime.data.runs.uncertain = {
    scheduleId: 'check',
    status: 'interrupted',
    finishedAt: '2026-04-26T09:00:00Z',
  };
  h.runtime.data.runs.later = {
    scheduleId: 'check',
    status: 'completed',
    finishedAt: '2026-04-26T10:00:00Z',
    result: { compatibilityTask: task },
  };
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, { state: 'blocked', at: null, reason: 'interrupted_attempt' });
  delete h.runtime.data.runs.uncertain;
  delete h.runtime.data.runs.later.result.compatibilityTask;
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, { state: 'blocked', at: null, reason: 'missing_final_receipt' });
  h.runtime.data.runs = {};
  task.status = 'failed';
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, { state: 'failed', at: null });
  task.status = 'pending';
  task.expiresAt = '2026-04-26T00:00:00Z';
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, { state: 'expired', at: null });
  delete task.expiresAt;
  task.nextRun = null;
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, { state: 'pending', at: null, reason: 'awaiting_scheduler' });
});

test('tick returns before completion, deduplicates and exposes durable full reports', async t => {
  const fixtureData = await fixture(t, {
    context: ['source'],
    prompt: 'Check the selected source and preserve the full instructions.',
  });
  await writeFile(join(fixtureData.root, 'source'), 'Selected source content');
  let finish;
  let dispatched;
  let calls = 0;
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: async request => {
      calls++;
      dispatched = request;
      assert.equal(fixtureData.runtime.data.runs['check:2026-04-27'].status, 'running');
      assert.match(request.id, /^[0-9a-f-]{36}$/);
      assert.equal(request.harness, 'pi');
      assert.equal(request.sessionFile, join(fixtureData.root, 'jobs', `${request.id}.jsonl`));
      assert.equal(fixtureData.runtime.data.runs['check:2026-04-27'].harness, 'pi');
      assert.equal(request.model, 'test');
      assert.equal(request.effort, 'high');
      return new Promise(resolve => { finish = resolve; });
    },
  });
  await writeFile(join(fixtureData.root, 'memory.md'), '- Rent is due November 1\n');

  await runner.tick();
  assert.equal(calls, 1);
  await runner.tick();
  assert.equal(calls, 1);

  finish({
    status: 'completed',
    text: 'Full findings',
    cost: null,
  });
  await fixtureData.runtime.idle();

  const envelope = JSON.parse(dispatched.prompt);
  assert.deepEqual(envelope.scope, {
    cwd: fixtureData.root,
    harness: 'pi',
    model: 'test',
    sources: ['source'],
  });
  assert.equal(envelope.reportId, 'check:2026-04-27', 'actions can link to the exact eventual report, not the harness session UUID');
  assert.equal(envelope.routine.instructions, fixtureData.schedule.prompt);
  assert.deepEqual(envelope.sources, [{ path: 'source', text: 'Selected source content' }]);
  assert.deepEqual(envelope.memory, ['Rent is due November 1']);
  const snapshot = await runner.snapshot();
  assert.equal(snapshot.reports[0].text, 'Full findings');

  await runner.tick();
  assert.equal(calls, 1);
  await runner.stop();
});

test('reload rejects malformed cached authority and unsafe/missing context before any dispatch', async t => {
  const fixtureData = await fixture(t);
  let calls = 0;
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: async () => {
      calls++;
      return { status: 'no_change' };
    },
  });

  await writeFile(join(fixtureData.root, 'routines/daily/check.md'), 'broken');
  await runner.tick();
  assert.equal(calls, 0);
  assert.equal((await runner.snapshot()).errors.length, 1);

  await fixtureData.save({ ...fixtureData.schedule, context: ['missing'] });
  await runner.tick();
  assert.equal(calls, 0);

  await writeFile(join(fixtureData.root, 'source'), 'source data');
  await symlink('source', join(fixtureData.root, 'link'));
  await fixtureData.save({ ...fixtureData.schedule, context: ['link'] });
  await runner.tick();
  assert.equal(calls, 0);

  await fixtureData.save({ ...fixtureData.schedule, context: ['source'] });
  await runner.tick();
  await fixtureData.runtime.idle();
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(fixtureData.runtime.data.runs), ['check:2026-04-27']);
});

test('capacity is bounded, schedule runs never overlap, and stop cancels only owned work', async t => {
  const fixtureData = await fixture(t);
  await fixtureData.save({ ...fixtureData.schedule, id: 'other' });
  let calls = 0;
  let date = new Date('2026-04-27T10:00:00Z');
  const runner = new HobkinRunner({
    ...fixtureData,
    config: { ...config, concurrency: 1 },
    now: () => date,
    runHarness: request => {
      calls++;
      return new Promise(resolve => {
        request.signal.addEventListener('abort', () => resolve({ status: 'interrupted' }), { once: true });
      });
    },
  });

  await Promise.all([runner.tick(), runner.tick()]);
  assert.equal(calls, 1);
  date = new Date('2026-04-28T10:00:00Z');
  await runner.tick();
  assert.equal(calls, 1);

  await runner.stop();
  assert.equal(Object.values(fixtureData.runtime.data.runs)[0].status, 'interrupted');
  assert.throws(() => new HobkinRunner({ ...fixtureData, config: { ...config, concurrency: 17 } }), /concurrency must be 1–16/);
});

test('sixteen routines run at once and the seventeenth waits for a place, and a saved four still reads as four', async t => {
  const h = await fixture(t);
  for (let n = 1; n < 17; n++) await h.save({ ...h.schedule, id: `check-${n}` });
  const started = [];
  const runner = new HobkinRunner({
    ...h,
    config: { ...config, concurrency: MOST_CONCURRENCY },
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: request => new Promise(resolve => {
      started.push({ resolve });
      request.signal.addEventListener('abort', () => resolve({ status: 'interrupted' }), { once: true });
    }),
  });
  t.after(() => runner.stop());
  const running = () => Object.values(h.runtime.data.runs).filter(run => run.status === 'running');
  const settled = async count => {
    for (let wait = 0; started.length < count && wait < 200; wait++) await new Promise(resolve => setTimeout(resolve, 5));
  };

  await runner.tick();
  await settled(16);
  await runner.tick();
  assert.equal(started.length, 16);
  assert.equal(running().length, 16, 'the seventeenth waits while all sixteen run');
  const routines = ['check', ...Array.from({ length: 16 }, (_, n) => `check-${n + 1}`)];
  const waiting = routines.find(id => !h.runtime.data.runs[`${id}:2026-04-27`]);
  await assert.rejects(runner.trigger(waiting, 'by-hand'), /Background capacity is full\./);

  started[0].resolve({ status: 'completed', text: 'ok' });
  for (let wait = 0; runner.jobs.size > 15 && wait < 200; wait++) await new Promise(resolve => setTimeout(resolve, 5));
  await runner.tick();
  await settled(17);
  assert.equal(started.length, 17, 'a place that frees takes the one that waited');
  assert.equal(h.runtime.data.runs[`${waiting}:2026-04-27`].status, 'running');

  const home = await realpath(await mkdtemp(join(tmpdir(), 'hobkin-limits-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const saved = initialize(home, { cwd: home, now: '2026-01-01T00:00:00Z' });
  assert.equal(validateConfig({ ...saved, concurrency: 4 }).concurrency, 4, 'a home that saved the old most keeps it');
  assert.equal(validateConfig({ ...saved, concurrency: 16 }).concurrency, 16);
  assert.throws(() => validateConfig({ ...saved, concurrency: 17 }), /execution limits/);
});

test('steering receipts require the exact completed user body and run, before or after ACK', { timeout: 2000 }, async t => {
  const runtime = new MemoryRuntime();
  const runner = new HobkinRunner({ runtime, root: '/unused', config, now: () => new Date(123) });
  const finish = Promise.withResolvers(), ack = Promise.withResolvers(), ready = Promise.withResolvers();
  const sent = [];
  runner.inboxes.set('run', { reject() {}, promise: Promise.resolve(async text => {
    sent.push(text);
    if (sent.length === 2) ready.resolve();
    return ack.promise;
  }) });
  const { work } = runner.startTracked({ id: 'run', scheduleId: 'check' }, () => finish.promise);
  t.after(async () => { ack.resolve({ disposition: 'queued' }); finish.resolve({ status: 'completed' }); await work; });
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const sends = ids.map(noteId => runner.messageCheck({ scheduleId: 'check', runId: 'run', noteId, message: 'Same words' }));
  await ready.promise;
  assert.notEqual(sent[0], sent[1]);
  const event = (content, type = 'message_end', role = 'user') => ({ type, message: { role, content } });
  for (const [run, record] of [['other', event(sent[0])], ['run', event(sent[0], 'message_start')],
    ['run', event(sent[0], 'message_end', 'assistant')], ['run', event('Same words')],
    ['run', event(`${sent[0]} extra`)], ['run', event(sent[0].replace(ids[0], '00000000-0000-4000-8000-000000000003'))],
    ['run', event([{ type: 'text', text: sent[0] }, { type: 'image', data: 'x' }])],
    ['run', { type: 'queue_update', steering: [] }]]) runner.onActivity(run, record);
  assert.deepEqual(runner.steeringReceipts(), {});
  runner.onActivity('run', event([{ type: 'text', text: sent[0].slice(0, 12) }, { type: 'text', text: sent[0].slice(12) }]));
  assert.deepEqual(runner.steeringReceipts(), { run: [{ noteId: ids[0], at: 123 }] });
  ack.resolve({ disposition: 'queued' });
  assert.ok((await Promise.all(sends)).every(result => result.status === 'queued'));
  runner.onActivity('run', event(sent[1]));
  assert.deepEqual(runner.steeringReceipts().run.map(note => note.noteId), ids);
  await assert.rejects(runner.messageCheck({ scheduleId: 'check', runId: 'old-run', noteId: ids[0], message: 'No redirect' }), /not running/);
  await assert.rejects(runner.messageCheck({ scheduleId: 'check', runId: 'run', noteId: ids[0], message: 'No reuse' }), /already/);
  assert.equal(sent.length, 2);
  const starting = Promise.withResolvers();
  runner.inboxes.set('run', starting);
  const late = runner.messageCheck({ scheduleId: 'check', runId: 'run', noteId: ids[1], message: 'No rollover' });
  await Promise.resolve();
  runtime.data.runs.run.status = 'completed';
  runtime.data.runs.replacement = { id: 'replacement', scheduleId: 'check', status: 'running' };
  starting.resolve(() => { throw Error('Must not send to ended run'); });
  await assert.rejects(late, /has finished/);
});

test('steering dispositions, pending limits and run-end cleanup stay bounded', { timeout: 2000 }, async t => {
  const runtime = new MemoryRuntime();
  const runner = new HobkinRunner({ runtime, root: '/unused', config });
  let response = { disposition: 'handled' }, marked;
  runner.inboxes.set('run', { reject() {}, promise: Promise.resolve(async text => { marked = text; if (response instanceof Error) throw response; return response; }) });
  const finish = Promise.withResolvers();
  const { work } = runner.startTracked({ id: 'run', scheduleId: 'check' }, () => finish.promise);
  t.after(async () => { finish.resolve({ status: 'completed' }); await work; });
  const send = index => runner.messageCheck({ scheduleId: 'check', runId: 'run', noteId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, message: 'Private' });
  assert.equal((await send(0)).status, 'handled');
  runner.onActivity('run', { type: 'message_end', message: { role: 'user', content: marked } });
  assert.deepEqual(runner.steeringReceipts(), {});
  response = Object.assign(Error('Rejected'), { commandRejected: true });
  await assert.rejects(send(0), error => error.notQueued === true);
  assert.equal(runner.pendingNotes.size, 0);
  response = Error('Connection lost');
  await assert.rejects(send(1), /Connection lost/);
  response = undefined;
  assert.equal((await send(2)).status, 'unconfirmed');
  response = { disposition: 'queued' };
  for (let index = 200; index <= 456; index++) {
    await send(index);
    runner.onActivity('run', { type: 'message_end', message: { role: 'user', content: marked } });
  }
  assert.equal(runner.steeringReceipts().run.length, 256);
  assert.equal(runner.steeringReceipts().run[0].noteId.endsWith('201'), true);
  for (let index = 3; index <= 128; index++) await send(index);
  await assert.rejects(send(129), /pending/);
  finish.resolve({ status: 'completed' });
  await work;
  assert.equal(runner.pendingNotes.size, 0);
  runner.onActivity('run', { type: 'message_end', message: { role: 'user', content: marked } });
  assert.equal(runner.steeringReceipts().run.length, 256);
});

test('a running check takes a message, and one that is not running says so', async t => {
  const fixtureData = await fixture(t);
  const received = [];
  const finish = Promise.withResolvers();
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: (_request, { onReady }) => {
      onReady(async text => { received.push(text); return { disposition: 'queued' }; });
      return finish.promise;
    },
  });
  t.after(() => { finish.resolve({ status: 'completed' }); return runner.stop(); });
  await assert.rejects(runner.messageCheck({ scheduleId: 'check', message: 'hello' }), /not running/);

  await runner.tick();

  assert.deepEqual(await runner.messageCheck({}), { running: [{ scheduleId: 'check', title: 'Check' }] });
  await assert.rejects(runner.messageCheck({ scheduleId: 'check' }), /what to tell/);
  assert.deepEqual(await runner.messageCheck({ scheduleId: 'check', message: 'look at the invoices' }), { scheduleId: 'check', status: 'queued' });
  assert.deepEqual(received, ['look at the invoices']);

  finish.resolve({ status: 'completed', text: 'Done' });
  await Promise.all(runner.jobs.values());

  assert.deepEqual(await runner.messageCheck({}), { running: [] });
});

test('a message to a running check takes the images the user attached, and its receipt counts them', { timeout: 2000 }, async t => {
  const runtime = new MemoryRuntime();
  const runner = new HobkinRunner({ runtime, root: '/unused', config, now: () => new Date(123) });
  const sent = [];
  runner.inboxes.set('run', { reject() {}, promise: Promise.resolve(async (text, images) => { sent.push({ text, images }); return { disposition: 'queued' }; }) });
  const finish = Promise.withResolvers();
  const { work } = runner.startTracked({ id: 'run', scheduleId: 'check' }, () => finish.promise);
  t.after(async () => { finish.resolve({ status: 'completed' }); await work; });
  const chart = { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' };
  const noteId = '00000000-0000-4000-8000-000000000001';

  assert.equal((await runner.messageCheck({ scheduleId: 'check', runId: 'run', noteId, message: 'See this', images: [chart] })).status, 'queued');
  assert.deepEqual(sent.at(-1).images, [chart]);
  // Words alone go as before, with no images.
  await runner.messageCheck({ scheduleId: 'check', message: 'Words alone' });
  assert.equal(sent.at(-1).images, undefined);

  // Anything that is not an image Pi can send, or more than a message holds, is refused and nothing goes.
  for (const images of [[{ ...chart, mimeType: 'image/tiff' }], [{ ...chart, data: '' }], [chart, chart, chart, chart, chart], 'chart']) {
    await assert.rejects(runner.messageCheck({ scheduleId: 'check', message: 'Bad', images }), error => error.notQueued === true);
  }
  assert.equal(sent.length, 2);

  // Pi's user message has the words and the image. The same words without it, or with two, are not this note.
  const marked = sent[0].text;
  const said = content => runner.onActivity('run', { type: 'message_end', message: { role: 'user', content } });
  said([{ type: 'text', text: marked }]);
  said([{ type: 'text', text: marked }, chart, chart]);
  assert.deepEqual(runner.steeringReceipts(), {});
  said([{ type: 'text', text: marked }, chart]);
  assert.deepEqual(runner.steeringReceipts(), { run: [{ noteId, at: 123 }] });
});

test('a message to a check that is still starting waits for it', async t => {
  const fixtureData = await fixture(t);
  const received = [];
  const ready = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: async (_request, { onReady }) => {
      await ready.promise;
      onReady(async text => { received.push(text); return { disposition: 'queued' }; });
      return finish.promise;
    },
  });
  t.after(() => { ready.resolve(); finish.resolve({ status: 'completed' }); return runner.stop(); });
  await runner.tick();

  const sent = runner.messageCheck({ scheduleId: 'check', message: 'hello' });
  ready.resolve();

  assert.deepEqual(await sent, { scheduleId: 'check', status: 'queued' });
  assert.deepEqual(received, ['hello']);
  finish.resolve({ status: 'completed', text: 'Done' });
  await Promise.all(runner.jobs.values());
});

test('a message to a check that ends before it starts fails instead of waiting forever', async t => {
  const fixtureData = await fixture(t);
  const failing = Promise.withResolvers();
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: () => failing.promise,
  });
  t.after(() => runner.stop());
  await runner.tick();

  const sent = runner.messageCheck({ scheduleId: 'check', message: 'hello' });
  failing.resolve({ status: 'failed', error: 'No credentials.' });

  await assert.rejects(sent, /has finished/);
});

test('kill stops only the named owned native run and keeps its schedule', async t => {
  const fixtureData = await fixture(t);
  await fixtureData.save({ ...fixtureData.schedule, id: 'other' });
  const held = request => new Promise(resolve => {
    request.signal.addEventListener('abort', () => resolve({ status: 'interrupted', error: 'Harness cancelled.' }), { once: true });
  });
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: held,
  });
  t.after(() => runner.stop());
  await runner.tick();
  fixtureData.runtime.data.runs.main = { id: 'main', kind: 'main', status: 'running' };
  runner.jobs.set('legacy', fixtureData.runtime.dispatch({ id: 'legacy', kind: 'background', legacy: true }, signal => held({ signal })));

  assert.equal(await runner.kill('main'), false);
  assert.equal(await runner.kill('unknown'), false);
  fixtureData.runtime.cancel = async () => { throw Error('Cancellation unavailable'); };
  await assert.rejects(runner.kill('other:2026-04-27'), /Cancellation unavailable/);
  delete fixtureData.runtime.cancel;
  assert.equal(await runner.kill('check:2026-04-27'), true);
  assert.equal(await runner.kill('check:2026-04-27'), false);

  const runs = fixtureData.runtime.data.runs;
  assert.deepEqual(['check:2026-04-27', 'other:2026-04-27', 'legacy', 'main'].map(id => runs[id].status),
    ['interrupted', 'running', 'running', 'running']);
  const { nextRun } = (await runner.snapshot()).schedules.find(item => item.id === 'check');
  assert.deepEqual(nextRun, { state: 'scheduled', at: '2026-04-28T09:00:00.000Z' });
});

test('kill interrupts only the named compatibility attempt and keeps explicit reconciliation', async t => {
  const { HobkinRuntime } = await import('../src/cli/runtime.mjs');
  const h = await fixture(t);
  await mkdir(join(h.root, 'routines/compatibility'));
  const files = [];
  for (const action of ['prompt', 'shell']) {
    const task = { id: `task_${action}`, action, prompt: 'Check', command: 'synthetic', enabled: true, status: 'pending' };
    files.push(join(h.root, `routines/compatibility/${action}.json`));
    await writeFile(files.at(-1), JSON.stringify({
      version: 1,
      id: `legacy-${action}`,
      role: 'routine',
      session: { sessionId: action, sessionFile: join(h.root, `${action}.jsonl`), cwd: h.root },
      source: { sha256: sha256(JSON.stringify(task)) },
      control: { started: true },
      compatibility: { synthetic: true },
      legacy: task,
    }));
  }
  const saved = await Promise.all(files.map(file => readFile(file)));
  const calls = [];
  const started = Object.fromEntries(['check', 'prompt', 'shell'].map(kind => [kind, Promise.withResolvers()]));
  const hold = (kind, outcome) => ({ signal }) => {
    calls.push(kind);
    started[kind].resolve();
    return new Promise(resolve => signal.addEventListener('abort', () => resolve(outcome), { once: true }));
  };
  const adapter = new LegacySchedules({
    engine: {
      // Like the pinned engine, no helper operation starts after cancellation.
      request: async (_binding, _operation, { task, now }, signal) => {
        if (signal?.aborted) throw Error('Compatibility operation cancelled.');
        return { task, dueAt: now };
      },
    },
    handlers: {
      prompt: hold('prompt', { status: 'interrupted', error: 'Harness cancelled.', cost: null }),
      shell: hold('shell', { code: null, killed: true, interrupted: true, stdout: '', stderr: '' }),
    },
  });
  const limits = { ...config, concurrency: 3 };
  const runtime = await HobkinRuntime.open(h.root, limits);
  let now = new Date('2026-04-27T10:00:00Z');
  const runner = new HobkinRunner({
    ...h, runtime, config: limits, now: () => now, compatibility: adapter,
    runHarness: hold('check', { status: 'interrupted', error: 'Harness cancelled.' }),
  });
  const [prompt, shell] = ['prompt', 'shell'].map(action => `legacy-${action}:2026-04-27T10:00:00.000Z`);
  try {
    await runner.tick();
    await Promise.all(Object.values(started).map(item => item.promise));
    const tracked = [shell, prompt].map(id => runner.jobs.get(id));
    assert.equal(await runner.kill(shell), true);
    let { runs } = await runtime.state();
    assert.deepEqual([shell, prompt, 'check:2026-04-27'].map(id => runs[id].status), ['interrupted', 'running', 'running']);
    assert.equal(await runner.kill(prompt), true);
    assert.equal(await runner.kill(prompt), false);
    await Promise.all(tracked);

    ({ runs } = await runtime.state());
    assert.deepEqual([shell, prompt].map(id => [runs[id].status, runs[id].result.error, runs[id].result.compatibilityTask]), [
      ['interrupted', 'Compatibility operation cancelled.', undefined],
      ['interrupted', 'Harness cancelled.', undefined],
    ]);
    assert.equal(runs['check:2026-04-27'].status, 'running');
    const { schedules } = await runner.snapshot();
    assert.deepEqual(schedules.filter(item => item.legacy).map(item => item.nextRun),
      Array(2).fill({ state: 'blocked', at: null, reason: 'interrupted_attempt' }));
    now = new Date('2026-04-28T10:00:00Z');
    await runner.tick();
    assert.deepEqual(calls.toSorted(), ['check', 'prompt', 'shell']);
    assert.equal(runner.loaded.errors.filter(error => /explicit reconciliation/.test(error.message)).length, 2);
    assert.deepEqual(await Promise.all(files.map(file => readFile(file))), saved);
  } finally {
    await runner.stop();
    await runtime.close();
  }
});

test('context file and total envelope limits fail closed without provider use', async t => {
  const fixtureData = await fixture(t, { context: ['large'] });
  await writeFile(join(fixtureData.root, 'large'), 'x'.repeat(33000));
  let calls = 0;
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: async () => { calls++; },
  });

  await runner.tick();
  assert.equal(calls, 0);
  assert.equal(Object.keys(fixtureData.runtime.data.runs).length, 0);
  assert.match((await runner.snapshot()).errors[0].message, /limit|large/);

  await writeFile(join(fixtureData.root, 'large'), 'x'.repeat(32768));
  await fixtureData.save({ ...fixtureData.schedule, context: ['large', 'large'] });
  await runner.tick();
  assert.equal(calls, 0);
  assert.match((await runner.snapshot()).errors[0].message, /envelope/);
});

test('real durable receipts and ordinary reports survive reopening without rerunning', async t => {
  const { HobkinRuntime } = await import('../src/cli/runtime.mjs');
  const fixtureData = await fixture(t);
  let calls = 0;
  const options = {
    root: fixtureData.root,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: async () => {
      calls++;
      return {
        status: 'completed',
        text: 'Nothing new',
        cost: null,
      };
    },
  };
  let runtime = await HobkinRuntime.open(fixtureData.root, config);
  let runner = new HobkinRunner({ ...options, runtime });
  try {
    await runner.tick();
    await runtime.idle();
    await runner.stop();
  } finally {
    await runtime.close();
  }

  runtime = await HobkinRuntime.open(fixtureData.root, config);
  runner = new HobkinRunner({ ...options, runtime });
  try {
    await runner.tick();
    await runtime.idle();
    const snapshot = await runner.snapshot();
    assert.equal(calls, 1);
    assert.equal(snapshot.runs[0].result.text, 'Nothing new');
    assert.equal(snapshot.reports[0].text, 'Nothing new');
    assert.equal(snapshot.runs[0].status, 'completed');
    await runner.stop();
  } finally {
    await runtime.close();
  }
});

test('a definition changed after reservation cannot use the old provider authority', async t => {
  const fixtureData = await fixture(t);
  let calls = 0;
  const dispatch = fixtureData.runtime.dispatch.bind(fixtureData.runtime);
  fixtureData.runtime.dispatch = (request, effect) => dispatch(request, async signal => {
    await writeFile(join(fixtureData.root, 'routines/daily/check.md'), 'broken');
    return effect(signal);
  });
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: async () => { calls++; },
  });

  await runner.tick();
  await fixtureData.runtime.idle();

  assert.equal(calls, 0);
  assert.equal(Object.values(fixtureData.runtime.data.runs)[0].status, 'failed');
});

test('start is idempotent and a running schedule cannot overlap on a later date', async t => {
  const fixtureData = await fixture(t);
  let calls = 0;
  let date = new Date('2026-04-27T10:00:00Z');
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => date,
    runHarness: request => {
      calls++;
      return new Promise(resolve => {
        request.signal.addEventListener('abort', () => resolve({ status: 'interrupted' }), { once: true });
      });
    },
  });

  runner.start();
  const timer = runner.timer;
  runner.start();
  assert.equal(runner.timer, timer);
  await runner.tick();
  assert.equal(calls, 1);

  date = new Date('2026-04-28T10:00:00Z');
  await runner.tick();
  assert.equal(calls, 1);

  await runner.stop();
  assert.equal(runner.timer, null);
  await runner.tick();
  assert.equal(calls, 1);
  assert.throws(() => runner.start(), /stopped/);
});

test('directory context and nested symlinks cannot cross explicit source permissions', async t => {
  const fixtureData = await fixture(t);
  await mkdir(join(fixtureData.root, 'folder'));
  await writeFile(join(fixtureData.root, 'folder/source'), 'data');
  await symlink('folder', join(fixtureData.root, 'alias'));
  let calls = 0;
  const runner = new HobkinRunner({
    ...fixtureData,
    config,
    now: () => new Date('2026-04-27T10:00:00Z'),
    runHarness: async () => { calls++; },
  });

  for (const context of [['folder'], ['alias/source'], ['../escape']]) {
    await fixtureData.save({ ...fixtureData.schedule, context });
    await runner.tick();
    assert.equal(calls, 0);
    assert.ok((await runner.snapshot()).errors.length);
  }
});

test('a routine changed through the runner shows in its snapshot at once, without waiting for a tick', async t => {
  const h = await fixture(t);
  const runner = new HobkinRunner({ ...h, config, now: () => new Date('2026-01-02T08:00:00Z'), runHarness: async () => ({ status: 'completed', text: 'Done' }) });
  await runner.tick();

  await runner.change('check', { enabled: false });
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, { state: 'paused', at: null });
  await runner.change('check', { enabled: true, at: '10:00' });
  assert.deepEqual((await runner.snapshot()).schedules[0].nextRun, { state: 'scheduled', at: '2026-01-02T10:00:00.000Z' });
  await assert.rejects(runner.change('check', { at: '25:00' }), { message: 'at must be HH:mm or a list of 1–48 unique HH:mm times' });
  assert.equal((await runner.snapshot()).schedules[0].at, '10:00');
});
