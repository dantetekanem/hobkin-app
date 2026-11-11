import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PERSONAS, applyPersona, composePersonaPrompt, validatePersona } from '../src/cli/persona.mjs';

const choices = ['Normal', 'Funnier', 'Serious', 'hal', 'her', 'jarvis', 'marvin', 'rocky', 'yoda'];
const prompt = name => readFileSync(new URL(`../src/prompts/persona/${name}.md`, import.meta.url), 'utf8');
const base = 'Base instructions.\r\n\nDirections: ask before tools.\nMemory: keep https://example.com/a?b=1 and `node --test`.\n';

test('only the nine supported choices are accepted, with missing selection defaulting to Normal', () => {
  assert.deepEqual(PERSONAS, choices);
  assert.ok(Object.isFrozen(PERSONAS));
  assert.equal(validatePersona(), 'Normal');
  for (const choice of choices) assert.equal(validatePersona(choice), choice);
  for (const unknown of [null, '', 'normal', 'HAL', '../hal', {}, 1, 'toString']) {
    assert.throws(() => validatePersona(unknown), /Invalid persona/);
    assert.throws(() => composePersonaPrompt(base, unknown), /Invalid persona/);
  }
});

test('Normal leaves the full original prompt byte-for-byte intact', () => {
  for (const original of [base, '', '\n\r\n', 'User text <hobkin-persona> must survive.']) {
    assert.equal(composePersonaPrompt(original), original);
    assert.equal(composePersonaPrompt(original, 'Normal'), original);
  }
});

test('each choice loads its exact stored voice once after the unchanged base and authority boundary', () => {
  const boundary = prompt('style-boundary');
  for (const choice of choices.slice(1)) {
    const voice = prompt(choice.toLowerCase());
    assert.equal(composePersonaPrompt(base, choice), `${base}\n\n<hobkin-persona>\n${boundary}\n<voice-style>\n${voice}\n</voice-style>\n</hobkin-persona>`);
  }
});

test('reapplying replaces the prior choice and reset restores directions and memory exactly', () => {
  const initial = { basePrompt: base };
  const hal = applyPersona(initial, 'hal');
  const rocky = applyPersona(hal, 'rocky');
  const repeated = applyPersona(rocky, 'rocky');
  const normal = applyPersona(repeated, 'Normal');
  assert.equal(hal.systemPrompt, composePersonaPrompt(base, 'hal'));
  assert.equal(rocky.systemPrompt, composePersonaPrompt(base, 'rocky'));
  assert.equal(repeated.systemPrompt, rocky.systemPrompt);
  assert.equal(normal.systemPrompt, base);
  assert.equal(normal.basePrompt, base);
  assert.equal(normal.persona, 'Normal');
  assert.deepEqual(initial, { basePrompt: base });
  assert.equal(hal.persona, 'hal');
  assert.ok(Object.isFrozen(rocky));
  assert.equal(applyPersona(hal).systemPrompt, base);
  assert.throws(() => applyPersona(hal, '../../untrusted'), /Invalid persona/);
  assert.equal(hal.persona, 'hal');
});

test('composition rejects a missing or non-text base rather than losing existing context', () => {
  for (const invalid of [undefined, null, {}, 1]) {
    assert.throws(() => composePersonaPrompt(invalid, 'hal'), /base prompt/i);
  }
});
