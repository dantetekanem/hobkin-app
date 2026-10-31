import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveBridge } from '../src/cli/bridge.mjs';
import { openCheck } from '../src/cli/checks.mjs';
import { directionsPath, readDirections } from '../src/cli/directions.mjs';
import { createMemoryExtension } from '../src/cli/memory.mjs';

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
