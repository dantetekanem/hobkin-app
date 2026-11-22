import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { askedWait, resumeNote } from '../src/cli/run-waits.mjs';
import { createWaitTool, waitExtension } from '../src/cli/wait-extension.mjs';
import { BRIDGE } from '../src/cli/bridge.mjs';
import { runReport } from '../src/cli/reports.mjs';

const NOW = Date.parse('2026-11-21T23:30:00Z');
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
const told = events => events.filter(event => event.type === 'message_end' && event.message?.role === 'user').map(event => event.message.content);

test('a wait is asked in minutes or for the next time a clock reads, with a note', () => {
  const inMinutes = askedWait({ minutes: 30, note: ' Read the monitoring again. ' }, { now: NOW, waits: 0 });
  assert.deepEqual(inMinutes.wait, { until: new Date(NOW + 30 * 60000).toISOString(), note: 'Read the monitoring again.', askedAt: new Date(NOW).toISOString() });
  assert.match(inMinutes.text, /30 minutes from now/);
  const soon = new Date(NOW + 90 * 60000);
  const at = `${soon.getHours()}:${String(soon.getMinutes()).padStart(2, '0')}`;
  assert.equal(askedWait({ at, note: 'Look again.' }, { now: NOW, waits: 3 }).wait.until, soon.toISOString());
  const past = new Date(NOW - 60 * 60000);
  const tomorrow = Date.parse(askedWait({ at: `${past.getHours()}:${String(past.getMinutes()).padStart(2, '0')}`, note: 'Look again.' }, { now: NOW, waits: 0 }).wait.until);
  assert.ok(tomorrow > NOW && tomorrow - NOW <= 24 * 3600000, 'a clock time already gone today is the one tomorrow');
  assert.match(askedWait({ note: 'Look again.' }, { now: NOW, waits: 0 }).refused, /minutes to wait or a clock time/);
  assert.match(askedWait({ minutes: 5, at: '10:00', note: 'Look again.' }, { now: NOW, waits: 0 }).refused, /minutes to wait or a clock time/);
  assert.match(askedWait({ minutes: 5, note: ' ' }, { now: NOW, waits: 0 }).refused, /note of what to do/);
  assert.match(askedWait({ at: '25:00', note: 'Look again.' }, { now: NOW, waits: 0 }).refused, /24-hour HH:MM/);
  assert.match(askedWait({ minutes: 5, note: 'Look again.' }, { now: NOW, waits: undefined }).refused, /This run cannot wait/);
  assert.match(askedWait({ minutes: 5, note: 'Look again.' }, { now: NOW, waits: 0, agentsOut: 1 }).refused, /agents are still working/);
  assert.match(resumeNote(inMinutes.wait, NOW + 31 * 60000), /Read the monitoring again\.[\s\S]*31 minutes after you asked/);
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
