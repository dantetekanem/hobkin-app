import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { git, repository } from './helpers/work-fixture.mjs';

const LAND = fileURLToPath(new URL('../src/skills/ludicrous-worker/land.mjs', import.meta.url));
const BRANCH = 'ludicrous/harbor';
const run = promisify(execFile);

/** The run's shared folder on its branch, with the api area's queue of packets as its leader wrote it, committed. */
function folder(t, packets) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-ludicrous-land-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const checkout = repository(base, 'harbor');
  git(checkout, 'switch', '-q', '-c', BRANCH);
  const trails = join(checkout, '_specs', 'ludicrous', 'trails', 'api');
  mkdirSync(trails, { recursive: true });
  writeFileSync(join(trails, 'queue.jsonl'), packets.map(packet => `${JSON.stringify({ step: 'S1', tier: 'mid', ...packet })}\n`).join(''));
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', 'api: the first packets');
  return checkout;
}

const write = (checkout, path, text) => {
  mkdirSync(join(checkout, path, '..'), { recursive: true });
  writeFileSync(join(checkout, path), text);
};
const trail = (checkout, id) => join(checkout, '_specs', 'ludicrous', 'trails', 'api', `${id}.md`);

/** A worker's `land`, as its process runs it in the shared folder, read up to `read`. */
function land(checkout, id, message, read) {
  const env = { ...process.env, LUDICROUS_BRANCH: BRANCH, LUDICROUS_AREA: 'api', LUDICROUS_READ: read };
  return run(process.execPath, [LAND, id, message], { cwd: checkout, env }).then(
    ({ stdout }) => ({ code: 0, stdout }),
    error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
  );
}

const filesIn = (checkout, commit) => git(checkout, 'show', '--name-only', '--format=', commit).split('\n').filter(Boolean).sort();

test('two workers landing at once both keep every line', async t => {
  const packets = Array.from({ length: 8 }, (_, n) => ({ id: `api-${n}`, paths: [`src/part-${n}.ts`, `test/part-${n}.test.ts`] }));
  const checkout = folder(t, packets);
  const read = git(checkout, 'rev-parse', BRANCH);
  for (const { id, paths } of packets) {
    for (const path of paths) write(checkout, path, `${id} wrote ${path}\n`);
    writeFileSync(trail(checkout, id), `# ${id}\n`);
  }

  // All eight read the same head and land at the same moment, so most find the branch moved under them and make their commit again.
  const landed = await Promise.all(packets.map(({ id }) => land(checkout, id, `${id}: its part`, read)));
  assert.deepEqual(landed.map(({ code }) => code), packets.map(() => 0));

  const head = git(checkout, 'rev-parse', BRANCH);
  assert.equal(git(checkout, 'rev-list', '--count', `${read}..${head}`), '8');
  for (const { id, paths } of packets) {
    for (const path of paths) assert.equal(git(checkout, 'show', `${head}:${path}`), `${id} wrote ${path}`);
    const own = git(checkout, 'log', '--format=%H', '--grep', `^Packet: ${id}$`, BRANCH);
    assert.deepEqual(filesIn(checkout, own), [...paths, `_specs/ludicrous/trails/api/${id}.md`].sort());
  }
});

test('a commit carries only its packet\'s paths, whatever else the shared folder holds', async t => {
  const checkout = folder(t, [{ id: 'api-1', paths: ['src/routes'] }]);
  const read = git(checkout, 'rev-parse', BRANCH);
  write(checkout, 'src/routes/users.ts', 'export const users = [];\n');
  write(checkout, 'src/routes/old.ts', 'gone soon\n');
  write(checkout, 'src/web/half-written.ts', 'export const half = ');
  writeFileSync(trail(checkout, 'api-1'), '# api-1\n');

  const { code, stdout } = await land(checkout, 'api-1', 'api-1: the users route', read);
  assert.equal(code, 0);
  const head = git(checkout, 'rev-parse', BRANCH);
  assert.equal(stdout.trim(), `Landed api-1 as ${head}.`);
  assert.deepEqual(filesIn(checkout, head), ['_specs/ludicrous/trails/api/api-1.md', 'src/routes/old.ts', 'src/routes/users.ts']);
  assert.equal(git(checkout, 'status', '--porcelain', '--', 'src/routes'), '');
  assert.match(git(checkout, 'status', '--porcelain'), /\?\? src\/web\//);
});

test('a path that changed since it was read is refused, and the trail says so', async t => {
  const checkout = folder(t, [{ id: 'api-1', paths: ['src/users.ts'] }, { id: 'api-2', paths: ['src/users.ts'] }]);
  const read = git(checkout, 'rev-parse', BRANCH);
  write(checkout, 'src/users.ts', 'first\n');
  writeFileSync(trail(checkout, 'api-1'), '# api-1\n');
  assert.equal((await land(checkout, 'api-1', 'api-1: users', read)).code, 0);
  const head = git(checkout, 'rev-parse', BRANCH);

  // A second worker read the branch before api-1 landed. Landing its own users.ts would write over api-1's line.
  write(checkout, 'src/users.ts', 'second\n');
  writeFileSync(trail(checkout, 'api-2'), '# api-2\n');
  const refused = await land(checkout, 'api-2', 'api-2: users again', read);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /src\/users\.ts changed on the branch since you read it/);
  assert.equal(git(checkout, 'rev-parse', BRANCH), head);
  assert.match(readFileSync(trail(checkout, 'api-2'), 'utf8'), new RegExp(`## Refused\\n\\nsrc/users\\.ts changed on the branch since ${read.slice(0, 12)}`));

  // Read again, at the branch as it is now, it lands.
  assert.equal((await land(checkout, 'api-2', 'api-2: users again', head)).code, 0);
  assert.equal(git(checkout, 'show', `${BRANCH}:src/users.ts`), 'second');
});

test('a packet its leader never wrote does not land', async t => {
  const checkout = folder(t, [{ id: 'api-1', paths: ['src/users.ts'] }]);
  const read = git(checkout, 'rev-parse', BRANCH);
  write(checkout, 'src/users.ts', 'first\n');
  const refused = await land(checkout, 'api-9', 'api-9: made up', read);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /api-9 is not in the api area's queue/);
  assert.equal(git(checkout, 'rev-parse', BRANCH), read);
});
