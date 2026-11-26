import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentsOut, TeamsAgents } from '../src/cli/teams-agents.mjs';

// No real Pi and no real ~/.pi: every reader gets a folder of its own and no timers.
const folder = t => {
  const dir = mkdtempSync(join(tmpdir(), 'hobkin-teams-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const clock = (start = 10_000) => {
  const time = { now: start };
  return Object.assign(time, { tick: ms => { time.now += ms; }, read: () => time.now });
};
const layer = (teamsDir, time) => new TeamsAgents({ teamsDir, now: time.read, schedule: () => () => {} });

const started = (id, toolName, args) => ({ type: 'tool_execution_start', toolCallId: id, toolName, args });
const ended = (id, toolName, details, isError = false) => ({
  type: 'tool_execution_end', toolCallId: id, toolName, isError,
  result: isError ? { content: [{ type: 'text', text: 'refused' }] } : { content: [{ type: 'text', text: 'Spawned.' }], details },
});
const report = (name, ok = true, summary = 'Found it') => ({
  type: 'message_end', message: { role: 'custom', customType: 'pi-extended-teams-report', display: true, content: 'Full report', details: { name, ok, summary } },
});
const wake = groupId => ({
  type: 'message_end', message: { role: 'custom', customType: 'pi-extended-teams-wake', display: false, content: 'Index', details: { completionGroup: { teamName: 'session-abc', groupId, deliveryId: 'd' } } },
});

/** A teams session folder as pi-extended-teams 2.7.1 writes it. */
function session(teamsDir, id, { members = [], reports = [], lead = id, leadSession = id, name = `session-${id}` } = {}) {
  const dir = join(teamsDir, `session-${id}`);
  mkdirSync(join(dir, 'inboxes'), { recursive: true });
  mkdirSync(join(dir, 'runtime'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    name, description: 'Pi session agents', createdAt: 1, leadAgentId: 'lead-agent', leadSessionId: lead,
    members: [{ agentId: 'lead-agent', name: 'team-lead', agentType: 'lead', joinedAt: 1, cwd: '/x', subscriptions: [] }, ...members],
  }));
  writeFileSync(join(dir, 'lead-session.json'), JSON.stringify({ pid: 1, sessionId: leadSession, startedAt: 1 }));
  writeFileSync(join(dir, 'reports.json'), JSON.stringify(reports));
  return dir;
}
const member = (name, joinedAt, runId, extra = {}) => ({
  agentId: `${name}@team`, name, agentType: 'teammate', role: 'read', modelSlot: 'read-review', joinedAt, cwd: '/x',
  subscriptions: [], prompt: `Prompt of ${name}`, lifecycleRunId: runId, isActive: true, ...extra,
});
const stored = (agentName, startedAt, createdAt, runId, status = 'completed', summary = 'Stored summary') => ({
  id: `report:${agentName}:${runId}`, teamName: 'session-abc', agentName, role: 'read', status, report: 'Body', summary,
  startedAt, createdAt, source: 'read-agent', result: { outcome: 'succeeded', runId }, metadata: { initialPrompt: `Stored prompt of ${agentName}` },
});
const view = (rows, fields = ['name', 'state', 'startedAt', 'endedAt']) => rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]])));

/** The run `r1` spawns `scout` at 10 000 in session `abc`. */
function spawnScout(teams, time, { name = 'scout', run = 'r1', session: named = 'session-abc' } = {}) {
  teams.observe(run, started(`call-${name}`, 'spawn_agent', { name, prompt: 'Find the bug\nin the login flow', model_slot: 'read-review' }));
  time.tick(300);
  teams.observe(run, ended(`call-${name}`, 'spawn_agent', { name, session: named, queued: false, role: 'read', modelSlot: 'read-review' }));
}

test("a run's own spawn calls give each agent its name, task, status and times", t => {
  const time = clock();
  const teams = layer(folder(t), time);
  assert.deepEqual(teams.snapshot(), {});
  teams.observe('quiet', { type: 'tool_execution_end', toolCallId: 'x', toolName: 'read', result: { content: [] } });
  spawnScout(teams, time);
  time.tick(700);
  teams.observe('r1', started('swarm', 'spawn_swarm_agents', {
    defaults: { model_slot: 'read-collect' },
    agents: [{ name: 'alpha', prompt: 'Alpha task' }, { name: 'beta', prompt: 'Beta task' }, { name: 'gamma', prompt: 'Gamma task' }],
  }));
  teams.observe('r1', ended('swarm', 'spawn_swarm_agents', {
    session: 'session-abc', completionGroup: { groupId: 'g1', journalPath: '/private/journal.json' },
    spawned: [{ name: 'alpha', queued: false }, { name: 'beta', queued: true, queuePosition: 1 }],
    failed: [{ name: 'gamma', error: 'capacity' }],
  }));
  teams.observe('r1', started('denied', 'spawn_agent', { name: 'writer', prompt: 'Write it', model_slot: 'write-patch' }));
  teams.observe('r1', ended('denied', 'spawn_agent', undefined, true));
  time.tick(4000);
  teams.observe('r1', report('scout', true, 'Login bug is in the redirect'));

  const rows = teams.snapshot().r1;
  assert.deepEqual(Object.keys(teams.snapshot()), ['r1'], 'only runs that started agents are listed');
  assert.deepEqual(view(rows), [
    { name: 'alpha', state: 'running', startedAt: 11_000, endedAt: undefined },
    { name: 'beta', state: 'queued', startedAt: 11_000, endedAt: undefined },
    { name: 'gamma', state: 'failed', startedAt: 11_000, endedAt: 11_000 },
    { name: 'writer', state: 'failed', startedAt: 11_000, endedAt: 11_000 },
    { name: 'scout', state: 'done', startedAt: 10_300, endedAt: 15_000 },
  ]);
  const scout = rows.find(row => row.name === 'scout');
  assert.equal(scout.task, 'Find the bug\nin the login flow');
  assert.equal(scout.modelSlot, 'read-review');
  assert.equal(scout.summary, 'Login bug is in the redirect');
  assert.equal(scout.from, 'run');
  assert.equal(rows.find(row => row.name === 'alpha').modelSlot, 'read-collect');
  assert.equal(rows.find(row => row.name === 'beta').task, 'Beta task');
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length, 'each row has a key of its own');
  assert.doesNotMatch(JSON.stringify(rows), /journal|Full report|refused|capacity/);
  assert.equal(teams.snapshot(), teams.snapshot(), 'nothing new gives the same object, so it is not sent again');

  time.tick(1000);
  teams.observe('r1', wake('other'));
  assert.equal(teams.snapshot().r1.find(row => row.name === 'alpha').state, 'running', "another group's wake ends nothing");
  teams.observe('r1', wake('g1'));
  assert.deepEqual(view(teams.snapshot().r1.filter(row => row.name !== 'scout')), [
    { name: 'gamma', state: 'failed', startedAt: 11_000, endedAt: 11_000 },
    { name: 'writer', state: 'failed', startedAt: 11_000, endedAt: 11_000 },
    { name: 'alpha', state: 'done', startedAt: 11_000, endedAt: 16_000 },
    { name: 'beta', state: 'done', startedAt: 11_000, endedAt: 16_000 },
  ]);
});

test("each agent says the model and thinking level teams started it on, from its spawn result or teams' record of it", async t => {
  const time = clock();
  const dir = folder(t);
  const claude = { name: 'write-critical', kind: 'claude', command: '/bin/claude', args: ['--model', 'claude-opus-5-5', '--effort=max'], instructions: '' };
  const codex = { name: 'pane', kind: 'codex', command: '/bin/codex', args: ['--model', 'gpt-x'], instructions: '' };
  session(dir, 'abc', { members: [
    member('scout', 10_100, 'run-1', { model: 'openai-codex/gpt-6-luna', thinking: 'max' }),
    member('fixer', 10_100, 'run-2', { modelSlot: 'write-critical', backendType: 'external-harness', externalHarness: claude }),
    member('pane', 10_100, 'run-3', { backendType: 'external-harness', externalHarness: codex }),
  ] });
  const teams = layer(dir, time);
  teams.observe('r1', started('swarm', 'spawn_swarm_agents', { agents: [{ name: 'alpha', prompt: 'A' }, { name: 'beta', prompt: 'B' }] }));
  teams.observe('r1', ended('swarm', 'spawn_swarm_agents', { session: 'session-abc', spawned: [
    { name: 'alpha', model: 'anthropic/claude-sonnet-5', thinking: 'high' },
    { name: 'beta', queued: true, model: 'openai-codex/gpt-6-luna', thinking: null },
  ] }));
  for (const name of ['scout', 'fixer', 'pane']) {
    teams.observe('r1', started(`call-${name}`, 'spawn_agent', { name, prompt: name }));
    teams.observe('r1', ended(`call-${name}`, 'spawn_agent', { name, session: 'session-abc', model: null, thinking: null }));
  }
  const ranOn = () => view(teams.snapshot().r1, ['name', 'model', 'thinking']);

  assert.deepEqual(ranOn(), [
    { name: 'alpha', model: 'anthropic/claude-sonnet-5', thinking: 'high' },
    { name: 'scout', model: undefined, thinking: undefined },
    { name: 'fixer', model: undefined, thinking: undefined },
    { name: 'pane', model: undefined, thinking: undefined },
    { name: 'beta', model: 'openai-codex/gpt-6-luna', thinking: undefined },
  ], 'the spawn result names what teams chose, and a level it left out stays out');
  await teams.read();
  assert.deepEqual(ranOn(), [
    { name: 'alpha', model: 'anthropic/claude-sonnet-5', thinking: 'high' },
    { name: 'scout', model: 'openai-codex/gpt-6-luna', thinking: 'max' },
    { name: 'fixer', model: 'claude-opus-5-5', thinking: 'max' },
    { name: 'pane', model: undefined, thinking: undefined },
    { name: 'beta', model: 'openai-codex/gpt-6-luna', thinking: undefined },
  ], "teams' record fills in the rest: a Pi agent's own fields, Claude Code's flags, and no other harness's");
});

test('a wake from a group that delivers each report as it comes ends only the agents its file says have settled', async t => {
  const time = clock();
  const dir = folder(t);
  const hex = 'a'.repeat(64), groupId = `group:${hex}`;
  const at = session(dir, 'abc', { members: [member('alpha', 10_100, 'ra'), member('beta', 10_100, 'rb'), member('gamma', 10_100, 'rc')] });
  mkdirSync(join(at, 'completion-groups'));
  writeFileSync(join(at, 'completion-groups', `${hex}.json`), JSON.stringify({
    version: 1, groupId, sessionId: 'abc', policy: { delivery: 'immediate' }, sealed: true,
    members: [
      { name: 'alpha', slotId: `${groupId}:0`, status: 'reported', runId: 'ra' },
      { name: 'beta', slotId: `${groupId}:1`, status: 'running', runId: 'rb' },
      { name: 'gamma', slotId: `${groupId}:2`, status: 'cancelled', runId: 'rc' },
    ],
    deliveries: [{ id: 'd', kind: 'member', slotIds: [`${groupId}:0`], status: 'enqueued', wake: { state: 'observed', entryId: 'e' } }],
  }));
  const teams = layer(dir, time);
  const agents = ['alpha', 'beta', 'gamma'].map(name => ({ name, prompt: `${name} task` }));
  teams.observe('r1', started('swarm', 'spawn_swarm_agents', { agents, completion_group: { delivery: 'immediate' } }));
  teams.observe('r1', ended('swarm', 'spawn_swarm_agents', {
    session: 'session-abc', completionGroup: { groupId }, spawned: agents.map(({ name }) => ({ name })),
  }));
  time.tick(3000);

  teams.observe('r1', wake(groupId));
  await teams.read();

  assert.deepEqual(view(teams.snapshot().r1, ['name', 'state']), [
    { name: 'beta', state: 'running' },
    { name: 'gamma', state: 'failed' },
    { name: 'alpha', state: 'done' },
  ]);
});

test('a run keeps at most 24 agents, and the reader the 20 runs that ended last', t => {
  const time = clock();
  const teams = layer(folder(t), time);
  for (let i = 0; i < 30; i++) {
    teams.observe('busy', started(`c${i}`, 'spawn_agent', { name: `a${i}`, prompt: 'p', model_slot: 'read-review' }));
    teams.observe('busy', ended(`c${i}`, 'spawn_agent', { name: `a${i}`, session: 'session-abc', queued: false }));
  }
  assert.equal(teams.snapshot().busy.length, 24);
  const runs = Array.from({ length: 23 }, (_, i) => `run${i}`);
  for (const run of runs) spawnScout(teams, time, { run });
  teams.snapshot(new Set(runs));
  for (const [i, run] of runs.entries()) {
    time.tick(10);
    teams.snapshot(new Set(runs.slice(i + 1)));
  }
  assert.deepEqual(Object.keys(teams.snapshot()).filter(id => id.startsWith('run')), runs.slice(3));
});

test("without teams' files, or with broken ones, the rows stand on the run's own events", async t => {
  const time = clock();
  const dir = folder(t);
  const teams = layer(join(dir, 'missing'), time);
  spawnScout(teams, time);
  assert.equal(await teams.read(), false);
  assert.equal(teams.snapshot().r1[0].state, 'running');

  const broken = layer(dir, time);
  const at = session(dir, 'abc');
  writeFileSync(join(at, 'config.json'), '{ not json');
  writeFileSync(join(at, 'reports.json'), '[{"agentName": "scout"');
  spawnScout(broken, time);
  await broken.read();
  assert.deepEqual(view(broken.snapshot().r1, ['name', 'state', 'from']), [{ name: 'scout', state: 'running', from: 'run' }]);

  // An event that throws while it is read is dropped, and the run's rows stay as they were.
  const hostile = { type: 'tool_execution_end', toolCallId: 'h', get toolName() { throw new Error('boom'); } };
  assert.doesNotThrow(() => broken.observe('r1', hostile));
  assert.doesNotThrow(() => broken.observe('r1', null));
  assert.equal(broken.snapshot().r1.length, 1);
});

test("teams' files count only for the session the run named, and a name alone never matches", async t => {
  const time = clock();
  const dir = folder(t);
  session(dir, 'abc', { reports: [
    stored('scout', 5_000, 6_000, 'old-run', 'failed', 'An earlier scout'),
    stored('scout', 10_200, 12_000, 'this-run', 'completed', 'This scout'),
  ] });
  session(dir, 'other', { reports: [stored('scout', 10_100, 11_000, 'other-run', 'failed', 'Another session')] });
  session(dir, 'forged', { leadSession: 'someone-else', reports: [stored('scout', 10_100, 11_000, 'f', 'failed', 'Forged')] });
  session(dir, 'local-session', { reports: [stored('scout', 10_100, 11_000, 'l', 'failed', 'Shared')] });
  const teams = layer(dir, time);
  spawnScout(teams, time, { run: 'mine' });
  spawnScout(teams, time, { run: 'forged', session: 'session-forged' });
  spawnScout(teams, time, { run: 'local', session: 'session-local-session' });
  spawnScout(teams, time, { run: 'unnamed', session: '../abc' });
  assert.equal(await teams.read(), true);

  const [mine] = teams.snapshot().mine;
  assert.deepEqual({ state: mine.state, endedAt: mine.endedAt, summary: mine.summary, from: mine.from },
    { state: 'done', endedAt: 12_000, summary: 'This scout', from: 'teams' });
  for (const run of ['forged', 'local', 'unnamed']) {
    assert.deepEqual(view(teams.snapshot()[run], ['state', 'summary', 'from']), [{ state: 'running', summary: undefined, from: 'run' }], run);
  }
});

test('an agent never seen to end reads unknown once its run ended or teams no longer lists it', async t => {
  const time = clock();
  const streamOnly = layer(folder(t), time);
  spawnScout(streamOnly, time);
  assert.equal(streamOnly.snapshot(new Set(['r1'])).r1[0].state, 'running');
  time.tick(1000);
  const [after] = streamOnly.snapshot(new Set()).r1;
  assert.deepEqual({ state: after.state, endedAt: after.endedAt }, { state: 'unknown', endedAt: undefined });

  const dir = folder(t);
  const at = session(dir, 'abc', { members: [member('scout', 10_100, 'run-1')] });
  const teams = layer(dir, time);
  time.now = 10_000;
  spawnScout(teams, time);
  teams.snapshot(new Set(['r1']));
  writeFileSync(join(at, 'runtime', 'scout.json'), JSON.stringify({ agentName: 'scout', lifecycleRunId: 'run-1', currentAction: 'working', activeToolName: 'grep', lastHeartbeatAt: 10_200 }));
  await teams.read();
  assert.deepEqual(view(teams.snapshot().r1, ['state', 'phase', 'from']), [{ state: 'running', phase: 'grep', from: 'teams' }]);

  session(dir, 'abc');
  time.tick(5000);
  await teams.read();
  assert.deepEqual(view(teams.snapshot().r1, ['state', 'endedAt']), [{ state: 'unknown', endedAt: undefined }], 'gone from teams with no report');

  // Once its run has ended, a member still listed runs only while its heartbeat is fresh.
  const kept = layer(dir, time);
  session(dir, 'abc', { members: [member('scout', time.now + 100, 'run-2')] });
  spawnScout(kept, time);
  kept.snapshot(new Set(['r1']));
  writeFileSync(join(at, 'runtime', 'scout.json'), JSON.stringify({ lifecycleRunId: 'run-2', currentAction: 'working', lastHeartbeatAt: time.now }));
  kept.snapshot(new Set());
  await kept.read();
  assert.equal(kept.snapshot().r1[0].state, 'running');
  time.tick(120_000);
  assert.equal(kept.snapshot(new Set()).r1[0].state, 'unknown');
});

test("an agent's steps and messages come from its own session and the inboxes, cut to size", async t => {
  const time = clock();
  const dir = folder(t);
  const at = session(dir, 'abc', { reports: [stored('scout', 10_200, 40_000, 'run-1')] });
  const transcript = join(at, 'agent-sessions', 'scout', 'run-1');
  mkdirSync(transcript, { recursive: true });
  const line = (timestamp, message) => JSON.stringify({ type: 'message', id: timestamp, timestamp, message });
  const lines = [
    JSON.stringify({ type: 'session', version: '3', id: 'child', timestamp: '2026-11-15T16:55:18.276Z', cwd: '/x' }),
    line('2026-11-15T16:55:19.000Z', { role: 'user', content: [{ type: 'text', text: 'PRIVATE PROMPT COPY' }] }),
    line('2026-11-15T16:55:20.000Z', { role: 'assistant', content: [
      { type: 'thinking', thinking: 'SECRET THINKING' },
      { type: 'text', text: 'Reading the login controller.' },
      { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'app/login.rb' } },
    ] }),
    line('2026-11-15T16:55:21.000Z', { role: 'toolResult', toolCallId: 't1', toolName: 'read', isError: false, content: [{ type: 'text', text: 'x'.repeat(5000) }], details: { private: 'DETAILS' } }),
  ];
  for (let i = 0; i < 30; i++) {
    lines.push(line(`2026-11-15T16:56:${String(i).padStart(2, '0')}.000Z`, { role: 'assistant', content: [{ type: 'text', text: `Step ${i}` }] }));
  }
  writeFileSync(join(transcript, '2026-11-15T16-55-18-276Z_child.jsonl'), lines.join('\n') + '\n');
  writeFileSync(join(at, 'inboxes', 'scout.json'), JSON.stringify([
    { id: 'm1', from: 'team-lead', text: 'Check the redirect too', timestamp: '2026-11-15T16:55:30.000Z', read: true, metadata: { recipientRunId: 'run-1' } },
    { id: 'm0', from: 'team-lead', text: 'For an older run', timestamp: '2026-11-15T16:55:31.000Z', read: true, metadata: { recipientRunId: 'old' } },
    { id: 'm2', from: 'fixer', text: 'I hold the controller claim', timestamp: '2026-11-15T16:55:40.000Z', read: true, metadata: { recipientRunId: 'run-1' } },
  ]));
  writeFileSync(join(at, 'inboxes', 'team-lead.json'), JSON.stringify([
    { id: 'm3', from: 'scout', text: 'y'.repeat(2000), timestamp: '2026-11-15T16:55:35.000Z', read: true, metadata: { senderRunId: 'run-1' } },
    { id: 'm4', from: 'fixer', text: 'Not scout', timestamp: '2026-11-15T16:55:36.000Z', read: true, metadata: { senderRunId: 'run-9' } },
  ]));
  const teams = layer(dir, time);
  spawnScout(teams, time);
  await teams.read();
  const [scout] = teams.snapshot().r1;

  assert.equal(scout.steps.length, 16);
  assert.deepEqual(scout.steps.at(-1), { id: scout.steps.at(-1).id, kind: 'assistant', text: 'Step 29', at: Date.parse('2026-11-15T16:56:29.000Z') });
  const all = new TeamsAgents({ teamsDir: dir, now: time.read, schedule: () => () => {}, mostSteps: 100 });
  spawnScout(all, time);
  await all.read();
  const [read] = all.snapshot().r1[0].steps.filter(step => step.kind === 'tool');
  assert.deepEqual({ name: read.name, state: read.state, at: read.at }, { name: 'read', state: 'completed', at: Date.parse('2026-11-15T16:55:20.000Z') });
  assert.ok(read.output.length <= 400 && read.input.includes('app/login.rb'));
  assert.doesNotMatch(JSON.stringify(all.snapshot()), /SECRET THINKING|DETAILS|PRIVATE PROMPT COPY/);

  assert.deepEqual(scout.messages.map(({ by, peer, at }) => ({ by, peer, at })), [
    { by: 'run', peer: undefined, at: Date.parse('2026-11-15T16:55:30.000Z') },
    { by: 'agent', peer: undefined, at: Date.parse('2026-11-15T16:55:35.000Z') },
    { by: 'peer', peer: 'fixer', at: Date.parse('2026-11-15T16:55:40.000Z') },
  ]);
  assert.equal(scout.messages[1].text.length, 600);
  assert.equal(scout.task, 'Find the bug\nin the login flow', "the run's own words for the task stay");

  // Without teams' inboxes, the run's own messages to it and its report are its exchanges.
  const plain = layer(folder(t), time);
  spawnScout(plain, time);
  plain.observe('r1', started('say', 'send_message', { recipient: 'scout', content: 'Look at the session store' }));
  plain.observe('r1', ended('say', 'send_message', { delivered: true }));
  plain.observe('r1', started('lost', 'send_message', { recipient: 'nobody', content: 'To no one' }));
  plain.observe('r1', ended('lost', 'send_message', {}));
  plain.observe('r1', report('scout', true, 'All done'));
  assert.deepEqual(plain.snapshot().r1[0].messages.map(({ by, text }) => [by, text]), [['run', 'Look at the session store'], ['agent', 'All done']]);
});

test("reading teams' files writes nothing there", async t => {
  const time = clock();
  const dir = folder(t);
  const at = session(dir, 'abc', { members: [member('scout', 10_100, 'run-1')] });
  writeFileSync(join(at, 'runtime', 'scout.json'), JSON.stringify({ lifecycleRunId: 'run-1', currentAction: 'working', lastHeartbeatAt: 10_000 }));
  const tree = () => {
    const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => {
      const full = join(path, entry.name);
      return entry.isDirectory() ? [full, ...walk(full)] : [`${full}:${statSync(full).size}:${statSync(full).mtimeMs}`];
    });
    return walk(dir).sort();
  };
  const before = tree();
  const teams = layer(dir, time);
  spawnScout(teams, time);
  await teams.read();
  teams.snapshot(new Set());
  await teams.read();
  assert.deepEqual(tree(), before);
});

test("teams' files say which agents are still out for a session, within teams' heartbeat staleness", async t => {
  const dir = folder(t), now = Date.now();
  const at = session(dir, 'abc', { members: [
    member('beating', 1, 'r1'), member('quiet', 1, 'r2'), member('starting', now - 1000, 'r3'),
    member('closed', now, 'r4', { isActive: false }), member('rerun', 1, 'r5'),
  ] });
  const beat = (name, lifecycleRunId, lastHeartbeatAt) =>
    writeFileSync(join(at, 'runtime', `${name}.json`), JSON.stringify({ agentName: name, lifecycleRunId, lastHeartbeatAt }));
  beat('beating', 'r1', now - 89_000);
  beat('quiet', 'r2', now - 91_000);
  beat('rerun', 'an-older-run', now);
  assert.deepEqual(await agentsOut('abc', { teamsDir: dir, now }), ['beating', 'starting']);

  // A completion group written lately also holds a slot that has not settled, and a wake that has not reached the lead.
  mkdirSync(join(at, 'completion-groups'));
  const group = (file, members, deliveries = []) =>
    writeFileSync(join(at, 'completion-groups', file), JSON.stringify({ version: 1, sessionId: 'abc', members, deliveries }));
  group('fresh.json', [
    { name: 'beating', status: 'running' },
    { name: 'waiting', status: 'queued' },
    { name: 'done', status: 'reported' },
  ], [
    { id: 'seen', status: 'enqueued', wake: { state: 'observed', entryId: 'e1' } },
    { id: 'coming', status: 'enqueued', wake: { state: 'pending' } },
  ]);
  group('dead.json', [{ name: 'stuck', status: 'running' }], [{ id: 'lost', status: 'pending' }]);
  const lastWrittenSeconds = (now - 91_000) / 1000;
  utimesSync(join(at, 'completion-groups', 'dead.json'), lastWrittenSeconds, lastWrittenSeconds);

  assert.deepEqual(await agentsOut('abc', { teamsDir: dir, now }), ['beating', 'starting', 'waiting', 'wake:coming']);

  // Another lead's folder, a shared session and one that is not there have nothing out.
  session(dir, 'other', { members: [member('beating', now, 'r1')], lead: 'someone-else' });
  for (const id of ['other', 'local-session', 'missing', '../abc']) assert.deepEqual(await agentsOut(id, { teamsDir: dir, now }), []);
});

test("observing a run's events changes none of them", t => {
  const time = clock();
  const teams = layer(folder(t), time);
  const freeze = value => {
    if (value && typeof value === 'object') {
      for (const inner of Object.values(value)) freeze(inner);
      Object.freeze(value);
    }
    return value;
  };
  const events = [
    started('c', 'spawn_agent', { name: 'scout', prompt: 'Find it', model_slot: 'read-review' }),
    ended('c', 'spawn_agent', { name: 'scout', session: 'session-abc', queued: false }),
    started('s', 'send_message', { recipient: 'scout', content: 'More' }),
    ended('s', 'send_message', {}),
    report('scout'),
    wake('g'),
  ];
  const copies = structuredClone(events);
  for (const event of events) {
    freeze(event);
    assert.doesNotThrow(() => teams.observe('r1', event));
  }
  assert.deepEqual(events, copies);
  assert.equal(teams.snapshot().r1[0].state, 'done');
});
