import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { JobActivity, MOST_OUTPUT, MOST_STEPS } from '../src/cli/job-activity.mjs';
import { runStepOutput, runStepsBefore } from '../src/cli/run-steps.mjs';
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

test('a snapshot is the same list while nothing in the feed changes, and a change copies only the entries it touched', () => {
  const feed = new JobActivity();
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept(update('text_delta', { delta: 'Looking' }));
  feed.accept({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read', args: { path: 'a' } });
  const first = feed.snapshot();
  assert.equal(feed.snapshot(), first, 'nothing changed');
  feed.accept(update('thinking_delta', { delta: 'never shown' }));
  feed.accept({ type: 'turn_start' });
  assert.equal(feed.snapshot(), first, 'events that show nothing change nothing');

  feed.accept({ type: 'tool_execution_end', toolCallId: 'a', toolName: 'read', result: { content: [{ type: 'text', text: 'A' }] } });
  const second = feed.snapshot();
  assert.notEqual(second, first);
  assert.equal(second[0], first[0], 'the words did not change');
  assert.equal(second[1].state, 'completed');
  assert.equal(first[1].state, 'running', 'a list handed out is never rewritten');

  feed.accept(update('text_delta', { delta: ' around' }));
  const third = feed.snapshot();
  assert.deepEqual(third.map(entry => entry.text), ['Looking around', undefined]);
  assert.equal(third[1], second[1]);
  assert.equal(second[0].text, 'Looking');

  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Looking around' }] } });
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept(update('text_delta', { delta: 'Next' }));
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'b', name: 'grep', arguments: {} }] } });
  assert.deepEqual(feed.snapshot().map(entry => entry.id), ['message:1:0', 'tool:a', 'tool:b'], 'a text its message dropped is gone');

  const bounded = new JobActivity({ most: 2 });
  for (const id of ['x', 'y']) bounded.accept({ type: 'tool_execution_start', toolCallId: id, toolName: 'read' });
  const full = bounded.snapshot();
  bounded.accept({ type: 'tool_execution_start', toolCallId: 'z', toolName: 'read' });
  assert.deepEqual(bounded.snapshot().map(entry => entry.id), ['tool:y', 'tool:z']);
  assert.equal(bounded.snapshot()[0], full[1], 'what stays keeps its copy');
});

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
test('owned-publication projects exact ancestry, and a helper row says only who it is, how it stands and what it runs on', () => {
  assert.equal(typeof activity.OwnedActivity, 'function');
  const display = new activity.OwnedActivity();
  display.track('root');
  const rows = [
    { ...child('root', 'child'), model: 'openai-codex/gpt-6-luna', thinking: 'high', usage: { private: 'SECRET' }, lastActivityAt: 1, performance: { steps: ['SECRET'] } },
    child('root', 'grandchild', 'unknown', 'child'),
  ];
  const view = display.project(rows).root;
  assert.deepEqual(view, [
    { id: 'child', parentId: 'root', rootId: 'root', depth: 1, name: 'same name', state: 'running', model: 'openai-codex/gpt-6-luna', thinking: 'high' },
    { id: 'grandchild', parentId: 'child', rootId: 'root', depth: 2, name: 'same name', state: 'unknown' },
  ], 'a row that names no model or level leaves them out');
  view[1].state = 'completed';
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

test('a call a codemode script made names the script call it belongs to, and a call the model made names none', () => {
  const feed = new JobActivity();
  feed.accept({ type: 'tool_execution_start', toolCallId: 'script', toolName: 'codemode', args: { code: 'await tools.read({ path: "a" })' } });
  // Pi gives a nested call its own events, with the id of the call that made it (`nested-tool-calls.js`).
  feed.accept({ type: 'tool_execution_start', toolCallId: 'script/1', toolName: 'read', args: { path: 'a' }, parentToolCallId: 'script' });
  feed.accept({ type: 'tool_execution_end', toolCallId: 'script/1', toolName: 'read', isError: true, result: { content: [{ type: 'text', text: 'no such file' }] }, parentToolCallId: 'script' });
  // A feed that first hears of a nested call at its end still links it.
  feed.accept({ type: 'tool_execution_end', toolCallId: 'script/2', toolName: 'bash', result: { content: [{ type: 'text', text: 'ok' }] }, parentToolCallId: 'script' });
  feed.accept({ type: 'tool_execution_start', toolCallId: 'after', toolName: 'bash', args: { command: 'ls' }, parentToolCallId: '' });

  const [script, read, bash, after] = feed.snapshot();
  assert.equal(Object.hasOwn(script, 'parent'), false);
  assert.equal(read.parent, 'tool:script');
  assert.equal(read.state, 'failed');
  assert.equal(bash.parent, 'tool:script');
  assert.equal(Object.hasOwn(after, 'parent'), false, 'an empty parent id is none');
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

// Every read of an entry by its place in the feed, counted. A snapshot or a delta that walks the whole feed reads all of them.
const counted = feed => {
  let reads = 0;
  feed.entries = new Proxy(feed.entries, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return () => { const n = reads; reads = 0; return n; };
};

test('a word on the last of 1,000 entries reads only the end of the feed, and its snapshot replaces only that entry', () => {
  const feed = new JobActivity();
  for (let i = 0; i < 999; i++) feed.accept({ type: 'tool_execution_end', toolCallId: `t${i}`, toolName: 'read', result: { content: [{ type: 'text', text: 'ok' }] } });
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept(update('text_delta', { delta: 'Reading' }));
  const before = feed.snapshot();
  const reads = counted(feed);

  feed.accept(update('text_delta', { delta: ' on' }));
  const after = feed.snapshot();
  assert.ok(reads() < 10, 'the delta and the snapshot read only the end');
  assert.notEqual(after, before);
  assert.equal(after.length, 1000);
  assert.equal(after.at(-1).text, 'Reading on');
  assert.equal(before.at(-1).text, 'Reading', 'a list handed out is never rewritten');
  assert.ok(after.slice(0, 999).every((entry, i) => entry === before[i]), 'every entry that did not change keeps its object');

  feed.accept({ type: 'tool_execution_start', toolCallId: 'new', toolName: 'grep' });
  const grown = feed.snapshot();
  assert.ok(reads() < 10, 'a new entry is added at the end');
  assert.equal(grown.length, 1001);
  assert.equal(grown[999], after[999]);
  assert.equal(grown.at(-1).id, 'tool:new');

  // The message's end drops nothing here, a filter that keeps every entry, and the list is built whole again with the same objects.
  feed.accept({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading on' }] } });
  const ended = feed.snapshot();
  assert.ok(ended.every((entry, i) => entry === grown[i]), 'a rebuilt list keeps the objects of what stayed the same');
  const trimmed = new JobActivity({ most: 3 });
  for (const id of ['a', 'b', 'c']) trimmed.accept({ type: 'tool_execution_start', toolCallId: id, toolName: 'read' });
  const kept = trimmed.snapshot();
  trimmed.accept({ type: 'tool_execution_update', toolCallId: 'c', toolName: 'read', partialResult: { content: [{ type: 'text', text: 'half' }] } });
  trimmed.accept({ type: 'tool_execution_start', toolCallId: 'd', toolName: 'read' });
  const next = trimmed.snapshot();
  assert.deepEqual(next.map(entry => entry.id), ['tool:b', 'tool:c', 'tool:d'], 'after a trim the list is built whole');
  assert.equal(next[0], kept[1]);
  assert.notEqual(next[1], kept[2]);
  assert.equal(next[1].output, 'half');
});

// What a step reads as, without when hobkin or Pi first saw it.
const timeless = ({ at, ...step }) => step;

test('a feed keeps 200 steps and a bounded output, and the saved session still has the rest', t => {
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-run-steps-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'run.jsonl');
  const session = SessionManager.open(file, folder, folder);
  const feed = new JobActivity({ most: MOST_STEPS, mostOutput: MOST_OUTPUT });
  // As a run streams through Pi, which saves each message when it ends.
  const say = message => {
    feed.accept({ type: 'message_start', message });
    feed.accept({ type: 'message_end', message });
    session.appendMessage(message);
  };
  const long = 'a line of test output\n'.repeat(2000);
  say({ role: 'user', content: 'Fix the job.', timestamp: Date.now() });
  for (let i = 0; i < 150; i++) {
    const call = { type: 'toolCall', id: `call-${i}`, name: 'bash', arguments: { command: `npm test -- ${i}` } };
    say({ role: 'assistant', content: [{ type: 'text', text: `Running part ${i}.` }, call], stopReason: 'toolUse', timestamp: Date.now() });
    feed.accept({ type: 'tool_execution_start', toolCallId: call.id, toolName: 'bash', args: call.arguments });
    const content = [{ type: 'text', text: i === 149 ? long : `ok ${i}` }];
    feed.accept({ type: 'tool_execution_end', toolCallId: call.id, toolName: 'bash', result: { content }, isError: false });
    say({ role: 'toolResult', toolCallId: call.id, toolName: 'bash', content, isError: false, timestamp: Date.now() });
  }

  const kept = feed.snapshot();
  assert.equal(kept.length, 200, 'the newest 200 of 300 steps');
  const last = kept.at(-1);
  assert.equal(last.outputLength, long.length);
  assert.ok(last.output.length <= MOST_OUTPUT + 3);
  assert.ok(last.output.startsWith(long.slice(0, 4096)) && last.output.endsWith(long.slice(-4096)), 'its first and last 4 KB');
  assert.equal(kept.at(-3).outputLength, undefined, 'a short output is whole');

  const older = runStepsBefore(file, { before: kept[0].id });
  assert.equal(older.steps.length, 100, 'the saved session has the 100 steps the feed let go');
  assert.equal(older.more, false);
  assert.deepEqual([older.steps[0].id, older.steps.at(-1).id], ['message:3:0', 'tool:call-49']);
  const page = runStepsBefore(file, { before: kept[0].id, most: 30 });
  assert.deepEqual(page.steps.map(timeless), older.steps.slice(-30).map(timeless), 'a page is the steps right before, newest last');
  assert.equal(page.more, true);
  const newest = runStepsBefore(file, { most: 200 });
  assert.deepEqual(newest.steps.map(timeless), kept.map(timeless), 'a saved step reads as the live one did');
  assert.deepEqual(runStepOutput(file, 'tool:call-149'), { id: 'tool:call-149', output: long, length: long.length });
  assert.equal(runStepOutput(file, 'tool:nowhere'), null);

  // A word on the newest step leaves every other step the same object.
  feed.accept({ type: 'message_start', message: { role: 'assistant' } });
  feed.accept({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Done' } });
  const next = feed.snapshot();
  assert.ok(next.slice(0, 198).every((step, i) => step === kept[i + 1]));
});

test('a saved run cut short in its last line still reads, a file that is not a session is refused, and a step it numbers otherwise is found by time', async t => {
  const { appendFileSync, writeFileSync } = await import('node:fs');
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-run-steps-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'run.jsonl');
  const session = SessionManager.open(file, folder, folder);
  session.appendMessage({ role: 'user', content: 'Look.', timestamp: Date.now() });
  for (const id of ['a', 'b']) {
    session.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'read', arguments: { path: id } }], timestamp: Date.now() });
    session.appendMessage({ role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text: `file ${id}` }], isError: id === 'b', timestamp: Date.now() });
  }
  appendFileSync(file, '{"type":"message","id":"half');

  const { steps } = runStepsBefore(file);
  assert.deepEqual(steps.map(({ id, state, output }) => [id, state, output]), [['tool:a', 'completed', 'file a'], ['tool:b', 'failed', 'file b']]);
  const later = runStepsBefore(file, { before: 'message:99:0', at: steps[1].at + 1000 });
  assert.deepEqual([later.found, later.steps.map(step => step.id)], [false, ['tool:a', 'tool:b']], 'what was saved before that time');
  assert.equal(runStepsBefore(file, { before: 'message:99:0' }).found, false);

  writeFileSync(join(folder, 'other.jsonl'), '{"type":"note"}\n');
  assert.throws(() => runStepsBefore(join(folder, 'other.jsonl')), /Unsupported Pi session format/);
});

test('a feed at its cap that takes a new step keeps the objects of the steps that stay, and copies only the new one', t => {
  const feed = new JobActivity({ most: MOST_STEPS, mostOutput: MOST_OUTPUT });
  const step = i => feed.accept({ type: 'tool_execution_start', toolCallId: `c${i}`, toolName: 'read', args: { path: `f${i}` } });
  for (let i = 0; i < MOST_STEPS; i++) step(i);
  const full = feed.snapshot();
  const copies = t.mock.method(feed, 'copyOf');
  step(MOST_STEPS);
  const next = feed.snapshot();
  assert.equal(next.length, MOST_STEPS);
  assert.ok(next.slice(0, -1).every((entry, i) => entry === full[i + 1]), 'what stays is the same object, one place up');
  assert.equal(next.at(-1).id, `tool:c${MOST_STEPS}`);
  for (let i = MOST_STEPS + 1; i < MOST_STEPS + 1000; i++) {
    step(i);
    feed.snapshot();
  }
  assert.ok(copies.mock.callCount() <= 1000, `${copies.mock.callCount()} copies for 1,000 steps past the cap`);
  assert.deepEqual(feed.snapshot().map(entry => entry.id), feed.entries.map(entry => entry.id));
});
