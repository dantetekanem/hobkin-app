import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { initialize } from '../src/cli/config.mjs';
import { runHarness } from '../src/cli/harnesses.mjs';
import { openPiSession } from '../src/cli/pi-session.mjs';

const id = 'f094b0ba-036c-4abc-9198-745fd1226765';
const grant = '/chrome authorize indefinite';

function folder(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'companion-chrome-')));
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
const piChild = ({ commands, dialogTitle = 'Authorize pi-chrome control?' }) => `
let input = '';
let grantId;
const answers = [];
const prompts = [];
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
    else if (cmd.type === 'get_commands') reply({ commands: ${JSON.stringify(commands)} });
    else if (cmd.type === 'get_session_stats') reply({ sessionId: 'pi-job', cost: 0 });
    else if (cmd.type === 'extension_ui_response') {
      answers.push(cmd);
      send({ type: 'response', id: grantId, command: 'prompt', success: true, data: { disposition: 'handled' } });
    } else if (cmd.type === 'prompt' && cmd.message.startsWith('/chrome')) {
      prompts.push(cmd.message);
      grantId = cmd.id;
      send({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: ${JSON.stringify(dialogTitle)} });
    } else if (cmd.type === 'prompt') {
      prompts.push(cmd.message);
      reply({ disposition: 'started' });
      const text = 'Useful: ' + JSON.stringify({ prompts, answers });
      send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }], usage: { cost: { total: 0 } } } });
      send({ type: 'agent_end', messages: [] });
      send({ type: 'agent_settled' });
    } else reply();
  }
});
`;

const spawnChild = program => (_command, _args, options) => spawn(process.execPath, ['--input-type=module', '-e', program], options);
const seenBy = result => JSON.parse(result.text.replace('Useful: ', ''));

test('a check with Chrome installed gets it with no time limit before its prompt', async t => {
  const result = await runHarness(request(folder(t)), { spawnProcess: spawnChild(piChild({ commands: [{ name: 'chrome' }] })) });

  assert.equal(result.status, 'completed');
  const { prompts, answers } = seenBy(result);
  assert.deepEqual(prompts, [grant, 'Do the check.']);
  assert.equal(answers[0].confirmed, true);
});

test('a check without Chrome never sends the command, which would reach the model', async t => {
  const result = await runHarness(request(folder(t)), { spawnProcess: spawnChild(piChild({ commands: [] })) });

  assert.deepEqual(seenBy(result).prompts, ['Do the check.']);
});

test('a check still declines every other dialog', async t => {
  const child = piChild({ commands: [{ name: 'chrome' }], dialogTitle: 'Delete everything?' });

  const result = await runHarness(request(folder(t)), { spawnProcess: spawnChild(child) });

  const [answer] = seenBy(result).answers;
  assert.equal(answer.cancelled, true);
  assert.equal(answer.confirmed, undefined);
});

test('a run with no tools does not ask for Chrome', async t => {
  const result = await runHarness({ ...request(folder(t)), purpose: 'reflection' }, { spawnProcess: spawnChild(piChild({ commands: [{ name: 'chrome' }] })) });

  assert.deepEqual(seenBy(result).prompts, ['Do the check.']);
});

async function runtimeFor(root, model) {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(root, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(root, 'models.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider('fixture', {
    name: 'Synthetic fixture provider',
    api: 'openai-completions',
    baseUrl: 'https://invalid.test',
    apiKey: 'synthetic',
    streamSimple: () => { throw Error('Synthetic tests never call a provider.'); },
    models: [model].map(({ provider, ...entry }) => entry),
  });
  return modelRuntime;
}

async function openChat(t, extensionSource) {
  const root = folder(t);
  const config = initialize(root, { cwd: root });
  const agentDir = join(root, 'agent');
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  if (extensionSource) writeFileSync(join(agentDir, 'extensions', 'fake-chrome.js'), extensionSource);
  const model = {
    id: 'old', name: 'old', provider: 'fixture', api: 'openai-completions', baseUrl: 'https://invalid.test', reasoning: true,
    input: ['text'], contextWindow: 32000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const modelRuntime = await runtimeFor(root, model);
  const session = await openPiSession({ root, config, askQuestion: async () => undefined, triggerSchedule: async () => ({}) }, {
    agentDir,
    modelRuntime,
    createSession: options => createAgentSession({
      ...options,
      modelRuntime,
      model,
      agentDir,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    }),
  });
  t.after(() => session.dispose());
  return { root, session };
}

test('the main chat gets Chrome with no time limit, and only that dialog is approved', async t => {
  const record = join(folder(t), 'grant.json');
  const { session } = await openChat(t, `
    import { writeFileSync } from 'node:fs';
    export default pi => {
      pi.registerCommand('chrome', {
        handler: async (args, ctx) => {
          const consent = await ctx.ui.confirm('Authorize pi-chrome control?', 'This session may control Chrome.');
          const other = await ctx.ui.confirm('Delete everything?', 'Sure?');
          ctx.ui.setStatus('chrome', ctx.ui.theme.fg('success', '●'));
          ctx.ui.notify('Authorized.', 'info');
          writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, consent, other }));
        },
      });
    };
  `);

  assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')), { args: 'authorize indefinite', consent: true, other: false });
  assert.equal(session.extensionRunner.hasUI(), false, 'the temporary UI is gone afterwards');
});

test('the main chat opens normally when Chrome is not installed', async t => {
  const { session } = await openChat(t);

  assert.equal(session.extensionRunner.getRegisteredCommands().some(command => command.invocationName === 'chrome'), false);
  assert.equal(existsSync(session.sessionFile), true);
});

test('a broken Chrome extension cannot stop the main chat from opening', async t => {
  const { session } = await openChat(t, `
    export default pi => {
      pi.registerCommand('chrome', { handler: async () => { throw Error('Bridge is down.'); } });
    };
  `);

  assert.ok(session.sessionId);
});
