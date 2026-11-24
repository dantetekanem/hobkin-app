import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

/**
 * Only the compatibility adapter may supply an already-authorized legacy command, and hobkin a command an agent
 * scheduled for itself (`agent-schedule-runner.mjs`). `env` is the environment it starts with, hobkin's own when none.
 */
export async function executeShell({ command, cwd, signal, env }, { spawnProcess = spawn, maxOutputBytes = 1048576 } = {}) {
  if (typeof command !== 'string' || !command.trim() || Buffer.byteLength(command) > 65536 || !isAbsolute(cwd ?? '')
    || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw Error('Invalid scheduled shell bounds.');
  }
  const result = { command, cwd, stdout: '', stderr: '', code: null, killed: false, truncated: false };
  if (signal?.aborted) return { ...result, killed: true, interrupted: true, error: 'Cancelled before shell admission.' };
  let child;
  try {
    // Matches pi-scheduler 0.5.1. The saved command is one argument, never interpolated into another command.
    child = spawnProcess('bash', ['-lc', command], {
      cwd,
      ...(env ? { env } : {}),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { ...result, error: String(error.message ?? error) };
  }

  const done = Promise.withResolvers();
  const chunks = { stdout: [], stderr: [] };
  let bytes = 0;
  let closed = false;
  let escalation;
  // How the process exited, once it has, and whether SIGKILL went after it.
  let exited = null;
  let hardKilled = false;
  // A killed command's own process has gone, but a child it left in a process group of its own may still hold the
  // pipes, so close would never come. Once SIGKILL has gone too, the pipes are let go and the run settles.
  const release = () => {
    if (closed || !exited || !hardKilled) return;
    closed = true;
    result.code = exited.code;
    result.signal = exited.signal;
    child.stdout?.destroy();
    child.stderr?.destroy();
    done.resolve();
  };
  const kill = action => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, action);
      else child.kill(action);
    } catch (error) {
      if (error.code !== 'ESRCH') result.error ??= String(error.message ?? error);
    }
  };
  const stop = reason => {
    if (closed || result.killed) return;
    result.killed = true;
    result.error = reason;
    kill('SIGTERM');
    escalation = setTimeout(() => {
      kill('SIGKILL');
      hardKilled = true;
      release();
    }, 500);
  };
  for (const channel of ['stdout', 'stderr']) {
    child[channel].on('data', data => {
      const chunk = Buffer.from(data);
      const available = Math.max(0, maxOutputBytes - bytes);
      if (available) chunks[channel].push(Buffer.from(chunk.subarray(0, available)));
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        result.truncated = true;
        stop('Scheduled shell output limit exceeded.');
      }
    });
  }
  child.on('error', error => { result.error = String(error.message ?? error); });
  child.on('exit', (code, exitSignal) => {
    exited = { code, signal: exitSignal };
    release();
  });
  child.on('close', (code, exitSignal) => {
    if (closed) return;
    closed = true;
    result.code = code;
    result.signal = exitSignal;
    clearTimeout(escalation);
    done.resolve();
  });
  const cancel = () => {
    result.interrupted = true;
    stop('Scheduled shell cancelled.');
  };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    await done.promise;
    for (const channel of ['stdout', 'stderr']) {
      result[channel] = Buffer.concat(chunks[channel]).toString('utf8');
    }
    return result;
  } finally {
    clearTimeout(escalation);
    signal?.removeEventListener('abort', cancel);
  }
}
