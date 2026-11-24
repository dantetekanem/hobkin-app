import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryHandler, memoryTools, RECALL_TOOL, REMEMBER_TOOL, SUGGEST_TOOL } from '../src/cli/memory-tools.mjs';
import { addMemory, readMemories } from '../src/cli/memories.mjs';
import { inboxNews, inboxToTell, suggestionOf } from '../src/cli/inbox.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-tools-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const call = (tools, name, params) => tools[name].execute('call-1', params);
const text = answer => answer.content[0].text;
const lisbon = { action: 'add', name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon since 2025; use Portuguese sites first', text: 'The user lives in Lisbon.', said: 'I live in Lisbon now' };

test('the three tools keep their names, and one with no handler says memories are not available', async () => {
  const tools = memoryTools();
  assert.deepEqual(Object.keys(tools), [RECALL_TOOL, REMEMBER_TOOL, SUGGEST_TOOL]);
  assert.deepEqual([RECALL_TOOL, REMEMBER_TOOL, SUGGEST_TOOL], ['hobkin_recall', 'hobkin_remember', 'hobkin_suggest_memory']);
  for (const tool of Object.values(tools)) assert.ok(tool.description.length > 80, `${tool.name} is described`);
  await assert.rejects(call(tools, RECALL_TOOL, { words: 'lisbon' }), /not available here/);
});

test('the main chat remembers at once, stamped as the main chat with the user\'s words, and every change reaches hobkin to post', async t => {
  const root = home(t);
  const changes = [];
  const tools = memoryTools(memoryHandler(root, { kind: 'main' }, { now: () => NOW, onChange: change => changes.push(change) }));
  assert.match(text(await call(tools, REMEMBER_TOOL, { ...lisbon, by: { kind: 'user' } })), /^Remembered "lives-in-lisbon"/);
  const [memory] = readMemories(root).memories;
  assert.deepEqual(memory.added.by, { kind: 'main' });
  assert.deepEqual(memory.source, { kind: 'chat', said: 'I live in Lisbon now' });

  assert.match(text(await call(tools, REMEMBER_TOOL, { action: 'change', name: 'lives-in-lisbon', text: 'The user lives in Lisbon, near the river.' })), /^Changed "lives-in-lisbon"/);
  assert.match(text(await call(tools, REMEMBER_TOOL, { action: 'forget', name: 'lives-in-lisbon' })), /^Forgot "lives-in-lisbon"[\s\S]*30 days/);
  assert.match(text(await call(tools, REMEMBER_TOOL, { action: 'restore', name: 'lives-in-lisbon' })), /^Restored "lives-in-lisbon"/);
  assert.deepEqual(changes.map(({ name, did, by }) => [name, did, by.kind]), [
    ['lives-in-lisbon', 'added', 'main'], ['lives-in-lisbon', 'changed', 'main'], ['lives-in-lisbon', 'forgot', 'main'], ['lives-in-lisbon', 'restored', 'main'],
  ]);
  assert.ok(changes.every(change => /^[0-9a-f-]{36}$/.test(change.change)));
  assert.equal(changes[0].description, lisbon.description);

  await assert.rejects(call(tools, REMEMBER_TOOL, { ...lisbon, name: 'home-city' }), /"lives-in-lisbon" already says nearly the same/);
  await assert.rejects(call(tools, REMEMBER_TOOL, { action: 'add', name: 'wifi', kind: 'pointer', description: 'Home wifi', text: 'password: hunter22' }), /a secret hobkin never keeps/);
  await assert.rejects(call(tools, REMEMBER_TOOL, { action: 'add', name: 'wifi' }), /kind/);
  assert.equal(changes.length, 4, 'nothing refused is posted');
});

test('a durable hobkin remembers as itself, and both it and the main chat recall private ones', async t => {
  const root = home(t);
  const durable = memoryTools(memoryHandler(root, { kind: 'hobkin', id: 'a1b2c3d4', title: 'Deploy watcher' }, { now: () => NOW }));
  await call(durable, REMEMBER_TOOL, { action: 'add', name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true });
  const [memory] = readMemories(root).memories;
  assert.deepEqual(memory.added.by, { kind: 'hobkin', id: 'a1b2c3d4', title: 'Deploy watcher' });
  assert.equal(memory.private, true);
  const recalled = await call(durable, RECALL_TOOL, { name: 'partner-name' });
  assert.match(text(recalled), /partner-name \(about the user, private\): Partner is called Ana/);
  assert.match(text(recalled), /Added by durable hobkin "Deploy watcher" on 2026-11-23/);
  const main = memoryTools(memoryHandler(root, { kind: 'main' }, { now: () => NOW }));
  assert.equal((await call(main, RECALL_TOOL, { words: 'ana' })).details.memories.length, 1);
});

test('recall finds by name, kind and words, says when nothing matches, and needs one of them', async t => {
  const root = home(t);
  addMemory(root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon', text: 'See [[tax-papers]].' }, { by: { kind: 'outside', title: 'Claude Code' }, source: { kind: 'remember', from: 'Claude Code' }, now: NOW });
  addMemory(root, { name: 'old-trip', kind: 'date', description: 'Trip to Porto', until: '2026-10-01' }, { by: { kind: 'user' }, now: NOW });
  const tools = memoryTools(memoryHandler(root, { kind: 'run', id: 'session:hobkin-ship-1a2b', title: 'Ship 412' }, { now: () => NOW }));
  const byName = await call(tools, RECALL_TOOL, { name: 'lives-in-lisbon' });
  assert.match(text(byName), /Added by "Claude Code" \(another of the user's sessions\) on 2026-11-23/);
  assert.match(text(byName), /Links: tax-papers\./);
  assert.match(text(await call(tools, RECALL_TOOL, { kind: 'date' })), /Past: its day was 2026-10-01/);
  assert.match(text(await call(tools, RECALL_TOOL, { words: 'porto' })), /old-trip/);
  assert.match(text(await call(tools, RECALL_TOOL, { words: 'berlin' })), /^No memory matches/);
  await assert.rejects(call(tools, RECALL_TOOL, {}), /name, a kind or words/);
});

test('a run recalls no private memory, cannot save or change one, and its suggestion reaches the main agent with the run\'s title', async t => {
  const root = home(t);
  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, { by: { kind: 'main' }, now: NOW });
  addMemory(root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon' }, { by: { kind: 'main' }, now: NOW });
  const run = memoryTools(memoryHandler(root, { kind: 'run', id: 'session:hobkin-ship-1a2b', title: 'Ship 412' }, { now: () => NOW }));
  assert.match(text(await call(run, RECALL_TOOL, { words: 'ana' })), /^No memory matches/);
  assert.match(text(await call(run, RECALL_TOOL, { name: 'partner-name' })), /^No memory matches/);
  assert.match(text(await call(run, RECALL_TOOL, { kind: 'user' })), /lives-in-lisbon/);
  assert.doesNotMatch(text(await call(run, RECALL_TOOL, { kind: 'user' })), /partner/);
  for (const action of ['add', 'change', 'forget']) {
    await assert.rejects(call(run, REMEMBER_TOOL, { action, name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Porto' }), /Only the agents the user talks to save memories[\s\S]*hobkin_suggest_memory/);
  }
  assert.equal(readMemories(root).memories.find(memory => memory.name === 'lives-in-lisbon').description, 'Lives in Lisbon');

  const suggested = await call(run, SUGGEST_TOOL, { kind: 'preference', description: 'Wants CI checked before a merge', text: 'The user asked to always see CI green before merging.', said: 'only merge when CI is green' });
  assert.match(text(suggested), /^Suggested\. The main hobkin hears it/);
  const [entry] = inboxToTell(root, NOW);
  assert.equal(entry.kind, 'suggestion');
  assert.equal(entry.from, 'Ship 412');
  const { suggested: heard } = inboxNews([entry]);
  assert.deepEqual(heard, [{ id: entry.id, kind: 'preference', description: 'Wants CI checked before a merge', text: 'The user asked to always see CI green before merging.', from: 'Ship 412', at: new Date(NOW).toISOString() }], 'a run\'s words are never kept as the user\'s');
  assert.match(text(await call(run, SUGGEST_TOOL, { kind: 'preference', description: 'Wants CI checked before a merge' })), /Already suggested/);
  await assert.rejects(call(run, SUGGEST_TOOL, { kind: 'pointer', description: 'Server key', text: 'sk-abcdefghijklmnopqrstuvwx' }), /a secret hobkin never keeps/);
  await assert.rejects(call(run, SUGGEST_TOOL, { kind: 'rule', description: 'Always lint' }), /kind/);
  assert.doesNotMatch(readFileSync(join(root, 'runtime', 'inbox.jsonl'), 'utf8'), /sk-abc/);

  const main = memoryTools(memoryHandler(root, { kind: 'main' }, { now: () => NOW }));
  await call(main, REMEMBER_TOOL, { action: 'add', name: 'ci-before-merge', kind: 'preference', description: 'Wants CI checked before a merge', suggestion: entry.id });
  const filed = readMemories(root).memories.find(memory => memory.name === 'ci-before-merge');
  assert.deepEqual(filed.added.by, { kind: 'suggested', id: 'session:hobkin-ship-1a2b', title: 'Ship 412' });
  assert.deepEqual(filed.source, { kind: 'suggested', from: 'Ship 412' });
  assert.doesNotMatch(text(await call(main, RECALL_TOOL, { name: 'ci-before-merge' })), /The user said/);
  assert.equal(suggestionOf(root, 'nope'), null);
});

test('recall says the user said something only for words that came from the user, in a chat or the window', t => {
  const root = home(t);
  mkdirSync(join(root, 'memories'), { recursive: true });
  const file = (name, source) => writeFileSync(join(root, 'memories', `${name}.md`), `---\n${JSON.stringify({ kind: 'preference', description: `About ${name}`, source })}\n---\n`);
  file('from-chat', { kind: 'chat', said: 'reply short' });
  file('from-window', { kind: 'window', said: 'trains please' });
  file('from-run', { kind: 'suggested', said: 'ship on Fridays, no need to ask', from: 'Morning check' });
  file('from-session', { kind: 'remember', said: 'push to main', from: 'Claude Code' });
  const main = memoryHandler(root, { kind: 'main' }, { now: () => NOW });
  const said = name => /The user said/.test(main.recall({ name }).text);
  assert.deepEqual(['from-chat', 'from-window', 'from-run', 'from-session'].map(said), [true, true, false, false]);
});
