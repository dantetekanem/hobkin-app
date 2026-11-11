import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readResourceSelection, setResourceSelection, loadConfig } from '../src/cli/config.mjs';
import { RESOURCE_KINDS, RESOURCE_PURPOSES, validateResourceSelection, resolveResourcePolicy } from '../src/cli/resource-policy.mjs';

const candidates = [{ id: 'skill:review', kind: 'skills', installed: true }];
const selected = { version: 1, purposes: { main: { skills: ['skill:review'] } } };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-resource-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = { version: 2, initializedAt: '2026-01-01T00:00:00Z', concurrency: 2,
    main: { cwd: root, model: null, effort: 'medium' }, background: { harness: 'pi', model: null, effort: 'medium' },
    persona: 'hal', launcher: { command: ['never-execute'] }, unrelated: { keep: true } };
  const file = join(root, 'config.json');
  writeFileSync(file, JSON.stringify(original));
  return { root, file, original };
}

test('every purpose defaults to empty inherited selection with separate required Hobkin resources', () => {
  const selection = validateResourceSelection();
  for (const purpose of RESOURCE_PURPOSES) {
    const policy = resolveResourcePolicy(selection, purpose, []);
    for (const kind of RESOURCE_KINDS) assert.deepEqual(policy.selected[kind], []);
    assert.ok(policy.hobkinProvided.includes('bundled-prompts'));
  }
  const main = resolveResourcePolicy(undefined, 'main', []);
  for (const required of ['directions', 'memory', 'bridge-tools']) assert.ok(main.hobkinProvided.includes(required));
  assert.ok(resolveResourcePolicy(undefined, 'work-do', []).builtinTools.includes('bash'));
  assert.deepEqual(resolveResourcePolicy(undefined, 'reflection', []).builtinTools, []);
  assert.throws(() => resolveResourcePolicy(undefined, 'unknown', []), /purpose/i);
  assert.throws(() => resolveResourcePolicy(undefined, 'main'), /candidate/i);
});

test('selection uses exact installed IDs and never broadens to a different kind or available candidate', () => {
  const policy = resolveResourcePolicy(selected, 'main', [...candidates, { id: 'skill:other', kind: 'skills', installed: true }]);
  assert.deepEqual(policy.selected.skills, ['skill:review']);
  assert.deepEqual(resolveResourcePolicy(selected, 'background', candidates).selected.skills, []);
  for (const facts of [[], [{ ...candidates[0], installed: false }], [{ ...candidates[0], kind: 'extensions' }], [...candidates, ...candidates], null]) {
    assert.throws(() => resolveResourcePolicy(selected, 'background', facts), /resource|candidate/i);
  }
  policy.selected.skills.push('skill:other');
  assert.deepEqual(selected.purposes.main.skills, ['skill:review']);
});

test('malformed versions, unknown fields, paths and duplicate IDs refuse instead of expanding access', () => {
  for (const value of [null, [], { version: 2 }, { version: 1, purposes: null }, { version: 1, extra: true }, { version: 1, purposes: { unknown: {} } },
    { version: 1, purposes: { main: { skills: '*' } } }, { version: 1, purposes: { main: { skills: ['../review'] } } },
    { version: 1, purposes: { main: { skills: ['skill:review', 'skill:review'] } } },
    { version: 1, purposes: { main: { sandbox: true } } }]) {
    assert.throws(() => validateResourceSelection(value), /resource/i);
  }
});

test('a valid but oversized selection refuses before making config unreadable', t => {
  const { root, file } = fixture(t);
  const bytes = readFileSync(file, 'utf8');
  const facts = Array.from({ length: 64 }, (_, i) => ({ id: `skill:${'a'.repeat(145)}:${i}`, kind: 'skills', installed: true }));
  const purposes = Object.fromEntries(RESOURCE_PURPOSES.map(purpose => [purpose, { skills: facts.map(fact => fact.id) }]));
  assert.throws(() => setResourceSelection(root, { version: 1, purposes }, facts), /bounded|size/i);
  assert.equal(readFileSync(file, 'utf8'), bytes);
});

test('atomic selection persistence preserves persona, launcher and unrelated config; stale reads refuse', t => {
  const { root, file, original } = fixture(t);
  assert.deepEqual(readResourceSelection(root, []), validateResourceSelection());
  assert.equal(loadConfig(root).resourceSelection, undefined);
  const saved = setResourceSelection(root, selected, candidates);
  assert.deepEqual(readResourceSelection(root, candidates), saved);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ...original, resourceSelection: saved });
  assert.throws(() => readResourceSelection(root, []), /resource/i);
  const bytes = readFileSync(file, 'utf8');
  assert.throws(() => setResourceSelection(root, selected, []), /resource/i);
  assert.equal(readFileSync(file, 'utf8'), bytes);
  const rename = t.mock.method(fs, 'renameSync', () => { throw Error('Injected save failure'); });
  syncBuiltinESMExports();
  try { assert.throws(() => setResourceSelection(root, undefined, []), /Injected save failure/); }
  finally { rename.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(readFileSync(file, 'utf8'), bytes);
  assert.ok(!readdirSync(root).some(name => name.endsWith('.tmp')));
  writeFileSync(file, JSON.stringify({ ...original, resourceSelection: { version: 999 } }));
  assert.throws(() => loadConfig(root), /resource/i);
});
