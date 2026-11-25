import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { buildInvocation, namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { BRIDGE } from '../src/cli/bridge.mjs';
import { createDoneTool, doneExtension } from '../src/cli/done-extension.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { startSession } from '../src/cli/session.mjs';
import { recordSessionStart, sessionsToWake } from '../src/cli/session-log.mjs';
import { readReport } from '../src/cli/reports.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const id = 'f094b0ba-036c-4abc-9198-745fd1226765';

function request(t, extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-until-done-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { id, harness: 'pi', cwd, model: null, effort: 'medium', prompt: 'Fix the totals.', sessionFile: join(cwd, 'job.jsonl'), ...extra };
}
/** A job's request as hobkin names its extensions: it lives until its agent calls `hobkin_done`. */
const living = (t, extra = {}) => request(t, { untilDone: true, extensions: [doneExtension], ...extra });

/**
 * A fake Pi on RPC. `body` runs on each prompt, with `prompts` counting them and `message` the words it was given;
 * `done(report, then)` calls `hobkin_done` over the bridge and hands `then` the host's answer.
 */
const rpc = (body, model = { provider: 'test', id: 'model' }) => `
let input = '';
let prompts = 0;
const answers = new Map();
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
const say = (text, stopReason = 'stop') => send({ type: 'message_end', message: { role: 'assistant', stopReason, content: [{ type: 'text', text }] } });
const settled = () => send({ type: 'agent_settled' });
const done = (report, then) => {
  const id = 'done-' + answers.size;
  answers.set(id, then);
  send({ type: 'extension_ui_request', id, method: 'input', title: ${JSON.stringify(BRIDGE)}, placeholder: JSON.stringify({ op: 'done', report }) });
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const cmd = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    const reply = data => send({ type: 'response', id: cmd.id, command: cmd.type, success: true, data });
    if (cmd.type === 'get_state') reply({ sessionId: 'pi-job', thinkingLevel: 'medium', model: ${JSON.stringify(model)} });
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-job', cost: 0.25 });
    else if (cmd.type === 'extension_ui_response') { const then = answers.get(cmd.id); answers.delete(cmd.id); then?.(JSON.parse(cmd.value)); }
    else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      prompts++;
      const message = cmd.message;
      send({ type: 'agent_start' });
      ${body}
    } else reply();
  }
});
`;
const fake = (program, pids = []) => (_command, _args, options) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], options);
  pids.push(child.pid);
  return child;
};
const gone = pid => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
async function until(check, ms = 4000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await wait(5);
  }
}

test('a job that lives until it is done outlives its turn, idle and taking messages, and ends on hobkin_done with its report', { timeout: 8000 }, async t => {
  const pids = [];
  const program = rpc(`
    if (prompts === 1) { say('Which branch should the fix go on?'); settled(); }
    else done('Useful: The totals add up again, on fix-totals, merged into main.', answer => { say('Ending.'); settled(); });
  `);
  const idle = [];
  let woken = 0, tell;
  const ran = runHarness(living(t), {
    spawnProcess: fake(program, pids),
    onReady: send => { tell = send; },
    onIdle: said => idle.push(said),
    onWoken: () => { woken++; },
  });

  await until(() => idle.length === 1);
  assert.deepEqual(idle, ['Which branch should the fix go on?'], 'its turn ended and it says so with its reply');
  await wait(50);
  assert.equal(gone(pids[0]), false, 'its process stays up');

  await tell('Put it on fix-totals.');
  const result = await ran;
  assert.equal(woken, 1, 'the message started a turn on it');
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Useful: The totals add up again, on fix-totals, merged into main.', 'its report is the one hobkin_done gave');
  await until(() => gone(pids[0]));
});

test('a stop ends a living job while it sits idle', { timeout: 8000 }, async t => {
  const controller = new AbortController();
  const idle = [];
  const ran = runHarness(living(t, { signal: controller.signal }), {
    spawnProcess: fake(rpc(`say('Waiting on you: which folder?'); settled();`)),
    onIdle: said => idle.push(said),
  });
  await until(() => idle.length === 1);
  controller.abort();
  const result = await ran;
  assert.equal(result.status, 'interrupted');
});

test('a living job never ends as waiting on a live schedule: its turn ends and it stays up', { timeout: 8000 }, async t => {
  const controller = new AbortController();
  const idle = [];
  const schedules = { make: () => ({ text: 'Scheduled.' }), manage: () => ({}), liveUntil: () => Date.now() + 3600000 };
  const ran = runHarness(living(t, { waits: 0, schedules: true, signal: controller.signal }), {
    spawnProcess: fake(rpc(`say('Watching CI.'); settled();`)),
    schedules,
    onIdle: said => idle.push(said),
  });
  await until(() => idle.length === 1);
  controller.abort();
  assert.equal((await ran).status, 'interrupted', 'it was still alive, not waiting');
});

test('hobkin_done is refused without a report and while agents are out, and the job goes on', { timeout: 8000 }, async t => {
  const answers = [];
  const program = rpc(`
    send({ type: 'tool_execution_end', toolName: 'spawn_agent', isError: false, result: { content: [], details: { name: 'reader' } } });
    done('  ', blank => done('Useful: Read it all.', early => {
      send({ type: 'message_end', message: { role: 'custom', customType: 'pi-extended-teams-report', content: 'Agent result.', display: false, details: { name: 'reader' } } });
      done('Useful: The reader found it.', last => {
        process.stdout.write(JSON.stringify({ type: 'answers', answers: [blank, early, last] }) + '\\n');
        say('Ending.');
        settled();
      });
    }));
  `);
  const result = await runHarness(living(t), {
    spawnProcess: fake(program),
    onEvent: event => { if (event.type === 'answers') answers.push(...event.answers); },
  });
  assert.equal(answers.length, 3);
  const [blank, early, last] = answers;
  assert.equal(blank.ok, false);
  assert.match(blank.error, /report/);
  assert.equal(early.ok, false);
  assert.match(early.error, /agents are still working/);
  assert.equal(last.ok, true);
  assert.equal(result.text, 'Useful: The reader found it.');
});

test('a run that is not asked to live until done ends with its turn, and only one that is gets hobkin_done', async t => {
  const result = await runHarness(request(t), { spawnProcess: fake(rpc(`say('Useful: Done in one turn.'); settled();`)), onIdle: () => assert.fail('it never sits idle') });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Useful: Done in one turn.');

  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  writeFileSync(join(agentDir, 'extensions/own.ts'), 'export default function () {}\n');
  const started = [];
  const run = namingExtensions(async job => { started.push(job); });
  await run(request(t, { untilDone: true }));
  await run(request(t));
  assert.equal(started[0].extensions.includes(doneExtension), true);
  assert.equal(started[1].extensions.includes(doneExtension), false);
});

test("hobkin_done asks the host over the job's own bridge and answers in the host's words", async () => {
  const asked = [];
  const ctx = { mode: 'rpc', ui: { input: async (title, placeholder) => {
    asked.push([title, JSON.parse(placeholder)]);
    return JSON.stringify({ ok: true, result: { text: 'hobkin ends this job when this turn ends.' } });
  } } };
  const answer = await createDoneTool().execute('call', { report: 'Useful: Done.' }, undefined, undefined, ctx);
  assert.deepEqual(asked, [[BRIDGE, { op: 'done', report: 'Useful: Done.' }]]);
  assert.equal(answer.content[0].text, 'hobkin ends this job when this turn ends.');
});

test('a living job reads its own short prompt in place of the routines\' one, and any other run keeps its own', t => {
  const words = name => readFileSync(new URL(`../src/prompts/${name}.md`, import.meta.url), 'utf8');
  const told = run => buildInvocation(run).args.join('\n');
  assert.ok(told(living(t)).includes(words('session-job')));
  assert.equal(told(living(t)).includes(words('background')), false);
  assert.ok(told(request(t)).includes(words('background')));
  assert.equal(told(request(t, { untilDone: true })).includes(words('session-job')), false, 'not without hobkin_done to end with');
  assert.throws(() => buildInvocation(living(t, { purpose: 'work-do' })), /lives until/);
});

/** A temporary home whose main chat is a fake Pi. The home goes once every app opened on it has closed. */
function home(t, { concurrency, now } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-until-done-home-')));
  const opened = [];
  t.after(async () => {
    await Promise.all(opened.map(app => app.close()));
    rmSync(root, { recursive: true, force: true });
  });
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  if (concurrency) config.concurrency = concurrency;
  atomicJson(join(root, 'config.json'), config);
  const main = fakePi(root);
  const open = async options => {
    const app = await HobkinApplication.open(root, { createMain: main.createMain, intervalMs: 60000, runHarness: async () => notHere, ...(now ? { now } : {}), ...options });
    opened.push(app);
    return app;
  };
  return { root, open };
}
// The report's editor and its short version are runs of their own, and these tests leave them out.
const notHere = { status: 'failed', cost: null, error: 'Not in this test.' };

test('a card choice the main agent could not be sent is sent on the next try, once', async t => {
  const app = await home(t).open();
  const send = app.runtime.send.bind(app.runtime);
  app.handOff({ project: 'finboard', item: 'abc123', title: 'Browse older payment installments', branch: 'hobkin/abc123', asked: 'Refresh it.', why: 'work mode is off' });
  app.runtime.send = async () => { throw Error('Wake was not admitted'); };
  await app.tickWakes();
  await wait(0);
  app.runtime.send = send;
  const sent = t.mock.method(app.runtime, 'send');

  await app.tickWakes();
  await app.runtime.idle();
  await app.tickWakes();

  const woken = sent.mock.calls.map(({ arguments: [text] }) => text);
  assert.equal(woken.length, 1);
  assert.match(woken[0], /^<hobkin-wake>\n\{"handOff":\[[\s\S]*Browse older payment installments/);
});

/** A harness start that takes messages, keeping each in `heard`, and ends interrupted when it is stopped, saying `said`. */
function heldCall(calls, request, options, said = '') {
  const call = { request, options, heard: [], end: Promise.withResolvers() };
  request.signal?.addEventListener('abort', () => call.end.resolve({ status: 'interrupted', text: said, error: 'Harness cancelled.', cost: null }), { once: true });
  options?.onReady?.(async message => {
    call.heard.push(message);
    return { disposition: 'started' };
  });
  calls.push(call);
  return call.end.promise;
}
const CUT_OFF = /^This job was cut off when hobkin closed or restarted, before its agent said it was done\./;

test('a job hobkin closes on ends its session with a report that says it was cut off, and the chat is woken', async t => {
  const h = home(t);
  const calls = [];
  const app = await h.open({ runHarness: async (request, options) => (request.purpose ? notHere : heldCall(calls, request, options, 'Which branch should the fix go on?')) });
  const started = await startSession({ root: h.root, title: 'Fix totals', brief: 'Fix the totals.', cwd: h.root, approved: true, wake: true, tier: 'mid' });
  void app.tickSessions();
  await until(() => calls.length === 1);
  await app.close();

  const report = readFileSync(started.report, 'utf8');
  assert.match(report, CUT_OFF);
  assert.match(report, /Which branch should the fix go on\?/, 'with what it last said');
  const [woken] = sessionsToWake(h.root);
  assert.equal(woken.name, started.name);
  assert.match(woken.said, CUT_OFF);
});

test('after a crash, a job that was cut off ends its session with a report that says so, and the chat is woken', async t => {
  const h = home(t);
  const name = 'hobkin-fix-totals-a1b2';
  const report = join(h.root, 'runtime', 'handoffs', `${name}.report.md`);
  const session = { name, title: 'Fix totals', cwd: h.root, brief: join(h.root, 'runtime', 'handoffs', `${name}.md`), report, wake: true };
  recordSessionStart(h.root, { name, title: session.title, report, wake: true });
  const first = await h.open({ runHarness: async () => notHere });
  // The run as hobkin left it when its process died: admitted and never finished.
  await first.runtime.admit({ id: `session:${name}`, kind: 'background', scheduleId: `session.${name}`, title: 'Fix totals', harness: 'pi', cwd: h.root, harnessId: 'b0c4f2a1-0d3e-4c55-9a8e-1f2a3b4c5d6e', session });
  await first.close();

  const app = await h.open({ runHarness: async () => notHere });
  const run = (await app.runtime.state()).runs[`session:${name}`];
  assert.equal(run.status, 'interrupted');
  assert.match(run.result.text, CUT_OFF);
  assert.match(readReport(h.root, run.id, ''), CUT_OFF, 'its own report says so too');
  assert.match(readFileSync(report, 'utf8'), CUT_OFF);
  const [woken] = sessionsToWake(h.root);
  assert.equal(woken.name, name);
  assert.match(woken.said, CUT_OFF);
});

const userWords = app => app.runtime.messages().filter(message => message.role === 'user')
  .map(message => (typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('')));
const sessionCalls = calls => async (request, options) => (request.purpose ? notHere : heldCall(calls, request, options));

test('an idle living job takes no place among the routines, and a turn on it takes one again', async t => {
  const h = home(t, { concurrency: 1 });
  const calls = [];
  const app = await h.open({ runHarness: sessionCalls(calls) });
  const count = async () => app.runner.scheduledJobCount(await app.runtime.runIndex());
  await startSession({ root: h.root, title: 'Fix totals', brief: 'Fix the totals.', cwd: h.root, approved: true, tier: 'mid' });
  void app.tickSessions();
  await until(() => calls.length === 1);
  assert.equal(await count(), 1, 'a working job takes its place');

  calls[0].options.onIdle('Which branch should the fix go on?');
  assert.equal(await count(), 0, 'an idle one takes none');
  await startSession({ root: h.root, title: 'Read the logs', brief: 'Read the logs.', cwd: h.root, approved: true, tier: 'fast' });
  void app.tickSessions();
  await until(() => calls.length === 2);

  calls[0].options.onWoken();
  assert.equal(await count(), 2, 'a turn on it takes a place again');
});

test("a living job's reply reaches the main agent once, and the answer reaches the job as a message", async t => {
  const h = home(t);
  const calls = [];
  const app = await h.open({ runHarness: sessionCalls(calls) });
  const started = await startSession({ root: h.root, title: 'Fix totals', brief: 'Fix the totals.', cwd: h.root, approved: true, tier: 'mid' });
  void app.tickSessions();
  await until(() => calls.length === 1);
  calls[0].options.onIdle('Which branch should the fix go on?');

  await app.tickWakes();
  await app.runtime.mainWork;
  await app.tickWakes();
  await app.runtime.mainWork;
  const woken = userWords(app).filter(text => text.startsWith('<hobkin-wake>'));
  assert.equal(woken.length, 1, 'told once');
  assert.deepEqual(JSON.parse(woken[0].split('\n')[1]), { jobs: [{ title: 'Fix totals', routineId: `session.${started.name}`, said: 'Which branch should the fix go on?' }] });

  await app.runner.messageCheck({ scheduleId: `session.${started.name}`, message: 'Put it on fix-totals.' });
  assert.deepEqual(calls[0].heard, ['Put it on fix-totals.']);
  calls[0].options.onWoken();
  calls[0].options.onIdle('');
  await app.tickWakes();
  await app.runtime.mainWork;
  assert.equal(userWords(app).filter(text => text.startsWith('<hobkin-wake>')).length, 1, 'a turn that ends with no words tells nobody');
});

/** Pi's own extensions for these tests: one of the user's own, and none of the Pi scheduler. */
function isolatedPi(t) {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
}
/** hobkin's own harness for sessions, extensions named, on a fake Pi that runs `program`. Other runs are left out. */
const sessionsOn = (program, pids) => (request, options) => (request.purpose ? Promise.resolve(notHere)
  : namingExtensions(runHarness)(request, { ...options, spawnProcess: fake(program, pids) }));

test('a session job lives past its turn, hears the user and its schedules there, and ends with the report hobkin_done gave', { timeout: 20000 }, async t => {
  isolatedPi(t);
  const clock = { now: Date.now() };
  const h = home(t, { now: () => clock.now });
  const pids = [];
  const program = rpc(`
    if (prompts === 1) { say('Which branch should the fix go on?'); settled(); }
    else if (message.startsWith('<hobkin-schedule>')) { say('CI is still running.'); settled(); }
    else done('Useful: The totals add up again, merged into main on fix-totals.', () => { say('Ending.'); settled(); });
  `, { provider: 'fixture', id: 'local' });
  const app = await h.open({ runHarness: sessionsOn(program, pids) });
  const started = await startSession({ root: h.root, title: 'Fix totals', brief: 'Fix the totals.', cwd: h.root, approved: true, wake: true, tier: 'mid' });
  const id = `session:${started.name}`;
  void app.tickSessions();
  await until(() => app.runner.idle.has(id));

  assert.equal((await app.runtime.state()).runs[id].status, 'running', 'its turn ended and it lives on');
  assert.equal(app.runner.idle.get(id).said, 'Which branch should the fix go on?');
  assert.equal(gone(pids[0]), false);

  app.agentSchedules.make({ kind: 'run', id }, h.root, { in: '1m', note: 'Look at CI.' });
  clock.now += 61000;
  await app.tickAgentSchedules();
  await until(() => app.runner.idle.get(id)?.said === 'CI is still running.');
  assert.equal((await app.runtime.state()).runs[id].status, 'running', 'a schedule starts a turn on it and never ends it as waiting');

  await app.runner.messageCheck({ scheduleId: `session.${started.name}`, message: 'Put it on fix-totals.' });
  await until(async () => (await app.runtime.state()).runs[id].status !== 'running');
  const run = (await app.runtime.state()).runs[id];
  assert.equal(run.status, 'completed');
  assert.equal(run.result.text, 'Useful: The totals add up again, merged into main on fix-totals.');
  assert.equal(readFileSync(started.report, 'utf8'), run.result.text);
  assert.equal(sessionsToWake(h.root)[0].name, started.name, 'its end wakes the chat');
  await until(() => gone(pids[0]));
});
