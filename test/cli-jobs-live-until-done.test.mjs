import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { namingExtensions, runHarness } from '../src/cli/harnesses.mjs';
import { BRIDGE } from '../src/cli/bridge.mjs';
import { createDoneTool, doneExtension } from '../src/cli/done-extension.mjs';

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
const rpc = body => `
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
    if (cmd.type === 'get_state') reply({ sessionId: 'pi-job', thinkingLevel: 'medium', model: { provider: 'test', id: 'model' } });
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
