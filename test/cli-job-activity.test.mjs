import test from 'node:test';
import assert from 'node:assert/strict';
import { JobActivity } from '../src/cli/job-activity.mjs';
import * as activity from '../src/cli/job-activity.mjs';

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

test('each entry keeps when hobkin first saw it, and what comes after never moves it', () => {
  const start = Date.UTC(2026, 10, 14, 19, 26, 5);
  let now = start;
  const feed = new JobActivity({ now: () => now });
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept(update('text_delta', { delta: 'Looking' }));
  now += 2000;
  feed.accept(update('text_delta', { delta: ' around.' }));
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [
    { type: 'text', text: 'Looking around.' },
    { type: 'toolCall', id: 't', name: 'bash', arguments: { command: 'ls' } },
  ] } });
  now += 1000;
  feed.accept({ type: 'tool_execution_start', toolCallId: 't', toolName: 'bash', args: { command: 'ls' } });
  now += 4000;
  feed.accept({ type: 'tool_execution_end', toolCallId: 't', toolName: 'bash', isError: false, result: { content: [{ type: 'text', text: 'a' }] } });
  assert.deepEqual(feed.snapshot().map(entry => [entry.id, entry.at]), [['message:1:0', start], ['tool:t', start + 2000]]);

  // A later call gets a time of its own.
  feed.accept({ type: 'tool_execution_start', toolCallId: 'u', toolName: 'read', args: { path: 'b' } });
  assert.deepEqual(feed.snapshot().map(entry => [entry.id, entry.at]), [['message:1:0', start], ['tool:t', start + 2000], ['tool:u', start + 7000]]);

  // Without a clock of its own it reads the system's.
  const plain = new JobActivity();
  const before = Date.now();
  plain.accept({ type: 'tool_execution_start', toolCallId: 'r', toolName: 'read', args: { path: 'a' } });
  const { at } = plain.snapshot()[0];
  assert.ok(at >= before && at <= Date.now());
});

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
  assert.deepEqual(entries.map(({ id, at, ...entry }) => entry), [
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

const child = (rootId, id, status = 'running', parentId = rootId) => ({
  id, parentId, rootId, depth: parentId === rootId ? 1 : 2, name: 'same name', status,
});
test('owned-publication projects exact ancestry and bounded public observations only', () => {
  assert.equal(typeof activity.OwnedActivity, 'function');
  const display = new activity.OwnedActivity();
  display.track('root');
  const rows = [child('root', 'child'), child('root', 'grandchild', 'unknown', 'child')];
  display.project(rows);
  display.observe({ id: 'impostor', rootId: 'root', name: 'same name' }, { type: 'message_end', text: 'SECRET' });
  display.observe(rows[0], { type: 'message_end', text: '\x1b[31mPublic\x1b[0m' + 'x'.repeat(9000), usage: { private: 'SECRET' } });
  display.observe(rows[0], { type: 'tool_execution_start', toolCallId: 'tool', toolName: 'read', args: { path: 'SECRET' } });
  display.observe(rows[0], { type: 'tool_execution_end', toolCallId: 'tool', toolName: 'read', isError: true, result: 'SECRET' });
  const view = display.project(rows).root;
  assert.deepEqual(view.map(({ id, parentId, rootId, depth, state }) => [id, parentId, rootId, depth, state]), [
    ['child', 'root', 'root', 1, 'running'], ['grandchild', 'child', 'root', 2, 'unknown'],
  ]);
  assert.equal(view[0].activity[0].text.length, 8000);
  assert.deepEqual(view[0].activity[1], { id: 'tool:tool', kind: 'tool', name: 'read', state: 'failed' });
  assert.doesNotMatch(JSON.stringify(view), /SECRET|usage|args|result|\\u001b/);
  view[0].activity[0].text = 'changed'; view[1].state = 'completed';
  assert.equal(display.project(rows).root[0].activity[0].text.startsWith('Public'), true);
  assert.equal(display.project(rows).root[1].state, 'unknown');
});

test('owned-publication retains unsettled and unknown roots and evicts only oldest settled display groups', () => {
  assert.equal(typeof activity.OwnedActivity, 'function');
  const display = new activity.OwnedActivity(), rows = [];
  for (const id of ['unsettled', 'unknown', 'active', ...Array.from({ length: 21 }, (_, i) => 'done' + i)]) {
    display.track(id);
    rows.push(child(id, id + ':child', id === 'unknown' ? 'unknown' : id === 'active' ? 'running' : 'completed'));
    if (id !== 'unsettled') display.settle(id);
  }
  const expected = ['unsettled', 'unknown', 'active', ...Array.from({ length: 20 }, (_, i) => 'done' + (i + 1))];
  assert.deepEqual(Object.keys(display.project(rows)), expected);
  assert.deepEqual(Object.keys(display.project(rows.toReversed())), expected, 'refresh does not resurrect evicted custody rows');
  assert.equal(rows.length, 24, 'display eviction never prunes lifecycle authority');
  const many = Array.from({ length: 40 }, (_, i) => child('active', 'bounded' + i));
  assert.equal(display.project([...rows, ...many]).active.length, 32);
  for (let i = 0; i < 100; i++) display.observe(many[0], { type: 'tool_execution_start', toolCallId: 't' + i, toolName: 'grep' });
  assert.equal(display.project([...rows, ...many]).active.find(row => row.id === 'bounded0').activity.length, 32);
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
