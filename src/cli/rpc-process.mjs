import { spawn } from 'node:child_process';

export const clean = value => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

const live = new Set();
let exitHook = false;
const signalGroup = (child, signal) => {
  if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
  else child.kill(signal);
};
const reapAtExit = () => {
  for (const child of live) {
    try {
      signalGroup(child, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
};

/**
 * One Pi RPC child in its own process group. Records are LF-delimited JSON, and one over maxKeptBytes is left out.
 * What is left out adds up, and passing maxRecordBytes stops the child. A reply is never left out, because something waits for it.
 * It never retries; failure, cancellation and exit end every waiter, and only this handle stops the child.
 */
export function startRpcProcess({
  command, args, cwd, env, ipc = false, onControl = () => {}, spawnProcess = spawn, signalProcess = signalGroup, maxRecordBytes = 1048576, maxKeptBytes = maxRecordBytes, name = 'Harness', onRecord = () => {}, onFail = () => {},
}) {
  const child = spawnProcess(command, args, {
    cwd,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])],
    env,
  });
  live.add(child);
  if (!exitHook) {
    exitHook = true;
    process.once('exit', reapAtExit);
  }
  const pending = new Map();
  const closed = Promise.withResolvers();
  const label = name.toLowerCase();
  let serial = 0;
  let parts = [];
  let size = 0;
  let leftOut = 0;
  let leavingOut = false;
  let stderr = '';
  let failure;
  let exited = false;
  let stopping = false;
  let killTimer;
  let graceTimer;
  const kill = signal => {
    if (exited) return;
    try {
      signalProcess(child, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') failure ??= error;
    }
  };
  const terminate = () => {
    if (stopping || exited) return;
    stopping = true;
    kill('SIGTERM');
    if (!exited) {
      killTimer = setTimeout(() => kill('SIGKILL'), 500);
      killTimer.unref();
    }
  };
  const fail = error => {
    failure ??= error;
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
    onFail(failure);
    terminate();
  };
  const write = record => child.stdin.write(`${JSON.stringify(record)}\n`, error => {
    if (error && !stopping) fail(error);
  });
  const request = (type, data = {}, onResponse, onRequest) => {
    if (failure || exited || !child.stdin.writable) return Promise.reject(failure ?? Error(`${name} exited.`));
    const id = `hobkin-${++serial}`;
    const waiter = Promise.withResolvers();
    try {
      onRequest?.(id);
    } catch (error) {
      return Promise.reject(error);
    }
    pending.set(id, { ...waiter, onResponse });
    write({ ...data, id, type });
    return waiter.promise;
  };
  const accept = record => {
    if (!record || typeof record !== 'object' || typeof record.type !== 'string') throw Error(`Invalid ${label} event.`);
    if (record.type === 'response') {
      const waiter = pending.get(record.id);
      if (waiter) {
        pending.delete(record.id);
        if (record.success) {
          waiter.onResponse?.(record.data);
          waiter.resolve(record.data);
        } else {
          waiter.reject(Object.assign(Error(clean(record.error || `${name} command failed.`)), { commandRejected: true }));
        }
      }
    }
    onRecord(record);
  };
  const flush = bytes => {
    const line = bytes.toString('utf8').replace(/\r$/, '');
    if (line.trim()) accept(JSON.parse(line));
  };
  const exceeded = () => Error(`${name} output record exceeded its byte limit.`);
  const startLeavingOut = () => {
    if (Buffer.concat(parts).subarray(0, 64).includes('"type":"response"')) throw exceeded();
    leavingOut = true;
    leftOut += size;
    parts = [];
  };
  // Bound each record, not the stream; a long healthy run emits many records.
  const read = chunk => {
    let start = 0;
    while (!failure) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      size += end - start;
      if (leavingOut) leftOut += end - start;
      else if (end > start) parts.push(chunk.subarray(start, end));
      if (size > maxKeptBytes && !leavingOut) startLeavingOut();
      if (leftOut > maxRecordBytes) throw exceeded();
      if (newline === -1) return;
      const record = leavingOut ? null : Buffer.concat(parts, size);
      parts = [];
      size = 0;
      leavingOut = false;
      if (record) flush(record);
      start = newline + 1;
    }
  };
  child.stdout.on('data', chunk => {
    if (failure) return;
    try {
      read(chunk);
    } catch (error) {
      fail(Error(`Invalid ${label} output: ${error.message}`));
    }
  });
  child.stdout.on('end', () => {
    if (failure) return;
    try {
      if (size && !leavingOut) flush(Buffer.concat(parts, size));
      parts = [];
      size = 0;
    } catch (error) {
      fail(error);
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + clean(chunk)).slice(-2000); });
  child.stdin.on('error', error => { if (!stopping) fail(error); });
  child.on('error', fail);
  if (ipc) child.on('message', record => {
    if (failure || exited) return;
    try {
      if (Buffer.byteLength(JSON.stringify(record)) > 65536) throw Error('Main child control record exceeded its byte limit.');
      onControl(record);
    } catch (error) { fail(error); }
  });
  // Exit revokes PID/PGID authority; only close confirms captured stdio closure.
  const markExited = () => {
    exited = true;
    live.delete(child);
    clearTimeout(killTimer);
    clearTimeout(graceTimer);
  };
  child.on('exit', markExited);
  child.on('close', (code, signal) => {
    markExited();
    const error = failure ?? Error(`${name} exited before completion (${code ?? signal}). ${stderr}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    closed.resolve({ code, signal, error });
  });
  return {
    pid: child.pid,
    request,
    sendControl(record) {
      if (!ipc || failure || exited || !child.connected) throw failure ?? Error('Main child control channel is unavailable.');
      if (Buffer.byteLength(JSON.stringify(record)) > 65536) throw Error('Main child control record exceeded its byte limit.');
      child.send(record, error => { if (error) fail(error); });
    },
    send: record => { if (!failure && !exited && child.stdin.writable) write(record); },
    fail,
    terminate,
    // A signal request is not a close receipt, nor proof about detached tool groups.
    force() {
      if (exited) return;
      stopping = true;
      clearTimeout(graceTimer);
      clearTimeout(killTimer);
      const error = Object.assign(Error(`${name} interrupted by user force.`), { interrupted: true });
      failure ??= error;
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      kill('SIGKILL');
    },
    /** Closing stdin asks Pi to dispose its runtime and exit; the signals only follow a missed grace period. */
    shutdown(graceMs = 5000) {
      if (!exited && !stopping) {
        child.stdin.end();
        graceTimer = setTimeout(terminate, graceMs);
        graceTimer.unref();
      }
      return closed.promise;
    },
    closed: closed.promise,
    get failure() { return failure; },
    get exited() { return exited; },
    get stderr() { return stderr; },
  };
}
