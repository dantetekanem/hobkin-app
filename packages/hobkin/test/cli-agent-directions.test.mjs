import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import agentDirections, { directionsExtension } from '../src/cli/agent-directions-extension.mjs';
import { directionsSection, readDirections } from '../src/cli/directions.mjs';
import { runHarness } from '../src/cli/harnesses.mjs';

const home = (t, directions) => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-agent-directions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'AGENTS.md'), directions);
  return root;
};

/** One agent with the extension loaded. Each `systemPrompt()` is what Pi would send for one more of its turns. */
const startAgent = options => {
  const handlers = {};
  agentDirections({ on: (event, handler) => { handlers[event] = handler; } }, options);
  const turn = { type: 'before_agent_start', systemPrompt: 'Base prompt.' };
  return { systemPrompt: () => handlers.before_agent_start(turn).systemPrompt };
};

test('Pi loads the extension hobkin names for the agents its runs spawn', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hobkin-agent-directions-pi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager: SettingsManager.inMemory({}),
    noExtensions: true,
    additionalExtensionPaths: [directionsExtension],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });

  await loader.reload();

  const { errors, extensions } = loader.getExtensions();
  assert.deepEqual(errors, []);
  assert.deepEqual(extensions.map(extension => [extension.path, [...extension.handlers.keys()]]), [[directionsExtension, ['before_agent_start']]]);
});

test("an agent starts with the main chat's directions section, read once as it starts, so an edit reaches the next agent", t => {
  const root = home(t, 'Write plainly.');
  const agent = startAgent({ root });

  assert.equal(agent.systemPrompt(), `Base prompt.\n\n${directionsSection(readDirections(root))}`);
  assert.match(agent.systemPrompt(), /## Directions[\s\S]*Write plainly\./);

  writeFileSync(join(root, 'AGENTS.md'), 'Write tersely.');
  const nextAgent = startAgent({ root });

  assert.match(agent.systemPrompt(), /Write plainly\./, 'a later turn of the same agent keeps what it started with');
  assert.match(nextAgent.systemPrompt(), /Write tersely\./);
});

test('an agent reads the directions of the home HOBKIN_HOME names, as a hobkin command it runs would', t => {
  const root = home(t, 'Ask before sending.');
  const before = process.env.HOBKIN_HOME;
  t.after(() => { if (before === undefined) delete process.env.HOBKIN_HOME; else process.env.HOBKIN_HOME = before; });
  process.env.HOBKIN_HOME = root;

  const agent = startAgent();

  assert.match(agent.systemPrompt(), /Ask before sending\./);
});

test("a hobkin run's Pi starts with the extension named for every agent it spawns", async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-agent-directions-run-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  let env;
  const startProcess = options => {
    env = options.env;
    throw Error('Not started.');
  };
  const run = {
    id: 'f094b0ba-036c-4abc-9198-000000000001',
    harness: 'pi',
    cwd,
    model: null,
    effort: 'medium',
    prompt: 'Go.',
    sessionFile: join(cwd, 'job.jsonl'),
    env: { HOBKIN_HOME: '/hobkin/home' },
  };

  const result = await runHarness(run, { startProcess });

  assert.equal(result.error, 'Not started.');
  assert.equal(env.PI_EXTENDED_TEAMS_AGENT_EXTENSIONS, directionsExtension);
  assert.equal(env.HOBKIN_HOME, '/hobkin/home', "the run's own variables still reach it");
});

test('a teams agent also starts with the index of shared memories, never a private one, and with none when there are no memories', async t => {
  const { addMemory } = await import('../src/cli/memories.mjs');
  const root = home(t, 'Write plainly.');
  assert.equal(startAgent({ root }).systemPrompt(), `Base prompt.\n\n${directionsSection(readDirections(root))}`);
  const as = { by: { kind: 'user' }, source: { kind: 'window' } };
  addMemory(root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon' }, as);
  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, as);
  const prompt = startAgent({ root }).systemPrompt();
  assert.match(prompt, /## Directions[\s\S]*Write plainly\.\n\n## What hobkin remembers\n[\s\S]*- lives-in-lisbon: Lives in Lisbon$/);
  assert.doesNotMatch(prompt, /partner|Ana|hobkin_recall/);
});
