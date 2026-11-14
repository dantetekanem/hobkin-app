import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { setTimeout as wait } from 'node:timers/promises';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { buildInvocation, runHarness } from '../src/cli/harnesses.mjs';
import { main } from '../src/cli/main.mjs';
import { runTellCommand, takeTellRequests, tellRequests } from '../src/cli/hobkin-tell.mjs';
import lockfile from 'proper-lockfile';
import { drawCanvas, readCanvases } from '../src/cli/canvas.mjs';
import { readReport, savedReportPath } from '../src/cli/reports.mjs';
import { allCardActions } from '../src/cli/work/card-actions.mjs';
import { durableDirections } from '../src/cli/hobkins.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const SUMMARY_KEYS = ['createdAt', 'cwd', 'engine', 'id', 'last', 'run', 'state', 'title', 'turns', 'waiting'];

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-durable-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const folder = join(root, 'project');
  mkdirSync(folder);
  const fake = fakePi(root);
  return {
    root, config, folder, fake,
    openApp: (options = {}) => HobkinApplication.open(root, { createMain: fake.createMain, intervalMs: 60000, ...options }),
  };
}

/** A Pi that answers when the test says so. It writes each turn to the conversation file, as Pi does, and takes notes while it runs. */
function fakeTurns() {
  const calls = [];
  const edits = [];
  const arrivals = [];
  const arrival = n => (arrivals[n] ??= Promise.withResolvers());
  return {
    calls,
    edits,
    nth: n => arrival(n).promise,
    runHarness: async (request, options) => {
      if (request.purpose === 'humanizer') {
        edits.push(request);
        return { status: 'completed', text: request.prompt, cost: null };
      }
      const call = { request, options, heard: [], end: Promise.withResolvers() };
      if (request.purpose === 'durable') appendFileSync(request.sessionFile, `${JSON.stringify({ prompt: request.prompt })}\n`);
      request.signal?.addEventListener('abort', () => call.end.resolve({ status: 'interrupted', text: '', error: 'Harness cancelled.', cost: null }), { once: true });
      options?.onReady?.(async message => { call.heard.push(message); return { disposition: 'queued' }; });
      arrival(calls.push(call) - 1).resolve(call);
      return call.end.promise;
    },
  };
}

const answer = (call, text, extra = {}) => call.end.resolve({ status: 'completed', text, cost: null, sessionId: null, ...extra });

async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await wait(5);
  }
}

const listed = async (app, id) => (await app.refresh()).hobkins?.find(hobkin => hobkin.id === id);
const waitingNow = (app, id) => until(async () => {
  const { hobkin } = await app.hobkins.read(id);
  return hobkin.state === 'waiting' && hobkin;
});

/** What hobkin gave a turn's process to say who it is: the token `hobkin tell` reads from its environment. */
const tokenOf = call => call.request.env?.HOBKIN_TURN;

/**
 * `hobkin tell` as a turn's shell runs it, in its own process in the real thing. The running hobkin takes what it writes
 * on a tick, so the test ticks for it until the command is done. With no app, nothing takes it.
 */
async function tell(app, root, env, args, input) {
  let printed = '';
  // `--home` goes before the recipient: after it, every word is the message.
  const command = main(['tell', '--home', root, ...args], { write: chunk => { printed += chunk; } }, { env, ...(input === undefined ? {} : { input: Readable.from([input]) }) });
  let done = false;
  command.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    await app?.hobkins.tick();
    await wait(5);
  }
  await command;
  return JSON.parse(printed);
}

/** What the main agent was woken with for messages, read from its own conversation. */
const wakesIn = app => app.runtime.messages()
  .filter(message => message.role === 'user')
  .map(message => (typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('')))
  .filter(text => text.startsWith('<hobkin-wake>\n'))
  .map(text => JSON.parse(text.split('\n')[1]));

/** Resolves once the main agent's turn has ended. Durable turns may still be running, so this is not `runtime.idle`. */
const mainDone = app => app.runtime.mainWork;

/** Holds the main agent's next turn open until the test lets it go. */
function holdMain(h) {
  const control = h.fake.controls.get(h.fake.opened.at(-1));
  control.gate = Promise.withResolvers();
  return () => control.gate.resolve();
}

/**
 * The fake main session streams while a turn runs, as Pi's does, and takes what the user sends then as a steer into
 * that turn. Answers with what was steered.
 */
function streamingMain(h) {
  const session = h.fake.sessions.get(h.fake.opened.at(-1));
  const steered = [];
  let streaming = false;
  const prompt = session.prompt.bind(session);
  session.prompt = async (text, options) => {
    streaming = true;
    try {
      return await prompt(text, options);
    } finally {
      streaming = false;
    }
  };
  Object.defineProperty(session, 'isStreaming', { get: () => streaming, configurable: true });
  session.steer = async text => { steered.push(text); };
  return steered;
}

/** The words of a turn a message started, and who it names as the sender. */
const messageIn = call => {
  assert.match(call.request.prompt, /^<hobkin-message>\n[^\n]+\n<\/hobkin-message>$/);
  return JSON.parse(call.request.prompt.split('\n')[1]);
};

test('a started hobkin runs its first turn and then waits', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const text = 'Look at why the build on the main branch fails every morning since Tuesday\nIt broke after the upgrade.';

  const { id, run } = await app.hobkins.start({ text, cwd: h.folder, engine: { kind: 'tier', tier: 'mid' } });
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.equal(run, `hobkin:${id}:1`);
  const call = await turns.nth(0);
  const sessionFile = join(h.root, 'hobkins', `${id}.jsonl`);
  assert.deepEqual(
    [call.request.harness, call.request.cwd, call.request.prompt, call.request.sessionFile, call.request.purpose, call.request.model, call.request.effort],
    ['pi', h.folder, text, sessionFile, 'durable', 'fixture/local', 'medium'],
  );
  assert.equal(call.request.directions, durableDirections(id));
  assert.equal('resume' in call.request, false);

  // Pi gets the directions as its own system prompt, with a job's tools.
  const { signal, ...request } = call.request;
  const { args } = buildInvocation(request);
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], durableDirections(id));
  assert.ok(args.includes('--approve'));
  assert.ok(!args.includes('--no-tools'));

  const admitted = (await app.runtime.state()).runs[run];
  assert.deepEqual([admitted.kind, admitted.scheduleId, admitted.harnessId, admitted.cwd, admitted.tier], ['background', `hobkin.${id}`, call.request.id, h.folder, 'mid']);
  assert.deepEqual(admitted.hobkin, { id, turn: 1, asked: text });

  call.options.onEvent({ type: 'tool_execution_start', toolCallId: 'r', toolName: 'read', args: { path: 'ci.yml' } });
  const working = await until(async () => {
    const view = await app.refresh();
    return view.jobActivity?.[run]?.length && view;
  });
  const summary = working.hobkins.find(hobkin => hobkin.id === id);
  assert.deepEqual(Object.keys(summary).sort(), SUMMARY_KEYS);
  assert.ok(summary.title.length <= 60 && text.startsWith(summary.title), summary.title);
  assert.deepEqual([summary.cwd, summary.engine, summary.state, summary.turns, summary.run, summary.last, summary.waiting], [h.folder, { kind: 'tier', tier: 'mid' }, 'working', 1, run, null, null]);
  assert.equal(working.jobActivity[run][0].name, 'read');
  assert.equal(working.runs.find(item => item.id === run).state, 'running');
  assert.ok(working.stopControls.targets.some(target => target.runId === run));

  const said = 'The build needs CI_TOKEN since the upgrade. Set it and the build passes.';
  answer(call, said);
  const waiting = await waitingNow(app, id);
  assert.deepEqual([waiting.state, waiting.run, waiting.turns, waiting.last.status, waiting.last.said], ['waiting', null, 1, 'completed', said]);
  assert.deepEqual(waiting.waiting, { since: waiting.last.at, seen: false });
  assert.deepEqual(Object.keys((await until(() => listed(app, id).then(hobkin => hobkin?.state === 'waiting' && hobkin)))).sort(), SUMMARY_KEYS);

  const { turns: conversation } = await app.hobkins.read(id);
  const finished = (await app.runtime.state()).runs[run];
  assert.deepEqual(conversation, [{ n: 1, run, asked: text, from: { kind: 'user' }, askedAt: finished.startedAt, status: 'completed', reply: said, error: null, endedAt: finished.finishedAt }]);

  // A long answer is cut to its start, and a name the user gives is kept.
  const named = await app.hobkins.start({ text: 'Again.', cwd: h.folder, engine: { kind: 'tier', tier: 'mid' }, title: '  Release notes  ' });
  answer(await turns.nth(1), 'x'.repeat(2000));
  const long = await waitingNow(app, named.id);
  assert.deepEqual([long.title, long.last.said.length], ['Release notes', 600]);
  assert.deepEqual((await app.refresh()).hobkins.map(hobkin => hobkin.id), [named.id, id], 'newest first');
});

test('a message to a waiting hobkin starts a turn on the same conversation, and one to a working hobkin steers it', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const { id } = await app.hobkins.start({ text: 'Find the slow query.', cwd: h.folder, engine: { kind: 'tier', tier: 'mid' } });
  const first = await turns.nth(0);
  answer(first, 'The orders index is missing.');
  await waitingNow(app, id);

  assert.deepEqual(await app.hobkins.say(id, { text: 'Add it.' }), { started: true, queued: false, run: `hobkin:${id}:2` });
  const second = await turns.nth(1);
  assert.equal(second.request.sessionFile, first.request.sessionFile, 'the same conversation reopens');
  assert.equal(second.request.prompt, 'Add it.');
  assert.notEqual(second.request.id, first.request.id);
  const working = (await app.hobkins.read(id)).hobkin;
  assert.deepEqual([working.state, working.turns, working.run, working.waiting, working.last.said], ['working', 2, `hobkin:${id}:2`, null, 'The orders index is missing.']);

  const noteId = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(await app.hobkins.say(id, { text: 'Name it orders_by_day.', noteId }), { started: false, queued: true, run: `hobkin:${id}:2` });
  assert.deepEqual(second.heard, [`[hobkin-note:${noteId}]\nName it orders_by_day.`]);
  assert.equal(turns.calls.length, 2, 'no second turn starts while one runs');
  await assert.rejects(app.hobkins.say(id, { text: 'x'.repeat(5000) }), /at most 4096/);

  answer(second, 'Added orders_by_day.');
  await waitingNow(app, id);
  const { turns: conversation } = await app.hobkins.read(id);
  assert.deepEqual(conversation.map(({ n, asked, status, reply }) => [n, asked, status, reply]), [
    [1, 'Find the slow query.', 'completed', 'The orders index is missing.'],
    [2, 'Add it.', 'completed', 'Added orders_by_day.'],
  ]);
  assert.deepEqual(readFileSync(first.request.sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line).prompt), ['Find the slow query.', 'Add it.']);

  await assert.rejects(app.hobkins.say('0badc0de', { text: 'Hello?' }), /no hobkin/i);
  await assert.rejects(app.hobkins.say(id, { text: ' ' }), /at most 32768 characters/);
});

test('a hobkin and its turns are still there after a restart, and a cut-off turn reads as cut off', async t => {
  const h = fixture(t);
  const before = fakeTurns();
  let app = await h.openApp({ runHarness: before.runHarness });
  t.after(() => app.close());
  const { id } = await app.hobkins.start({ text: 'Tidy the docs folder.', cwd: h.folder, engine: { kind: 'tier', tier: 'fast' } });
  answer(await before.nth(0), 'Moved four pages.');
  await waitingNow(app, id);
  await app.hobkins.say(id, { text: 'Now the images.' });
  const cut = await before.nth(1);
  await app.close();
  assert.equal(cut.request.signal.aborted, true);

  const after = fakeTurns();
  app = await h.openApp({ runHarness: after.runHarness });
  const summary = await listed(app, id);
  assert.deepEqual([summary.state, summary.turns, summary.run, summary.last.status, summary.last.said, summary.waiting.seen],
    ['waiting', 2, null, 'interrupted', 'It was cut off when hobkin restarted. Send it a message to carry on.', false]);
  const { turns: conversation } = await app.hobkins.read(id);
  assert.deepEqual(conversation.map(({ n, status, reply }) => [n, status, reply]), [[1, 'completed', 'Moved four pages.'], [2, 'interrupted', null]]);
  assert.match(conversation[1].error, /cut off/);
  assert.ok(conversation[1].endedAt);

  assert.deepEqual(await app.hobkins.say(id, { text: 'Carry on.' }), { started: true, queued: false, run: `hobkin:${id}:3` });
  const resumed = await after.nth(0);
  assert.equal(resumed.request.sessionFile, cut.request.sessionFile);
  answer(resumed, 'Moved the images too.');
  assert.equal((await waitingNow(app, id)).turns, 3);
});

test('a turn leaves no report, no humanizer pass and no place taken', async t => {
  const h = fixture(t);
  h.config.concurrency = 1;
  atomicJson(join(h.root, 'config.json'), h.config);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const { id, run } = await app.hobkins.start({ text: 'Check the deploy.', cwd: h.folder, engine: { kind: 'tier', tier: 'mid' }, title: 'Deploy check' });
  const call = await turns.nth(0);
  assert.equal(app.runner.scheduledJobCount(await app.runtime.state()), 0, 'a turn takes no ordinary place');
  assert.equal(app.director.outlook().checks, 0, 'and no place from work mode, which counts a check as one');

  // The one ordinary place is still free for a routine.
  const schedule = { id: 'check', title: 'Check', at: '09:00', timezone: 'UTC', cwd: h.root, context: [], enabled: true, harness: 'pi', model: 'fixture/check', effort: 'medium' };
  writeFileSync(join(h.root, 'routines/daily/check.md'), `---\n${JSON.stringify(schedule)}\n---\nCheck local state.\n`);
  assert.equal((await app.runner.trigger('check', 'routine-beside-a-hobkin')).status, 'running');
  answer(await turns.nth(1), 'Nothing new.');
  await until(() => app.runner.jobs.size === 1);

  answer(call, 'Useful: The deploy is green.\n\nAll checks pass.');
  await waitingNow(app, id);
  assert.equal(turns.edits.length, 0, 'no humanizer pass');
  assert.equal(readReport(h.root, run, null), null);
  assert.equal(savedReportPath(h.root, run), null, 'nothing saved on disk');
  const view = await app.refresh();
  assert.equal(view.runs.find(item => item.id === run).state, 'completed', 'the run itself stays listed');
  assert.equal(view.reports.some(report => report.id === run), false);
  assert.equal(Object.hasOwn(view.completedJobReports, run), false);
  assert.equal(view.messages.some(message => /Deploy check|deploy is green/.test(message.content)), false, 'no line in Chat');
  assert.equal(view.reportAttention.some(item => item.scheduleId === `hobkin.${id}`), false);

  // A Stop from the screen ends the turn and tells nobody else.
  await app.hobkins.say(id, { text: 'Watch it for an hour.' });
  const watching = await turns.nth(2);
  assert.equal(await app.kill(`hobkin:${id}:2`), true);
  assert.equal(watching.request.signal.aborted, true);
  const stopped = await waitingNow(app, id);
  assert.deepEqual([stopped.last.status, stopped.last.said], ['interrupted', 'It was stopped before it finished.']);
  assert.equal(allCardActions(h.root).some(action => action.id === `user-stop:hobkin:${id}:2`), false);
  assert.equal((await app.refresh()).messages.some(message => /hobkin:/.test(message.content)), false);

  // The next message to the main agent carries no word of it.
  await app.send('Anything new?');
  await app.runtime.idle();
  const told = app.runtime.messages().filter(message => message.role === 'user').map(message => JSON.stringify(message.content));
  assert.equal(told.some(text => /Deploy check|hobkin:|deploy is green/.test(text)), false);
});

test('each engine runs a turn on its own model and thinking', async t => {
  const h = fixture(t);
  atomicJson(join(h.root, 'config.json'), { ...h.config, tiers: { high: { model: 'fixture/strong', effort: 'xhigh' } } });
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());

  const tier = await app.hobkins.start({ text: 'Plan the migration.', cwd: h.folder, engine: { kind: 'tier', tier: 'high' } });
  const onTier = await turns.nth(0);
  assert.deepEqual([onTier.request.harness, onTier.request.model, onTier.request.effort], ['pi', 'fixture/strong', 'xhigh']);
  const tierRun = (await app.runtime.state()).runs[tier.run];
  assert.deepEqual([tierRun.harness, tierRun.model, tierRun.effort, tierRun.tier], ['pi', 'fixture/strong', 'xhigh', 'high']);
  answer(onTier, 'Three steps.');
  await waitingNow(app, tier.id);
  // The tier is read when each turn starts.
  atomicJson(join(h.root, 'config.json'), { ...h.config, tiers: { high: { model: 'fixture/stronger', effort: 'high' } } });
  await app.hobkins.say(tier.id, { text: 'Go.' });
  const retiered = await turns.nth(1);
  assert.deepEqual([retiered.request.model, retiered.request.effort], ['fixture/stronger', 'high']);
  answer(retiered, 'Done.');

  const pi = await app.hobkins.start({ text: 'Summarize the logs.', cwd: h.folder, engine: { kind: 'pi', model: 'other/model-x', effort: 'low' } });
  const onPi = await turns.nth(2);
  assert.deepEqual([onPi.request.harness, onPi.request.model, onPi.request.effort], ['pi', 'other/model-x', 'low']);
  assert.equal((await app.runtime.state()).runs[pi.run].tier, undefined);
  answer(onPi, 'Quiet night.');

  // Claude Code is the host's to run: hobkin hands it the request, with the main binding as placeholders, and resumes its session.
  const claude = await app.hobkins.start({ text: 'Review the diff.', cwd: h.folder, engine: { kind: 'claude' } });
  const onClaude = await turns.nth(3);
  assert.deepEqual([onClaude.request.harness, onClaude.request.model, onClaude.request.effort, onClaude.request.purpose], ['claude', 'fixture/local', 'medium', 'durable']);
  assert.equal('resume' in onClaude.request, false);
  assert.throws(() => buildInvocation({ ...onClaude.request, signal: undefined }), /Pi/, "hobkin's own harness runs only Pi");
  answer(onClaude, 'Two nits.', { sessionId: 'claude-session-1' });
  await waitingNow(app, claude.id);
  await app.hobkins.say(claude.id, { text: 'Fix them.' });
  const resumed = await turns.nth(4);
  assert.equal(resumed.request.resume, 'claude-session-1');
  assert.equal(resumed.request.sessionFile, onClaude.request.sessionFile);
  answer(resumed, 'Fixed.');
  assert.deepEqual((await app.hobkins.read(claude.id)).hobkin.engine, { kind: 'claude' });

  // A Claude hobkin can name its own model and thinking, which the host passes to Claude Code. A record without them says none.
  assert.equal('claude' in onClaude.request, false);
  const chosen = await app.hobkins.start({ text: 'Audit it.', cwd: h.folder, engine: { kind: 'claude', model: 'opus', effort: 'max' } });
  const onChosen = await turns.nth(5);
  assert.deepEqual(onChosen.request.claude, { model: 'opus', effort: 'max' });
  assert.deepEqual((await app.hobkins.read(chosen.id)).hobkin.engine, { kind: 'claude', model: 'opus', effort: 'max' });
  answer(onChosen, 'Clean.');
  await waitingNow(app, chosen.id);

  const refused = async (input, reason) => assert.rejects(app.hobkins.start({ text: 'Go.', cwd: h.folder, ...input }), reason);
  await refused({ engine: { kind: 'tier', tier: 'huge' } }, /tier is one of fast, mid, high, max/);
  await refused({ engine: { kind: 'pi', model: 'no-provider', effort: 'low' } }, /provider\/model/);
  await refused({ engine: { kind: 'pi', model: 'other/model-x', effort: 'extreme' } }, /thinking level/);
  await refused({ engine: { kind: 'claude', model: 'gpt' } }, /Claude Code model is one of default, opus, sonnet, haiku, fable/);
  await refused({ engine: { kind: 'claude', effort: 'tier' } }, /Claude Code thinking level is one of default, low, medium, high, xhigh, max/);
  await refused({ engine: { kind: 'gpt' } }, /a tier, Claude Code or a Pi model/);
  await refused({ engine: undefined }, /a tier, Claude Code or a Pi model/);
  await refused({ engine: { kind: 'claude' }, cwd: 'project' }, /full path to a folder that exists/);
  await refused({ engine: { kind: 'claude' }, cwd: join(h.folder, 'missing') }, /full path to a folder that exists/);
  await refused({ engine: { kind: 'claude' }, title: 'x'.repeat(121) }, /at most 120 characters/);
  await assert.rejects(app.hobkins.start({ text: 'x'.repeat(32769), cwd: h.folder, engine: { kind: 'claude' } }), /at most 32768 characters/);
  assert.equal(turns.calls.length, 6, 'a refused start runs nothing');
  assert.equal((await app.refresh()).hobkins.length, 4);
});

test('an unseen wait wakes the main agent once, and a seen one never', async t => {
  const h = fixture(t);
  let clock = Date.parse('2026-03-01T10:00:00Z');
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness, now: () => clock });
  t.after(() => app.close());
  const unseen = await app.hobkins.start({ text: 'Bump the lockfile.', cwd: h.folder, engine: { kind: 'tier', tier: 'fast' }, title: 'Lockfile' });
  const looked = await app.hobkins.start({ text: 'Rename the module.', cwd: h.folder, engine: { kind: 'tier', tier: 'fast' }, title: 'Rename' });
  answer(await turns.nth(0), 'Bumped 3 packages. One needs your call: pin react 18 or move to 19?');
  answer(await turns.nth(1), 'Renamed.');
  await waitingNow(app, unseen.id);
  await waitingNow(app, looked.id);
  assert.deepEqual(await app.hobkins.seen(looked.id), { ok: true });
  assert.equal((await app.hobkins.read(looked.id)).hobkin.waiting.seen, true);
  const sent = t.mock.method(app.runtime, 'send');

  clock += 19000;
  await app.tickWakes();
  assert.equal(sent.mock.callCount(), 0, 'the user has 20 seconds to look');

  clock += 1000;
  await app.tickWakes();
  await app.runtime.idle();
  assert.equal(sent.mock.callCount(), 1);
  const [brief] = sent.mock.calls[0].arguments;
  assert.match(brief, /^<hobkin-wake>\n/);
  assert.deepEqual(JSON.parse(brief.split('\n')[1]), { hobkins: [{ id: unseen.id, title: 'Lockfile', status: 'completed', said: 'Bumped 3 packages. One needs your call: pin react 18 or move to 19?' }] });

  clock += 60000;
  await app.tickWakes();
  await app.runtime.idle();
  assert.equal(sent.mock.callCount(), 1, 'a wait is told once, and a seen one never');
  assert.equal((await app.refresh()).messages.some(message => message.role === 'user' && /hobkin-wake/.test(message.content)), false, 'Chat shows only the answer');

  // The next wait is a wait of its own.
  await app.hobkins.say(unseen.id, { text: 'Move to 19.' });
  answer(await turns.nth(2), 'Moved to 19.');
  await until(async () => (await app.hobkins.read(unseen.id)).hobkin.last?.said === 'Moved to 19.');
  clock += 20000;
  await app.tickWakes();
  await app.runtime.idle();
  assert.equal(sent.mock.callCount(), 2);
  assert.match(sent.mock.calls[1].arguments[0], /Moved to 19\./);
  assert.doesNotMatch(sent.mock.calls[1].arguments[0], /Rename/);
});

test('ending stops the turn and keeps the conversation, and a thirteenth is refused', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const { id, run } = await app.hobkins.start({ text: 'Draw the plan.', cwd: h.folder, engine: { kind: 'tier', tier: 'mid' } });
  const call = await turns.nth(0);
  drawCanvas(h.root, id, { html: '<p>plan</p>', title: 'Plan' });

  assert.deepEqual(await app.hobkins.end(id), { ok: true });
  assert.equal(call.request.signal.aborted, true, 'the turn in flight stops');
  assert.equal((await app.runtime.state()).runs[run].status, 'interrupted');
  assert.equal(readCanvases(h.root)[id].open, false);
  assert.equal(readFileSync(call.request.sessionFile, 'utf8').trim(), JSON.stringify({ prompt: 'Draw the plan.' }), 'the conversation stays on disk');
  assert.equal((await app.refresh()).hobkins.some(hobkin => hobkin.id === id), false);
  await assert.rejects(app.hobkins.say(id, { text: 'Hello?' }), /has ended/);
  await assert.rejects(app.hobkins.end(id), /has ended/);
  await assert.rejects(app.hobkins.read(id), /has ended/);
  assert.equal(turns.calls.length, 1);

  const kept = [];
  for (let n = 0; n < 12; n++) kept.push(await app.hobkins.start({ text: `Job ${n}.`, cwd: h.folder, engine: { kind: 'tier', tier: 'fast' } }));
  await assert.rejects(app.hobkins.start({ text: 'One more.', cwd: h.folder, engine: { kind: 'tier', tier: 'fast' } }), /already 12 hobkins\. End one first\./);
  assert.equal((await app.refresh()).hobkins.length, 12);
  await app.hobkins.end(kept[0].id);
  assert.match((await app.hobkins.start({ text: 'One more.', cwd: h.folder, engine: { kind: 'tier', tier: 'fast' } })).id, /^[0-9a-f]{8}$/);
});

test("the main agent's message tool neither lists nor reaches a hobkin's turn", async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const { id, run } = await app.hobkins.start({ text: 'Clean the build folder.', cwd: h.folder, engine: { kind: 'claude' } });
  const call = await turns.nth(0);
  await until(async () => (await app.runtime.state()).runs[run]?.status === 'running');

  // `message_check` is the main agent's way to talk to a running routine. A durable hobkin is the user's alone.
  assert.deepEqual(await app.runtime.messageCheck({}), { running: [] });
  await assert.rejects(app.runtime.messageCheck({ scheduleId: `hobkin.${id}`, message: 'Also delete the sources.' }), /not running/);
  assert.deepEqual(call.heard, []);

  // The user's own words still reach the turn in flight.
  assert.deepEqual(await app.hobkins.say(id, { text: 'Keep the cache.' }), { started: false, queued: true, run });
  assert.deepEqual(call.heard, ['Keep the cache.']);
  answer(call, 'Cleaned.');
  await waitingNow(app, id);
});

test('a message sent as a turn starts reaches that turn, and a wake that fails is not tried again at once', async t => {
  const h = fixture(t);
  let clock = Date.parse('2026-03-01T10:00:00Z');
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness, now: () => clock });
  t.after(() => app.close());

  // The words arrive before the turn's run is even admitted: they wait for it, and are not held until it ends.
  const { id, run } = await app.hobkins.start({ text: 'Run the migration.', cwd: h.folder, engine: { kind: 'tier', tier: 'fast' }, title: 'Migration' });
  const early = await Promise.race([app.hobkins.say(id, { text: 'Dry run first.' }), wait(3000).then(() => 'held')]);
  assert.deepEqual(early, { started: false, queued: true, run });
  const call = await turns.nth(0);
  assert.deepEqual(call.heard, ['Dry run first.']);
  answer(call, 'The dry run passes.');
  await waitingNow(app, id);

  // The main agent cannot take the wake, as with a sign-in that ran out. hobkin waits before it tries again.
  const sent = t.mock.method(app.runtime, 'send', async () => { throw Error('No API key found.'); });
  clock += 20000;
  await app.tickWakes();
  assert.equal(sent.mock.callCount(), 1);
  clock += 1000;
  await app.tickWakes();
  clock += 60000;
  await app.tickWakes();
  assert.equal(sent.mock.callCount(), 1, 'not again within five minutes');
  clock += 5 * 60000;
  await app.tickWakes();
  assert.equal(sent.mock.callCount(), 2, 'then once more');
  assert.equal((await app.hobkins.read(id)).hobkin.waiting.seen, false);
});

test('a hobkin started with no message waits untold, and its first message is its first turn and gives it its name', async t => {
  const h = fixture(t);
  let clock = Date.parse('2026-03-01T10:00:00Z');
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness, now: () => clock });
  t.after(() => app.close());

  const started = await app.hobkins.start({ cwd: h.folder, engine: { kind: 'tier', tier: 'fast' } });
  assert.match(started.id, /^[0-9a-f]{8}$/);
  assert.equal(started.run, null, 'no turn runs until it is given something to do');
  assert.equal(turns.calls.length, 0);
  const fresh = (await app.hobkins.read(started.id));
  assert.deepEqual(fresh.turns, []);
  assert.deepEqual(
    [fresh.hobkin.title, fresh.hobkin.state, fresh.hobkin.turns, fresh.hobkin.run, fresh.hobkin.last, fresh.hobkin.waiting?.seen],
    ['New hobkin', 'waiting', 0, null, null, true],
  );

  // Nothing happened yet, so there is nothing for the main agent to tell.
  const sent = t.mock.method(app.runtime, 'send');
  clock += 60000;
  await app.tickWakes();
  assert.equal(sent.mock.callCount(), 0);
  sent.mock.restore();

  // Its first message is its first turn, and names it.
  const text = 'Find out why the nightly export is slow\nIt takes an hour now.';
  assert.deepEqual(await app.hobkins.say(started.id, { text }), { started: true, queued: false, run: `hobkin:${started.id}:1` });
  const call = await turns.nth(0);
  assert.equal(call.request.prompt, text);
  const working = (await app.hobkins.read(started.id)).hobkin;
  assert.deepEqual([working.title, working.turns, working.state], ['Find out why the nightly export is slow', 1, 'working']);
  assert.equal((await app.runtime.state()).runs[`hobkin:${started.id}:1`].title, 'Find out why the nightly export is slow');
  answer(call, 'An index is missing.');
  await waitingNow(app, started.id);

  // A name the user gives is kept: a later message never renames it.
  const named = await app.hobkins.start({ cwd: h.folder, engine: { kind: 'tier', tier: 'fast' }, title: 'Exports' });
  await app.hobkins.say(named.id, { text: 'Look at the weekly one too.' });
  answer(await turns.nth(1), 'Looked.');
  assert.equal((await waitingNow(app, named.id)).title, 'Exports');
  const renamed = await app.hobkins.start({ cwd: h.folder, engine: { kind: 'tier', tier: 'fast' } });
  await app.hobkins.rename(renamed.id, 'Mine');
  await app.hobkins.say(renamed.id, { text: 'Start with the logs.' });
  answer(await turns.nth(2), 'Read.');
  assert.equal((await waitingNow(app, renamed.id)).title, 'Mine');
});

test('a hobkin named from its first message can be given a better title once, and never over a name the user gave', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());

  // Nothing to title before a first message, and nothing for one the user named.
  const quiet = await app.hobkins.start({ cwd: h.folder, engine: { kind: 'tier', tier: 'fast' } });
  const named = await app.hobkins.start({ text: 'Check the exports.', cwd: h.folder, engine: { kind: 'tier', tier: 'fast' }, title: 'Exports' });
  answer(await turns.nth(0), 'Checked.');
  await waitingNow(app, named.id);
  assert.deepEqual(await app.hobkins.toTitle(), []);

  // One named from its first message asks for a title, with the words to make it from.
  const text = 'hey can you look at why the nightly export job got so slow since last week';
  await app.hobkins.say(quiet.id, { text });
  const call = await turns.nth(1);
  assert.deepEqual(await app.hobkins.toTitle(), [{ id: quiet.id, words: [text] }]);
  answer(call, 'An index went missing in the last migration.');
  await waitingNow(app, quiet.id);
  assert.deepEqual(await app.hobkins.toTitle(), [{ id: quiet.id, words: [text, 'An index went missing in the last migration.'] }]);

  // The title is taken once. After that it asks for none, and a later title is not taken.
  assert.equal((await app.hobkins.retitle(quiet.id, '  Slow nightly export  ')).title, 'Slow nightly export');
  assert.deepEqual(await app.hobkins.toTitle(), []);
  assert.equal((await app.hobkins.retitle(quiet.id, 'Something else')).title, 'Slow nightly export');
  // A name the user gave is never replaced.
  assert.equal((await app.hobkins.retitle(named.id, 'Export check')).title, 'Exports');
  await assert.rejects(app.hobkins.retitle(quiet.id, 'x'.repeat(121)), /at most 120 characters/);
});

const FAST = { kind: 'tier', tier: 'fast' };

test("a durable hobkin's message reaches the main hobkin once, right after a busy turn, and after a restart", async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  let app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const { id } = await app.hobkins.start({ text: 'Tell the main hobkin that I love him.', cwd: h.folder, engine: FAST, title: 'Docs' });
  const env = { HOBKIN_TURN: tokenOf(await turns.nth(0)) };
  const texts = wake => wake.messages.map(({ at, ...message }) => (assert.ok(Date.parse(at)), message));

  const sent = await tell(app, h.root, env, ['main', 'The', 'user', 'says', 'they', 'love', 'you.']);
  assert.deepEqual([sent.sent, sent.to, sent.title], [true, 'main', 'the main hobkin']);
  await app.tickWakes();
  await mainDone(app);
  assert.deepEqual(wakesIn(app).map(texts), [[{ from: id, title: 'Docs', text: 'The user says they love you.' }]]);
  await app.tickWakes();
  await mainDone(app);
  assert.equal(wakesIn(app).length, 1, 'delivered once');
  assert.deepEqual((await app.runtime.state()).hobkinMail, {});
  assert.equal((await app.refresh()).messages.some(message => message.role === 'user' && /hobkin-wake/.test(message.content)), false, 'Chat shows only the answer');

  // While the main hobkin works, the message waits, and it goes right after that turn.
  const release = holdMain(h);
  await app.send('What is new?');
  await tell(app, h.root, env, ['main', 'Second note.']);
  await app.tickWakes();
  assert.equal(wakesIn(app).length, 1, 'not while it works');
  release();
  await mainDone(app);
  await app.tickWakes();
  await mainDone(app);
  assert.deepEqual(texts(wakesIn(app).at(-1)).map(({ text }) => text), ['Second note.']);

  // A message kept before a restart goes after it.
  await tell(app, h.root, env, ['main', 'Third note.']);
  await app.close();
  app = await h.openApp({ runHarness: fakeTurns().runHarness });
  await app.tickWakes();
  await mainDone(app);
  assert.deepEqual(texts(wakesIn(app).at(-1)), [{ from: id, title: 'Docs', text: 'Third note.' }]);
  assert.equal(wakesIn(app).length, 3);
  assert.deepEqual((await app.runtime.state()).hobkinMail, {});
});

test("the main hobkin's message starts a turn from it, and waits for a working hobkin's turn to end", async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const { id } = await app.hobkins.start({ cwd: h.folder, engine: FAST, title: 'Docs' });

  const asked = 'The user wants the docs folder tidied.';
  assert.deepEqual(await app.hobkins.tell(id, { text: asked }), { started: true, queued: false, run: `hobkin:${id}:1` });
  const first = await turns.nth(0);
  assert.deepEqual(messageIn(first), { from: 'main', title: 'the main hobkin', text: asked });
  assert.deepEqual((await app.runtime.state()).runs[`hobkin:${id}:1`].hobkin, { id, turn: 1, asked, from: { kind: 'main' } });

  // A working hobkin is not steered: the message starts its next turn once this one ends.
  assert.deepEqual(await app.hobkins.tell(id, { text: 'Keep the README.' }), { started: false, queued: true, run: null });
  assert.deepEqual(first.heard, []);
  assert.equal(turns.calls.length, 1);
  answer(first, 'Tidied.');
  const second = await turns.nth(1);
  assert.equal(messageIn(second).text, 'Keep the README.');
  assert.equal(second.request.sessionFile, first.request.sessionFile, 'the same conversation');
  answer(second, 'Kept it.');
  await waitingNow(app, id);

  // The user's own words are still the user's.
  await app.hobkins.say(id, { text: 'Thanks.' });
  answer(await turns.nth(2), 'You are welcome.');
  await waitingNow(app, id);
  const { hobkin, turns: conversation } = await app.hobkins.read(id);
  assert.deepEqual(conversation.map(({ n, asked: words, from, reply }) => [n, words, from, reply]), [
    [1, asked, { kind: 'main' }, 'Tidied.'],
    [2, 'Keep the README.', { kind: 'main' }, 'Kept it.'],
    [3, 'Thanks.', { kind: 'user' }, 'You are welcome.'],
  ]);
  assert.equal(hobkin.title, 'Docs');
  await assert.rejects(app.hobkins.tell('0badc0de', { text: 'Hello?' }), /no hobkin with that id/);
});

test('a durable hobkin messages another, and a message for a working one survives a restart', async t => {
  const h = fixture(t);
  const before = fakeTurns();
  let app = await h.openApp({ runHarness: before.runHarness });
  t.after(() => app.close());
  const notes = await app.hobkins.start({ text: 'Write the release notes.', cwd: h.folder, engine: FAST, title: 'Notes' });
  const writing = await before.nth(0);
  const changelog = await app.hobkins.start({ text: 'Check the changelog.', cwd: h.folder, engine: FAST, title: 'Changelog' });
  const env = { HOBKIN_TURN: tokenOf(await before.nth(1)) };

  const sent = await tell(app, h.root, env, [notes.id, 'The', 'changelog', 'misses', 'v2.']);
  assert.deepEqual([sent.sent, sent.to, sent.title], [true, notes.id, 'Notes']);
  await tell(app, h.root, env, [notes.id, '-'], 'And v2.1, from standard input.');
  assert.deepEqual(writing.heard, [], 'a working hobkin is not steered');
  assert.equal(before.calls.length, 2);

  // hobkin restarts before Notes is done. Its turn is cut off, and the messages start the turns after it.
  await app.close();
  const after = fakeTurns();
  app = await h.openApp({ runHarness: after.runHarness });
  await app.hobkins.tick();
  const second = await after.nth(0);
  assert.deepEqual(messageIn(second), { from: changelog.id, title: 'Changelog', text: 'The changelog misses v2.' });
  answer(second, 'Added v2.');
  const third = await after.nth(1);
  assert.equal(messageIn(third).text, 'And v2.1, from standard input.');
  answer(third, 'Added v2.1.');
  await waitingNow(app, notes.id);
  const from = { kind: 'hobkin', id: changelog.id, title: 'Changelog' };
  assert.deepEqual((await app.hobkins.read(notes.id)).turns.map(turn => [turn.n, turn.from, turn.status]), [
    [1, { kind: 'user' }, 'interrupted'],
    [2, from, 'completed'],
    [3, from, 'completed'],
  ]);
  assert.equal(after.calls.length, 2, 'Changelog has no message waiting, so it waits');
});

test('a turn cannot send as another hobkin, and nothing outside a running turn sends', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const notes = await app.hobkins.start({ text: 'Write the release notes.', cwd: h.folder, engine: FAST, title: 'Notes' });
  const writing = await turns.nth(0);
  const changelog = await app.hobkins.start({ text: 'Check the changelog.', cwd: h.folder, engine: FAST, title: 'Changelog' });
  const checking = await turns.nth(1);
  const [own, other] = [tokenOf(writing), tokenOf(checking)];
  assert.match(own, /^[0-9a-f]{32}$/);
  assert.notEqual(own, other);
  assert.equal(writing.request.env.HOBKIN_HOME, h.root, 'and the home the command reaches hobkin through');

  // Pi's process gets both.
  const given = [];
  const { signal, ...request } = writing.request;
  await runHarness(request, { startProcess: options => { given.push(options.env); throw Error('No Pi in this test.'); } });
  assert.deepEqual([given[0].HOBKIN_TURN, given[0].HOBKIN_HOME], [own, h.root]);

  // The sender is the turn the token belongs to. There is no way to name another.
  await tell(app, h.root, { HOBKIN_TURN: own }, ['main', 'From Notes.']);
  await assert.rejects(tell(app, h.root, { HOBKIN_TURN: own }, ['--from', changelog.id, 'main', 'Hi']), /Unknown or incomplete option: --from/);
  // After the recipient a flag is only words, and the sender stays the turn's.
  await tell(app, h.root, { HOBKIN_TURN: own }, ['main', '--from', changelog.id]);
  await assert.rejects(tell(app, h.root, {}, ['main', 'Hi']), /inside a durable hobkin's turn/);
  await assert.rejects(tell(app, h.root, { HOBKIN_TURN: 'f'.repeat(32) }, ['main', 'Hi']), /not a turn hobkin is running/);
  answer(writing, 'Done.');
  await waitingNow(app, notes.id);
  await assert.rejects(tell(app, h.root, { HOBKIN_TURN: own }, ['main', 'Late.']), /not a turn hobkin is running/, 'a token is good only while its turn runs');
  const notesFrom = { kind: 'hobkin', id: notes.id, title: 'Notes' };
  assert.deepEqual(Object.values((await app.runtime.state()).hobkinMail).sort((a, b) => a.n - b.n).map(({ from, text }) => [from, text]), [
    [notesFrom, 'From Notes.'],
    [notesFrom, `--from ${changelog.id}`],
  ]);

  // While hobkin is not running nothing is sent, and the command says so at once.
  await app.close();
  const began = Date.now();
  await assert.rejects(tell(null, h.root, { HOBKIN_TURN: other }, ['main', 'Anyone there?']), /not running/);
  assert.ok(Date.now() - began < 2000);
  assert.deepEqual(readdirSync(join(h.root, 'runtime', 'tell-requests')), [], 'nothing is left behind');
});

test('a message to nobody, to an ended hobkin, to itself or past three waiting is refused', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const notes = await app.hobkins.start({ text: 'Write the release notes.', cwd: h.folder, engine: FAST, title: 'Notes' });
  const env = { HOBKIN_TURN: tokenOf(await turns.nth(0)) };
  const changelog = await app.hobkins.start({ text: 'Check the changelog.', cwd: h.folder, engine: FAST, title: 'Changelog' });
  await turns.nth(1);
  const gone = await app.hobkins.start({ cwd: h.folder, engine: FAST });
  await app.hobkins.end(gone.id);

  await assert.rejects(tell(app, h.root, env, ['0badc0de', 'Hello?']), /no hobkin with that id/);
  await assert.rejects(tell(app, h.root, env, ['nobody', 'Hello?']), /no hobkin with that id/);
  await assert.rejects(tell(app, h.root, env, [gone.id, 'Hello?']), /has ended/);
  await assert.rejects(tell(app, h.root, env, [notes.id, 'Hello?']), /that is you/i);
  await assert.rejects(tell(app, h.root, env, ['main', '-'], 'x'.repeat(4097)), /at most 4096 characters/);
  await assert.rejects(tell(app, h.root, env, ['main']), /Usage: hobkin tell/);
  await assert.rejects(app.hobkins.tell(changelog.id, { text: ' ' }), /at most 4096 characters/);
  await assert.rejects(app.hobkins.tell(gone.id, { text: 'Hello?' }), /has ended/);

  // Three may wait from one sender for one recipient, and the fourth is refused. Another sender still has room.
  for (const n of [1, 2, 3]) await tell(app, h.root, env, [changelog.id, `Note ${n}.`]);
  await assert.rejects(tell(app, h.root, env, [changelog.id, 'Note 4.']), /three messages from you already wait/);
  assert.deepEqual(await app.hobkins.tell(changelog.id, { text: 'From the main hobkin.' }), { started: false, queued: true, run: null });
  const waiting = () => Object.values(app.hobkins.mail).sort((a, b) => a.n - b.n).map(({ to, text }) => [to, text]);
  assert.deepEqual(waiting(), [[changelog.id, 'Note 1.'], [changelog.id, 'Note 2.'], [changelog.id, 'Note 3.'], [changelog.id, 'From the main hobkin.']]);
  assert.equal(turns.calls.length, 2, 'nothing refused started a turn');

  // A message for a hobkin the user ends goes with it.
  await app.hobkins.end(changelog.id);
  assert.deepEqual((await app.runtime.state()).hobkinMail, {});
});

const asTurn = call => ({ HOBKIN_TURN: tokenOf(call) });
const TOO_MANY = /already led to three messages between hobkins/;

test('one word from the user allows three messages between hobkins in all, however they fan out, and a restart keeps the count', async t => {
  const h = fixture(t);
  const before = fakeTurns();
  let app = await h.openApp({ runHarness: before.runHarness });
  t.after(() => app.close());
  const plan = await app.hobkins.start({ text: 'Plan the release.', cwd: h.folder, engine: FAST, title: 'Plan' });
  const planning = await before.nth(0);
  const build = await app.hobkins.start({ cwd: h.folder, engine: FAST, title: 'Build' });

  // One turn the user started sends three, to two hobkins, and a fourth is refused.
  await tell(app, h.root, asTurn(planning), [build.id, 'Build v2.']);
  const building = await before.nth(1);
  await tell(app, h.root, asTurn(planning), [build.id, 'Then tag it.']);
  await tell(app, h.root, asTurn(planning), ['main', 'Release planned.']);
  await assert.rejects(tell(app, h.root, asTurn(planning), ['main', 'One more thing.']), TOO_MANY);
  // A turn that a message started spends the same three.
  await assert.rejects(tell(app, h.root, asTurn(building), ['main', 'Building.']), TOO_MANY);
  await assert.rejects(tell(app, h.root, asTurn(building), [plan.id, 'On it.']), TOO_MANY);

  // A restart keeps the count: the message that waited for Build starts its turn after it, with nothing left to send.
  await app.close();
  const after = fakeTurns();
  // The main hobkin's next turn is held from the start, since the first tick after a restart may be the one that wakes it.
  const release = holdMain(h);
  app = await h.openApp({ runHarness: after.runHarness });
  await app.hobkins.tick();
  const tagging = await after.nth(0);
  assert.equal(messageIn(tagging).text, 'Then tag it.');
  await assert.rejects(tell(app, h.root, asTurn(tagging), ['main', 'Tagged.']), TOO_MANY);

  // The main hobkin woken for that count cannot go past it either, to the sender or to anyone else.
  await app.tickWakes();
  await until(() => app.runtime.mainTurn);
  assert.deepEqual(wakesIn(app).at(-1).messages.map(({ text }) => text), ['Release planned.']);
  await assert.rejects(app.hobkins.tell(plan.id, { text: 'Thanks.' }), TOO_MANY);
  await assert.rejects(app.hobkins.tell(build.id, { text: 'Hurry.' }), TOO_MANY);
  release();
  await mainDone(app);
  assert.equal(after.calls.length, 1, 'nothing refused started a turn');
});

test("the user's words start a fresh count for the turn they reach, in Chat or on a hobkin's page, while it runs too", async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const steered = streamingMain(h);
  const docs = await app.hobkins.start({ text: 'Tidy the docs.', cwd: h.folder, engine: FAST, title: 'Docs' });
  const tidying = await turns.nth(0);
  const site = await app.hobkins.start({ cwd: h.folder, engine: FAST, title: 'Site' });
  await tell(app, h.root, asTurn(tidying), [site.id, 'Rebuild the site after.']);
  const rebuilding = await turns.nth(1);
  await tell(app, h.root, asTurn(tidying), ['main', 'Tidying.']);
  await tell(app, h.root, asTurn(tidying), ['main', 'Half done.']);
  await assert.rejects(tell(app, h.root, asTurn(tidying), ['main', 'Done.']), TOO_MANY);

  // In Chat: the user's words join the main hobkin's wake turn while it streams, and what it sends next counts from them.
  const release = holdMain(h);
  await app.tickWakes();
  await assert.rejects(app.hobkins.tell(docs.id, { text: 'Thanks.' }), TOO_MANY);
  await app.send('Tell the docs hobkin to stop there.');
  assert.ok(steered.some(text => text.endsWith('Tell the docs hobkin to stop there.')), 'the words joined the turn in flight');
  assert.deepEqual(await app.hobkins.tell(docs.id, { text: 'The user says stop there.' }), { started: false, queued: true, run: null });
  release();
  await mainDone(app);

  // On a page: the user's words reach Docs' running turn, and what it sends next counts from them. Site's turn did not hear them.
  assert.deepEqual(await app.hobkins.say(docs.id, { text: 'Tell main you stopped.' }), { started: false, queued: true, run: `hobkin:${docs.id}:1` });
  assert.equal((await tell(app, h.root, asTurn(tidying), ['main', 'Stopped.'])).sent, true);
  await assert.rejects(tell(app, h.root, asTurn(rebuilding), ['main', 'Rebuilt.']), TOO_MANY);
});

test("answering one hobkin is not held back by another hobkin's count in the same wake, and a wait carries its count", async t => {
  const h = fixture(t);
  let clock = Date.parse('2026-03-01T10:00:00Z');
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness, now: () => clock });
  t.after(() => app.close());

  // One and Helper pass three messages, the last to the main hobkin, so One's count is spent.
  const one = await app.hobkins.start({ text: 'Ship the fix.', cwd: h.folder, engine: FAST, title: 'One' });
  const shipping = await turns.nth(0);
  const helper = await app.hobkins.start({ cwd: h.folder, engine: FAST, title: 'Helper' });
  await tell(app, h.root, asTurn(shipping), [helper.id, 'Check the tests.']);
  const checking = await turns.nth(1);
  await tell(app, h.root, asTurn(checking), [one.id, 'They pass.']);
  answer(shipping, 'Waiting on the tests.');
  const shipped = await turns.nth(2);
  await tell(app, h.root, asTurn(shipped), ['main', 'The fix is out.']);
  // Two asks the main hobkin something, from a word of the user's own.
  const two = await app.hobkins.start({ text: 'Ask main which branch.', cwd: h.folder, engine: FAST, title: 'Two' });
  await tell(app, h.root, asTurn(await turns.nth(3)), ['main', 'Which branch?']);

  const release = holdMain(h);
  await app.tickWakes();
  assert.deepEqual(wakesIn(app).at(-1).messages.map(({ from }) => from), [one.id, two.id], 'both in one wake');
  assert.deepEqual(await app.hobkins.tell(two.id, { text: 'Use main.' }), { started: false, queued: true, run: null });
  await assert.rejects(app.hobkins.tell(one.id, { text: 'Thanks.' }), TOO_MANY);
  release();
  await mainDone(app);

  // Helper's turn came from One's count, so its wait, told to the main hobkin, carries that count.
  answer(checking, 'Checked.');
  await waitingNow(app, helper.id);
  clock += 20000;
  const again = holdMain(h);
  await app.tickWakes();
  assert.deepEqual(wakesIn(app).at(-1), { hobkins: [{ id: helper.id, title: 'Helper', status: 'completed', said: 'Checked.' }] });
  await assert.rejects(app.hobkins.tell(helper.id, { text: 'Thanks.' }), TOO_MANY);
  again();
  await mainDone(app);
});

test("inside a durable hobkin's turn, remember, remind, decide, action and session say to use hobkin tell", async t => {
  const h = fixture(t);
  const run = (args, env) => main([...args, '--home', h.root], { write: () => {} }, { env, input: Readable.from(['{}']) });
  const inTurn = { HOBKIN_TURN: 'a'.repeat(32) };
  for (const args of [['remember', 'The user loves the main hobkin.'], ['remind', 'Call the bank', '--on', '2026-12-01'], ['decide'], ['action', 'list'], ['session', '--tier', 'fast']]) {
    await assert.rejects(run(args, inTurn), /hobkin tell main/, args[0]);
  }
  assert.equal(existsSync(join(h.root, 'runtime', 'inbox.jsonl')), false, 'nothing was handed over');
  // Outside a turn they work as before.
  await run(['remember', 'A fact to keep.'], {});
  assert.match(readFileSync(join(h.root, 'runtime', 'inbox.jsonl'), 'utf8'), /A fact to keep\./);
});

test('after the recipient every word is the message as typed, flags and all', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  await app.hobkins.start({ text: 'Write it up.', cwd: h.folder, engine: FAST, title: 'Notes' });
  const env = asTurn(await turns.nth(0));
  const words = ['--plain', '--title', 'X', '--cwd', 'Y', '--home', '/elsewhere', '-5', '-h', '--help', '-v', '-'];
  assert.equal((await tell(app, h.root, env, ['main', ...words])).sent, true);
  assert.deepEqual(Object.values(app.hobkins.mail).map(({ text }) => text), [words.join(' ')]);
});

test('nothing in the requests folder that is not a request file stops hobkin or costs another request its answer', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-tell-folder-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = tellRequests(root);
  const at = name => join(folder, name);
  execFileSync('mkfifo', [at(`${randomUUID()}.json`)]);
  symlinkSync('/dev/zero', at(`${randomUUID()}.json`));
  const directory = `${randomUUID()}.json`;
  mkdirSync(at(directory));
  const answerDirectory = `${randomUUID()}.answer.json`;
  mkdirSync(at(answerDirectory));
  const good = randomUUID();
  const request = { token: 'c'.repeat(32), to: 'main', text: 'Hi' };
  writeFileSync(at(`${good}.json`), JSON.stringify(request));
  const old = new Date(Date.now() - 5 * 60000);
  const stale = [`${randomUUID()}.json.tmp`, `${randomUUID()}.answer.json.tmp`, `${randomUUID()}.json.taken`];
  for (const name of [...stale, answerDirectory]) {
    if (!name.endsWith('.answer.json')) writeFileSync(at(name), '{}');
    utimesSync(at(name), old, old);
  }
  const fresh = `${randomUUID()}.json.tmp`;
  writeFileSync(at(fresh), '{}');

  // In a process of its own, so a look that blocks fails the test instead of freezing it.
  const look = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { takeTellRequests } from ${JSON.stringify(new URL('../src/cli/hobkin-tell.mjs', import.meta.url).href)};
     process.stdout.write(JSON.stringify(takeTellRequests(process.argv[1])));`, root], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' });
  assert.equal(look.error, undefined, 'the look ends');
  assert.equal(look.status, 0, look.stderr);
  assert.deepEqual(JSON.parse(look.stdout), [{ id: good, request }]);
  assert.deepEqual(readdirSync(folder).sort(), [answerDirectory, directory, fresh].sort(), 'what is not a file is left or removed, and only stale leftovers go');
});

test('when hobkin does not answer, the command says only what it knows', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-tell-wait-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'runtime'));
  // Held as a running hobkin holds it, so the command waits for an answer.
  const unlock = await lockfile.lock(join(root, 'runtime'), { stale: 300000 });
  t.after(() => unlock());
  const env = { HOBKIN_TURN: 'b'.repeat(32) };

  // Nobody takes it, so the command takes it back, and nothing was sent.
  await assert.rejects(runTellCommand(root, ['main', 'Hello?'], { env, waitMs: 100 }), /^Error: Nothing was sent: hobkin did not take the message in time/);
  assert.deepEqual(readdirSync(tellRequests(root)), []);

  // Something takes it and never answers: whether it went is not known, and the command says no more than that.
  const taking = setInterval(() => takeTellRequests(root), 10);
  t.after(() => clearInterval(taking));
  await assert.rejects(runTellCommand(root, ['main', 'Hello?'], { env, waitMs: 100 }), error => /not known/.test(error.message) && !/send it again/i.test(error.message));
});

test('however many messages wait for the main hobkin, each wake fits and every one arrives', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  // Quotes are what JSON escapes most: 4096 of them are 8192 bytes in a wake.
  const quotes = '"'.repeat(4096);
  for (const n of [0, 1, 2]) {
    await app.hobkins.start({ text: `Job ${n}.`, cwd: h.folder, engine: FAST, title: `Job ${n}` });
    const env = asTurn(await turns.nth(n));
    for (let k = 0; k < 3; k++) await tell(app, h.root, env, ['main', '-'], quotes);
  }
  const sent = t.mock.method(app.runtime, 'send');
  for (let look = 0; look < 6 && Object.keys(app.hobkins.mail).length; look++) {
    await app.tickWakes();
    await mainDone(app);
  }
  const briefs = sent.mock.calls.map(call => call.arguments[0]);
  assert.ok(briefs.length >= 2, 'more than one wake');
  for (const brief of briefs) assert.ok(Buffer.byteLength(brief) <= 65536, `${Buffer.byteLength(brief)} bytes`);
  assert.equal(briefs.flatMap(brief => JSON.parse(brief.split('\n')[1]).messages).length, 9);
  assert.deepEqual(app.hobkins.mail, {});
});

test('each side lists who it can reach', async t => {
  const h = fixture(t);
  const turns = fakeTurns();
  const app = await h.openApp({ runHarness: turns.runHarness });
  t.after(() => app.close());
  const notes = await app.hobkins.start({ text: 'Write the release notes.', cwd: h.folder, engine: FAST, title: 'Notes' });
  const env = { HOBKIN_TURN: tokenOf(await turns.nth(0)) };
  const changelog = await app.hobkins.start({ cwd: h.folder, engine: FAST, title: 'Changelog' });
  const gone = await app.hobkins.start({ cwd: h.folder, engine: FAST });
  await app.hobkins.end(gone.id);
  const byId = (a, b) => a.id.localeCompare(b.id);

  const { hobkins } = await app.hobkins.reach();
  assert.deepEqual(hobkins.toSorted(byId), [
    { id: notes.id, title: 'Notes', state: 'working' },
    { id: changelog.id, title: 'Changelog', state: 'waiting' },
  ].toSorted(byId));
  assert.deepEqual(await tell(app, h.root, env, []), {
    hobkins: [{ id: 'main', title: 'the main hobkin', state: 'waiting' }, { id: changelog.id, title: 'Changelog', state: 'waiting' }],
  });
});
