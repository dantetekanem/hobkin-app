import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveBridge } from '../src/cli/bridge.mjs';
import { openCheck } from '../src/cli/checks.mjs';
import { directionsPath, readDirections } from '../src/cli/directions.mjs';
import { createMemoryExtension } from '../src/cli/memory.mjs';
import { setProfile } from '../src/cli/profile.mjs';
import { aboutSetup, readSetupFacts, writeSetupFacts } from '../src/cli/setup-facts.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-directions-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const systemPromptFrom = extension => {
  let handler;
  extension({ on: (_event, run) => { handler = run; } });
  return handler({ systemPrompt: 'Base.' }).systemPrompt;
};

test('a new folder gets the default directions, and an edit is never replaced', t => {
  const root = dataRoot(t);

  const first = readDirections(root);

  assert.equal(readFileSync(directionsPath(root), 'utf8'), first);
  writeFileSync(directionsPath(root), 'Always answer in Portuguese.\n');
  assert.equal(readDirections(root), 'Always answer in Portuguese.\n');
});

test('what the user answered in the setup comes after who they are and before the directions, outside their cap', t => {
  const root = dataRoot(t);
  const long = `Keep reports short.\n${'x'.repeat(20000)}`;
  writeFileSync(directionsPath(root), long);
  setProfile(root, 'name', 'Ada');
  writeSetupFacts(root, [{ about: 'Where do your projects live?', said: '~/Code' }]);

  const setup = aboutSetup(readSetupFacts(root));

  assert.match(setup, /~\/Code/);
  assert.ok(readDirections(root).endsWith(long), 'all standing directions survive the setup prefix');
  assert.equal(readDirections(root), `The user's name is Ada.\n\n${setup}\n\n${long}`);
});

test('standing directions retain complete UTF-8 through 64 KiB and reject oversize instead of truncating', t => {
  const root = dataRoot(t);
  const full = '界'.repeat(21845) + 'x';
  assert.equal(Buffer.byteLength(full), 65536);
  writeFileSync(directionsPath(root), full);
  assert.equal(Buffer.byteLength(readDirections(root)), 65536);
  assert.equal(readDirections(root), full);
  writeFileSync(directionsPath(root), full + 'x');
  assert.throws(() => readDirections(root), /AGENTS.md.*65536/);
});

test('with no setup answers the directions read exactly as they did', t => {
  const root = dataRoot(t);
  writeFileSync(directionsPath(root), 'Keep reports short.\n');
  writeSetupFacts(root, []);

  assert.equal(readDirections(root), 'Keep reports short.\n');
  setProfile(root, 'name', 'Ada');
  assert.equal(readDirections(root), "The user's name is Ada.\n\nKeep reports short.\n");
});

test('the main chat reads the directions on every turn, so an edit applies at once', t => {
  const root = dataRoot(t);
  const extension = createMemoryExtension(root);
  writeFileSync(directionsPath(root), 'First direction.\n');
  assert.match(systemPromptFrom(extension), /First direction\./);

  writeFileSync(directionsPath(root), 'Second direction.\n');

  const prompt = systemPromptFrom(extension);
  assert.match(prompt, /Second direction\./);
  assert.doesNotMatch(prompt, /First direction\./);
});

test('every check starts with the directions', t => {
  const root = dataRoot(t);
  writeFileSync(directionsPath(root), 'Keep reports short.\n');

  assert.equal(openCheck(root, 'email').directions, 'Keep reports short.\n');
});

test('the launcher path reaches the directions through the bridge', async () => {
  const answer = await serveBridge(JSON.stringify({ op: 'directions' }), { tools: {}, memory: () => [], directions: () => 'Keep reports short.\n' });

  assert.deepEqual(answer, { ok: true, result: 'Keep reports short.\n' });
});
