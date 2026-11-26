import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addMemory, MAIN_INDEX_BYTES, memorySnapshot, runIndex } from '../src/cli/memories.mjs';
import { memoryHandler } from '../src/cli/memory-tools.mjs';
import { memoryUsePath, readMemoryUse, recordMemoryUse } from '../src/cli/memory-use.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const DAY = 86400000;
const MAIN = { by: { kind: 'main' }, source: { kind: 'chat' }, now: NOW };

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-use-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const lines = root => readFileSync(memoryUsePath(root), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const byName = uses => Object.fromEntries(uses.map(use => [use.name, use]));
const iso = at => new Date(at).toISOString();

function withMemories(t) {
  const root = home(t);
  addMemory(root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon since 2025', text: 'Look up the Portuguese version first.' }, MAIN);
  addMemory(root, { name: 'tram-pass', kind: 'pointer', description: 'Monthly tram pass in the blue wallet' }, MAIN);
  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, MAIN);
  addMemory(root, { name: 'old-trip', kind: 'date', description: 'Trip to Porto', until: '2026-10-01' }, MAIN);
  return root;
}

test('uses add up in one line a day and a memory, and the reader gives recalls, index builds, who and when', t => {
  const root = home(t);
  for (let count = 0; count < 100; count += 1) recordMemoryUse(root, { kind: 'index', names: ['lives-in-lisbon', 'tram-pass'], by: 'main' }, { now: NOW + count });
  recordMemoryUse(root, { kind: 'index', names: ['lives-in-lisbon'], by: 'run' }, { now: NOW + 200 });
  recordMemoryUse(root, { kind: 'recall', names: ['lives-in-lisbon'], by: 'hobkin' }, { now: NOW + 300 });
  recordMemoryUse(root, { kind: 'index', names: ['lives-in-lisbon'], by: 'main' }, { now: NOW + DAY });

  assert.equal(lstatSync(join(root, 'runtime')).mode & 0o777, 0o700);
  assert.equal(lstatSync(memoryUsePath(root)).mode & 0o777, 0o600);
  assert.equal(memoryUsePath(root), join(root, 'runtime', 'memory-use.jsonl'));
  assert.deepEqual(lines(root).map(line => line.name), ['lives-in-lisbon', 'tram-pass', 'lives-in-lisbon'], 'one line a day and a memory, not one a prompt');

  const uses = readMemoryUse(root, { now: NOW + DAY });
  assert.deepEqual(uses.map(use => use.name), ['lives-in-lisbon', 'tram-pass'], 'the most recalled first');
  assert.deepEqual(byName(uses)['lives-in-lisbon'], {
    name: 'lives-in-lisbon',
    recalls: 1,
    indexed: 102,
    last: iso(NOW + DAY),
    lastRecall: iso(NOW + 300),
    by: { main: { recalls: 0, indexed: 101 }, run: { recalls: 0, indexed: 1 }, hobkin: { recalls: 1, indexed: 0 } },
  });
  assert.deepEqual(byName(uses)['tram-pass'], {
    name: 'tram-pass',
    recalls: 0,
    indexed: 100,
    last: iso(NOW + 99),
    lastRecall: null,
    by: { main: { recalls: 0, indexed: 100 } },
  });
});

test('the reader counts only the days asked for, 30 unless said, and a home that never recorded reads as none', t => {
  const root = home(t);
  assert.deepEqual(readMemoryUse(root, { now: NOW }), []);

  recordMemoryUse(root, { kind: 'recall', names: ['tram-pass'], by: 'main' }, { now: NOW - 40 * DAY });
  recordMemoryUse(root, { kind: 'recall', names: ['tram-pass'], by: 'main' }, { now: NOW - 3 * DAY });
  recordMemoryUse(root, { kind: 'recall', names: ['tram-pass'], by: 'main' }, { now: NOW });

  assert.equal(readMemoryUse(root, { now: NOW })[0].recalls, 2);
  assert.equal(readMemoryUse(root, { days: 1, now: NOW })[0].recalls, 1);
  assert.equal(readMemoryUse(root, { days: 4, now: NOW })[0].recalls, 2);
  assert.equal(readMemoryUse(root, { days: 90, now: NOW })[0].recalls, 3);
  assert.equal(readMemoryUse(root, { days: 1e12, now: NOW })[0].recalls, 3, 'a span past ten years reads as ten years');
});

test('a use names a recall or an index and who, keeps only memory names, and with none it writes nothing', t => {
  const root = home(t);
  assert.throws(() => recordMemoryUse(root, { kind: 'read', names: ['tram-pass'], by: 'main' }), /recall or an index/);
  assert.throws(() => recordMemoryUse(root, { kind: 'recall', names: ['tram-pass'], by: 'someone' }), /main, hobkin, run or helper/);

  recordMemoryUse(root, { kind: 'recall', names: [], by: 'main' }, { now: NOW });
  recordMemoryUse(root, { kind: 'recall', names: ['Not A Name', '../x'], by: 'main' }, { now: NOW });
  assert.equal(existsSync(join(root, 'runtime')), false);

  recordMemoryUse(root, { kind: 'recall', names: ['tram-pass', 'tram-pass', 'Not A Name'], by: 'helper' }, { now: NOW });
  assert.deepEqual(readMemoryUse(root, { now: NOW }).map(({ name, recalls }) => [name, recalls]), [['tram-pass', 1]]);
});

test('past its cap the file keeps its newest lines, and a line cut short is skipped', t => {
  const root = home(t);
  const names = Array.from({ length: 300 }, (_, index) => `memory-number-${index}`);
  for (let day = 0; day < 20; day += 1) recordMemoryUse(root, { kind: 'index', names, by: 'main' }, { now: NOW + day * DAY });
  assert.ok(statSync(memoryUsePath(root)).size <= 512 << 10, 'kept under its cap');
  const kept = lines(root);
  assert.ok(kept.length < 300 * 20, 'the oldest went');
  assert.equal(kept.at(-1).name, 'memory-number-299');
  assert.equal(kept.at(-1).last, iso(NOW + 19 * DAY), 'the newest stayed');

  writeFileSync(memoryUsePath(root), `${readFileSync(memoryUsePath(root), 'utf8')}{"day":"20`);
  assert.equal(readMemoryUse(root, { now: NOW + 19 * DAY }).length, 300);
  recordMemoryUse(root, { kind: 'recall', names: ['memory-number-1'], by: 'main' }, { now: NOW + 19 * DAY });
  assert.equal(byName(readMemoryUse(root, { now: NOW + 19 * DAY }))['memory-number-1'].recalls, 1);
});

test('a recall counts each memory it read whole, as the reader that asked, and one that finds nothing counts nothing', t => {
  const root = withMemories(t);
  memoryHandler(root, { kind: 'main' }, { now: () => NOW }).recall({ words: 'lisbon' });
  memoryHandler(root, { kind: 'hobkin', id: 'a1b2c3d4', title: 'Deploy watcher' }, { now: () => NOW }).recall({ name: 'partner-name' });
  memoryHandler(root, { kind: 'run', id: 'r1', title: 'Morning brief' }, { now: () => NOW }).recall({ kind: 'pointer' });
  memoryHandler(root, { kind: 'run', id: 'r1', title: 'Morning brief' }, { now: () => NOW }).recall({ words: 'nothing-like-it' });
  const uses = byName(readMemoryUse(root, { now: NOW }));
  assert.deepEqual(Object.keys(uses).sort(), ['lives-in-lisbon', 'partner-name', 'tram-pass']);
  assert.deepEqual(uses['lives-in-lisbon'].by, { main: { recalls: 1, indexed: 0 } });
  assert.deepEqual(uses['partner-name'].by, { hobkin: { recalls: 1, indexed: 0 } });
  assert.deepEqual(uses['tram-pass'].by, { run: { recalls: 1, indexed: 0 } });
});

test('an index counts the memories it listed within its budget, as the main chat, a run or a helper, and never a past one', t => {
  const root = withMemories(t);
  // runIndex reads the clock, so every index here does.
  memorySnapshot(root, { private: true, maxBytes: MAIN_INDEX_BYTES, recall: 'hobkin_recall' });
  memorySnapshot(root, { private: true, maxBytes: MAIN_INDEX_BYTES, recall: 'hobkin memory', by: 'hobkin' });
  runIndex(root, 'hobkin_recall');
  runIndex(root);
  const uses = byName(readMemoryUse(root));
  assert.deepEqual(Object.keys(uses).sort(), ['lives-in-lisbon', 'partner-name', 'tram-pass'], 'a past memory is in no index');
  assert.deepEqual(uses['partner-name'].by, { main: { recalls: 0, indexed: 1 }, hobkin: { recalls: 0, indexed: 1 } }, 'a private one only in the indexes that hold it');
  assert.deepEqual(uses['tram-pass'].by, { main: { recalls: 0, indexed: 1 }, hobkin: { recalls: 0, indexed: 1 }, run: { recalls: 0, indexed: 1 }, helper: { recalls: 0, indexed: 1 } });

  const small = home(t);
  addMemory(small, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon since 2025' }, MAIN);
  addMemory(small, { name: 'tram-pass', kind: 'pointer', description: 'Monthly tram pass in the blue wallet' }, MAIN);
  const whole = memorySnapshot(small, { private: true, by: null, now: NOW }).index;
  const { index } = memorySnapshot(small, { private: true, maxBytes: Buffer.byteLength(whole) - 1, now: NOW });
  assert.match(index, /lives-in-lisbon/);
  assert.doesNotMatch(index, /tram-pass/);
  assert.deepEqual(readMemoryUse(small, { now: NOW }).map(use => use.name), ['lives-in-lisbon'], 'one cut for room was not listed');

  const quiet = withMemories(t);
  memorySnapshot(quiet, { private: true, by: null, now: NOW });
  assert.equal(existsSync(memoryUsePath(quiet)), false, 'a reader that says by no one counts nothing');
});

test('a use that cannot be written costs the count, never the recall or the index', t => {
  const root = withMemories(t);
  writeFileSync(join(root, 'runtime'), 'not a folder');
  const recalled = memoryHandler(root, { kind: 'main' }, { now: () => NOW }).recall({ words: 'lisbon' });
  assert.deepEqual(recalled.memories.map(memory => memory.name), ['lives-in-lisbon']);
  assert.match(memorySnapshot(root, { private: true, now: NOW }).index, /tram-pass/);
  assert.match(runIndex(root), /tram-pass/);

  const other = withMemories(t);
  mkdirSync(memoryUsePath(other), { recursive: true });
  assert.match(memorySnapshot(other, { private: true, now: NOW }).index, /tram-pass/);
  assert.deepEqual(readMemoryUse(other), []);
});
