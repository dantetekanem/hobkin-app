import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SETUP_FACTS_MAX, SETUP_TEXT_MAX, aboutSetup, readSetupFacts, writeSetupFacts } from '../src/cli/setup-facts.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-setup-facts-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const facts = [
  { about: 'Where do your projects live?', said: '~/Code' },
  { about: 'Projects hobkin runs', said: 'api and web' },
];
const setupFile = root => join(root, 'setup.json');

test('the setup answers replace what was there in one write, and read back', t => {
  const root = dataRoot(t);
  writeSetupFacts(root, [{ about: 'Old question?', said: 'old answer' }]);

  assert.deepEqual(writeSetupFacts(root, facts), { facts });

  assert.deepEqual(readSetupFacts(root), { facts });
});

test('the setup answers are private to the user', t => {
  const root = dataRoot(t);

  writeSetupFacts(root, facts);

  assert.equal(lstatSync(setupFile(root)).mode & 0o077, 0);
});

test('an answer is saved trimmed, with only what it is about and what was said', t => {
  const root = dataRoot(t);

  const saved = writeSetupFacts(root, [{ about: '  Where do your projects live?  ', said: ' ~/Code ', id: 7 }]);

  assert.deepEqual(saved, { facts: [facts[0]] });
  assert.deepEqual(readSetupFacts(root), saved);
});

test('the most answers there can be, each as long as it can be, still save', t => {
  const root = dataRoot(t);
  const longest = 'x'.repeat(SETUP_TEXT_MAX);
  const full = Array.from({ length: SETUP_FACTS_MAX }, () => ({ about: longest, said: longest }));

  assert.deepEqual(writeSetupFacts(root, full), { facts: full });
  assert.deepEqual(readSetupFacts(root), { facts: full });
});

test('a bad answer, or too many, saves nothing', t => {
  const root = dataRoot(t);
  writeSetupFacts(root, facts);
  const tooLong = 'x'.repeat(SETUP_TEXT_MAX + 1);
  const tooMany = Array.from({ length: SETUP_FACTS_MAX + 1 }, (_, index) => ({ about: `Question ${index}?`, said: 'yes' }));

  for (const wrong of [
    [{ about: 'Where?', said: '' }],
    [{ about: '   ', said: 'here' }],
    [{ about: 'Where?', said: 'two\nlines' }],
    [{ about: 'Where?', said: 'a\u0007bell' }],
    [{ about: tooLong, said: 'here' }],
    [{ about: 'Where?', said: 42 }],
    [{ about: 'Where?' }],
    [facts[0], 'Where?'],
    [null],
    facts[0],
    tooMany,
  ]) {
    assert.throws(() => writeSetupFacts(root, wrong), /must be a list|at most 12 answers|Answer \d+ needs/, JSON.stringify(wrong));
  }

  assert.deepEqual(readSetupFacts(root), { facts });
});

test('a missing, broken, oversized or oddly shaped file reads as no answers, so it never stops a start or a check', t => {
  const root = dataRoot(t);
  assert.deepEqual(readSetupFacts(root), { facts: [] });

  const oversized = JSON.stringify({ facts: [facts[0]], padding: 'x'.repeat(70000) });
  for (const text of ['not json', 'null', '[]', JSON.stringify({ facts: 'yes' }), oversized]) {
    writeFileSync(setupFile(root), text);
    assert.deepEqual(readSetupFacts(root), { facts: [] }, text.slice(0, 40));
  }

  rmSync(setupFile(root));
  mkdirSync(setupFile(root));
  assert.deepEqual(readSetupFacts(root), { facts: [] });
});

test('what is not a real answer is dropped from what is read, and the rest is kept', t => {
  const root = dataRoot(t);
  const odd = [facts[0], { about: 'Where?', said: 'two\nlines' }, 'text', null, { about: 7, said: 'x' }, facts[1]];

  writeFileSync(setupFile(root), JSON.stringify({ facts: odd }));
  assert.deepEqual(readSetupFacts(root), { facts });

  const tooMany = Array.from({ length: SETUP_FACTS_MAX + 3 }, (_, index) => ({ about: `Question ${index}?`, said: 'yes' }));
  writeFileSync(setupFile(root), JSON.stringify({ facts: tooMany }));
  assert.deepEqual(readSetupFacts(root), { facts: tooMany.slice(0, SETUP_FACTS_MAX) });
});

test('hobkin reads each answer on its own line, as facts to know and never as the user\'s yes', () => {
  assert.equal(aboutSetup({ facts: [] }), '');

  const lines = aboutSetup({ facts }).split('\n');

  assert.match(lines[0], /answered .* the app's setup/);
  assert.deepEqual(lines.slice(1, 3), ['- Where do your projects live? ~/Code', '- Projects hobkin runs: api and web']);
  assert.equal(lines.length, 4);
  assert.match(lines[3], /not permissions/);
  assert.match(lines[3], /a scan, an install, a send or a change/);
});
