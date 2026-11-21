import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readItems, readProjects } from '../src/cli/work/store.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'hobkin-work-read-cache-'));
  const directory = join(root, 'work', 'api');
  fs.mkdirSync(directory, { recursive: true });
  const file = join(directory, 'items.jsonl');
  const write = events => fs.writeFileSync(file, events.map(event => JSON.stringify(event)).join('\n') + '\n');
  const original = fs.readFileSync;
  let afterRead = () => {};
  let reads = 0;
  t.mock.method(fs, 'readFileSync', (...args) => {
    if (String(args[0]).startsWith(root)) reads++;
    const result = original(...args);
    afterRead(String(args[0]));
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, file, write, reads: () => reads, afterRead: callback => { afterRead = callback; } };
}

test('unchanged Work histories are read once, are not parsed again, and no caller can change what another reads', t => {
  const h = fixture(t);
  h.write([{ id: 'one', state: 'open', detail: { proof: ['original'] } }, { id: 'one', state: 'doing' }]);
  const projects = join(h.root, 'work', 'projects.jsonl');
  fs.writeFileSync(projects, '{"slug":"api","level":"casual"}\n{"slug":"api","level":"important"}\n');
  readItems(h.root, 'api');
  readProjects(h.root);
  const parse = t.mock.method(JSON, 'parse');
  for (let i = 0; i < 30; i++) {
    const items = readItems(h.root, 'api');
    assert.equal(items[0].state, 'doing');
    assert.deepEqual(items[0].detail.proof, ['original']);
    assert.throws(() => items[0].detail.proof.push('caller mutation'), TypeError);
    assert.throws(() => { items[0].state = 'changed'; }, TypeError);
    items.length = 0;
    assert.equal(readProjects(h.root)[0].level, 'important');
  }
  assert.equal(parse.mock.callCount(), 0, 'a cached history is handed out as it is');
  assert.equal(h.reads(), 2);
});

test('external appends, replacement, truncation, deletion and recreation invalidate Work reads', t => {
  const h = fixture(t);
  h.write([{ id: 'one', state: 'open' }]);
  assert.equal(readItems(h.root, 'api')[0].state, 'open');
  fs.appendFileSync(h.file, '{"id":"one","state":"done"}\n');
  assert.equal(readItems(h.root, 'api')[0].state, 'done');
  const replacement = `${h.file}.new`;
  fs.writeFileSync(replacement, '{"id":"two","state":"open"}\n');
  fs.renameSync(replacement, h.file);
  assert.equal(readItems(h.root, 'api')[0].id, 'two');
  fs.truncateSync(h.file, 0);
  assert.deepEqual(readItems(h.root, 'api'), []);
  fs.unlinkSync(h.file);
  assert.deepEqual(readItems(h.root, 'api'), []);
  h.write([{ id: 'new', state: 'open' }]);
  assert.equal(readItems(h.root, 'api')[0].id, 'new');
});

test('same-size rewrites and completed partial lines become visible', t => {
  const h = fixture(t);
  h.write([{ id: 'one', state: 'open' }]);
  assert.equal(readItems(h.root, 'api')[0].state, 'open');
  h.write([{ id: 'one', state: 'done' }]);
  assert.equal(readItems(h.root, 'api')[0].state, 'done');
  fs.appendFileSync(h.file, '{"id":"two",');
  assert.equal(readItems(h.root, 'api').length, 1);
  fs.appendFileSync(h.file, '"state":"open"}\n');
  assert.deepEqual(readItems(h.root, 'api').map(item => item.id), ['one', 'two']);
});

test('a write during a read prevents caching that stale projection', t => {
  const h = fixture(t);
  h.write([{ id: 'one', state: 'open' }]);
  h.afterRead(file => {
    if (file !== h.file) return;
    h.afterRead(() => {});
    fs.appendFileSync(h.file, '{"id":"one","state":"done"}\n');
  });
  assert.equal(readItems(h.root, 'api')[0].state, 'open');
  assert.equal(readItems(h.root, 'api')[0].state, 'done');
  assert.equal(h.reads(), 2);
});

test('the Work cache evicts old files and does not retain oversized records', t => {
  const h = fixture(t);
  h.write([{ id: 'one', state: 'open' }]);
  readItems(h.root, 'api');
  for (let i = 0; i < 64; i++) {
    const directory = join(h.root, 'work', `project-${i}`);
    fs.mkdirSync(directory);
    fs.writeFileSync(join(directory, 'items.jsonl'), '{"id":"one"}\n');
    readItems(h.root, `project-${i}`);
  }
  const before = h.reads();
  assert.equal(readItems(h.root, 'api')[0].state, 'open');
  assert.equal(h.reads(), before + 1);

  h.write([{ id: 'large', brief: 'x'.repeat(8 * 1024 * 1024) }]);
  for (let i = 0; i < 2; i++) assert.equal(readItems(h.root, 'api')[0].id, 'large');
  assert.equal(h.reads(), before + 3);
});
