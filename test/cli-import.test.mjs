import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { importHome } from '../src/cli/import.mjs';
import { fakePi } from './helpers/pi-session.mjs';

function folders(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-import-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { from: join(root, 'old'), to: join(root, 'new') };
}

const prepared = root => {
  mkdirSync(root, { recursive: true });
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  atomicJson(join(root, 'config.json'), { ...config, main: { ...config.main, model: 'fixture/local' } });
};

const opened = root => HobkinApplication.open(root, { createMain: fakePi(root).createMain });

// The same layout pi-companion leaves, which only differs in its database's name.
async function companionHome(root) {
  prepared(root);
  await (await opened(root)).close();
  for (const ending of ['', '-wal', '-shm']) {
    const file = join(root, 'runtime', `hobkin.sqlite${ending}`);
    if (existsSync(file)) renameSync(file, join(root, 'runtime', `companion.sqlite${ending}`));
  }
}

test('an imported folder reopens the same conversation, with its paths moved', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  const note = `Read ${from}/notes/plan.md, ~/.companion/notes/plan.md and ~/.companion-notes/old.md.\n`;
  mkdirSync(join(from, 'notes'), { recursive: true });
  writeFileSync(join(from, 'notes/plan.md'), 'The plan.\n');
  writeFileSync(join(from, 'memory.md'), note);

  await importHome(to, from);

  assert.equal(readFileSync(join(to, 'notes/plan.md'), 'utf8'), 'The plan.\n');
  assert.equal(existsSync(join(to, 'runtime/hobkin.sqlite')), true);
  assert.equal(existsSync(join(to, 'runtime/companion.sqlite')), false);
  assert.equal(readFileSync(join(to, 'memory.md'), 'utf8'), `Read ${to}/notes/plan.md, ${to}/notes/plan.md and ~/.companion-notes/old.md.\n`);
  assert.equal(readFileSync(join(from, 'memory.md'), 'utf8'), note, 'the old folder is left as it was');
  const app = await opened(to);
  t.after(() => app.close());
  assert.equal(app.snapshot.connection, 'connected');
});

test('nothing is copied while the old app is running', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  renameSync(join(from, 'runtime/companion.sqlite'), join(from, 'runtime/hobkin.sqlite'));
  const app = await opened(from);
  t.after(() => app.close());

  await assert.rejects(importHome(to, from), /still running/);

  assert.equal(existsSync(to), false);
});

test('a folder that already has its own history is never overwritten', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  prepared(to);
  await (await opened(to)).close();

  await assert.rejects(importHome(to, from), /already has its own history/);
});

test('a setting made before the import survives it', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  prepared(to);
  atomicJson(join(to, 'config.json'), { ...JSON.parse(readFileSync(join(to, 'config.json'), 'utf8')), jev: { enabled: true } });

  await importHome(to, from);

  assert.deepEqual(JSON.parse(readFileSync(join(to, 'config.json'), 'utf8')).jev, { enabled: true });
});

test('a folder with no data is refused', async t => {
  const { from, to } = folders(t);

  await assert.rejects(importHome(to, from), /Nothing to import/);
});
