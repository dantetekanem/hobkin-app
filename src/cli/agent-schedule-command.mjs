import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { askRunning, requestFolder, TURN_HOME } from './hobkin-tell.mjs';
import { SCHEDULE_TOKEN } from './agent-schedule-runner.mjs';

/**
 * `hobkin schedule`: how a run on Claude Code, which has no tool bridge, keeps schedules for itself
 * (056-agent-schedules), as the `hobkin_schedule` and `hobkin_schedules` tools do for a run on Pi. It runs in the run's
 * own shell, another process, so it hands the request to the running hobkin as a file in its home and waits for the
 * answer, the way `hobkin tell` does. Who asks is never typed: the host gives the run's process a token of its own,
 * and hobkin names the run from it (`HobkinApplication.takeScheduleRequests`).
 */

/** The environment a run on Claude Code carries for this: its token, and the home of the hobkin that runs it. */
export const SCHEDULE_ENVIRONMENT = Object.freeze({ token: SCHEDULE_TOKEN, home: TURN_HOME });
export const SCHEDULE_REQUESTS = 'schedule-requests';

const TOKEN = /^[0-9a-f]{32}$/;
const ACTIONS = ['list', 'cancel', 'pause', 'resume', 'run'];
const MOST_INPUT = 65536;
export const SCHEDULE_USAGE = 'Usage: hobkin schedule [list | make | cancel <id> | pause <id> | resume <id> | run <id>]. make reads the schedule as JSON on standard input, with the fields hobkin_schedule takes: note, and command, in or at, every, wakeOn, stopOn, pendingExit, maxRuns, expiresIn, timeoutMs and name.';
const OUTSIDE = "Nothing was done: hobkin schedule works only inside a run hobkin started, which tells hobkin who is asking.";

async function readAll(input) {
  const pieces = [];
  let bytes = 0;
  for await (const piece of input) {
    pieces.push(Buffer.from(piece));
    bytes += piece.length;
    if (bytes > MOST_INPUT) throw Error('A schedule is at most 64 KB of JSON.');
  }
  return Buffer.concat(pieces).toString('utf8');
}

/** The folder `hobkin schedule` writes to. */
export const scheduleRequests = root => requestFolder(root, SCHEDULE_REQUESTS);

/**
 * Whether `hobkin schedule` has ever asked in this home: its folder exists once it has. The running hobkin answers what
 * is in it on every tick from then on, a token it no longer holds included, so no command waits out its answer time.
 */
export const scheduleAskedHere = root => existsSync(join(root, 'runtime', SCHEDULE_REQUESTS));

/**
 * `hobkin schedule [list | make | cancel <id> | pause <id> | resume <id> | run <id>]`. It answers with what the running
 * hobkin said, and throws its refusal.
 */
export async function runScheduleCommand(root, args, { env = process.env, input = process.stdin, waitMs } = {}) {
  const token = env[SCHEDULE_TOKEN];
  if (typeof token !== 'string' || !TOKEN.test(token)) throw Error(OUTSIDE);
  const [action = 'list', id, ...rest] = args;
  let request;
  if (action === 'make' && id === undefined) {
    let params;
    try {
      params = JSON.parse(await readAll(input));
    } catch (error) {
      throw Error(/64 KB/.test(error.message) ? error.message : `Give the schedule as one JSON object on standard input. ${SCHEDULE_USAGE}`);
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error(`Give the schedule as one JSON object on standard input. ${SCHEDULE_USAGE}`);
    request = { token, action, params };
  } else if (action === 'list' && id === undefined) {
    request = { token, action };
  } else if (ACTIONS.includes(action) && typeof id === 'string' && id && !rest.length) {
    request = { token, action, id };
  } else {
    throw Error(SCHEDULE_USAGE);
  }
  return askRunning(root, SCHEDULE_REQUESTS, request, { waitMs });
}
