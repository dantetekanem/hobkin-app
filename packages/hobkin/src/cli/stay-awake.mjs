import { spawn } from 'node:child_process';

/**
 * A Mac that sleeps misses its checks, so it stays awake for as long as this process lives. `-w` ends it when Hobkin ends,
 * however that happens. There is no `-d`, so the display still dims and sleeps as usual.
 */
export function stayAwake({ platform = process.platform, pid = process.pid, run = spawn } = {}) {
  if (platform !== 'darwin') return;

  const child = run('caffeinate', ['-i', '-s', '-w', String(pid)], { stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/**
 * Holds the Mac awake until the answer is called: a Ludicrous run holds it while it builds and lets go at Stop or done (076). `-w` lets go
 * too when hobkin ends, however that happens. The live app's host holds the Mac awake for its whole life anyway (`stayAwake`).
 */
export function holdAwake({ platform = process.platform, pid = process.pid, run = spawn } = {}) {
  if (platform !== 'darwin') return () => {};

  const child = run('caffeinate', ['-i', '-w', String(pid)], { stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return () => {
    try {
      child.kill();
    } catch {
      // Gone already.
    }
  };
}
