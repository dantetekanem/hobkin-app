import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { closeKept, keptCommands, runHarness } from '../src/cli/harnesses.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { fakePi } from './helpers/pi-session.mjs';

// What Pi's `get_commands` lists for a session: an extension command, a prompt template and a skill.
const COMMANDS = [
  { name: 'review', description: 'Review the branch', source: 'extension' },
  { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt' },
  { name: 'skill:humanizer', description: 'Rewrite AI-sounding text', source: 'skill' },
];

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
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-commands-')));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};

/** A Pi process in memory that lists its session's commands and runs a prompt until `finish`. */
function memoryPi() {
  const pi = { sent: [] };
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
      request(type) {
        pi.sent.push(type);
        if (type === 'get_state') return Promise.resolve({ sessionId: 'pi-job', model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium' });
        if (type === 'get_commands') return Promise.resolve({ commands: structuredClone(COMMANDS) });
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

test("a working agent's process lists what Pi offers its session", async t => {
  const pi = memoryPi();
  let handle;
  const run = runHarness(job(t), { startProcess: pi.startProcess, onControl: control => { handle = control; } });
  await until(() => pi.sent.includes('prompt'));

  assert.deepEqual(await handle.commands(), COMMANDS);
  pi.finish('Done.');
  assert.equal((await run).status, 'completed');
});

test("a durable turn lists its commands while it runs, and the process kept for the next turn lists them after", async t => {
  const pi = memoryPi();
  const input = job(t, { purpose: 'durable' });
  t.after(() => closeKept(input.sessionFile));
  assert.equal(await keptCommands(input.sessionFile), null, 'nothing is kept before its first turn');

  let handle;
  const run = runHarness(input, { startProcess: pi.startProcess, onControl: control => { handle = control; } });
  await until(() => pi.sent.includes('prompt'));
  assert.deepEqual(await handle.commands(), COMMANDS);
  pi.finish('Done.');
  assert.equal((await run).status, 'completed');

  await assert.rejects(handle.commands(), /turn has ended/, "the turn's handle lets go of the kept process");
  pi.sent.length = 0;
  assert.deepEqual(await keptCommands(input.sessionFile), COMMANDS);
  assert.deepEqual(pi.sent, ['get_commands'], 'asking only reads: nothing is prompted');
  assert.equal(pi.child.exited, false, 'the process stays kept for the next turn');

  await closeKept(input.sessionFile);
  assert.equal(await keptCommands(input.sessionFile), null);
});

/** A runtime whose state is a plain object, with one background run whose process lists its commands. */
function runtimeFixture(t) {
  const root = folder(t);
  const state = { runs: {} };
  const runtime = new HobkinRuntime(root, { main: { cwd: root } }, {});
  runtime.state = async () => structuredClone(state);
  runtime.change = async change => change(state);
  const closed = Promise.withResolvers();
  const transport = { closed: closed.promise, force() {}, terminate() {}, commands: async () => structuredClone(COMMANDS) };
  const gate = Promise.withResolvers();
  t.after(() => { gate.resolve({ status: 'completed', text: 'Done.', cost: null }); closed.resolve({}); });
  const harnessId = '11111111-1111-4111-8111-111111111111';
  const start = (id = 'check-1', kind = 'background') => runtime.dispatch({ id, kind, title: 'Check', harness: 'pi', model: 'test/model', effort: 'medium', harnessId }, async () => {
    if (kind !== 'main') runtime.bindHarness(id, harnessId, transport);
    return gate.promise;
  });
  return { runtime, closed, gate, start };
}

test("a working run lists its own session's commands, and a run that is not working lists none", async t => {
  const h = runtimeFixture(t);
  await assert.rejects(h.runtime.runCommands('nobody'), /not working/);
  const work = h.start();
  await until(() => h.runtime.active.get('check-1')?.transport);
  assert.deepEqual(await h.runtime.runCommands('check-1'), COMMANDS);

  h.closed.resolve({});
  await until(() => h.runtime.active.get('check-1')?.transportClosed);
  await assert.rejects(h.runtime.runCommands('check-1'), /process has closed/);
  h.gate.resolve({ status: 'completed', text: 'Done.', cost: null });
  await work;
  await assert.rejects(h.runtime.runCommands('check-1'), /not working/);
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
  const runHarness = async (request, options) => {
    if (request.purpose !== 'durable' || request.warm) return { status: 'completed', text: request.prompt ?? '', cost: null };
    const call = { request, end: Promise.withResolvers() };
    calls.push(call);
    const closed = Promise.withResolvers();
    options?.onControl?.({ closed: closed.promise, force() {}, terminate() {}, commands: async () => structuredClone(COMMANDS) });
    request.signal?.addEventListener('abort', () => call.end.resolve({ status: 'interrupted', text: '', cost: null }), { once: true });
    const result = await call.end.promise;
    closed.resolve({});
    return result;
  };
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000, runHarness });
  t.after(() => app.close());
  return { project, app, calls };
}
const PI_ENGINE = { kind: 'pi', model: 'test/model', effort: 'medium' };

test("a working hobkin lists its turn's commands, one that waits with no process kept lists none, and an ended one is refused", async t => {
  const h = await hobkinsFixture(t);
  const waiting = await h.app.hobkins.start({ cwd: h.project, engine: PI_ENGINE });
  assert.deepEqual(await h.app.hobkins.commands(waiting.id), []);

  const working = await h.app.hobkins.start({ text: 'Review it.', cwd: h.project, engine: PI_ENGINE });
  const call = await until(() => h.calls[0]);
  await until(() => h.app.runtime.active.get(working.run)?.transport);
  assert.deepEqual(await h.app.hobkins.commands(working.id), COMMANDS);
  call.end.resolve({ status: 'completed', text: 'Done.', cost: null });

  await h.app.hobkins.end(waiting.id);
  await assert.rejects(h.app.hobkins.commands(waiting.id), /ended/);
  await assert.rejects(h.app.hobkins.commands('ffffffff'), /no hobkin/);
});

test("a slash command starts a waiting hobkin's turn as typed, and what changed in memories waits for the next turn", async t => {
  const h = await hobkinsFixture(t);
  let told = 0;
  h.app.hobkins.keptMemories = () => ({ memories: () => '', news: () => ({ text: 'Memory now also holds: ships on Fridays.\n', told: () => { told++; } }) });
  const { id } = await h.app.hobkins.start({ cwd: h.project, engine: PI_ENGINE });

  await h.app.hobkins.say(id, { text: '/skill:humanizer the release notes' });
  const first = await until(() => h.calls[0]);
  assert.equal(first.request.prompt, '/skill:humanizer the release notes', 'Pi sees the slash first, so it expands the skill');
  assert.equal(told, 0);
  first.end.resolve({ status: 'completed', text: 'Done.', cost: null });
  await until(async () => (await h.app.hobkins.read(id)).hobkin.state === 'waiting');

  await h.app.hobkins.say(id, { text: 'Thanks.' });
  const second = await until(() => h.calls[1]);
  assert.equal(second.request.prompt, 'Memory now also holds: ships on Fridays.\nThanks.');
  assert.equal(told, 1);
  second.end.resolve({ status: 'completed', text: 'Done.', cost: null });
});
