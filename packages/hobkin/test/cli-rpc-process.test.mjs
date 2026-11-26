import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { startRpcProcess } from '../src/cli/rpc-process.mjs';

function standIn() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: undefined, signals: [],
  });
  child.kill = signal => {
    child.signals.push(signal);
    child.finish(null, signal);
    return true;
  };
  child.finish = (code = 0, signal = null) => {
    child.stdout.end();
    setImmediate(() => child.emit('close', code, signal));
  };
  return child;
}
function start(child, options = {}) {
  const records = [];
  const handle = startRpcProcess({
    command: 'pi', args: [], cwd: '/', spawnProcess: () => child, onRecord: record => records.push(record), ...options,
  });
  return { handle, records };
}

test('records are LF-delimited whatever the chunking, including multi-byte text, CRLF and a final record without LF', async () => {
  const child = standIn();
  const { handle, records } = start(child);
  const bytes = Buffer.from([
    JSON.stringify({ type: 'a', text: 'caf\u00e9 \u2028 \u65e5\u672c\u8a9e' }),
    '\r\n\n   \n',
    JSON.stringify({ type: 'b' }),
    '\n',
    JSON.stringify({ type: 'c' }),
  ].join(''));
  for (let index = 0; index < bytes.length; index += 3) child.stdout.write(bytes.subarray(index, index + 3));
  child.finish(0);
  const { error } = await handle.closed;
  assert.deepEqual(records.map(record => record.type), ['a', 'b', 'c']);
  assert.equal(records[0].text, 'caf\u00e9 \u2028 \u65e5\u672c\u8a9e');
  assert.match(error.message, /exited before completion \(0\)/);
});

test('a large healthy record is framed in linear time and one over the limit stops the child', async () => {
  const healthy = standIn();
  const { handle, records } = start(healthy, { maxRecordBytes: 8 * 1024 * 1024 });
  const record = `${JSON.stringify({ type: 'big', text: 'x'.repeat(6 * 1024 * 1024) })}\n`;
  const started = Date.now();
  const bytes = Buffer.from(record);
  for (let index = 0; index < bytes.length; index += 65536) healthy.stdout.write(bytes.subarray(index, index + 65536));
  healthy.finish(0);
  await handle.closed;
  assert.equal(records.length, 1);
  assert.equal(records[0].text.length, 6 * 1024 * 1024);
  assert.ok(Date.now() - started < 3000, 'framing does not rescan the accumulated record');

  const hostile = standIn();
  const failures = [];
  const second = start(hostile, { maxRecordBytes: 1024, onFail: error => failures.push(error) });
  hostile.stdout.write(`${'x'.repeat(600)}`);
  hostile.stdout.write(`${'x'.repeat(600)}\n`);
  const { error } = await second.handle.closed;
  assert.match(error.message, /record exceeded its byte limit/);
  assert.equal(failures.length, 1);
  assert.deepEqual(hostile.signals, ['SIGTERM']);
});

test('responses are matched by id, a refusal is marked, and the response callback runs before later records', async () => {
  const child = standIn();
  const { handle, records } = start(child);
  const first = handle.request('get_state');
  const order = [];
  const second = handle.request('prompt', { message: 'x' }, data => order.push(['response', data, records.length]));
  const third = handle.request('abort');
  const sent = [];
  child.stdin.on('data', chunk => sent.push(...String(chunk).trim().split('\n').map(line => JSON.parse(line))));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.map(({ id, type }) => [id, type]), [['hobkin-1', 'get_state'], ['hobkin-2', 'prompt'], ['hobkin-3', 'abort']]);
  child.stdout.write([
    { type: 'response', id: 'hobkin-3', command: 'abort', success: false, error: 'Nothing to abort\u0007' },
    { type: 'response', id: 'hobkin-2', command: 'prompt', success: true, data: { disposition: 'started' } },
    { type: 'agent_start' },
    { type: 'response', id: 'hobkin-1', command: 'get_state', success: true, data: { ok: true } },
  ].map(record => `${JSON.stringify(record)}\n`).join(''));
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { disposition: 'started' });
  await assert.rejects(third, error => error.commandRejected === true && error.message === 'Nothing to abort');
  assert.deepEqual(order, [['response', { disposition: 'started' }, 1]], 'only the abort refusal had been read before it');
  assert.deepEqual(records.map(record => record.type), ['response', 'response', 'agent_start', 'response']);
  child.finish(0);
  await handle.closed;
});

test('closing stdin asks the child to exit, signals only after the grace period, and later commands are refused cleanly', { timeout: 5000 }, async t => {
  // PassThrough streams do not keep the child's unref'ed shutdown timer alive.
  const keepAlive = setTimeout(() => {}, 5000);
  t.after(() => clearTimeout(keepAlive));
  const polite = standIn();
  polite.stdin.on('end', () => polite.finish(0));
  polite.stdin.resume();
  const first = start(polite);
  await first.handle.shutdown(1000);
  assert.deepEqual(polite.signals, []);
  await assert.rejects(first.handle.request('get_state'), /exited/);
  assert.equal(first.handle.failure, undefined);

  const stubborn = standIn();
  const second = start(stubborn);
  const pending = second.handle.request('get_state');
  const settled = assert.rejects(pending, /exited before completion/);
  await second.handle.shutdown(20);
  await settled;
  assert.deepEqual(stubborn.signals, ['SIGTERM']);
  assert.equal(second.handle.exited, true);
  second.handle.send({ type: 'extension_ui_response', id: 'late', cancelled: true });
});

test('TERM-ignore escalates to KILL without treating either signal as a close receipt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = standIn(), signals = [];
  const { handle } = start(child, { signalProcess: (captured, signal) => { assert.equal(captured, child); signals.push(signal); } });
  t.after(() => child.emit('close', null, 'SIGKILL'));
  let closed = false;
  handle.closed.then(() => { closed = true; });
  handle.terminate();
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(500);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  await Promise.resolve();
  assert.equal(closed, false);
  child.emit('close', null, 'SIGKILL');
  await handle.closed;
  handle.terminate();
  assert.equal(signals.length, 2);
});

test('a captured close cancels TERM escalation without claiming detached cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = standIn(), signals = [];
  const { handle } = start(child, { signalProcess: (_child, signal) => signals.push(signal) });
  t.after(() => child.emit('close', 0, null));
  handle.terminate(); child.emit('close', 0, null); await handle.closed;
  t.mock.timers.tick(500); handle.force();
  assert.deepEqual(signals, ['SIGTERM']);
});

test('exit revokes Force, timers and exit-reaping authority while close remains unconfirmed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['idle', 'grace', 'term']) {
    const child = standIn(), signals = [];
    const { handle } = start(child, { signalProcess: (_child, signal) => signals.push(signal) });
    t.after(() => child.emit('close', 0, null));
    let closed = false;
    handle.closed.then(() => { closed = true; });
    if (mode === 'grace') void handle.shutdown(1000);
    if (mode === 'term') handle.terminate();
    child.emit('exit', 0, null);
    t.mock.timers.tick(5000);
    handle.terminate(); handle.force();
    process.listeners('exit').find(listener => listener.name === 'reapAtExit')();
    await Promise.resolve();
    assert.deepEqual({ signals, reaped: child.signals, closed }, {
      signals: mode === 'term' ? ['SIGTERM'] : [], reaped: [], closed: false,
    }, mode);
    assert.equal(handle.exited, true);
    child.emit('close', 0, null);
    const receipt = await handle.closed;
    assert.equal(receipt.code, 0);
    assert.equal(closed, true);
    handle.force();
    assert.deepEqual(signals, mode === 'term' ? ['SIGTERM'] : []);
  }
});

test('a childless spawn error still settles on close without an exit event', async () => {
  const child = standIn(), error = Error('spawn failed');
  const { handle } = start(child, { signalProcess: () => {} });
  child.emit('error', error);
  child.emit('close', -2, null);
  assert.equal((await handle.closed).error, error);
  assert.equal(handle.exited, true);
});

test('Force bypasses grace and the TERM latch, interrupts RPC, and never signals a closed child', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const duringTerm of [false, true]) {
    const child = standIn(), signals = [];
    const { handle, records } = start(child, { signalProcess: (_child, signal) => signals.push(signal) });
    t.after(() => child.emit('close', null, 'SIGKILL'));
    const pending = assert.rejects(handle.request('abort'), error => error.interrupted === true);
    pending.catch(() => {}); // Keep cleanup from leaking a second failure if Force is absent.
    if (duringTerm) handle.terminate();
    else void handle.shutdown(2000);
    assert.equal(handle.force(), undefined, 'a signal request is not a close receipt');
    assert.deepEqual(signals, duringTerm ? ['SIGTERM', 'SIGKILL'] : ['SIGKILL']);
    await pending;
    assert.equal(handle.exited, false);
    child.stdout.write('{"type":"message_end","text":"late"}\n');
    assert.deepEqual(records, []);
    await assert.rejects(handle.request('get_state'), error => error.interrupted === true);
    child.emit('close', null, 'SIGKILL');
    await handle.closed;
    handle.force();
    t.mock.timers.tick(5000);
    assert.equal(signals.length, duringTerm ? 2 : 1);
  }
});

test('stderr is kept as a bounded tail for the exit error and invalid output ends the child', async () => {
  const failing = standIn();
  const { handle } = start(failing);
  failing.stderr.write('x'.repeat(5000));
  failing.stderr.write('last words\u0001');
  await new Promise(resolve => setImmediate(resolve));
  failing.finish(2);
  const { error } = await handle.closed;
  assert.match(error.message, /exited before completion \(2\)\. x+last words$/);
  assert.ok(handle.stderr.length <= 2000);

  const garbled = standIn();
  const second = start(garbled);
  garbled.stdout.write('{broken\n');
  assert.match((await second.handle.closed).error.message, /Invalid harness output/);
  const untyped = standIn();
  const third = start(untyped);
  untyped.stdout.write('[1]\n');
  assert.match((await third.handle.closed).error.message, /Invalid harness event/);
});
