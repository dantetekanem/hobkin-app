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

test('a command starts through taskpolicy at utility priority on macOS and plainly elsewhere', async t => {
  const present = () => true;
  assert.deepEqual(atUtilityPriority('pi', ['--mode', 'rpc'], { platform: 'darwin', exists: present }),
    { command: TASKPOLICY, args: ['-c', 'utility', 'pi', '--mode', 'rpc'] });
  assert.deepEqual(atUtilityPriority('pi', ['--mode', 'rpc'], { platform: 'linux', exists: present }), { command: 'pi', args: ['--mode', 'rpc'] });
  assert.deepEqual(atUtilityPriority('pi', ['--mode', 'rpc'], { platform: 'darwin', exists: () => false }), { command: 'pi', args: ['--mode', 'rpc'] });
  if (!onMac) return;

  // taskpolicy becomes the command: the same process id, the same pipes, and a signal reaches the command itself.
  const wrapped = atUtilityPriority(process.execPath, ['-e', ECHO]);
  const child = spawn(wrapped.command, wrapped.args, { stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  child.stdout.setEncoding('utf8');
  const [first] = await once(child.stdout, 'data');
  assert.equal(JSON.parse(first).pid, child.pid);
  const reference = priorityOf(child.pid);
  child.stdin.write('ping\n');
  assert.equal((await once(child.stdout, 'data'))[0], 'ping\n');
  child.kill('SIGTERM');
  const [, signal] = await once(child, 'close');
  assert.equal(signal, 'SIGTERM');

  // Pi's children start the same way, and run at the priority taskpolicy gives.
  const records = [];
  const seen = Promise.withResolvers();
  const handle = startRpcProcess({
    command: process.execPath, args: ['-e', ECHO], cwd: process.cwd(), env: process.env,
    onRecord: record => { records.push(record); seen.resolve(); },
  });
  await seen.promise;
  assert.equal(records[0].pid, handle.pid);
  assert.equal(priorityOf(handle.pid), reference);
  handle.terminate();
  await handle.closed;
});
