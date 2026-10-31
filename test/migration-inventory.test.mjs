import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inventoryLegacy, readSource, verifyInventory } from '../src/cli/migration/inventory.mjs';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'hobkin-inventory-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const file = (path, value) => {
    const target = join(home, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, value);
    return target;
  };
  return { home, file };
}

test('every owned source and nested note is named once, raw unknown and malformed data survives', t => {
  const { home, file } = fixture(t);
  const origin = 'a'.repeat(64);
  const state = file(`.pi/agent/hobkin/${origin}.json`, '{"version":1,"items":[],"unknown":"PRIVATE BODY"}');
  file('.pi/agent/hobkin/owner.json', '{"version":1,"sessionId":"old"}');
  file('.pi/agent/hobkin/unknown.bin', 'opaque');
  file('.pi/agent/state/scheduler/tasks.json', '{"version":2,"revision":3,"tasks":[{"id":"x","unknown":true}]}');
  file('.hobkin-schedules.md', '## Daily\nPRIVATE REGISTRY');
  file('.hobkin-notes/nested/taste.md', 'PRIVATE NOTE');
  file('.hobkin-notes/broken.json', '{incomplete');
  file('.hobkin-reports-updates.md', '<!-- old marker -->\nPRIVATE FEED');
  const inventory = inventoryLegacy({ home });
  assert.equal(inventory.files.length, 8);
  assert.equal(new Set(inventory.files.map(entry => entry.path)).size, 8);
  const entry = inventory.files.find(entry => entry.path === state);
  assert.equal(entry.category, 'state');
  assert.equal(entry.origin, `session:${origin}`);
  assert.match(readSource(entry).toString(), /PRIVATE BODY/);
  assert.ok(inventory.files.find(entry => entry.category === 'unknown'));
  assert.doesNotMatch(JSON.stringify(inventory), /PRIVATE/);
  assert.equal(verifyInventory(inventory), true);
});

test('missing optional data is explicit; malformed state is preserved with a diagnostic instead of normalized away', t => {
  const { home, file } = fixture(t);
  file(`.pi/agent/hobkin/${'b'.repeat(64)}.json`, '{not valid json');
  const inventory = inventoryLegacy({ home });
  assert.ok(inventory.missing.some(item => item.category === 'scheduler'));
  assert.equal(inventory.files[0].diagnostic, 'invalid_json');
  assert.equal(readSource(inventory.files[0]).toString(), '{not valid json');
});

test('source edits, additions, removal, symlinks and size violations block a stable inventory', t => {
  const { home, file } = fixture(t);
  const note = file('.hobkin-notes/a.md', 'original');
  const before = inventoryLegacy({ home });
  writeFileSync(note, 'changed');
  assert.throws(() => verifyInventory(before), /changed/);
  const current = inventoryLegacy({ home });
  file('.hobkin-notes/b.md', 'new');
  assert.throws(() => verifyInventory(current), /changed/);
  symlinkSync(note, join(home, '.hobkin-notes/link.md'));
  assert.throws(() => inventoryLegacy({ home }), /regular|symlink/);
  rmSync(join(home, '.hobkin-notes/link.md'));
  assert.throws(() => inventoryLegacy({ home, maxFileBytes: 2 }), /limit/);
});
