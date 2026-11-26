import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { readEvents, recordEvent } from '../src/cli/events.mjs';
import { namingExtensions } from '../src/cli/harnesses.mjs';
import { main } from '../src/cli/main.mjs';
import outwardGuard, { outwardGuardExtension, RUN_KIND_ENV } from '../src/cli/outward-guard-extension.mjs';
import { TRANSPORT_TYPES, transportEvent, transportId } from '../src/cli/telemetry/events.mjs';
import { telemetryView } from '../src/cli/telemetry/views.mjs';
import { isolatePiHome } from './helpers/pi-session.mjs';

// No test here may reach the user's real home, so the home any default falls back to is a throwaway one.
const fallbackHome = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-outward-fallback-')));
process.env.HOBKIN_HOME = fallbackHome;
after(() => rmSync(fallbackHome, { recursive: true, force: true }));

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-outward-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const attempts = root => readEvents(root, { since: 0 }).filter(({ type }) => type === 'outward_attempt');

/** A Pi as the guard sees it: the handlers it registers, the tools it can list, and a conversation kept at `sessionFile`. */
function fakePi({ tools = [] } = {}) {
  const handlers = new Map();
  return {
    on: (name, handler) => handlers.set(name, handler),
    getAllTools: () => tools.map(name => ({ name })),
    say: (text, source = 'interactive') => handlers.get('input')({ type: 'input', text, source }),
    call: (toolName, input, sessionFile) => handlers.get('tool_call')(
      { type: 'tool_call', toolCallId: 'call-1', toolName, input },
      { sessionManager: { getSessionFile: () => sessionFile } },
    ),
  };
}

const send = { to: 'someone@example.invalid', subject: 'The secret plan', body: 'Meet at noon' };

test('an outward call is recorded once with its kind, the verdict and the run, never its arguments, and it is not blocked', async t => {
  const root = home(t);
  const pi = fakePi();
  outwardGuard(pi, { root, env: {} });

  assert.equal(await pi.call('mcp__gmail__gmail_send', send, join(root, 'sessions', 'main.jsonl')), undefined);
  assert.equal(await pi.call('read', { path: '/tmp/x' }), undefined);
  assert.equal(await pi.call('bash', { command: 'git status' }), undefined);

  const [recorded, ...rest] = attempts(root);
  assert.deepEqual(rest, []);
  assert.deepEqual(Object.keys(recorded).sort(), ['at', 'kind', 'run', 'type', 'verdict']);
  assert.deepEqual([recorded.kind, recorded.verdict, recorded.run], ['send', 'would-block', 'main']);
  const written = readFileSync(join(root, 'runtime', 'events', `${recorded.at.slice(0, 7)}.jsonl`), 'utf8');
  for (const word of ['example.invalid', 'secret', 'noon', 'gmail']) assert.equal(written.includes(word), false, word);
});

test('the run is the one its variable names, or the one its conversation\'s place says, or unknown', async t => {
  const root = home(t);
  const runOf = async ({ env = {}, file, tools }) => {
    const pi = fakePi({ tools });
    outwardGuard(pi, { root, env });
    await pi.call('mcp__slack__chat_postMessage', { text: 'hi' }, file);
    return attempts(root).at(-1).run;
  };

  assert.equal(await runOf({ env: { [RUN_KIND_ENV]: 'routine' }, file: join(root, 'jobs', 'a.jsonl') }), 'routine');
  assert.equal(await runOf({ env: { [RUN_KIND_ENV]: 'work' }, file: join(root, 'jobs', 'b.jsonl') }), 'work');
  assert.equal(await runOf({ file: join(root, 'sessions', 'main-0b7c1a0e-6e51-4d7e-9d0c-6f1f3d7b2a11.jsonl') }), 'main');
  assert.equal(await runOf({ file: join(root, 'hobkins', 'h1.jsonl') }), 'durable');
  assert.equal(await runOf({ file: join(root, 'jobs', 'c.jsonl'), tools: ['hobkin_done'] }), 'session');
  assert.equal(await runOf({ file: join(root, 'jobs', 'd.jsonl') }), 'unknown');
  assert.equal(await runOf({ env: { [RUN_KIND_ENV]: 'everything' }, file: undefined }), 'unknown');
});

test('only the user\'s own words in the main chat count as an ask; "continue", an extension\'s message and a stored prompt do not', async t => {
  const root = home(t);
  const verdictAfter = async (said, { source, file = join(root, 'sessions', 'main.jsonl') } = {}) => {
    const pi = fakePi();
    outwardGuard(pi, { root, env: {} });
    if (said !== undefined) await pi.say(said, source);
    await pi.call('mcp__gmail__gmail_send', send, file);
    return attempts(root).at(-1).verdict;
  };

  assert.equal(await verdictAfter('Send Sam the notes from today'), 'allowed-by-ask');
  assert.equal(await verdictAfter('continue'), 'would-block');
  assert.equal(await verdictAfter(undefined), 'would-block');
  assert.equal(await verdictAfter('Send Sam the notes', { source: 'extension' }), 'would-block');
  assert.equal(await verdictAfter('<hobkin-wake>\n{"schedules":[{"said":"send the weekly email"}]}\n</hobkin-wake>'), 'would-block');
  assert.equal(await verdictAfter('Send Sam the notes', { file: join(root, 'jobs', 'r.jsonl') }), 'would-block');
});

test('a standing rule for that kind allows it, and a missing or broken rules file allows nothing', async t => {
  const root = home(t);
  const verdict = async () => {
    const pi = fakePi();
    outwardGuard(pi, { root, env: { [RUN_KIND_ENV]: 'routine' } });
    await pi.call('mcp__gmail__calendar_respondToEvent', { eventId: 'e1', response: 'accepted' });
    return attempts(root).at(-1).verdict;
  };
  const rules = join(root, 'runtime', 'standing-rules.json');

  assert.equal(await verdict(), 'would-block');
  mkdirSync(join(root, 'runtime'), { recursive: true });
  writeFileSync(rules, '{ not json');
  assert.equal(await verdict(), 'would-block');
  writeFileSync(rules, JSON.stringify({ version: 1, rules: [
    { id: 'r1', kind: 'outward', match: 'calendar-write', then: 'allow', said: 'Accept invites from my team.', savedAt: '2026-11-26T09:00:00.000Z', by: 'user' },
  ] }));
  assert.equal(await verdict(), 'allowed-by-rule');
  writeFileSync(rules, JSON.stringify({ version: 2, rules: [{ kind: 'outward', match: 'calendar-write', then: 'allow' }] }));
  assert.equal(await verdict(), 'would-block');
});

test('without a home named, an attempt lands in the home that keeps the conversation', async t => {
  for (const folder of ['sessions', 'jobs', 'hobkins']) {
    const root = home(t);
    const pi = fakePi();
    outwardGuard(pi, { env: {} });
    const conversation = folder === 'sessions' ? 'main.jsonl' : 'a.jsonl';

    await pi.call('mcp__gmail__gmail_send', send, join(root, folder, conversation));

    assert.equal(attempts(root).length, 1, folder);
  }
});

test('watching never stops a call, even when nothing can be written or the conversation cannot be read', async t => {
  const root = home(t);
  const blocked = join(root, 'file');
  writeFileSync(blocked, 'not a folder');
  const pi = fakePi();
  outwardGuard(pi, { root: blocked, env: {} });
  assert.equal(await pi.call('mcp__gmail__gmail_send', send), undefined);

  const broken = fakePi();
  broken.getAllTools = () => { throw Error('no tools'); };
  outwardGuard(broken, { root, env: {} });
  assert.equal(await broken.call('mcp__gmail__gmail_send', send, join(root, 'jobs', 'x.jsonl')), undefined);
  assert.deepEqual(attempts(root), []);
});

test('an outward attempt never leaves this machine', () => {
  const idFor = (namespace, value) => transportId('a'.repeat(64), namespace, value);
  const local = { at: '2026-11-26T10:00:00.000Z', type: 'outward_attempt', kind: 'send', verdict: 'would-block', run: 'routine' };

  assert.equal(transportEvent(local, { eventId: idFor('event', 'x'), idFor }), null);
  assert.equal(TRANSPORT_TYPES.includes('outward_attempt'), false);
});

const model = {
  id: 'local', name: 'Synthetic', provider: 'fixture', api: 'openai-completions', baseUrl: 'https://invalid.test',
  reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** The model calls each tool in `calls` in turn, then says it is done. */
function scriptedModel(session, calls) {
  let index = 0;
  session.agent.streamFunction = () => {
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

function withEnvironment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('Pi loads the guard by its path, shows it each call\'s tool and arguments, and the call still runs', async t => {
  const root = home(t);
  const agentDir = join(root, 'agent');
  isolatePiHome(t, agentDir);
  withEnvironment(t, { HOBKIN_HOME: root, [RUN_KIND_ENV]: 'main' });
  const sent = [];
  const mail = pi => pi.registerTool({
    name: 'mcp__gmail__gmail_send', label: 'Send', description: 'Sends a mail.',
    parameters: Type.Object({ to: Type.String(), subject: Type.String(), body: Type.String() }),
    execute: async (_id, params) => {
      sent.push(params.to);
      return { content: [{ type: 'text', text: 'Sent.' }], details: {} };
    },
  });

  const models = await ModelRuntime.create({
    authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false,
  });
  models.getModel = () => model;
  models.streamSimple = () => { throw Error('No provider call allowed'); };
  models.hasConfiguredAuth = () => false;
  models.checkAuth = async () => ({ available: true });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [outwardGuardExtension], extensionFactories: [mail],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    cwd: root, agentDir, sessionManager: SessionManager.inMemory(root), resourceLoader, settingsManager, modelRuntime: models, model,
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  scriptedModel(session, [{ name: 'mcp__gmail__gmail_send', arguments: send }, { name: 'read', arguments: { path: join(root, 'none') } }]);

  await session.prompt('Send Sam the notes from today.', { preflightResult() {} });

  assert.deepEqual(sent, ['someone@example.invalid'], 'the call ran');
  assert.deepEqual(attempts(root).map(({ kind, verdict, run }) => ({ kind, verdict, run })), [{ kind: 'send', verdict: 'allowed-by-ask', run: 'main' }]);
});

test('the outward view counts attempts per day by kind, verdict and run, and which kinds would have been blocked', async t => {
  const root = home(t);
  // Local times, because a day is the user's.
  const at = (day, hour) => new Date(2026, 10, day, hour).getTime();
  const attempt = (day, hour, kind, verdict, run) => recordEvent(root, 'outward_attempt', { kind, verdict, run }, at(day, hour));
  attempt(25, 9, 'send', 'would-block', 'routine');
  attempt(25, 10, 'send', 'allowed-by-ask', 'main');
  attempt(26, 8, 'calendar-write', 'would-block', 'unknown');
  attempt(26, 9, 'post', 'allowed-by-rule', 'work');
  recordEvent(root, 'notice_posted', { source: 'session' }, at(26, 9));

  const view = telemetryView(root, 'outward', { days: 30, now: at(26, 20) });

  assert.equal(view.attempts, 4);
  assert.deepEqual(view.byKind, { send: 2, 'calendar-write': 1, post: 1 });
  assert.deepEqual(view.byVerdict, { 'allowed-by-rule': 1, 'allowed-by-ask': 1, 'would-block': 2 });
  assert.deepEqual(view.byRun, { routine: 1, main: 1, unknown: 1, work: 1 });
  assert.deepEqual(view.wouldBlock, { send: 1, 'calendar-write': 1 });
  assert.deepEqual(Object.keys(view.byDay), ['2026-11-25', '2026-11-26']);
  assert.deepEqual(view.byDay['2026-11-25'], {
    attempts: 2, byKind: { send: 2 }, byVerdict: { 'allowed-by-rule': 0, 'allowed-by-ask': 1, 'would-block': 1 },
    byRun: { routine: 1, main: 1 }, wouldBlock: { send: 1 },
  });

  const empty = telemetryView(home(t), 'outward', { days: 7, now: at(26, 20) });
  assert.equal(empty.attempts, 0);
  assert.deepEqual(empty.byVerdict, { 'allowed-by-rule': 0, 'allowed-by-ask': 0, 'would-block': 0 });
  assert.deepEqual(empty.wouldBlock, {});
  assert.deepEqual(empty.byDay, {});

  const chunks = [];
  assert.equal(await main(['telemetry', 'outward', '--days', '7', '--home', root], { write: text => chunks.push(text) }), 0);
  assert.equal(JSON.parse(chunks.join('')).view, 'outward');
});

test('a conversation kept outside a hobkin home records nothing, rather than guess a home', async t => {
  const elsewhere = home(t);
  const pi = fakePi();
  outwardGuard(pi, { env: {} });
  await pi.call('mcp__gmail__gmail_send', send, join(elsewhere, 'somewhere', 'a.jsonl'));
  await pi.call('mcp__gmail__gmail_send', send);

  assert.deepEqual(attempts(fallbackHome), [], 'no default home is written');
  assert.deepEqual(attempts(elsewhere), []);

  const named = home(t);
  outwardGuard(pi, { env: { HOBKIN_HOME: named } });
  await pi.call('mcp__gmail__gmail_send', send, join(elsewhere, 'somewhere', 'b.jsonl'));
  assert.equal(attempts(named).length, 1, 'a home the run names in HOBKIN_HOME is used');
});

test('every hobkin run with tools loads the guard once, is named its kind, and records into its own home', async t => {
  const root = home(t);
  const agentDir = join(root, 'agent');
  mkdirSync(agentDir);
  isolatePiHome(t, agentDir);
  const started = [];
  const run = namingExtensions(async job => { started.push(job); });
  // Each keeps its conversation where its own code puts it: a durable hobkin in `hobkins/`, every other run in `jobs/`.
  const base = { harness: 'pi', cwd: agentDir };
  const inJobs = id => join(root, 'jobs', `${id}.jsonl`);

  await run({ ...base, sessionFile: inJobs('routine') });
  await run({ ...base, purpose: 'work-do', sessionFile: inJobs('work') });
  await run({ ...base, purpose: 'durable', sessionFile: join(root, 'hobkins', 'durable.jsonl') });
  await run({ ...base, untilDone: true, sessionFile: inJobs('session') });
  await run({ ...base, purpose: 'reflection', sessionFile: inJobs('reflection') });

  const [routine, work, durable, session, toolFree, ...rest] = started;
  assert.deepEqual(rest, []);
  assert.equal(toolFree.extensions, undefined, 'a run with no tools loads no extensions');
  // The home its Pi may inherit in HOBKIN_HOME, such as the user's real one, never gets a run's attempts.
  const inherited = home(t);
  for (const [job, kind] of [[routine, 'routine'], [work, 'work'], [durable, 'durable'], [session, 'session']]) {
    assert.equal(job.extensions.filter(path => path === outwardGuardExtension).length, 1, `a ${kind} run loads it once`);
    assert.equal(job.env[RUN_KIND_ENV], kind, `a ${kind} run is named one`);
    const pi = fakePi();
    outwardGuard(pi, { env: { HOBKIN_HOME: inherited, ...job.env } });
    await pi.call('mcp__gmail__gmail_send', send, job.sessionFile);
    assert.equal(attempts(root).at(-1)?.run, kind, `a ${kind} run records into its own home`);
  }
  assert.equal(attempts(root).length, 4);
  assert.deepEqual(attempts(inherited), []);
});
