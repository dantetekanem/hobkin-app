import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { initialize } from '../src/cli/config.mjs';
import { runHarness } from '../src/cli/harnesses.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';

const id = 'f094b0ba-036c-4abc-9198-745fd1226765';

function folder(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-chrome-')));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

const request = cwd => ({
  id,
  harness: 'pi',
  cwd,
  model: null,
  effort: 'medium',
  prompt: 'Do the check.',
  sessionFile: join(cwd, 'job.jsonl'),
});

// A Pi child that offers the given commands and asks one consent question for the grant.
const piChild = ({ commands, dialogTitle = 'Authorize pi-chrome control?', dialogOnPrompt = false }) => `
let input = '';
let grantId;
const answers = [];
const prompts = [];
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
const finish = () => {
  const text = 'Useful: ' + JSON.stringify({ prompts, answers });
  send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }], usage: { cost: { total: 0 } } } });
  send({ type: 'agent_end', messages: [] });
  send({ type: 'agent_settled' });
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
    else if (cmd.type === 'get_commands') reply({ commands: ${JSON.stringify(commands)} });
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-job', cost: 0 });
    else if (cmd.type === 'extension_ui_response') {
      answers.push(cmd);
      if (grantId) send({ type: 'response', id: grantId, command: 'prompt', success: true, data: { disposition: 'handled' } });
      else finish();
    } else if (cmd.type === 'prompt' && cmd.message.startsWith('/chrome')) {
      prompts.push(cmd.message);
      grantId = cmd.id;
      send({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: ${JSON.stringify(dialogTitle)} });
    } else if (cmd.type === 'prompt') {
      prompts.push(cmd.message);
      reply({ disposition: 'started' });
      grantId = undefined;
      if (${dialogOnPrompt}) send({ type: 'extension_ui_request', id: 'ui-job', method: 'confirm', title: ${JSON.stringify(dialogTitle)} });
      else finish();
    } else reply();
  }
});
`;

const spawnChild = program => (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', program], options);
const seenBy = result => JSON.parse(result.text.replace('Useful: ', ''));

test('a check with Chrome installed submits only its ordinary prompt', async t => {
  const result = await runHarness(request(folder(t)), { spawnProcess: spawnChild(piChild({ commands: [{ name: 'chrome' }] })) });

  assert.equal(result.status, 'completed');
  const { prompts, answers } = seenBy(result);
  assert.deepEqual(prompts, ['Do the check.']);
  assert.deepEqual(answers, []);
});

test('a check without Chrome never sends the command, which would reach the model', async t => {
  const result = await runHarness(request(folder(t)), { spawnProcess: spawnChild(piChild({ commands: [] })) });

  assert.deepEqual(seenBy(result).prompts, ['Do the check.']);
});

for (const dialogTitle of ['Authorize pi-chrome control?', 'Delete everything?']) {
  test(`an unattended check declines ${dialogTitle}`, async t => {
    const child = piChild({ commands: [], dialogTitle, dialogOnPrompt: true });
    const result = await runHarness(request(folder(t)), { spawnProcess: spawnChild(child) });
    assert.equal(result.status, 'completed');
    assert.deepEqual(seenBy(result).answers, [{ type: 'extension_ui_response', id: 'ui-job', cancelled: true }]);
  });
}

test('a run with no tools does not ask for Chrome', async t => {
  const result = await runHarness({ ...request(folder(t)), purpose: 'reflection' }, { spawnProcess: spawnChild(piChild({ commands: [{ name: 'chrome' }] })) });

  assert.deepEqual(seenBy(result).prompts, ['Do the check.']);
});

for (const availability of ['installed', 'absent', 'broken']) {
  test(`the main chat opens and accepts its ordinary prompt with Chrome ${availability}`, async t => {
    const root = folder(t);
    const config = initialize(root, { cwd: root });
    // Never execute the SDK's installed or inline extension loaders in this fixture.
    t.mock.method(DefaultResourceLoader.prototype, 'reload', async () => {});
    const prompts = [];
    const commands = t.mock.fn(() => {
      if (availability === 'broken') throw Error('Command listing is unavailable.');
      return availability === 'installed' ? [{ invocationName: 'chrome' }] : [];
    });
    let bound = false;
    const session = await openPiSession({ root, config }, {
      agentDir: join(root, 'agent'),
      createSession: async ({ sessionManager, thinkingLevel }) => ({ session: {
        sessionId: sessionManager.getSessionId(),
        sessionFile: sessionManager.getSessionFile(),
        thinkingLevel,
        model: { provider: 'fixture', id: 'local' },
        extensionRunner: { getRegisteredCommands: commands },
        async bindExtensions() { bound = true; },
        async prompt(text) { prompts.push(text); return 'Useful reply.'; },
        dispose() {},
      } }),
    });
    t.after(() => session.dispose());
    assert.equal(bound, true);
    assert.ok(session.sessionId);
    assert.equal(existsSync(session.sessionFile), true);
    assert.equal(commands.mock.callCount(), 0);
    assert.deepEqual(prompts, []);
    assert.equal(await session.prompt('Do the check.'), 'Useful reply.');
    assert.deepEqual(prompts, ['Do the check.']);
  });
}
