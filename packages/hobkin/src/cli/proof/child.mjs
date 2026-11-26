import { spawn } from 'node:child_process';

/**
 * A tool the proof process runs, Java or tlapm. Its output streams to the callbacks as it comes, and `stop` ends it:
 * asked with SIGTERM, then killed with SIGKILL when it has not gone within `graceMs`.
 */
export function startProcess(command, args, { cwd, env, onStdout = () => {}, onStderr = () => {} } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8').on('data', onStdout);
  child.stderr.setEncoding('utf8').on('data', onStderr);
  let exited = false;
  const done = new Promise(resolve => {
    child.once('error', error => {
      exited = true;
      resolve({ code: null, signal: null, error });
    });
    child.once('close', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  return {
    pid: child.pid,
    done,
    async stop(graceMs) {
      if (exited) return done;
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, graceMs);
      const ended = await done;
      clearTimeout(timer);
      return ended;
    },
  };
}
