import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

/**
 * Pi's code tool (`execute`, codemode) aborts the controller of every call still out when a script finishes
 * (`Execution.finish` in Pi's `execute-*.js` chunk), and that abort reason can escape uncaught, which ends Pi with exit 1
 * after the script's result was already in hand. Pi 1.5.2 and 1.6.0 both do this.
 */
const ABORTED_BY_FINISH = /at AbortController\.abort \([^\n]*\n\s+at Execution\.finish \([^\n]*\/execute-[\w-]+\.js:/;

/** Whether an error is exactly that abort: an AbortError made by `Execution.finish` aborting its controller. */
export const isCodeToolAbort = error => error?.name === 'AbortError' && ABORTED_BY_FINISH.test(String(error?.stack ?? ''));

/** The path Pi loads with `--extension` for every hobkin run with tools (`namingExtensions` in `harnesses.mjs`). */
export const codeToolGuardExtension = fileURLToPath(import.meta.url);

const GUARDED = Symbol.for('hobkin.code-tool-abort-guard');

/**
 * Keeps that abort from ending the Pi process, once per process however many extensions ask. Only `uncaughtException`
 * is listened to: with no `unhandledRejection` listener, Node raises an unhandled rejection as an uncaught exception, so
 * rejections keep their own behavior. Any other error ends Pi as Node would, printed and with exit 1, unless Pi or
 * another extension handles uncaught errors itself, in which case it is left to them.
 */
export function guardCodeToolAbort(target = process) {
  if (target[GUARDED]) return false;
  target[GUARDED] = true;
  target.on('uncaughtException', error => {
    if (isCodeToolAbort(error)) {
      target.stderr.write("hobkin: Pi's code tool threw its own abort after a script finished; ignored so the run goes on.\n");
      return;
    }
    if (target.listenerCount('uncaughtException') > 1) return;
    target.stderr.write(`${inspect(error)}\n`);
    target.exit(1);
  });
  return true;
}

/** Loaded into each hobkin run's Pi, and installed by hobkin's other extensions, so every Pi it starts has the guard. */
export default function codeToolGuard() {
  guardCodeToolAbort();
}
