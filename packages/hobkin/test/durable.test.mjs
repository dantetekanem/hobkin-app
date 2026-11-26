import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableHobkin } from '../src/durable.ts';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hobkin-durable-'));
  const opened = [];
  const owner = { sessionId: 'owner', sessionFile: join(dir, 'owner.jsonl') };
  t.after(async () => {
    for (const runtime of opened) await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, owner, async open(candidate = owner, configured = true) {
    const runtime = await DurableHobkin.open(dir, candidate, configured);
    opened.push(runtime);
    return runtime;
  } };
}
const controls = calls => ({
  daily: async action => { calls.push(`daily:${action}`); },
  routines: async action => { calls.push(`routines:${action}`); },
});

test('real Durable SQLite retains the owner and setup receipt without any model configuration', async t => {
  const h = fixture(t), calls = [];
  const first = await h.open();
  await first.control('start', controls(calls));
  assert.equal(await first.claimSetup(), false);
  await first.close();
  const resumed = await h.open({ sessionId: 'other', sessionFile: join(h.dir, 'other.jsonl') }, false);
  assert.deepEqual((await resumed.state()).owner, h.owner);
  await resumed.recover(controls(calls));
  assert.deepEqual(calls, ['daily:start', 'routines:start']);
  assert.equal((await resumed.state()).active, true);
  assert.equal(await resumed.claimSetup(), false);
  assert.equal(statSync(join(h.dir, 'hobkin.sqlite')).mode & 0o777, 0o600);
});

test('cold setup is reserved once and an interrupted dispatch is not blindly replayed', async t => {
  const h = fixture(t), runtime = await h.open(h.owner, false);
  assert.equal(await runtime.claimSetup(), true);
  await runtime.close();
  const resumed = await h.open();
  assert.equal(await resumed.claimSetup(), false);
  assert.equal((await resumed.state()).setup, 'requested');
});

test('a second runtime cannot own the same storage until the first closes', async t => {
  const h = fixture(t), runtime = await h.open();
  await assert.rejects(h.open(), /already running|locked/i);
  await runtime.close();
  await h.open();
});

test('close and reopen resume only the unfinished control phase and reconcile its receipt', async t => {
  const h = fixture(t), runtime = await h.open(), calls = [];
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let effects = 0, receipt = false;
  const running = runtime.control('start', {
    daily: async action => { calls.push(`daily:${action}`); },
    routines: async (_action, signal) => {
      if (!receipt) { effects++; receipt = true; }
      entered();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  });
  const rejected = assert.rejects(running);
  await ready;
  await runtime.close();
  await rejected;
  const resumed = await h.open();
  await resumed.recover({
    daily: async () => { calls.push('repeated daily'); },
    routines: async () => { if (!receipt) effects++; calls.push('reconciled routines'); },
  });
  assert.deepEqual(calls, ['daily:start', 'reconciled routines']);
  assert.equal(effects, 1);
  assert.equal((await resumed.state()).active, true);
});

test('recovery resumes the same phase after five unclean exits without repeating receipted effects', { timeout: 30000 }, async t => {
  const h = fixture(t);
  const childSource = `
    import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { DurableHobkin } from ${JSON.stringify(new URL('../src/durable.ts', import.meta.url).href)};
    const dir = process.argv[1];
    const runtime = await DurableHobkin.open(dir, {
      sessionId: 'owner', sessionFile: join(dir, 'owner.jsonl'),
    }, true);
    const controls = {
      daily: async () => appendFileSync(join(dir, 'daily.log'), 'daily\\n'),
      routines: async () => {
        const receipt = join(dir, 'routine.receipt');
        if (!existsSync(receipt)) {
          appendFileSync(join(dir, 'effects.log'), 'routine\\n');
          writeFileSync(receipt, 'applied');
        }
        appendFileSync(join(dir, 'attempts.log'), 'routines\\n');
        // Exit before Durable commits phase completion, without closing its harness.
        process.exit(0);
      },
    };
    if ((await runtime.state()).taskId === null) await runtime.control('start', controls);
    else await runtime.recover(controls);
  `;

  for (let crash = 0; crash < 5; crash++) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource, h.dir], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(child.error, undefined, child.stderr);
    assert.equal(child.status, 0, child.stderr);
  }
  assert.equal(readFileSync(join(h.dir, 'attempts.log'), 'utf8'), 'routines\n'.repeat(5));

  const resumed = await h.open();
  const calls = [];
  let deadline;
  try {
    await Promise.race([
      resumed.recover({
        daily: async () => assert.fail('completed daily phase repeated'),
        routines: async () => {
          assert.equal(readFileSync(join(h.dir, 'routine.receipt'), 'utf8'), 'applied');
          calls.push('reconciled routines');
        },
      }),
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(Error('recovery did not resume after five crashes')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
  assert.deepEqual(calls, ['reconciled routines']);
  assert.equal(readFileSync(join(h.dir, 'daily.log'), 'utf8'), 'daily\n');
  assert.equal(readFileSync(join(h.dir, 'effects.log'), 'utf8'), 'routine\n');
  assert.equal((await resumed.state()).active, true);
  assert.deepEqual((await resumed.state()).owner, h.owner);
  await resumed.close();
  const reopened = await h.open();
  await reopened.recover(controls(calls));
  assert.deepEqual(calls, ['reconciled routines']);
});

test('recovery finishes an interrupted routine stop and retains the earlier daily failure', async t => {
  const h = fixture(t);
  const runtime = await h.open();
  await runtime.control('start', controls([]));
  let entered;
  const routineEntered = new Promise(resolve => { entered = resolve; });
  const stopping = runtime.control('stop', {
    daily: async () => { throw Error('daily wake changed'); },
    routines: async (_action, signal) => {
      entered();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  });
  const rejected = assert.rejects(stopping);
  await Promise.race([routineEntered, stopping]);
  await runtime.close();
  await rejected;

  const resumed = await h.open();
  const calls = [];
  await assert.rejects(resumed.recover(controls(calls)), /daily wake changed/);
  assert.deepEqual(calls, ['routines:stop']);
  assert.equal((await resumed.state()).active, false);
  await resumed.close();
  const settled = await h.open();
  await assert.rejects(settled.recover(controls(calls)), /daily wake changed/);
  assert.deepEqual(calls, ['routines:stop']);
});

test('stop persists failures from both controls while start remains fail-fast', async t => {
  const h = fixture(t);
  const runtime = await h.open();
  const calls = [];
  const failing = {
    daily: async action => { calls.push(`daily:${action}`); throw Error('daily unavailable'); },
    routines: async action => { calls.push(`routines:${action}`); throw Error('routines unavailable'); },
  };
  await assert.rejects(runtime.control('start', failing), /daily unavailable/);
  assert.deepEqual(calls, ['daily:start']);
  await assert.rejects(runtime.control('stop', failing), /daily unavailable.*routines unavailable/);
  assert.deepEqual(calls, ['daily:start', 'daily:stop', 'routines:stop']);
  assert.equal((await runtime.state()).active, false);
  await runtime.close();

  const resumed = await h.open();
  await assert.rejects(resumed.recover(controls(calls)), /daily unavailable.*routines unavailable/);
  assert.deepEqual(calls, ['daily:start', 'daily:stop', 'routines:stop']);
});

test('stop cancels an in-flight start before running its own controls', async t => {
  const h = fixture(t), runtime = await h.open(), calls = [];
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const starting = runtime.control('start', {
    daily: async (_action, signal) => {
      entered();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    routines: async () => assert.fail('cancelled start reached routines'),
  });
  const cancelled = assert.rejects(starting, /aborted/);
  await ready;
  await runtime.control('stop', controls(calls));
  await cancelled;
  assert.deepEqual(calls, ['daily:stop', 'routines:stop']);
  assert.equal((await runtime.state()).active, false);
});

test('an explicit stop supersedes an interrupted start instead of replaying its enable phase', async t => {
  const h = fixture(t), runtime = await h.open();
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const running = runtime.control('start', {
    daily: async (_action, signal) => {
      entered();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    routines: async () => assert.fail('interrupted start must not reach routines'),
  });
  const rejected = assert.rejects(running);
  await ready;
  await runtime.close();
  await rejected;
  const resumed = await h.open(), calls = [];
  await resumed.control('stop', controls(calls));
  assert.deepEqual(calls, ['daily:stop', 'routines:stop']);
  assert.equal((await resumed.state()).active, false);
  await resumed.close();
  const stopped = await h.open();
  await stopped.recover(controls(calls));
  assert.equal((await stopped.state()).active, false);
  assert.equal(calls.length, 2);
});
