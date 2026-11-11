import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { startRpcProcess } from '../src/cli/rpc-process.mjs';
import { attachUserBash } from '../src/cli/user-bash.mjs';
import { PiRpcSession } from '../src/cli/rpc-session.mjs';

const command = ' printf exact\nbytes ';
const result = { output: 'partial', exitCode: 7, cancelled: true, truncated: true, fullOutputPath: '/fake/output' };
const forbidden = () => { throw Error('Unexpected model or shell executor'); };

test('SDK user bash intercepts before native execution and preserves command, id and operations', { timeout: 1000 }, async () => {
  const calls = [];
  const operations = {};
  const session = attachUserBash({
    prompt: forbidden, steer: forbidden,
    sessionManager: { getCwd: () => '/fake/cwd' },
    extensionRunner: { emitUserBash: async event => { calls.push(event); return { operations }; } },
    executeBash: async (...args) => { calls.push(args); return result; },
  });
  assert.equal(await session.executeUserBash(command, { id: 'public-id' }), result);
  assert.deepEqual(calls, [{ type: 'user_bash', command, excludeFromContext: false, cwd: '/fake/cwd' },
    [command, undefined, { id: 'public-id', operations }]]);
});

test('SDK intercepted result records once; interception errors never fall back', { timeout: 1000 }, async () => {
  const records = [];
  const session = attachUserBash({
    prompt: forbidden, steer: forbidden, executeBash: forbidden,
    sessionManager: { getCwd: () => '/fake/cwd' },
    extensionRunner: { emitUserBash: async () => ({ result }) },
    recordBashResult: (...args) => records.push(args),
  });
  assert.equal(await session.executeUserBash(command, { id: 'public-id' }), result);
  assert.deepEqual(records, [[command, result]]);
  session.extensionRunner.emitUserBash = async () => { throw Error('policy refused'); };
  await assert.rejects(session.executeUserBash(command), /policy refused/);
  assert.equal(records.length, 1);
});

test('RPC native bash keeps real result, refreshes messages and aborts without a model turn', { timeout: 1000 }, async () => {
  const session = new PiRpcSession({});
  const calls = [];
  const native = { role: 'bashExecution', command, ...result };
  session.child = { request: async (type, data) => {
    calls.push([type, data]);
    if (type === 'bash') return result;
    if (type === 'get_state') return { sessionId: 'fake', isStreaming: false };
    if (type === 'get_messages') return { messages: [native] };
    if (type === 'get_session_stats') return {};
    if (type === 'abort_bash') return {};
    forbidden();
  } };
  assert.equal(await session.executeUserBash(command, { id: 'public-id' }), result);
  assert.deepEqual(session.messages, [native]);
  await session.abortBash();
  assert.deepEqual(calls.map(([type]) => type), ['bash', 'get_state', 'get_messages', 'get_session_stats', 'abort_bash']);
  assert.deepEqual(calls[0][1], { command });
});

test('RPC maps only exact live wire bash ids and rejects metadata errors before sending', { timeout: 1000 }, async () => {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const session = new PiRpcSession({});
  const sent = [], events = [];
  process.stdin.on('data', bytes => sent.push(JSON.parse(bytes)));
  const child = startRpcProcess({ spawnProcess: () => process, onRecord: record => session.accept(record) });
  session.attach(child);
  session.pull = async () => {};
  session.subscribe(event => events.push(event));
  const update = id => process.stdout.write(`${JSON.stringify({ type: 'bash_execution_update', id, delta: id })}\n`);
  const reply = (id, success = true) => process.stdout.write(`${JSON.stringify({ type: 'response', id, success, data: result, error: 'refused' })}\n`);
  try {
    const first = session.executeUserBash(command, { id: 'public-one' });
    const wire = sent.at(-1).id;
    assert.notEqual(wire, 'public-one');
    update('wrong'); update(wire);
    reply(wire);
    assert.deepEqual(await first, result);
    const second = session.executeUserBash(command, { id: 'public-two' });
    const next = sent.at(-1).id;
    update(wire); update(next);
    reply(next, false);
    await assert.rejects(second, /refused/);
    update(next);
    assert.deepEqual(events.filter(event => event.type === 'bash_execution_update').map(event => event.id), ['wrong', 'public-one', wire, 'public-two', next]);
    const count = sent.length;
    await assert.rejects(child.request('bash', {}, undefined, () => { throw Error('metadata failed'); }), /metadata failed/);
    assert.equal(sent.length, count);
    const afterError = child.request('abort_bash', { id: 'forged' });
    assert.notEqual(sent.at(-1).id, 'forged');
    reply(sent.at(-1).id);
    await afterError;
  } finally { process.emit('close', 0); }
});
