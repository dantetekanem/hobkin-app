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
