import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { buildInvocation, namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { BRIDGE } from '../src/cli/bridge.mjs';
import { scheduleExtension } from '../src/cli/schedule-extension.mjs';
import { ownedRoleTools } from '../src/cli/owned-agent-extension.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { startSession } from '../src/cli/session.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const MINUTE = 60000;
const iso = time => new Date(time).toISOString();
const harnessId = '0c3f6d3e-8f43-4a7e-9f7e-2b1c0f6a9d11';

/** A fake Pi on RPC whose one turn makes a schedule over its bridge, says its line and settles. */
const scheduling = params => `
let input = '';
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const cmd = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    const reply = data => send({ type: 'response', id: cmd.id, command: cmd.type, success: true, data });
    if (cmd.type === 'get_state') reply({ sessionId: 'pi-job', thinkingLevel: 'medium', model: { provider: 'test', id: 'model' } });
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-job', cost: 0.1 });
    else if (cmd.type === 'extension_ui_response') {
      const answer = cmd.cancelled ? { ok: false, error: 'The Hobkin host did not answer.' } : JSON.parse(cmd.value);
      send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Watching: ' + (answer.ok ? answer.result.content[0].text : answer.error) }] } });
      send({ type: 'agent_settled' });
    } else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      send({ type: 'agent_start' });
      send({ type: 'extension_ui_request', id: 'schedule', method: 'input', title: ${JSON.stringify(BRIDGE)},
        placeholder: JSON.stringify({ op: 'tool', name: 'hobkin_schedule', id: 'call-1', params: ${JSON.stringify(params)} }) });
    } else reply();
  }
});
`;
const fake = (program, pids = []) => (_command, _args, options) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], options);
  pids.push(child.pid);
  return child;
};

function request(t, extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-schedule-run-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { id: harnessId, harness: 'pi', cwd, model: null, effort: 'medium', prompt: 'Ship #412 and watch CI.', sessionFile: join(cwd, 'job.jsonl'), ...extra };
}

test('a run whose turn ends while it keeps a live schedule waits with no process, and its tools answer over its own pipe', { timeout: 8000 }, async t => {
  const made = [];
  const until = NOW + 2 * 3600000;
  const schedules = live => ({
    make: params => { made.push(params); return { text: 'Scheduled "Watch CI" (id a1b2c3d4).' }; },
    manage: () => ({ schedules: [] }),
    liveUntil: () => (live ? until : null),
  });
  const pids = [];
  const params = { name: 'Watch CI', command: 'gh pr checks 412', every: '2m', pendingExit: [8], note: 'Read the checks.' };
  const waited = await runHarness(request(t, { waits: 0 }), { spawnProcess: fake(scheduling(params), pids), now: () => NOW, schedules: schedules(true) });
  assert.deepEqual(made, [params]);
  assert.equal(waited.status, 'waiting');
  assert.equal(waited.text, 'Watching: Scheduled "Watch CI" (id a1b2c3d4).');
  assert.deepEqual(waited.wait, { until: iso(until + 5 * MINUTE), note: 'Waits for its schedules to wake it.', askedAt: iso(NOW), schedules: true });
  assert.throws(() => process.kill(pids[0], 0), { code: 'ESRCH' });

  const ended = await runHarness(request(t, { waits: 0 }), { spawnProcess: fake(scheduling(params)), now: () => NOW, schedules: schedules(false) });
  assert.equal(ended.status, 'completed', 'with no live schedule left the run ends');
  const elsewhere = await runHarness(request(t), { spawnProcess: fake(scheduling(params)), now: () => NOW });
  assert.equal(elsewhere.status, 'completed');
  assert.match(elsewhere.text, /did not answer|not available/i, 'a run hobkin keeps no schedules for is told so');
});

test('a run given the schedule tools loads them and leaves out the Pi scheduler, and a helper has neither', async t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
  mkdirSync(join(agentDir, 'extensions/pi-scheduler'), { recursive: true });
  writeFileSync(join(agentDir, 'extensions/pi-scheduler/index.ts'), 'export default function () {}\n');
  writeFileSync(join(agentDir, 'extensions/own.ts'), 'export default function () {}\n');
  const started = [];
  const run = namingExtensions(async job => { started.push(job); });
  await run(request(t, { waits: 0, schedules: true }));
  await run(request(t, { waits: 0 }));
  const [given, other] = started.map(job => job.extensions);
  assert.equal(given.includes(scheduleExtension), true);
  assert.equal(given.some(path => path.includes('pi-scheduler')), false);
  assert.equal(other.includes(scheduleExtension), false);
  assert.equal(other.some(path => path.includes('pi-scheduler')), true, 'every other run keeps the Pi scheduler');
  for (const role of ['read', 'write', 'theme']) {
    assert.equal(ownedRoleTools(role).some(name => name.startsWith('hobkin_schedule')), false, `a ${role} helper has no schedule tools`);
  }
});

/** A temporary home whose main chat is a fake Pi and whose scheduled commands run in a fake shell. */
function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-schedule-wakes-')));
  const opened = [];
  t.after(async () => {
    await Promise.all(opened.map(app => app.close()));
    rmSync(root, { recursive: true, force: true });
  });
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fakeMain = fakePi(root);
  const clock = { now: NOW };
  const open = async options => {
    const app = await HobkinApplication.open(root, { createMain: fakeMain.createMain, intervalMs: 60000, now: () => clock.now, ...options });
    opened.push(app);
    return app;
  };
  return { root, clock, open };
}

const notHere = { status: 'failed', cost: null, error: 'Not in this test.' };

/**
 * A harness start the test ends with `end.resolve`: it takes messages while it runs, keeping each in `heard`, and ends
 * interrupted when hobkin closes.
 */
function heldCall(calls, request, options) {
  const call = { request, options, heard: [], end: Promise.withResolvers() };
  const cancelled = () => call.end.resolve({ status: 'interrupted', text: '', error: 'Harness cancelled.', cost: null });
  request.signal?.addEventListener('abort', cancelled, { once: true });
  options?.onReady?.(async message => {
    call.heard.push(message);
    return { disposition: 'queued' };
  });
  calls.push(call);
  return call.end.promise;
}
const userWords = app => app.runtime.messages().filter(message => message.role === 'user').map(message => (typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('')));
async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await wait(5);
  }
}

test("the main chat's wake comes as a hidden turn while it is free, with the note and the output, and reaches no one else", async t => {
  const h = home(t);
  const app = await h.open({ runHarness: async () => notHere });
  app.agentSchedules.shell = async () => ({ code: 1, stdout: 'lint failed on line 3', stderr: '', killed: false });
  const watch = app.agentSchedules.make({ kind: 'main' }, h.root, { name: 'Watch CI', command: 'gh pr checks 412', in: '1m', note: 'Read the checks.' });
  h.clock.now += MINUTE;
  await app.tickAgentSchedules();
  await until(() => app.agentSchedules.wakes().length === 1);
  app.tickWakes();
  await until(() => !app.agentSchedules.wakes().length);
  const [brief] = userWords(app);
  assert.match(brief, /^<hobkin-wake>\n/);
  const { schedules } = JSON.parse(brief.split('\n')[1]);
  assert.deepEqual(schedules.map(({ id, name, note, what, outcome, exitCode, output }) => ({ id, name, note, what, outcome, exitCode, output })),
    [{ id: watch.id, name: 'Watch CI', note: 'Read the checks.', what: 'fired', outcome: 'failed', exitCode: 1, output: 'lint failed on line 3' }]);
  assert.equal((await app.refresh()).messages.some(message => message.role === 'user' && /hobkin-wake/.test(message.content ?? '')), false, 'Chat does not show it');
});

test('a run is steered while it runs, started again while it waits, and told once when its schedule ends', async t => {
  const h = home(t);
  const calls = [];
  const app = await h.open({ runHarness: async (request, options) => {
    if (request.purpose) return notHere;
    return heldCall(calls, request, options);
  } });
  const started = await startSession({ root: h.root, title: 'Ship 412', brief: 'Ship #412 and watch CI.', cwd: h.root, approved: true, tier: 'mid' });
  const sessions = app.tickSessions();
  await until(() => calls.length === 1);
  const [first] = calls;
  assert.equal(first.request.schedules, true, 'a session run is given the schedule tools');
  const made = await first.options.schedules.make({ name: 'Watch CI', every: '2m', note: 'Read the checks.' });
  assert.match(made.text, /End your turn now/);
  assert.match((await first.options.schedules.manage({ action: 'list' })).text, /Watch CI/);

  await app.tickAgentSchedules();
  await until(() => first.heard.length === 1);
  assert.match(first.heard[0], /^<hobkin-schedule>\n[\s\S]*"note":"Read the checks\."/);

  first.end.resolve({ status: 'waiting', text: 'Watching CI.', cost: null, freshSession: true,
    wait: { until: iso(NOW + 3 * 3600000), note: 'Waits for its schedules to wake it.', askedAt: iso(NOW), schedules: true } });
  await sessions;
  const id = `session:${started.name}`;
  assert.equal((await app.runtime.state()).runs[id].status, 'waiting');

  h.clock.now += 2 * MINUTE;
  await app.tickAgentSchedules();
  // A tick's sessions resolve once their runs end, so nothing waits for them here.
  void app.tickSessions();
  await until(() => calls.length === 2);
  assert.match(calls[1].request.prompt, /^<hobkin-schedule>\n[\s\S]*"what":"fired"/);
  assert.equal(app.agentSchedules.wakes().length, 0, 'the start took the wake');
  calls[1].end.resolve({ status: 'waiting', text: 'Still watching.', cost: null,
    wait: { until: iso(NOW + 3 * 3600000), note: 'Waits for its schedules to wake it.', askedAt: iso(h.clock.now), schedules: true } });
  await until(async () => (await app.runtime.state()).runs[id].status === 'waiting');

  assert.deepEqual(await app.cancelAgentSchedule(made.schedule.id), { ok: true });
  await app.tickAgentSchedules();
  void app.tickSessions();
  await until(() => calls.length === 3);
  assert.match(calls[2].request.prompt, /"what":"ended"[\s\S]*"endedWhy":"the user cancelled it from the window"/);
  calls[2].end.resolve({ status: 'completed', text: 'Useful: #412 shipped and CI passed.', cost: null });
  await until(async () => (await app.runtime.state()).runs[id].status === 'completed');
  assert.equal(readFileSync(started.report, 'utf8'), 'Useful: #412 shipped and CI passed.');
  await app.tickSessions();
  assert.equal(calls.length, 3, 'told once');
});

test("a durable hobkin's wake starts a turn while it waits and is steered into the turn while it works, and its schedules end with it", async t => {
  const h = home(t);
  const calls = [];
  const app = await h.open({ runHarness: async (request, options) => {
    if (request.purpose !== 'durable' || request.warm) return request.warm ? { status: 'warmed' } : notHere;
    return heldCall(calls, request, options);
  } });
  const { id } = await app.hobkins.start({ cwd: h.root, engine: { kind: 'tier', tier: 'mid' }, title: 'Deploy watcher' });
  const owner = { kind: 'hobkin', id };
  app.agentSchedules.make(owner, h.root, { name: 'Look at the deploy', every: '5m', note: 'Read the deploy log.' });
  await app.tickAgentSchedules();
  await until(() => calls.length === 1);
  assert.equal(calls[0].request.schedules, true);
  assert.match(calls[0].request.prompt, /^<hobkin-schedule>\n[\s\S]*"note":"Read the deploy log\."/);
  assert.equal((await app.hobkins.read(id)).turns[0].from.kind, 'schedule');
  assert.equal((await app.hobkins.read(id)).turns[0].from.title, 'Look at the deploy');

  h.clock.now += 5 * MINUTE;
  await app.tickAgentSchedules();
  await until(() => calls[0].heard.length === 1);
  assert.match(calls[0].heard[0], /^<hobkin-schedule>/);
  assert.equal(calls.length, 1, 'it hears it in the turn it is on');

  calls[0].end.resolve({ status: 'completed', text: 'The deploy looks fine.', cost: null });
  await until(async () => (await app.hobkins.read(id)).hobkin.state === 'waiting');
  await app.hobkins.end(id);
  await app.tickAgentSchedules();
  assert.equal(app.agentSchedules.live(owner), 0);
  assert.equal((await app.refresh()).agentSchedules[0].endedWhy, 'its agent ended');
});

test('a reset ends the main chat\'s schedules, and a wake not delivered before a restart is delivered after it', async t => {
  const h = home(t);
  let app = await h.open({ runHarness: async () => notHere });
  app.agentSchedules.make({ kind: 'main' }, h.root, { in: '1m', note: 'Say the deploy is done.' });
  h.clock.now += MINUTE;
  await app.tickAgentSchedules();
  assert.equal(app.agentSchedules.wakes().length, 1);
  await app.close();

  app = await h.open({ runHarness: async () => notHere });
  app.tickWakes();
  await until(() => !app.agentSchedules.wakes().length);
  assert.match(userWords(app).at(-1), /Say the deploy is done\./);

  const kept = app.agentSchedules.make({ kind: 'main' }, h.root, { every: '5m', in: '5m', note: 'Look.' });
  await app.reset();
  assert.equal(app.agentSchedules.live({ kind: 'main' }), 0);
  assert.equal((await app.refresh()).agentSchedules.find(item => item.id === kept.id).endedWhy, 'the chat was reset');
});

test('a wake is steered into a run once, however late its Pi takes messages', async t => {
  const h = home(t);
  const calls = [];
  const app = await h.open({ runHarness: async (request, options) => {
    if (request.purpose) return notHere;
    // Pi takes the run's messages only when the test says, as a slow start would.
    return heldCall(calls, request, { ...options, onReady: send => { calls.ready = () => options.onReady(send); } });
  } });
  await startSession({ root: h.root, title: 'Slow start', brief: 'Watch.', cwd: h.root, approved: true, tier: 'mid' });
  void app.tickSessions();
  await until(() => calls.length === 1);
  await calls[0].options.schedules.make({ name: 'Ping', in: '1m', note: 'Look at the deploy.' });
  h.clock.now += MINUTE;

  t.mock.timers.enable({ apis: ['setTimeout'] });
  await app.tickAgentSchedules();
  t.mock.timers.tick(65000);
  for (let tick = 0; tick < 3; tick++) {
    await new Promise(resolve => setImmediate(resolve));
    await app.tickAgentSchedules();
  }
  t.mock.timers.reset();
  calls.ready();
  await until(() => calls[0].heard.length > 0);
  await wait(50);

  assert.equal(calls[0].heard.length, 1, 'heard once');
  assert.match(calls[0].heard[0], /"note":"Look at the deploy\."/);
  assert.deepEqual(app.agentSchedules.wakes(), []);
});

test('a routine or a Work run, which gets no schedule tools, is told nothing about them', t => {
  for (const purpose of [undefined, 'work-discover', 'work-look', 'work-do']) {
    const { args } = buildInvocation(request(t, { ...(purpose ? { purpose } : {}) }));
    const told = args.join('\n');
    assert.doesNotMatch(told, /hobkin_schedule|hobkin schedule|HOBKIN_SCHEDULE_TOKEN/, `a ${purpose ?? 'routine'} run`);
  }
});
