import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { namingExtensions } from '../src/cli/harnesses.mjs';
import hobkin, { HOBKIN_BRIDGE_TOOLS } from '../src/cli/hobkin-extension.mjs';
import loadSkill, { loadSkillExtension } from '../src/cli/load-skill-extension.mjs';
import { doneExtension } from '../src/cli/done-extension.mjs';
import { isolatePiHome } from './helpers/pi-session.mjs';

const model = {
  id: 'local', name: 'Synthetic', provider: 'fixture', api: 'openai-completions', baseUrl: 'https://invalid.test',
  reasoning: true, input: ['text'], contextWindow: 32000, maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** The model calls each tool in `calls` in turn, then says it is done. The system prompt of each request lands in `prompts`. */
function scriptedModel(session, calls, prompts = []) {
  let index = 0;
  session.agent.streamFunction = () => {
    prompts.push(session.systemPrompt);
    const call = calls[index++];
    const message = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: call ? [{ type: 'toolCall', id: `call-${index}`, name: call.name, arguments: call.arguments }] : [{ type: 'text', text: 'Done.' }],
      stopReason: call ? 'toolUse' : 'stop',
      timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: 'done', reason: message.stopReason, message });
      stream.end();
    });
    return stream;
  };
}

/** A skill's folder with its SKILL.md. One `userOnly` is marked so that only the user may start it. */
function writeSkill(root, { name, description, body, userOnly = false }) {
  const folder = join(root, 'skills', name);
  const frontMatter = [`name: ${name}`, `description: ${description}`, ...(userOnly ? ['disable-model-invocation: true'] : [])];
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), `---\n${frontMatter.join('\n')}\n---\n${body}`);
  return folder;
}

/** A real Pi session that loads only the load_skill extension and the skills given as paths, as `--skill` gives them. */
async function piWithSkills(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-load-skill-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, 'agent');
  isolatePiHome(t, agentDir);

  const humanizer = writeSkill(root, {
    name: 'humanizer',
    description: 'Rewrite text so it reads as a person wrote it.',
    body: '# Humanizer\n\nRead `patterns.md` in this folder first.\n',
  });
  const release = writeSkill(root, { name: 'release', description: 'Cut a release.', body: '# Release\n', userOnly: true });

  const models = await ModelRuntime.create({
    authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'),
    allowModelNetwork: false, refreshOnCreate: false,
  });
  models.getModel = () => model;
  models.streamSimple = () => { throw Error('No provider call allowed'); };
  models.hasConfiguredAuth = () => false;
  models.checkAuth = async () => ({ available: true });

  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalSkillPaths: [join(humanizer, 'SKILL.md'), join(release, 'SKILL.md')],
    extensionFactories: [loadSkill],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: root, agentDir, sessionManager: SessionManager.inMemory(root), resourceLoader, settingsManager, modelRuntime: models, model,
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  return { session, humanizer };
}

const toolResults = session => session.messages.filter(message => message.role === 'toolResult');
const textOf = result => result.content.map(part => part.text).join('');

test("load_skill answers a skill's name and folder first, then its instructions without the front matter", async t => {
  const { session, humanizer } = await piWithSkills(t);
  scriptedModel(session, [{ name: 'load_skill', arguments: { name: 'humanizer' } }]);

  await session.prompt('Polish this.', { preflightResult() {} });

  const [result] = toolResults(session);
  assert.notEqual(result.isError, true);
  assert.equal(textOf(result), `Skill: humanizer\nFolder: ${humanizer}\n\n# Humanizer\n\nRead \`patterns.md\` in this folder first.`);
});

test('load_skill refuses a name it is not offered, and names the skills it can load', async t => {
  const { session } = await piWithSkills(t);
  scriptedModel(session, [
    { name: 'load_skill', arguments: { name: 'tla-plus' } },
    // A skill only the user may start is not offered to the model, so it is not loaded either.
    { name: 'load_skill', arguments: { name: 'release' } },
  ]);

  await session.prompt('Load what you need.', { preflightResult() {} });

  const [unknown, userOnly, ...rest] = toolResults(session);
  assert.deepEqual(rest, []);
  for (const [result, name] of [[unknown, 'tla-plus'], [userOnly, 'release']]) {
    assert.equal(result.isError, true);
    assert.match(textOf(result), new RegExp(`No skill named "${name}"`));
    assert.match(textOf(result), /You can load: humanizer\./);
  }
});

test("the agent's list of skills tells it to load each with load_skill rather than read its file", async t => {
  const { session } = await piWithSkills(t);
  const prompts = [];
  scriptedModel(session, [], prompts);

  await session.prompt('Hello.', { preflightResult() {} });

  const skills = /<skills>\n([\s\S]*?)\n<\/skills>/.exec(prompts[0])?.[1] ?? '';
  assert.match(skills, /load_skill/);
  assert.doesNotMatch(skills, /Use the read tool/);
  assert.match(skills, /<name>humanizer<\/name>/);
  assert.doesNotMatch(skills, /release/);
});

test('every Pi run hobkin starts with tools loads load_skill, and the main chat registers it with its own tools', async t => {
  const agentDir = mkdtempSync(join(tmpdir(), 'hobkin-agent-'));
  isolatePiHome(t, agentDir);
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  const started = [];
  const run = namingExtensions(async job => { started.push(job); });
  const base = { harness: 'pi', cwd: agentDir };

  for (const purpose of [undefined, 'work-do', 'durable']) await run({ ...base, purpose });
  await run({ ...base, untilDone: true });

  const [routine, work, durable, living, ...rest] = started;
  assert.deepEqual(rest, []);
  for (const [job, kind] of [[routine, 'routine'], [work, 'work'], [durable, 'durable'], [living, 'living']]) {
    assert.ok(job.extensions.includes(loadSkillExtension), `a ${kind} run loads load_skill`);
  }
  assert.ok(living.extensions.includes(doneExtension), 'the living job is one');

  const registered = [];
  const mainChatPi = {
    registerTool: tool => registered.push(tool.name),
    on() {},
    getActiveTools: () => [],
    setActiveTools() {},
  };
  hobkin(mainChatPi);
  assert.ok(registered.includes('load_skill'));
  assert.ok(HOBKIN_BRIDGE_TOOLS.includes('load_skill'), "the main chat's exact tool list expects it");
});
