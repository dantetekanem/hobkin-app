import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySelection, readResourceSelection, readSelection, setResourceSelection, loadConfig } from '../src/cli/config.mjs';
import { RESOURCE_KINDS, RESOURCE_PURPOSES, validateResourceSelection, resolveResourcePolicy,
  changeSelection, chosenResources, normalizeSelection, resourceFlags } from '../src/cli/resource-policy.mjs';

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

// Version 2 (038-resources): ids by kind, checked against a catalog, turned into Pi's flags.
const all = { main: true, background: true, work: true, durable: true };
const catalog = { items: [
  { id: 'package:npm:@siddr/pi-web-search', type: 'package', offered: all,
    paths: { extensions: ['/pi/npm/web/index.js'], skills: ['/pi/npm/web/skills/web/SKILL.md'], context: [] } },
  { id: 'package:../../Poetry/pi-memory', type: 'package', offered: { ...all, main: false },
    paths: { extensions: ['/poetry/pi-memory/index.ts'], skills: [], context: [] } },
  { id: 'skill:skills/humanizer/SKILL.md', type: 'skill', offered: all, paths: { extensions: [], skills: ['/pi/skills/humanizer/SKILL.md'], context: [] } },
  { id: 'builtin:mcp', type: 'builtin', offered: { ...all, main: false }, paths: { extensions: ['builtin:mcp'], skills: [], context: [] } },
  { id: 'context:pi', type: 'context', offered: all, paths: { extensions: [], skills: [], context: ['/pi/AGENTS.md'] } },
] };

test('a selection holding a path instead of an id is refused', () => {
  for (const ids of [['/Users/someone/.pi/agent/extensions/x.ts'], ['../x'], ['extensions/x.ts'], ['prompt:x'], ['skill:'], ['skill: padded'],
    ['skill:a\nb'], [`skill:${'a'.repeat(300)}`], ['skill:a', 'skill:a'], Array.from({ length: 129 }, (_, i) => `skill:${i}`), '*', [7]]) {
    assert.throws(() => normalizeSelection({ version: 2, kinds: { work: ids } }), /resource/i, JSON.stringify(ids).slice(0, 80));
    if (Array.isArray(ids) && ids.length === 1) {
      assert.throws(() => changeSelection(undefined, { kind: 'work', on: ids }, catalog), /resource/i);
      assert.throws(() => changeSelection(undefined, { kind: 'work', off: ids }, catalog), /resource/i);
    }
  }
  for (const value of [null, [], { version: 3 }, { version: 2, extra: true }, { version: 2, kinds: { reflection: [] } }, { version: 2, kinds: [] },
    { version: 2, kinds: { work: null } }]) {
    assert.throws(() => normalizeSelection(value), /resource/i);
  }
  const ids = ['package:npm:@siddr/pi-web-search', 'package:../../Poetry/pi-agentic-search', 'skill:/Users/someone/My Skills/x/SKILL.md'];
  assert.deepEqual(normalizeSelection({ version: 2, kinds: { work: ids } }).kinds.work, ids);
  assert.deepEqual(normalizeSelection(undefined), { version: 2, kinds: { main: [], background: [], work: [], durable: [] } });
  assert.deepEqual(normalizeSelection(selected), normalizeSelection(undefined), 'a version 1 selection reads as nothing chosen');
});

test('turning an id on checks the catalog and the kinds it is offered to, and turning one off always works', () => {
  const on = changeSelection(undefined, { kind: 'work', on: ['package:npm:@siddr/pi-web-search', 'context:pi'] }, catalog);
  assert.deepEqual(on.kinds.work, ['package:npm:@siddr/pi-web-search', 'context:pi']);
  assert.deepEqual(on.kinds.main, []);
  assert.deepEqual(changeSelection(on, { kind: 'work', on: ['context:pi'] }, catalog).kinds.work, on.kinds.work, 'on twice keeps one');
  assert.throws(() => changeSelection(on, { kind: 'work', on: ['package:npm:gone'] }, catalog), /catalog/);
  assert.throws(() => changeSelection(on, { kind: 'main', on: ['builtin:mcp'] }, catalog), /offered/);
  assert.throws(() => changeSelection(on, { kind: 'reflection', on: ['context:pi'] }, catalog), /kind/);
  assert.throws(() => changeSelection(on, { kind: 'work', on: ['context:pi'], off: ['context:pi'] }, catalog), /resource/i);
  const gone = { version: 2, kinds: { work: ['package:npm:gone', 'context:pi'] } };
  assert.deepEqual(changeSelection(gone, { kind: 'work', off: ['package:npm:gone'] }, { items: [] }).kinds.work, ['context:pi']);
  const full = { version: 2, kinds: { work: Array.from({ length: 128 }, (_, i) => `skill:${i}`) } };
  assert.throws(() => changeSelection(full, { kind: 'work', on: ['context:pi'] }, catalog), /resource/i);
});

test('the selection is kept in config.json as version 2 and holds across a restart', t => {
  const { root, file, original } = fixture(t);
  assert.deepEqual(readSelection(root), normalizeSelection(undefined));
  const saved = applySelection(root, { kind: 'work', on: ['package:npm:@siddr/pi-web-search'] }, catalog);
  assert.deepEqual(readSelection(root), saved);
  assert.deepEqual(loadConfig(root).resourceSelection, saved);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ...original, resourceSelection: saved });
  assert.deepEqual(applySelection(root, { kind: 'work', off: ['package:npm:@siddr/pi-web-search'] }, { items: [] }).kinds.work, []);
  writeFileSync(file, JSON.stringify({ ...original, resourceSelection: selected }));
  assert.deepEqual(readSelection(root), normalizeSelection(undefined), 'version 1 on disk reads as nothing chosen');
  const big = { items: Array.from({ length: 128 }, (_, i) => ({ id: `skill:${String(i).padStart(3, '0')}${'a'.repeat(290)}`, offered: all,
    paths: { extensions: [], skills: [], context: [] } })) };
  writeFileSync(file, JSON.stringify({ ...original, resourceSelection: { version: 2, kinds: { main: big.items.map(item => item.id) } } }));
  const bytes = readFileSync(file, 'utf8');
  assert.throws(() => applySelection(root, { kind: 'work', on: big.items.map(item => item.id) }, big), /bounded|size/i);
  assert.equal(readFileSync(file, 'utf8'), bytes);
});

test("a kind's choices become Pi's flags: nothing of Pi's but its own tools, then the chosen paths", () => {
  const selection = { version: 2, kinds: { work: ['package:npm:@siddr/pi-web-search', 'skill:skills/humanizer/SKILL.md', 'context:pi', 'builtin:mcp', 'package:npm:gone'] } };
  const work = chosenResources(selection, 'work', catalog);
  assert.deepEqual(work.missing, [{ id: 'package:npm:gone', reason: 'not-installed' }]);
  assert.deepEqual(resourceFlags(work), [
    '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve',
    '-e', 'builtin:codemode', '-e', 'builtin:tool-search',
    '--extension', '/pi/npm/web/index.js', '--extension', 'builtin:mcp',
    '--skill', '/pi/npm/web/skills/web/SKILL.md', '--skill', '/pi/skills/humanizer/SKILL.md',
    '--append-system-prompt', '/pi/AGENTS.md',
  ]);
  assert.deepEqual(resourceFlags(chosenResources(selection, 'background', catalog)), [
    '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve',
    '-e', 'builtin:codemode', '-e', 'builtin:tool-search',
  ], 'a choice for one kind reaches no other');
  assert.deepEqual(resourceFlags(work, { managedExtensions: true }), [
    '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve',
    '--skill', '/pi/npm/web/skills/web/SKILL.md', '--skill', '/pi/skills/humanizer/SKILL.md',
    '--append-system-prompt', '/pi/AGENTS.md',
  ], 'under a launcher that manages extensions, skills and context files still follow the choice');
  const stale = chosenResources({ version: 2, kinds: { main: ['package:../../Poetry/pi-memory'] } }, 'main', catalog);
  assert.deepEqual(stale, { kind: 'main', chosen: [], missing: [{ id: 'package:../../Poetry/pi-memory', reason: 'not-offered' }] });
  const forged = { items: [{ ...catalog.items[0], paths: { extensions: ['relative/x.ts'], skills: [], context: [] } }] };
  assert.throws(() => chosenResources(selection, 'work', forged), /path/);
});
