import test from 'node:test';
import assert from 'node:assert/strict';
import { JobActivity } from '../src/cli/job-activity.mjs';

const update = (type, extra = {}) => ({ type: 'message_update', assistantMessageEvent: { type, contentIndex: 0, ...extra } });

for (const [boundary, markHidden] of [
  ['event.display', event => { event.display = false; }],
  ['message.display', event => { event.message = { display: false }; }],
  ['assistantMessageEvent.display', event => { event.assistantMessageEvent.display = false; }],
  ['assistantMessageEvent.content.display', event => { event.assistantMessageEvent.content = { display: false }; }],
]) {
  test(`message updates stay hidden after ${boundary} is false`, () => {
    const feed = new JobActivity();
    feed.accept({ type: 'message_start', message: { role: 'assistant' } });
    feed.accept(update('text_delta', { delta: 'Public before' }));

    const hiddenUpdate = update('text_delta', { delta: 'HIDDEN_BOUNDARY' });
    markHidden(hiddenUpdate);
    feed.accept(hiddenUpdate);
    feed.accept(update('text_delta', { delta: 'HIDDEN_DELTA' }));
    feed.accept(update('text_end', { content: 'HIDDEN_UPDATE_FINAL' }));
    assert.deepEqual(feed.snapshot().map(entry => entry.text), ['Public before']);

    feed.accept({ type: 'message_end', message: { role: 'assistant', content: [
      { type: 'text', text: 'HIDDEN_MESSAGE_FINAL' },
    ] } });

    feed.accept({ type: 'message_start', message: { role: 'assistant' } });
    feed.accept(update('text_delta', { delta: 'Public after' }));
    feed.accept({ type: 'message_end', message: { role: 'assistant', content: [
      { type: 'text', text: 'Public after' },
    ] } });

    assert.deepEqual(feed.snapshot().map(entry => entry.text), ['Public before', 'Public after']);
  });
}

test('public custom messages preserve complete Unicode display history', () => {
  const feed = new JobActivity();
  const text = '🌍你好'.repeat(12000);
  feed.accept({ type: 'message_end', message: { role: 'custom', display: true, content: 'Visible custom' } });
  feed.accept({ type: 'message_end', message: { role: 'custom', display: true, content: [{ type: 'text', text }] } });
  assert.deepEqual(feed.snapshot().map(entry => entry.text), ['Visible custom', text]);
});

test('compact RPC reconciles text and tool snapshots without duplicating streamed output', () => {
  const feed = new JobActivity();
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept(update('text_delta', { delta: 'Hel' }));
  feed.accept(update('text_delta', { delta: 'lo' }));
  feed.accept(update('text_end', { content: 'Hello!' }));
  feed.accept({ type: 'tool_execution_start', toolCallId: 't', toolName: 'read', args: { path: 'file.txt' } });
  feed.accept({ type: 'tool_execution_update', toolCallId: 't', toolName: 'read', partialResult: { content: [{ type: 'text', text: 'Part' }] } });
  assert.equal(feed.snapshot().at(-1).output, 'Part');
  feed.accept({ type: 'tool_execution_update', toolCallId: 't', toolName: 'read', partialResult: { content: [{ type: 'text', text: 'Partial' }] } });
  assert.equal(feed.snapshot().at(-1).output, 'Partial');
  feed.accept({ type: 'tool_execution_end', toolCallId: 't', isError: true, result: { content: [{ type: 'text', text: 'Failed to read' }], details: { internal: 'not display content' } } });
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] } });
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept(update('text_delta', { delta: 'Next' }));
  const entries = feed.snapshot();
  assert.deepEqual(entries.map(({ id, ...entry }) => entry), [
    { kind: 'assistant', text: 'Hello!' }, { kind: 'tool', name: 'read', state: 'failed', input: '{\n  "path": "file.txt"\n}', output: 'Failed to read' },
    { kind: 'assistant', text: 'Next' },
  ]);
  feed.accept(update('text_end', { content: 'Final' }));
  assert.equal(entries.at(-1).text, 'Next');
  feed.accept(update('text_delta', { contentIndex: 2, delta: 'Second block' }));
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [
    { type: 'text', text: 'Final' }, { type: 'thinking', thinking: 'SECRET' }, { type: 'text', text: 'Reconciled' },
  ] } });
  assert.deepEqual(feed.snapshot().filter(entry => entry.kind === 'assistant').map(entry => entry.text), ['Hello!', 'Final', 'Reconciled']);
});

test('complete parent text, tool names, inputs and outputs survive beyond former preview limits', () => {
  const feed = new JobActivity();
  const text = 'Beginning\n' + 'x'.repeat(40000) + '\nEnd';
  const name = 'read'.repeat(50);
  feed.accept({ type: 'tool_execution_start', toolCallId: 'large', toolName: name, args: { text } });
  feed.accept({ type: 'tool_execution_end', toolCallId: 'large', result: { content: [{ type: 'text', text }] } });
  for (let i = 0; i < 100; i++) {
    feed.accept({ type: 'message_start', message: { role: 'assistant' } });
    feed.accept(update('text_delta', { delta: `${i}:${text}` }));
    feed.accept({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: `${i}:${text}` }] } });
  }
  const entries = feed.snapshot();
  assert.equal(entries.length, 101);
  assert.equal(entries[0].name, name);
  assert.equal(entries[0].input, JSON.stringify({ text }, null, 2));
  assert.equal(entries[0].output, text);
  assert.equal(entries[1].text, `0:${text}`);
  assert.equal(entries[100].text, `99:${text}`);
});

test('authoritative message end removes superseded preview blocks', () => {
  const feed = new JobActivity();
  feed.accept(update('text_delta', { delta: 'Superseded' }));
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [] } });
  assert.deepEqual(feed.snapshot(), []);
});

test('unsafe, hidden and malformed records are ignored; visible content stays terminal-safe', () => {
  const feed = new JobActivity();
  for (const event of [null, {}, { type: 'extension_ui_request', text: 'SECRET' },
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'SECRET', display: false }] } },
    update('thinking_delta', { delta: 'SECRET' }), { type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET' }] } },
    { type: 'message_end', message: { role: 'custom', content: 'SECRET' } },
    { type: 'message_start', message: { role: 'custom', display: false } }, update('text_delta', { delta: 'SECRET' }),
  ]) assert.doesNotThrow(() => feed.accept(event));
  assert.deepEqual(feed.snapshot(), []);
  feed.accept({ type: 'message_end', message: { role: 'custom' } });
  feed.accept({ type: 'message_start', display: false, message: { role: 'assistant' } });
  feed.accept(update('text_delta', { delta: 'SECRET' }));
  assert.deepEqual(feed.snapshot(), []);
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [] } });
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '\x1b[31mVisible\x1b[0m\r\x00' }, { type: 'toolCall', id: 'c', name: 'read', arguments: { path: 'file.txt' } }] } });
  feed.accept({ type: 'tool_execution_end', toolCallId: 'c', result: { content: [{ type: 'text', text: 'File content' }] } });
  assert.equal(feed.snapshot()[0].text, 'Visible');
  assert.equal(feed.snapshot()[1].state, 'completed');
  assert.equal(feed.snapshot()[1].input, '{\n  "path": "file.txt"\n}');
  assert.equal(feed.snapshot()[1].output, 'File content');
});

const spawned = (toolName, details, isError = false) => ({ type: 'tool_execution_end', toolCallId: toolName, toolName, isError, result: { content: [{ type: 'text', text: 'Spawned.' }], details } });
const said = (customType, details, display = true) => ({ type: 'message_end', message: { role: 'custom', customType, display, content: 'Report body', details } });

test('spawned teams agents stand by their own spawn details and reports, never their transcripts', () => {
  let clock = 100;
  const feed = new JobActivity({ now: () => clock });
  feed.accept(spawned('spawn_agent', { name: 'scout', role: 'read', modelSlot: 'read-collect', model: 'm', sessionContext: 'full', session: 'session-x', queued: false }));
  feed.accept(spawned('spawn_agent', { name: 'fixer', role: 'write', modelSlot: 'write-feature', queued: true, queuePosition: 2 }));
  feed.accept(spawned('spawn_agent', { name: 'refused' }, true));
  assert.deepEqual(feed.children(), [
    { name: 'scout', role: 'read', modelSlot: 'read-collect', state: 'running', startedAt: 100 },
    { name: 'fixer', role: 'write', modelSlot: 'write-feature', state: 'queued', queuePosition: 2, startedAt: 100 },
  ]);
  clock = 250;
  feed.accept(said('pi-extended-teams-report', { name: 'scout', ok: true, summary: 'Found it' }));
  feed.accept(said('pi-extended-teams-report', { name: 'fixer', ok: false }));
  feed.accept(said('pi-extended-teams-report', { name: 'stranger', ok: true }));
  assert.deepEqual(feed.children().map(({ name, state, endedAt, queuePosition }) => ({ name, state, endedAt, queuePosition })), [
    { name: 'scout', state: 'reported', endedAt: 250, queuePosition: undefined },
    { name: 'fixer', state: 'failed', endedAt: 250, queuePosition: undefined },
  ]);
  assert.doesNotMatch(JSON.stringify(feed.children()), /session|Report body|Found it|"m"/);
});

test('a grouped swarm finishes on its own wake; status results refine only agents it spawned', () => {
  const feed = new JobActivity({ now: () => 5 });
  feed.accept(spawned('spawn_swarm_agents', {
    session: 'session-x', completionGroup: { groupId: 'g1', journalPath: '/private/journal.json' },
    spawned: [{ name: 'a', role: 'read', queued: false }, { name: 'b', role: 'read', queued: true, queuePosition: 1 }],
    failed: [{ name: 'c', error: 'capacity' }],
  }));
  feed.accept({ type: 'tool_execution_end', toolCallId: 's', toolName: 'get_agent_status', result: { details: { statuses: [
    { name: 'a', role: 'read', phase: 'working', activeTool: 'grep', progress: 'private progress' },
    { name: 'b', role: 'read', phase: 'starting' },
    { name: 'grandchild', role: 'read', phase: 'working' },
  ] } } });
  assert.deepEqual(feed.children(), [
    { name: 'a', role: 'read', state: 'running', group: 'g1', startedAt: 5, phase: 'working', activeTool: 'grep' },
    { name: 'b', role: 'read', state: 'running', group: 'g1', startedAt: 5, phase: 'starting' },
    { name: 'c', state: 'failed', group: 'g1', endedAt: 5 },
  ]);
  feed.accept(said('pi-extended-teams-wake', { completionGroup: { teamName: 't', groupId: 'other', deliveryId: 'd' } }, false));
  assert.deepEqual(feed.children().map(child => child.state), ['running', 'running', 'failed']);
  feed.accept(said('pi-extended-teams-wake', { completionGroup: { teamName: 't', groupId: 'g1', deliveryId: 'd' } }, false));
  assert.deepEqual(feed.children().map(child => [child.state, child.activeTool]), [['reported', undefined], ['reported', undefined], ['failed', undefined]]);
  assert.doesNotMatch(JSON.stringify(feed.children()), /journal|private|grandchild|capacity/);
});

test('a child still out when its run ends is stopped, not reported', () => {
  const feed = new JobActivity({ now: () => 1 });
  feed.accept(spawned('spawn_agent', { name: 'done', role: 'read' }));
  feed.accept(spawned('spawn_agent', { name: 'busy', role: 'write' }));
  feed.accept(spawned('spawn_agent', { name: 'waiting', role: 'read', queued: true, queuePosition: 1 }));
  feed.accept(said('pi-extended-teams-report', { name: 'done', ok: true }));
  assert.deepEqual(feed.children({ ended: true }).map(({ name, state, queuePosition }) => ({ name, state, queuePosition })), [
    { name: 'done', state: 'reported', queuePosition: undefined },
    { name: 'busy', state: 'stopped', queuePosition: undefined },
    { name: 'waiting', state: 'stopped', queuePosition: undefined },
  ]);
  assert.equal(feed.children()[1].state, 'running', 'only the published copy says stopped');
});

test('codemode details preserve ordered call snapshots, including duplicate running ids', () => {
  const feed = new JobActivity();
  feed.accept({ type: 'tool_execution_start', toolCallId: 'outer', toolName: 'codemode', args: { code: 'await Promise.all(...)' } });
  const partial = calls => ({ content: [], details: { calls, fullOutputPath: '/tmp/codemode-output.txt', private: 'SECRET' } });
  feed.accept({ type: 'tool_execution_update', toolCallId: 'outer', toolName: 'codemode', partialResult: partial([
    { id: 'outer/?', name: 'read', args: '{"path":"a"}', status: 'running', private: 'SECRET' },
    { id: 'outer/?', name: 'grep', args: '{"pattern":"x"}', status: 'running' },
  ]) });
  const running = feed.snapshot().at(-1);
  feed.accept({ type: 'tool_execution_update', toolCallId: 'outer', toolName: 'codemode', partialResult: partial([
    { id: 'outer/2', name: 'read', args: '{"path":"a"}', status: 'ok', durationMs: 12, cost: 0 },
    { id: 'outer/?', name: 'grep', args: '{"pattern":"x"}', status: 'running' },
  ]) });

  const updated = feed.snapshot().at(-1);
  assert.deepEqual(updated.codemode.calls.map(({ id, name, status }) => [id, name, status]), [
    ['outer/2', 'read', 'ok'], ['outer/?', 'grep', 'running'],
  ]);
  assert.equal(running.codemode.calls[0].id, 'outer/?', 'prior snapshots are not rewritten');
  assert.equal(updated.codemode.fullOutputPath, '/tmp/codemode-output.txt');
  assert.doesNotMatch(JSON.stringify(updated.codemode), /SECRET|private/);
  assert.deepEqual(Object.keys(updated.codemode.calls[0]).sort(), ['args', 'cost', 'durationMs', 'id', 'name', 'status']);
  assert.equal(updated.codemode.calls[0].cost, 0);
});

test('codemode partial output and nested errors stay separate from parent failure', () => {
  const feed = new JobActivity();
  feed.accept({ type: 'tool_execution_start', toolCallId: 'failed-script', toolName: 'codemode', args: { code: 'text(await tools.read(...))' } });
  feed.accept({ type: 'tool_execution_update', toolCallId: 'failed-script', toolName: 'codemode', partialResult: {
    content: [{ type: 'text', text: 'partial script output' }],
    details: { calls: [{ id: 'failed-script/1', name: 'read', args: '{}', status: 'error', error: 'read failed', durationMs: 4 }] },
  } });
  feed.accept({ type: 'tool_execution_end', toolCallId: 'failed-script', toolName: 'codemode', isError: true, result: {
    content: [{ type: 'text', text: 'partial script output' }],
    details: { calls: [{ id: 'failed-script/1', name: 'read', args: '{}', status: 'error', error: 'read failed', durationMs: 4 }] },
  } });

  const [entry] = feed.snapshot();
  assert.equal(entry.state, 'failed');
  assert.equal(entry.output, 'partial script output');
  assert.equal(entry.codemode.calls[0].status, 'error');
  assert.equal(entry.codemode.calls[0].error, 'read failed');
});

test('codemode metadata is bounded and private details from other tools remain excluded', () => {
  const feed = new JobActivity();
  feed.accept({ type: 'tool_execution_update', toolCallId: 'other', toolName: 'read', partialResult: {
    content: [{ type: 'text', text: 'public' }],
    details: { calls: [{ id: 'secret', name: 'private', args: 'SECRET', status: 'ok' }], fullOutputPath: '/private/path' },
  } });
  feed.accept({ type: 'tool_execution_update', toolCallId: 'bad-codemode', toolName: 'codemode', partialResult: {
    content: [], details: { calls: 'malformed', private: 'SECRET' },
  } });
  feed.accept({ type: 'tool_execution_update', toolCallId: 'bad-status', toolName: 'codemode', partialResult: {
    content: [], details: { calls: [{ id: 'bad', name: 'read', args: '{}', status: 'unknown' }] },
  } });
  feed.accept({ type: 'tool_execution_update', toolCallId: 'bounded', toolName: 'codemode', partialResult: {
    content: [], details: { calls: Array.from({ length: 150 }, (_, index) => ({
      id: `outer/${index}`, name: 'x'.repeat(200), args: 'a'.repeat(2000), status: 'ok', durationMs: -1,
      error: 'e'.repeat(2000), cost: Infinity, private: 'SECRET',
    })) },
  } });

  const entries = feed.snapshot();
  assert.equal(Object.hasOwn(entries[0], 'codemode'), false);
  assert.equal(Object.hasOwn(entries[1], 'codemode'), false, 'malformed metadata is unknown');
  assert.equal(Object.hasOwn(entries[2], 'codemode'), false, 'unknown statuses make metadata unknown');
  assert.equal(entries[3].codemode.calls.length, 100);
  assert.equal(entries[3].codemode.calls[0].name.length <= 120, true);
  assert.equal(entries[3].codemode.calls[0].args.length <= 500, true);
  assert.equal(entries[3].codemode.calls[0].error.length <= 1000, true);
  assert.equal(Object.hasOwn(entries[3].codemode.calls[0], 'durationMs'), false);
  assert.equal(Object.hasOwn(entries[3].codemode.calls[0], 'cost'), false);
  assert.doesNotMatch(JSON.stringify(entries), /SECRET|private|Infinity/);
});
