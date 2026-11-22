import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { askedWait, resumeNote } from '../src/cli/run-waits.mjs';
import { createWaitTool, waitExtension } from '../src/cli/wait-extension.mjs';
import { BRIDGE } from '../src/cli/bridge.mjs';
import { readReport, runReport } from '../src/cli/reports.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { startSession } from '../src/cli/session.mjs';
import { allCardActions } from '../src/cli/work/card-actions.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-21T23:30:00Z');
const iso = time => new Date(time).toISOString();
const id = 'f094b0ba-036c-4abc-9198-745fd1226765';

function request(t, extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-waits-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { id, harness: 'pi', cwd, model: null, effort: 'medium', prompt: 'Deploy and watch.', sessionFile: join(cwd, 'job.jsonl'), ...extra };
}

/** A fake Pi on RPC. `body` runs on each prompt, with `prompts` counting them and `message` the words it was given. */
const rpc = (body, { model = { provider: 'test', id: 'model' }, effort = 'medium' } = {}) => `
let input = '';
let prompts = 0;
const answers = new Map();
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
const say = (text, stopReason = 'stop', calls = []) => send({ type: 'message_end', message: { role: 'assistant', stopReason,
  content: [...(text ? [{ type: 'text', text }] : []), ...calls.map((name, at) => ({ type: 'toolCall', id: 'call-' + at, name, arguments: {} }))] } });
const ran = name => send({ type: 'tool_execution_end', toolName: name, isError: false, result: { content: [], details: {} } });
const settled = () => send({ type: 'agent_settled' });
const ask = (params, then) => {
  const id = 'wait-' + answers.size;
  answers.set(id, then);
  send({ type: 'extension_ui_request', id, method: 'input', title: ${JSON.stringify(BRIDGE)}, placeholder: JSON.stringify({ op: 'wait', ...params }) });
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const cmd = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    const reply = data => send({ type: 'response', id: cmd.id, command: cmd.type, success: true, data });
    if (cmd.type === 'get_state') reply({ sessionId: 'pi-job', thinkingLevel: ${JSON.stringify(effort)}, model: ${JSON.stringify(model)} });
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-job', cost: 0.25 });
    else if (cmd.type === 'extension_ui_response') { const then = answers.get(cmd.id); answers.delete(cmd.id); then?.(JSON.parse(cmd.value)); }
    else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      prompts++;
      const message = cmd.message;
      send({ type: 'agent_start' });
      send({ type: 'message_end', message: { role: 'user', content: message } });
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
const told = events => events
  .filter(event => event.type === 'message_end' && event.message?.role === 'user')
  .map(event => event.message.content);
/** The local clock's `HH:MM` at a time, as an agent would ask for it. */
const clockAt = time => `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`;

test('a wait is asked in minutes or for the next time a clock reads, with a note', () => {
  const run = { now: NOW, waits: 0 };

  const inMinutes = askedWait({ minutes: 30, note: ' Read the monitoring again. ' }, run);
  assert.deepEqual(inMinutes.wait, { until: iso(NOW + 30 * 60000), note: 'Read the monitoring again.', askedAt: iso(NOW) });
  assert.match(inMinutes.text, /30 minutes from now/);
  assert.match(resumeNote(inMinutes.wait, NOW + 31 * 60000), /Read the monitoring again\.[\s\S]*31 minutes after you asked/);

  const soon = new Date(NOW + 90 * 60000);
  assert.equal(askedWait({ at: clockAt(soon), note: 'Look again.' }, { now: NOW, waits: 3 }).wait.until, soon.toISOString());

  const tomorrow = Date.parse(askedWait({ at: clockAt(new Date(NOW - 60 * 60000)), note: 'Look again.' }, run).wait.until);
  assert.ok(tomorrow > NOW && tomorrow - NOW <= 24 * 3600000, 'a clock time already gone today is the one tomorrow');

  assert.match(askedWait({ note: 'Look again.' }, run).refused, /minutes to wait or a clock time/);
  assert.match(askedWait({ minutes: 5, at: '10:00', note: 'Look again.' }, run).refused, /minutes to wait or a clock time/);
  assert.match(askedWait({ minutes: 5, note: ' ' }, run).refused, /note of what to do/);
  assert.match(askedWait({ at: '25:00', note: 'Look again.' }, run).refused, /24-hour HH:MM/);
  assert.match(askedWait({ minutes: 5, note: 'Look again.' }, { now: NOW, waits: undefined }).refused, /This run cannot wait/);
  assert.match(askedWait({ minutes: 5, note: 'Look again.' }, { ...run, agentsOut: 1 }).refused, /agents are still working/);
});

test('hobkin_wait asks the host over the run\'s own bridge and answers in the host\'s words', async () => {
  const asked = [];
  const ctx = { mode: 'rpc', ui: { input: async (title, placeholder) => {
    asked.push([title, JSON.parse(placeholder)]);
    return JSON.stringify({ ok: true, result: { text: 'hobkin will start you again.', until: '2026-11-22T00:00:00.000Z', note: 'Look again.' } });
  } } };
  const answer = await createWaitTool().execute('call', { minutes: 30, note: 'Look again.' }, undefined, undefined, ctx);
  assert.deepEqual(asked, [[BRIDGE, { op: 'wait', minutes: 30, note: 'Look again.' }]]);
  assert.deepEqual(answer, { content: [{ type: 'text', text: 'hobkin will start you again.' }], details: { until: '2026-11-22T00:00:00.000Z', note: 'Look again.' } });
  const refused = { mode: 'rpc', ui: { input: async () => JSON.stringify({ ok: false, error: 'A wait is at most 24 hours.' }) } };
  await assert.rejects(createWaitTool().execute('call', { minutes: 2000, note: 'Look again.' }, undefined, undefined, refused), /at most 24 hours/);
});

test('only a run that can wait is given hobkin_wait', async t => {
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
  await run(request(t, { waits: 0 }));
  await run(request(t));
  assert.equal(started[0].extensions.includes(waitExtension), true);
  assert.equal(started[1].extensions.includes(waitExtension), false);
});

test('a wait over 24 hours or past the twelfth is refused in the tool\'s answer and the run ends as usual', { timeout: 5000 }, async t => {
  for (const [asked, waits, refusal] of [
    [{ minutes: 1500, note: 'Read the monitoring again.' }, 0, /A wait is at most 24 hours/],
    [{ minutes: 30, note: 'Read the monitoring again.' }, 12, /This run has waited 12 times, the most one run may/],
  ]) {
    const program = rpc(`ask(${JSON.stringify(asked)}, answer => { say('Useful: ' + (answer.ok ? answer.result.text : answer.error)); settled(); });`);
    const result = await runHarness(request(t, { waits }), { spawnProcess: fake(program), now: () => NOW });
    assert.equal(result.status, 'completed');
    assert.match(result.text, refusal);
    assert.equal(result.wait, undefined);
  }
});

test('a run whose agent asks to wait and ends its turn ends waiting, with its process gone', { timeout: 5000 }, async t => {
  const pids = [];
  const program = rpc(`ask({ minutes: 30, note: 'Read the monitoring again.' }, answer => { say('Waiting until ' + answer.result.until + '.'); settled(); });`);
  const result = await runHarness(request(t, { waits: 2 }), { spawnProcess: fake(program, pids), now: () => NOW });
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.wait, { until: new Date(NOW + 30 * 60000).toISOString(), note: 'Read the monitoring again.', askedAt: new Date(NOW).toISOString() });
  assert.equal(result.text, `Waiting until ${result.wait.until}.`);
  assert.equal(result.cost.usd, 0.25);
  assert.throws(() => process.kill(pids[0], 0), { code: 'ESRCH' });
});

test('a wait belongs to the turn that asked for it', { timeout: 5000 }, async t => {
  // A later turn of the same process, as when an agent's report comes in, that ends without asking again ends the run.
  const program = rpc(`ask({ minutes: 30, note: 'Look again.' }, () => {
    say('Waiting.');
    send({ type: 'agent_start' });
    say('Useful: Done after the report.');
    settled();
  });`);
  const result = await runHarness(request(t, { waits: 0 }), { spawnProcess: fake(program), now: () => NOW });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Useful: Done after the report.');
});

test('a run that stops on task_wait is told once to use hobkin_wait and goes on', { timeout: 8000 }, async t => {
  const stopsOnTaskWait = "say('Watching for 30 minutes.', 'toolUse', ['schedule_task', 'task_wait']); ran('schedule_task'); ran('task_wait'); settled();";
  const waits = { waits: 0, extensions: [waitExtension] };

  const events = [];
  const goesOn = rpc(`
    if (prompts === 1) { ${stopsOnTaskWait} }
    else ask({ minutes: 30, note: 'Read the monitoring again.' }, () => { say('Waiting for the watch.'); settled(); });
  `);
  const waited = await runHarness(request(t, waits), { spawnProcess: fake(goesOn), now: () => NOW, onEvent: event => events.push(event) });
  assert.equal(waited.status, 'waiting');
  const [, followUp] = told(events);
  assert.match(followUp, /You stopped on schedule_task and task_wait\./);
  assert.match(followUp, /cancel it with cancel_scheduled_task/);
  assert.match(followUp, /call hobkin_wait with the minutes or a clock time/);

  const again = rpc(stopsOnTaskWait);
  const twice = [];
  const failed = await runHarness(request(t, waits), { spawnProcess: fake(again), now: () => NOW, onEvent: event => twice.push(event) });
  assert.equal(told(twice).length, 2, 'told once');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'The agent stopped in the middle of a step, a call to schedule_task and task_wait, and did not come back.');

  const cannot = [];
  const finishes = rpc(`if (prompts === 1) { ${stopsOnTaskWait} } else { say('Useful: Deployed; the watch is left to the next look.'); settled(); }`);
  const finished = await runHarness(request(t), { spawnProcess: fake(finishes), now: () => NOW, onEvent: event => cannot.push(event) });
  assert.equal(finished.status, 'completed');
  assert.match(told(cannot)[1], /This run cannot wait, so finish what you can now/);
});

test('a run that stops in the middle of a step fails in plain words', { timeout: 5000 }, async t => {
  const program = rpc("say('', 'toolUse', ['bash']); ran('bash'); settled();");
  const result = await runHarness(request(t, { waits: 0 }), { spawnProcess: fake(program), now: () => NOW });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'The agent stopped in the middle of a step, a call to bash, and did not come back.');
  const report = runReport(result);
  assert.match(report, /^The run failed: The agent stopped in the middle of a step, a call to bash, and did not come back\./);
  assert.doesNotMatch(report, /toolUse/);
});

/**
 * A temporary home whose sessions run on `fixture/local` at medium, as its tiers give them, `concurrency` at once. The
 * home goes once every app opened on it has closed, since a closing app still writes there.
 */
function home(t, { concurrency } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-waits-home-')));
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

  const fake = fakePi(root);
  const open = async options => {
    const app = await HobkinApplication.open(root, { createMain: fake.createMain, intervalMs: 60000, ...options });
    opened.push(app);
    return app;
  };
  return { root, open };
}
const NOTE = 'Read the monitoring again.';
const waitingFor = (minutes, at) => ({ status: 'waiting', text: 'Deployed. Waiting to read the monitoring.', cost: null, freshSession: true,
  wait: { until: iso(at + minutes * 60000), note: NOTE, askedAt: iso(at) } });
const held = { status: 'completed', text: 'Useful: The deploy held for its 30 minutes.', cost: null };
// The report's editor and its short version are runs of their own, and these tests leave them out.
const notHere = { status: 'failed', cost: null, error: 'Not in this test.' };
/** A harness for sessions only, which answers each start with what `answers` gives for it, counting from 1. */
const scripted = (calls, answers) => async request => {
  if (request.purpose) return notHere;
  calls.push(request);
  return answers(calls.length, request);
};
const session = (h, title) => startSession({ root: h.root, title, brief: `${title} and watch.`, cwd: h.root, approved: true });
const runOf = async (app, started) => (await app.runtime.state()).runs[`session:${started.name}`];
const ended = root => readFileSync(join(root, 'runtime/handoffs/sessions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(line => line.endedAt);

test('a session that asks to wait ends its turn waiting, with no report, no process and its place free', { timeout: 10000 }, async t => {
  const h = home(t, { concurrency: 1 });
  const pids = [];
  const program = rpc(`
    if (message.includes('hobkin-second')) { say('Useful: The second session ran.'); settled(); }
    else ask({ minutes: 30, note: ${JSON.stringify(NOTE)} }, () => { say('Deployed. Waiting 30 minutes to read the monitoring.'); settled(); });
  `, { model: { provider: 'fixture', id: 'local' } });
  const app = await h.open({ now: () => NOW,
    runHarness: (request, options) => (request.purpose ? Promise.resolve(notHere)
      : runHarness(request, { ...options, now: () => NOW, spawnProcess: fake(program, pids) })) });
  t.after(() => app.close());
  const started = await session(h, 'Deploy');
  await app.tickSessions();

  const run = await runOf(app, started);
  assert.equal(run.status, 'waiting');
  assert.deepEqual(run.wait, { until: iso(NOW + 30 * 60000), note: NOTE, askedAt: iso(NOW),
    said: 'Deployed. Waiting 30 minutes to read the monitoring.', waits: 1, freshSession: true });
  assert.equal(run.finishedAt, undefined);
  assert.equal(readReport(h.root, run.id, null), null, 'no report is filed');
  assert.equal(existsSync(started.report), false);
  assert.deepEqual(ended(h.root), [], 'the session has not ended');
  assert.throws(() => process.kill(pids[0], 0), { code: 'ESRCH' });
  assert.equal(app.runner.scheduledJobCount(await app.runtime.runIndex()), 0);

  const second = await session(h, 'Second');
  await app.tickSessions();
  assert.equal((await runOf(app, second)).status, 'completed', 'its one place went to the next session');
  assert.equal((await runOf(app, started)).status, 'waiting');
});

test('at its time a waiting session starts again on its own session with its note and files one report', async t => {
  const h = home(t);
  let clock = NOW;
  const calls = [];
  const app = await h.open({ now: () => clock, runHarness: scripted(calls, count => (count === 1 ? waitingFor(30, clock) : held)) });
  t.after(() => app.close());
  const started = await session(h, 'Deploy');
  await app.tickSessions();
  clock = NOW + 29 * 60000;
  await app.tickSessions();
  assert.equal(calls.length, 1, 'not before its time');

  clock = NOW + 31 * 60000;
  await app.tickSessions();
  const [first, again] = calls;
  assert.deepEqual([again.id, again.sessionFile, again.cwd], [first.id, first.sessionFile, first.cwd]);
  assert.deepEqual([first.waits, again.waits], [0, 1]);
  assert.match(again.prompt, /Read the monitoring again\.[\s\S]*31 minutes after you asked/);
  const run = await runOf(app, started);
  assert.equal(run.status, 'completed');
  assert.equal(run.result.freshSession, true, 'its cost still counts from the session it began');
  assert.equal(readReport(h.root, run.id, null), held.text);
  assert.equal(readFileSync(started.report, 'utf8'), held.text);
  assert.equal(ended(h.root).length, 1);
  await app.tickSessions();
  assert.equal(calls.length, 2, 'it ran once more and no more');
});

test('a waiting session whose time has come starts only when a place is free', async t => {
  const h = home(t, { concurrency: 1 });
  let clock = NOW;
  const calls = [];
  const gate = Promise.withResolvers(), busy = Promise.withResolvers();
  const app = await h.open({ now: () => clock, runHarness: scripted(calls, count => {
    if (count === 1) return waitingFor(30, clock);
    if (count === 2) { busy.resolve(); return gate.promise; }
    return held;
  }) });
  t.after(() => { gate.resolve(notHere); return app.close(); });
  const deploy = await session(h, 'Deploy');
  await app.tickSessions();
  await session(h, 'Busy');
  const busyEnded = app.tickSessions();
  await busy.promise;

  clock = NOW + 31 * 60000;
  void app.tickSessions();
  await app.runner.serialize(() => {});
  assert.equal(calls.length, 2);
  assert.equal((await runOf(app, deploy)).status, 'waiting', 'it waits its turn');

  gate.resolve({ status: 'completed', text: 'Useful: Busy finished.', cost: null });
  await busyEnded;
  await app.tickSessions();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].id, calls[0].id);
  assert.equal((await runOf(app, deploy)).status, 'completed');
});

test('a wait outlives a restart and starts at once when its time passed while hobkin was closed', async t => {
  const h = home(t);
  let clock = NOW;
  const calls = [];
  const options = { now: () => clock, runHarness: scripted(calls, count => (count === 1 ? waitingFor(30, clock) : held)) };
  let app = await h.open(options);
  const started = await session(h, 'Deploy');
  await app.tickSessions();
  assert.equal((await runOf(app, started)).status, 'waiting');
  await app.close();

  clock = NOW + 2 * 3600000;
  app = await h.open(options);
  t.after(() => app.close());
  await app.tickSessions();
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /120 minutes after you asked/);
  assert.equal((await runOf(app, started)).status, 'completed');
});

test('stopping a waiting session ends it with its report and it never starts again', async t => {
  const h = home(t);
  let clock = NOW;
  const calls = [];
  const app = await h.open({ now: () => clock, runHarness: scripted(calls, () => waitingFor(30, clock)) });
  t.after(() => app.close());
  const started = await session(h, 'Deploy');
  await app.tickSessions();
  const id = `session:${started.name}`;

  assert.equal(await app.kill(id), true);
  const run = await runOf(app, started);
  assert.equal(run.status, 'interrupted');
  assert.deepEqual(run.userStop, { source: 'user', reason: 'Stopped from the agent view.' });
  assert.match(readReport(h.root, id, ''), /^Deployed\. Waiting to read the monitoring\.[\s\S]*stopped it while it waited/);
  assert.equal(readFileSync(started.report, 'utf8'), 'Deployed. Waiting to read the monitoring.');
  assert.deepEqual(ended(h.root).map(line => line.userStop?.runId), [id]);
  assert.ok(allCardActions(h.root).some(action => action.id === `user-stop:${id}`));
  assert.equal(await app.kill(id), false);

  clock = NOW + 3600000;
  await app.tickSessions();
  assert.equal(calls.length, 1);
  assert.equal((await runOf(app, started)).status, 'interrupted');
});

test('a waiting run shows in the snapshot as waiting, with until when and why', async t => {
  const h = home(t);
  const app = await h.open({ now: () => NOW, runHarness: scripted([], () => waitingFor(30, NOW)) });
  t.after(() => app.close());
  const started = await session(h, 'Deploy');
  await app.tickSessions();
  const view = await app.refresh();
  const shown = view.runs.find(run => run.id === `session:${started.name}`);
  assert.deepEqual([shown.state, shown.waitUntil, shown.waitNote, shown.waits], ['waiting', iso(NOW + 30 * 60000), NOTE, 1]);
  assert.equal(view.reports.some(report => report.id === shown.id), false);
  assert.equal(Object.hasOwn(view.completedJobReports, shown.id), false);
  assert.equal(view.messages.some(message => /Report available/.test(message.content ?? '')), false);
});

test("a run's row in the snapshot names the tier it runs at", async t => {
  const h = home(t);
  const app = await h.open({ now: () => NOW, runHarness: scripted([], () => waitingFor(30, NOW)) });
  const started = await startSession({ root: h.root, title: 'Deploy', brief: 'Deploy and watch.', cwd: h.root, approved: true, tier: 'high' });
  await app.tickSessions();

  const view = await app.refresh();

  assert.equal(view.runs.find(run => run.id === `session:${started.name}`).tier, 'high');
});
