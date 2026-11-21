import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { atUtilityPriority, TASKPOLICY } from '../src/cli/priority.mjs';
import { startRpcProcess } from '../src/cli/rpc-process.mjs';

const onMac = process.platform === 'darwin';
const priorityOf = pid => Number(execFileSync('ps', ['-o', 'pri=', '-p', String(pid)], { encoding: 'utf8' }).trim());
// A child that says its own process id, then echoes each line it reads until its input ends.
const ECHO = "process.stdout.write(JSON.stringify({ type: 'started', pid: process.pid }) + '\\n'); process.stdin.on('data', d => process.stdout.write(d));";

/** A plain child, ended when the test ends, whatever its assertions did. */
function plainChild(t, command, args) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  child.stdout.setEncoding('utf8');
  return child;
}

/** A child started as Pi's are, ended with its whole process group when the test ends, and its first record. */
async function rpcChild(t, options = {}) {
  const started = Promise.withResolvers();
  const handle = startRpcProcess({
    command: process.execPath, args: ['-e', ECHO], cwd: process.cwd(), env: process.env, ...options,
    onRecord: record => started.resolve(record),
  });
  t.after(async () => {
    handle.force();
    await handle.closed;
  });
  return { handle, record: await started.promise };
}

test('a command starts through taskpolicy at utility priority on macOS and plainly elsewhere', async t => {
  const present = () => true;
  assert.deepEqual(atUtilityPriority('pi', ['--mode', 'rpc'], { platform: 'darwin', exists: present }),
    { command: TASKPOLICY, args: ['-c', 'utility', 'pi', '--mode', 'rpc'] });
  assert.deepEqual(atUtilityPriority('pi', ['--mode', 'rpc'], { platform: 'linux', exists: present }), { command: 'pi', args: ['--mode', 'rpc'] });
  assert.deepEqual(atUtilityPriority('pi', ['--mode', 'rpc'], { platform: 'darwin', exists: () => false }), { command: 'pi', args: ['--mode', 'rpc'] });
  if (!onMac) return;

  // taskpolicy becomes the command: the same process id, the same pipes, and a signal reaches the command itself.
  const wrapped = atUtilityPriority(process.execPath, ['-e', ECHO]);
  const child = plainChild(t, wrapped.command, wrapped.args);
  const [first] = await once(child.stdout, 'data');
  assert.equal(JSON.parse(first).pid, child.pid);
  const utility = priorityOf(child.pid);
  child.stdin.write('ping\n');
  assert.equal((await once(child.stdout, 'data'))[0], 'ping\n');
  child.kill('SIGTERM');
  const [, signal] = await once(child, 'close');
  assert.equal(signal, 'SIGTERM');

  // Pi's children start the same way, and run at the priority taskpolicy gives.
  const { handle, record } = await rpcChild(t);
  assert.equal(record.pid, handle.pid);
  assert.equal(priorityOf(handle.pid), utility);
});

test('a caller that waits on its child, as the main chat does, starts it at normal priority', async t => {
  if (!onMac) return;
  const plain = plainChild(t, process.execPath, ['-e', ECHO]);
  await once(plain.stdout, 'data');
  const { handle } = await rpcChild(t, { utility: false });
  assert.equal(priorityOf(handle.pid), priorityOf(plain.pid));
  const { handle: lowered } = await rpcChild(t);
  assert.ok(priorityOf(lowered.pid) < priorityOf(handle.pid), 'a background child still runs below it');
});

test('a command that is missing or cannot run fails as it always did, naming the program, not through taskpolicy', async t => {
  for (const [command, code] of [['definitely-not-a-command-hobkin', 'ENOENT'], ['/etc/hosts', 'EACCES']]) {
    const handle = startRpcProcess({ command, args: [], cwd: process.cwd(), env: process.env });
    t.after(async () => {
      handle.force();
      await handle.closed;
    });
    const { error } = await handle.closed;
    assert.equal(error.code, code, error.message);
    assert.match(error.message, new RegExp(command.replace(/[./]/g, '\\$&')));
    assert.doesNotMatch(error.message, /taskpolicy/);
  }
});
