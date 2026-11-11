import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs, { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as config from '../src/cli/config.mjs';
import { createMemoryExtension } from '../src/cli/memory.mjs';
import { PERSONAS, composePersonaPrompt } from '../src/cli/persona.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-persona-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = {
    version: 2, initializedAt: '2026-01-01T00:00:00Z', concurrency: 2,
    main: { cwd: root, model: null, effort: 'medium' },
    background: { harness: 'pi', model: null, effort: 'medium' },
    launcher: { command: ['never-execute-this'] }, unrelated: { keep: ['all', 'fields'] },
  };
  const file = join(root, 'config.json');
  writeFileSync(file, JSON.stringify(original));
  writeFileSync(join(root, 'AGENTS.md'), 'Preserve technical tokens: x.y() https://example.com/a');
  writeFileSync(join(root, 'memory.md'), '- Remember this');
  return { root, file, original };
}

test('optional persona defaults to Normal and every exact selection persists without losing config', t => {
  const { root, file, original } = fixture(t);
  assert.equal(config.readPersona(root), 'Normal');
  assert.equal(config.loadConfig(root).persona, undefined);
  for (const persona of PERSONAS) {
    assert.equal(config.setPersona(root, persona), persona);
    assert.equal(config.readPersona(root), persona);
    assert.deepEqual(config.loadConfig(root), { ...original, persona });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ...original, persona });
    assert.equal(lstatSync(file).mode & 0o077, 0);
  }
});

test('invalid requests and invalid saved selections fail without rewriting configuration', t => {
  const { root, file, original } = fixture(t);
  for (const persona of [null, '', 'normal', '../hal', {}, 1]) {
    const bytes = readFileSync(file, 'utf8');
    assert.throws(() => config.setPersona(root, persona), /persona/i);
    assert.equal(readFileSync(file, 'utf8'), bytes);
    writeFileSync(file, JSON.stringify({ ...original, persona }));
    assert.throws(() => config.loadConfig(root), /persona/i);
    assert.throws(() => config.readPersona(root), /persona/i);
    const invalid = readFileSync(file, 'utf8');
    assert.throws(() => config.setPersona(root, 'Normal'), /persona/i);
    assert.equal(readFileSync(file, 'utf8'), invalid);
    writeFileSync(file, JSON.stringify(original));
  }
});

test('a failed atomic replacement preserves the confirmed selection and removes its temporary file', t => {
  const { root, file } = fixture(t);
  config.setPersona(root, 'hal');
  const bytes = readFileSync(file, 'utf8');
  const rename = t.mock.method(fs, 'renameSync', () => { throw Error('Injected save failure'); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => config.setPersona(root, 'yoda'), /Injected save failure/);
  } finally {
    rename.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(file, 'utf8'), bytes);
  assert.equal(config.readPersona(root), 'hal');
  assert.ok(!readdirSync(root).some(name => name.endsWith('.tmp')));
});

test('the fake SDK captures a durable selection each run, replacing voices and returning to Normal', t => {
  const { root } = fixture(t);
  let beforeStart;
  createMemoryExtension(root)({
    on(event, handler) {
      assert.equal(event, 'before_agent_start');
      beforeStart = handler;
    },
    prompt() { assert.fail('selection must not submit a turn'); },
    abort() { assert.fail('selection must not abort'); },
    execute() { assert.fail('selection must not execute tools'); },
  });
  const run = () => beforeStart({ systemPrompt: 'Original SDK base.' }).systemPrompt;
  const base = run();
  assert.ok(base.includes('x.y() https://example.com/a'));
  assert.ok(base.includes('- Remember this'));
  for (const persona of PERSONAS.slice(1)) {
    config.setPersona(root, persona);
    const captured = run();
    assert.equal(captured, composePersonaPrompt(base, persona));
    config.setPersona(root, 'Normal');
    assert.equal(captured, composePersonaPrompt(base, persona), 'a started run retains its captured prompt');
    assert.equal(run(), base);
  }
  config.setPersona(root, 'hal');
  run();
  config.setPersona(root, 'yoda');
  assert.equal(run(), composePersonaPrompt(base, 'yoda'));
  writeFileSync(join(root, 'memory.md'), '- Changed between runs');
  config.setPersona(root, 'Normal');
  assert.ok(run().includes('- Changed between runs'));
});
