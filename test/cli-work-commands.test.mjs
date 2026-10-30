import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { main, parseArguments } from '../src/cli/main.mjs';
import { readItems, readMode, readProjects } from '../src/cli/work/store.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'companion-work-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root });
  return root;
}

async function work(root, args, input) {
  let text = '';
  const code = await main(['work', ...args, '--home', root], { write: chunk => { text += chunk; } }, {
    input: Readable.from(input === undefined ? [] : [JSON.stringify(input)]),
  });
  return { code, result: JSON.parse(text) };
}

const proposal = { name: 'api', path: '/repos/api', level: 'casual', summary: 'An API.', found: 'CI green.', first: [] };
const item = { key: 'update:rack', kind: 'update', title: 'Update rack', brief: 'Rack has an advisory.' };

test('work arguments keep their order and the home option still applies', () => {
  const options = parseArguments(['work', 'choose', '/repos/api', 'critical', '--home', '/tmp/home']);

  assert.deepEqual(options.args, ['choose', '/repos/api', 'critical']);
  assert.equal(options.root, '/tmp/home');
});

test('work on and off set the mode a running owner picks up', async t => {
  const root = dataRoot(t);

  assert.equal((await work(root, ['on'])).result.enabled, true);
  assert.equal(readMode(root).enabled, true);

  assert.equal((await work(root, ['off'])).result.enabled, false);
  assert.equal(readMode(root).enabled, false);
});

test('an agent proposes a project, and the user takes or skips it', async t => {
  const root = dataRoot(t);

  await work(root, ['propose'], proposal);
  await work(root, ['propose'], { ...proposal, name: 'site', path: '/repos/site' });
  await work(root, ['choose', 'api', 'critical']);
  await work(root, ['skip', 'site']);

  assert.deepEqual(readProjects(root).map(({ slug, state, level }) => [slug, state, level]), [
    ['api', 'chosen', 'critical'],
    ['site', 'skipped', 'casual'],
  ]);
});

test('an agent files an item, then updates it by id', async t => {
  const root = dataRoot(t);
  await work(root, ['choose', '/repos/api']);

  const { result: filed } = await work(root, ['item', 'api'], item);
  await work(root, ['item', 'api'], { id: filed.id, state: 'pr', pr: 'https://example.com/1' });

  assert.deepEqual(readItems(root, 'api').map(({ state, pr }) => [state, pr]), [['pr', 'https://example.com/1']]);
});

test('bare work prints status as JSON', async t => {
  const root = dataRoot(t);
  await work(root, ['propose'], proposal);

  const { result } = await work(root, []);

  assert.equal(result.enabled, false);
  assert.deepEqual(result.projects.map(project => project.slug), ['api']);
});

test('a bad request fails without changing anything', async t => {
  const root = dataRoot(t);

  await assert.rejects(work(root, ['choose', 'missing']), /Unknown project/);
  await assert.rejects(work(root, ['dance']), /Usage/);
  assert.deepEqual(readProjects(root), []);
});
