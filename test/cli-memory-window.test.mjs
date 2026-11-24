import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryForget, memoryList, memoryNowChange, memorySave, memoryUndo } from '../src/cli/memory-window.mjs';
import { addMemory } from '../src/cli/memories.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-window-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('the window lists every memory with its version, the right-now list with its version, and the unreadable files', t => {
  const root = home(t);
  const empty = memoryList(root);
  assert.deepEqual(empty.memories, []);
  assert.deepEqual(empty.now, []);
  assert.match(empty.nowVersion, /^[0-9a-f]{64}$/);
  assert.deepEqual(empty.unreadable, []);
  assert.equal(existsSync(join(root, 'memories')), false, 'reading makes no folder');

  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, { by: { kind: 'main' }, now: NOW });
  writeFileSync(join(root, 'memories', 'broken.md'), 'nope');
  writeFileSync(join(root, 'memory.md'), '- Reply to the landlord by Nov 28\n');
  const list = memoryList(root);
  assert.deepEqual(list.memories.map(memory => [memory.name, memory.private, /^[0-9a-f]{64}$/.test(memory.version)]), [['partner-name', true, true]]);
  assert.deepEqual(list.now, ['Reply to the landlord by Nov 28']);
  assert.notEqual(list.nowVersion, empty.nowVersion);
  assert.deepEqual(list.unreadable, ['broken']);
});

test('a save with no version adds one by the user from the window, naming it from its description when it has no name', t => {
  const root = home(t);
  const saved = memorySave(root, { description: 'Prefers the train under 600 km', kind: 'preference', text: 'Train over flying.' }, { now: NOW });
  assert.equal(saved.saved, true);
  assert.equal(saved.memory.name, 'prefers-the-train-under-600-km');
  assert.deepEqual(saved.memory.added.by, { kind: 'user' });
  assert.deepEqual(saved.memory.source, { kind: 'window' });
  assert.match(saved.change, /^[0-9a-f-]{36}$/);
  assert.equal(memorySave(root, { description: 'Prefers the train under 600 km again', kind: 'preference' }).saved, false);
  const refused = memorySave(root, { description: 'Wifi password: hunter22', kind: 'pointer' });
  assert.deepEqual(refused.saved, false);
  assert.match(refused.message, /a secret hobkin never keeps/);
  assert.match(memorySave(root, { description: 'x', kind: 'rule' }).message, /kind/);
});

test('a save with a version changes that memory as the form holds it, and one made against an older version is refused in plain words', t => {
  const root = home(t);
  const { memory } = memorySave(root, { name: 'tax-papers', description: 'Tax papers are in ~/Documents/Taxes', kind: 'pointer', until: '2027-04-30', private: true });
  const changed = memorySave(root, { name: 'tax-papers', description: 'Tax papers are in ~/Documents/Taxes, one folder a year', kind: 'pointer', version: memory.version });
  assert.equal(changed.saved, true);
  assert.equal(changed.memory.until, undefined, 'a field the form leaves out is cleared');
  assert.equal(changed.memory.private, undefined);
  assert.deepEqual(changed.memory.changed.by, { kind: 'user' });
  const stale = memorySave(root, { name: 'tax-papers', description: 'Old draft', kind: 'pointer', version: memory.version });
  assert.equal(stale.saved, false);
  assert.match(stale.message, /changed since you opened it/);
  assert.match(memorySave(root, { description: 'No name', kind: 'pointer', version: 'abc' }).message, /which memory/);
});

test('forget answers its change, which undo takes back, and both refuse in plain words', t => {
  const root = home(t);
  const { memory } = memorySave(root, { name: 'tax-papers', description: 'Tax papers are in ~/Documents/Taxes', kind: 'pointer' });
  assert.match(memoryForget(root, { name: 'tax-papers', version: 'f'.repeat(64) }).message, /changed since/);
  const forgot = memoryForget(root, { name: 'tax-papers', version: memory.version });
  assert.equal(forgot.forgot, true);
  assert.deepEqual(memoryList(root).memories, []);
  assert.deepEqual(memoryUndo(root, { change: forgot.change }), { ok: true });
  assert.deepEqual(memoryList(root).memories.map(entry => entry.name), ['tax-papers']);
  const again = memoryUndo(root, { change: forgot.change });
  assert.equal(again.ok, false);
  assert.match(again.reason, /is in use|changed since/);
  assert.match(memoryForget(root, { name: 'nothing-here' }).message, /No memory is called/);
  assert.match(memoryUndo(root, { change: 'nope' }).reason, /no such change/);
  const lines = readFileSync(join(root, 'memories', 'changes.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines.map(line => [line.did, line.by.kind]), [['added', 'user'], ['forgot', 'user'], ['restored', 'user']]);
});

test('the right-now list changes by its own rules and refuses a stale version', t => {
  const root = home(t);
  const { nowVersion } = memoryList(root);
  const added = memoryNowChange(root, { action: 'add', text: 'Reply to the landlord by Nov 28', version: nowVersion });
  assert.equal(added.ok, true);
  assert.deepEqual(added.now, ['Reply to the landlord by Nov 28']);
  assert.match(memoryNowChange(root, { action: 'add', text: 'Another', version: nowVersion }).reason, /changed since/);
  const replaced = memoryNowChange(root, { action: 'replace', item: 'Reply to the landlord by Nov 28', text: 'Replied to the landlord', version: added.nowVersion });
  assert.deepEqual(replaced.now, ['Replied to the landlord']);
  assert.match(memoryNowChange(root, { action: 'remove', item: 'Not there', version: replaced.nowVersion }).reason, /no item with that exact text/);
  assert.match(memoryNowChange(root, { action: 'add', text: 'x'.repeat(201), version: replaced.nowVersion }).reason, /200 characters/);
  assert.equal(readFileSync(join(root, 'memory.md'), 'utf8'), '- Replied to the landlord\n');
});
