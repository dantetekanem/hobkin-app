import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  const note = `Read ${from}/notes/plan.md, ~/.companion/notes/plan.md and ~/.companion-notes/old.md. Home is "${from}", or ~/.companion.\n`;
  mkdirSync(join(from, 'notes'), { recursive: true });
  writeFileSync(join(from, 'notes/plan.md'), 'The plan.\n');
  writeFileSync(join(from, 'memory.md'), note);

  await importHome(to, from);

  assert.equal(readFileSync(join(to, 'notes/plan.md'), 'utf8'), 'The plan.\n');
  assert.equal(existsSync(join(to, 'runtime/hobkin.sqlite')), true);
  assert.equal(existsSync(join(to, 'runtime/companion.sqlite')), false);
  assert.equal(readFileSync(join(to, 'memory.md'), 'utf8'), `Read ${to}/notes/plan.md, ${to}/notes/plan.md and ~/.companion-notes/old.md. Home is "${to}", or ${to}.\n`);
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
  mkdirSync(join(to, 'reports'), { recursive: true });
  writeFileSync(join(to, 'reports/one.md'), 'A real report.\n');

  await assert.rejects(importHome(to, from), /already has its own history/);

  assert.equal(readFileSync(join(to, 'reports/one.md'), 'utf8'), 'A real report.\n');
});

test('a folder Hobkin has only been started in takes the import', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  writeFileSync(join(from, 'memory.md'), '- Rent is due November 1\n');
  prepared(to);
  await (await opened(to)).close();

  await importHome(to, from);

  assert.equal(readFileSync(join(to, 'memory.md'), 'utf8'), '- Rent is due November 1\n');
  const app = await opened(to);
  t.after(() => app.close());
  assert.equal(app.snapshot.connection, 'connected');
});

test('a folder that is not a Hobkin home is never replaced', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  mkdirSync(to, { recursive: true });
  writeFileSync(join(to, 'thesis.md'), 'Three years of work.\n');

  await assert.rejects(importHome(to, from), /not a Hobkin folder/);

  assert.equal(readFileSync(join(to, 'thesis.md'), 'utf8'), 'Three years of work.\n');
  assert.deepEqual(readdirSync(dirname(to)).filter(name => name.includes('importing')), []);
});

test('a home that was migrated keeps its journal', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  mkdirSync(join(to, 'migration/one/data'), { recursive: true });
  writeFileSync(join(to, 'active.json'), '{}\n');

  await assert.rejects(importHome(to, from), /not a Hobkin folder/);

  assert.equal(existsSync(join(to, 'active.json')), true);
});

test('folders that overlap are refused, so the old one cannot be lost', async t => {
  const { from, to } = folders(t);
  await companionHome(from);

  await assert.rejects(importHome(from, from), /overlap/);
  await assert.rejects(importHome(dirname(from), from), /overlap/);
  await assert.rejects(importHome(join(from, 'inner'), from), /overlap/);

  assert.equal(existsSync(join(from, 'runtime/companion.sqlite')), true);
  assert.equal(existsSync(to), false);
});

test('work trees stay behind, because a copied one still points into the old folder', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  mkdirSync(join(from, 'work/api/trees/look'), { recursive: true });
  writeFileSync(join(from, 'work/api/trees/look/.git'), `gitdir: ${from}/work/api/repo/.git/worktrees/look\n`);
  writeFileSync(join(from, 'work/api/project.md'), 'What agents learned.\n');
  mkdirSync(join(from, 'notes/trees'), { recursive: true });
  writeFileSync(join(from, 'notes/trees/oak.md'), 'A note about trees.\n');

  await importHome(to, from);

  assert.equal(existsSync(join(to, 'work/api/trees')), false);
  assert.equal(existsSync(join(to, 'work/api/project.md')), true);
  assert.equal(existsSync(join(to, 'notes/trees/oak.md')), true);
});

test('a link is copied as a link, and what it points at is never rewritten', async t => {
  const { from, to } = folders(t);
  await companionHome(from);
  const outside = join(dirname(from), 'outside.md');
  writeFileSync(outside, `Notes live in ${from}/notes.\n`);
  mkdirSync(join(from, 'notes'), { recursive: true });
  symlinkSync(outside, join(from, 'notes/shared.md'));

  await importHome(to, from);

  assert.equal(readFileSync(outside, 'utf8'), `Notes live in ${from}/notes.\n`);
  assert.equal(lstatSync(join(to, 'notes/shared.md')).isSymbolicLink(), true);
});

test('only whole paths move, and a target path is taken literally', async t => {
  const { from } = folders(t);
  await companionHome(from);
  const to = join(dirname(from), 'dollar$&home');
  writeFileSync(join(from, 'memory.md'), `Mine: ${from}/a.md. Not mine: /Volumes/Backup${from}/a.md.\n`);

  await importHome(to, from);

  assert.equal(readFileSync(join(to, 'memory.md'), 'utf8'), `Mine: ${to}/a.md. Not mine: /Volumes/Backup${from}/a.md.\n`);
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
