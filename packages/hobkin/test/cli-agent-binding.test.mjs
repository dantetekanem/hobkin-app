import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { closeKept, runHarness } from '../src/cli/harnesses.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await wait(5);
  }
}
const folder = t => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-binding-')));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};

/** A Pi process in memory: it holds a model and a thinking level, takes Pi's setters, and runs a prompt until `finish`. */
function memoryPi() {
  const pi = { held: { provider: 'test', id: 'model' }, level: 'medium', sent: [] };
  pi.startProcess = ({ onRecord }) => {
    const closed = Promise.withResolvers();
    pi.finish = text => {
      onRecord({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } });
      onRecord({ type: 'agent_settled' });
    };
    pi.child = {
      failure: null,
      exited: false,
      closed: closed.promise,
      request(type, data = {}) {
        pi.sent.push(type);
        if (type === 'get_state') return Promise.resolve({ sessionId: 'pi-job', model: { ...pi.held }, thinkingLevel: pi.level });
        if (type === 'set_model') { pi.held = { provider: data.provider, id: data.modelId }; return Promise.resolve(pi.held); }
        if (type === 'set_thinking_level') { pi.level = data.level; return Promise.resolve(); }
        if (type === 'prompt') return Promise.resolve({ disposition: 'started' });
        if (type === 'get_session_stats') return Promise.resolve({ sessionId: 'pi-job', cost: 0 });
        return Promise.reject(Error(`Unknown command: ${type}`));
      },
      send() {},
      terminate() { pi.child.exited = true; closed.resolve({}); },
      force() { pi.child.exited = true; closed.resolve({}); },
    };
    return pi.child;
  };
  return pi;
}

function job(t, extra = {}) {
  const cwd = folder(t);
  return { id: 'f094b0ba-036c-4abc-9198-745fd1226765', harness: 'pi', cwd, model: 'test/model', effort: 'medium',
    prompt: 'Read the logs.', sessionFile: join(cwd, 'job.jsonl'), ...extra };
}

test("a working agent's process takes only what changed, and answers with what Pi holds", async t => {
  const pi = memoryPi();
  let handle;
  const run = runHarness(job(t), { startProcess: pi.startProcess, onControl: control => { handle = control; } });
  await until(() => pi.sent.includes('prompt'));
  pi.sent.length = 0;

  assert.deepEqual(await handle.changeBinding({ effort: 'high' }), { model: 'test/model', effort: 'high' });
  assert.deepEqual(pi.sent, ['set_thinking_level', 'get_state'], 'only the level was sent');
  pi.sent.length = 0;
  assert.deepEqual(await handle.changeBinding({ model: 'test/other' }), { model: 'test/other', effort: 'high' });
  assert.deepEqual(pi.sent, ['set_model', 'get_state']);
  pi.sent.length = 0;

  await assert.rejects(handle.changeBinding({ model: 'other' }), /provider\/model/);
  await assert.rejects(handle.changeBinding({ effort: 'extreme' }), /thinking level is one of/);
  await assert.rejects(handle.changeBinding({}), /model, a thinking level or both/);
  assert.deepEqual(pi.sent, [], 'a refused change reaches nothing');

  pi.finish('Done.');
  assert.equal((await run).status, 'completed');
});

test("a durable turn's handle changes its process only while the turn runs", async t => {
  const pi = memoryPi();
  const input = job(t, { purpose: 'durable' });
  t.after(() => closeKept(input.sessionFile));
  let handle;
  const run = runHarness(input, { startProcess: pi.startProcess, onControl: control => { handle = control; } });
  await until(() => pi.sent.includes('prompt'));
  assert.deepEqual(await handle.changeBinding({ effort: 'low' }), { model: 'test/model', effort: 'low' });
  pi.finish('Done.');
  assert.equal((await run).status, 'completed');
  pi.sent.length = 0;
  await assert.rejects(handle.changeBinding({ effort: 'high' }), /turn has ended/);
  assert.deepEqual(pi.sent, [], 'the process kept for the next turn is not touched');
});

/** A runtime whose state is a plain object, with one background run whose process takes changes as Pi would. */
function runtimeFixture(t) {
  const root = folder(t);
  const state = { runs: {} };
  const runtime = new HobkinRuntime(root, { main: { cwd: root } }, {});
  runtime.state = async () => structuredClone(state);
  runtime.change = async change => change(state);
  const asked = [];
  const closed = Promise.withResolvers();
  const transport = {
    closed: closed.promise, force() {}, terminate() {},
    changeBinding: async change => { asked.push(change); return { model: change.model ?? 'test/model', effort: change.effort ?? null }; },
  };
  const gate = Promise.withResolvers();
  t.after(() => { gate.resolve({ status: 'completed', text: 'Done.', cost: null }); closed.resolve({}); });
  const harnessId = '11111111-1111-4111-8111-111111111111';
  const start = (id = 'check-1', kind = 'background') => runtime.dispatch({ id, kind, title: 'Check', harness: 'pi', model: 'test/model', effort: 'medium', harnessId }, async () => {
    if (kind !== 'main') runtime.bindHarness(id, harnessId, transport);
    return gate.promise;
  });
  return { runtime, state, asked, transport, closed, gate, start };
}

test("a working agent's run changes and records what Pi holds, leaving what Pi did not say", async t => {
  const h = runtimeFixture(t);
  const work = h.start();
  await until(() => h.runtime.active.get('check-1')?.transport);

  assert.deepEqual(await h.runtime.changeRun('check-1', { model: 'test/other' }), { model: 'test/other', effort: 'medium' });
  assert.deepEqual(h.asked, [{ model: 'test/other' }]);
  assert.deepEqual([h.state.runs['check-1'].model, h.state.runs['check-1'].effort], ['test/other', 'medium']);

  h.gate.resolve({ status: 'completed', text: 'Done.', cost: null });
  await work;
  await assert.rejects(h.runtime.changeRun('check-1', { effort: 'high' }), /not working/);
  assert.equal(h.asked.length, 1);
});

test('every run that is not working changes nothing', async t => {
  const h = runtimeFixture(t);
  await assert.rejects(h.runtime.changeRun('nobody', { effort: 'high' }), /not working/);

  const admission = Promise.withResolvers();
  const admit = h.runtime.admit.bind(h.runtime);
  h.runtime.admit = async request => { await admission.promise; return admit(request); };
  const work = h.start();
  await tick();
  await assert.rejects(h.runtime.changeRun('check-1', { effort: 'high' }), /not started yet/);
  admission.resolve();
  await until(() => h.runtime.active.get('check-1')?.transport);
  h.closed.resolve({});
  await until(() => h.runtime.active.get('check-1')?.transportClosed);
  await assert.rejects(h.runtime.changeRun('check-1', { effort: 'high' }), /process has closed/);
  h.gate.resolve({ status: 'completed', text: 'Done.', cost: null });
  await work;

  const main = new HobkinRuntime(folder(t), { main: { cwd: '/' } }, {});
  const state = { runs: {} };
  main.state = async () => structuredClone(state);
  main.change = async change => change(state);
  const held = Promise.withResolvers();
  t.after(() => held.resolve({ status: 'completed', text: '', cost: null }));
  void main.dispatch({ id: 'conversation', kind: 'main', title: 'Conversation' }, () => held.promise);
  await until(() => main.active.get('conversation')?.admitted);
  await assert.rejects(main.changeRun('conversation', { effort: 'high' }), /own conversation/);
  assert.deepEqual(h.asked, []);
});

/** hobkin with durable hobkins whose turns run in a stand-in that hands the runtime a process handle, as the real one does. */
async function hobkinsFixture(t) {
  const root = folder(t);
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  atomicJson(join(root, 'config.json'), config);
  const project = join(root, 'project');
  mkdirSync(project);
  const calls = [];
  const asked = [];
  const runHarness = async (request, options) => {
    if (request.purpose !== 'durable' || request.warm) return { status: 'completed', text: request.prompt ?? '', cost: null };
    const call = { request, end: Promise.withResolvers(), took: true };
    calls.push(call);
    const closed = Promise.withResolvers();
    options?.onControl?.({ closed: closed.promise, force() {}, terminate() {},
      changeBinding: async change => {
        if (!call.took) throw Error('Its turn has ended.');
        asked.push(change);
        return { model: change.model ?? request.model, effort: change.effort ?? request.effort };
      } });
    request.signal?.addEventListener('abort', () => call.end.resolve({ status: 'interrupted', text: '', cost: null }), { once: true });
    const result = await call.end.promise;
    closed.resolve({});
    return result;
  };
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000, runHarness });
  t.after(() => app.close());
  return { root, project, app, calls, asked };
}
const engineOf = async (app, id) => (await app.hobkins.read(id)).hobkin.engine;

test('a waiting hobkin saves the change, and its next turn starts with it', async t => {
  const h = await hobkinsFixture(t);
  const { id } = await h.app.hobkins.start({ cwd: h.project, engine: { kind: 'pi', model: 'test/model', effort: 'medium' } });
  assert.deepEqual(await h.app.hobkins.changeEngine(id, { effort: 'high' }), { engine: { kind: 'pi', model: 'test/model', effort: 'high' }, turn: null });
  assert.deepEqual(await engineOf(h.app, id), { kind: 'pi', model: 'test/model', effort: 'high' });

  await h.app.hobkins.say(id, { text: 'Go.' });
  const call = await until(() => h.calls[0]);
  assert.deepEqual([call.request.model, call.request.effort], ['test/model', 'high']);
  call.end.resolve({ status: 'completed', text: 'Done.', cost: null });

  // A tier becomes the Pi model it is on, with the new level.
  const tier = await h.app.hobkins.start({ cwd: h.project, engine: { kind: 'tier', tier: 'mid' } });
  assert.deepEqual((await h.app.hobkins.changeEngine(tier.id, { effort: 'low' })).engine, { kind: 'pi', model: 'fixture/local', effort: 'low' });
  assert.deepEqual(h.asked, [], 'no turn was running to take it');
});

test("a working hobkin's turn takes only what changed, and keeps the change for later turns", async t => {
  const h = await hobkinsFixture(t);
  const { id, run } = await h.app.hobkins.start({ text: 'Review it.', cwd: h.project, engine: { kind: 'pi', model: 'test/model', effort: 'medium' } });
  const call = await until(() => h.calls[0]);
  await until(() => h.app.runtime.active.get(run)?.transport);

  const changed = await h.app.hobkins.changeEngine(id, { model: 'test/other', effort: 'medium' });
  assert.deepEqual(changed, { engine: { kind: 'pi', model: 'test/other', effort: 'medium' }, turn: { run, took: true, model: 'test/other', effort: 'medium' } });
  assert.deepEqual(h.asked, [{ model: 'test/other' }], 'the level it already had was not passed');
  assert.equal((await h.app.runtime.state()).runs[run].model, 'test/other');

  // The turn ends while the next change is on its way: it is kept for the next turn, and says why the turn did not take it.
  call.took = false;
  const late = await h.app.hobkins.changeEngine(id, { effort: 'high' });
  assert.deepEqual(late.engine, { kind: 'pi', model: 'test/other', effort: 'high' });
  assert.deepEqual([late.turn.run, late.turn.took], [run, false]);
  assert.match(late.turn.reason, /turn has ended/);
  call.end.resolve({ status: 'completed', text: 'Done.', cost: null });
  await until(async () => (await h.app.hobkins.read(id)).hobkin.state === 'waiting');
  await h.app.hobkins.say(id, { text: 'Again.' });
  const next = await until(() => h.calls[1]);
  assert.deepEqual([next.request.model, next.request.effort], ['test/other', 'high']);
  next.end.resolve({ status: 'completed', text: 'Done.', cost: null });
});

test('a hobkin on Claude Code, an ended one, nothing asked and an unknown level save nothing', async t => {
  const h = await hobkinsFixture(t);
  const claude = await h.app.hobkins.start({ cwd: h.project, engine: { kind: 'claude' } });
  await assert.rejects(h.app.hobkins.changeEngine(claude.id, { effort: 'high' }), /Claude Code/);
  assert.deepEqual(await engineOf(h.app, claude.id), { kind: 'claude' });

  const pi = await h.app.hobkins.start({ cwd: h.project, engine: { kind: 'pi', model: 'test/model', effort: 'medium' } });
  await assert.rejects(h.app.hobkins.changeEngine(pi.id, {}), /model, a thinking level or both/);
  await assert.rejects(h.app.hobkins.changeEngine(pi.id, { effort: 'extreme' }), /thinking level is one of/);
  await assert.rejects(h.app.hobkins.changeEngine(pi.id, { model: 'no-provider' }), /provider\/model/);
  assert.deepEqual(await engineOf(h.app, pi.id), { kind: 'pi', model: 'test/model', effort: 'medium' });

  await h.app.hobkins.end(pi.id);
  await assert.rejects(h.app.hobkins.changeEngine(pi.id, { effort: 'high' }), /ended/);
  assert.deepEqual(h.asked, []);
});
