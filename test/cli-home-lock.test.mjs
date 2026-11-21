import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockHolderGone, lockHome } from '../src/cli/home-lock.mjs';

const module = new URL('../src/cli/home-lock.mjs', import.meta.url).href;

function runtimeFolder(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-home-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'runtime');
  mkdirSync(directory);
  return directory;
}

/** Another process that takes the lock and keeps it until it is stopped, as a host does. */
async function holder(t, directory) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    const { lockHome } = await import(${JSON.stringify(module)});
    await lockHome(${JSON.stringify(directory)}, { onCompromised: () => {} });
    console.log('locked');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  const [line] = await once(child.stdout, 'data');
  assert.equal(String(line).trim(), 'locked');
  return child;
}

test('a home whose holder was killed outright opens at once, not five minutes later', async t => {
  const directory = runtimeFolder(t);
  const child = await holder(t, directory);
  child.kill('SIGKILL');
  await once(child, 'exit');

  assert.equal(lockHolderGone(directory), true);
  const release = await lockHome(directory, { onCompromised: () => {} });
  assert.equal(lockHolderGone(directory), false);
  await release();
});

test('a home whose holder still runs stays shut', async t => {
  const directory = runtimeFolder(t);
  await holder(t, directory);

  assert.equal(lockHolderGone(directory), false);
  await assert.rejects(lockHome(directory, { onCompromised: () => {} }), /already running/);
});

test('a lock nobody wrote down waits until it goes stale, even beside the record of a holder that is gone', async t => {
  const directory = runtimeFolder(t);
  const child = await holder(t, directory);
  child.kill('SIGTERM');
  await once(child, 'exit');
  // Made by a process that died before it wrote itself down, or by an older hobkin.
  rmSync(`${directory}.lock`, { recursive: true, force: true });
  mkdirSync(`${directory}.lock`);

  assert.equal(lockHolderGone(directory), false);
  await assert.rejects(lockHome(directory, { onCompromised: () => {} }), /already running/);
});
