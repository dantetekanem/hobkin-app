import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHarness } from '../src/cli/harnesses.mjs';

const MIB = 1048576;
const id = 'f094b0ba-036c-4abc-9198-745fd1226765';

function request(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-rpc-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { id, harness: 'pi', cwd, model: null, effort: 'medium', prompt: 'Go.', sessionFile: join(cwd, 'job.jsonl') };
}

const piThat = onPrompt => (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', `
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
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-job', cost: 0.25 });
    else if (cmd.type === 'get_commands') reply({ commands: [] });
    else if (cmd.type === 'prompt') {
      reply({ disposition: 'started' });
      ${onPrompt}
    }
  }
});
`], options);

const finishing = "send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Useful: Done.' }] } });";
const settling = "send({ type: 'agent_settled' });";
// Pi repeats a whole run in `agent_end`, so the biggest record of a long run comes when its work is done.
const wholeRun = bytes => `send({ type: 'agent_end', messages: ['${'x'.repeat(16)}'.repeat(${Math.ceil(bytes / 16)})] });`;

test('a run whose last record repeats everything it did still finishes with its report', async t => {
  const result = await runHarness(request(t), { spawnProcess: piThat(`${finishing}${wholeRun(2 * MIB)}${settling}`) });

  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Useful: Done.');
});

test('one oversized record leaves the records after it intact', async t => {
  const events = [];
  const result = await runHarness(request(t), {
    spawnProcess: piThat(`
      send({ type: 'tool_execution_end', toolName: 'read', result: 'x'.repeat(${2 * MIB}) });
      send({ type: 'tool_execution_end', toolName: 'read', result: 'small' });
      ${finishing}${settling}
    `),
    onEvent: event => events.push(event.type),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(events.filter(type => type === 'tool_execution_end'), ['tool_execution_end'], 'only the one that fits reaches tracking');
});

test('a reply too big to read ends the run, because something is waiting for it', async t => {
  const result = await runHarness(request(t), {
    spawnProcess: (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', `
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', chunk => {
        const { id } = JSON.parse(chunk.split('\\n')[0]);
        process.stdout.write(JSON.stringify({ id, type: 'response', command: 'get_state', success: true, data: 'x'.repeat(${2 * MIB}) }) + '\\n');
      });
    `], options),
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /record exceeded its byte limit/);
});

test('oversized records have a limit of their own, so a child cannot pour them out for ever', async t => {
  const result = await runHarness(request(t), {
    maxOutputBytes: 4 * MIB,
    spawnProcess: piThat(`
      for (let index = 0; index < 4; index++) send({ type: 'tool_execution_end', result: 'x'.repeat(${2 * MIB}) });
      ${finishing}${settling}
    `),
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /record exceeded its byte limit/);
});
