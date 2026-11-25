import { existsSync } from 'node:fs';
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

/** Whether a run's error says its Pi exited on that abort, from the stack Pi printed (`rpc-process.mjs` keeps its tail). */
export const crashedInCodeTool = error => /exited before completion/.test(error ?? '')
  && /This operation was aborted/.test(error) && ABORTED_BY_FINISH.test(error);

const RESTART_NOTE = 'Your previous attempt at this task stopped because Pi crashed in its code tool, and hobkin restarted you on the same session. Carry on from where you stopped and finish the task.';

/**
 * A run whose Pi still exits on that abort (a Pi without the guard, or another way out) starts again once, on its own
 * session file, told why: a saved session already holds the task, and one not saved yet is given it again. Its result
 * says it was restarted (`restarted`), and its cost still counts from the session it began. A run the user stopped, any
 * other failure and a process started ahead of its turn are never restarted. The run's process handle (`onControl`) and
 * its inbox (`onReady`) are each given once and reach whichever attempt is running.
 */
export const restartingAfterCodeToolCrash = run => async (request, options = {}) => {
  if (request.warm === true) return run(request, options);
  let current, send;
  const closed = Promise.withResolvers();
  const handle = {
    closed: closed.promise,
    force: () => current.force(),
    terminate: () => current.terminate(),
    changeBinding: change => current.changeBinding(change),
    commands: () => current.commands(),
  };
  const attempt = asked => run(asked, {
    ...options,
    // Binding can force the process at once (`bindHarness`), so the handle reaches this attempt before it is given.
    ...(options.onControl && { onControl: child => {
      const first = !current;
      current = child;
      if (first) options.onControl(handle);
    } }),
    ...(options.onReady && { onReady: given => {
      if (!send) options.onReady((...message) => send(...message));
      send = given;
    } }),
  });
  try {
    const first = await attempt(request);
    if (first?.status !== 'failed' || !crashedInCodeTool(first.error) || request.signal?.aborted) return first;
    const { images: _images, ...rest } = request;
    const again = await attempt(existsSync(request.sessionFile)
      ? { ...rest, prompt: RESTART_NOTE }
      : { ...request, prompt: `${RESTART_NOTE}\n\n${request.prompt}` });
    return { ...again, freshSession: first.freshSession, restarted: { error: first.error } };
  } finally {
    Promise.resolve(current?.closed).then(closed.resolve, closed.resolve);
  }
};
