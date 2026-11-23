import { createHash, randomBytes } from 'node:crypto';

/**
 * The schedules an agent keeps for itself (the client's `_specs/056-agent-schedules`): a command hobkin runs on a timer,
 * or a plain timed wake, that brings the agent back only when its wake rule says so. One agent can watch a pull
 * request's checks and hear of them only when they turn red or finish. They are not the user's routines
 * (`schedules.mjs`), which start a fresh session each time.
 *
 * This module holds the rules as pure functions: what a schedule may be, its defaults and limits, when it is due, and
 * what one run's result means for waking, stopping and ending, with the reason kept in plain words. The store and the
 * tick that runs the commands are `agent-schedule-runner.mjs`.
 */

const MINUTE = 60000;
const HOUR = 60 * MINUTE;

export const MOST_NAME = 80;
export const MOST_COMMAND = 4000;
export const MOST_NOTE = 1000;
export const SHORTEST_EVERY_MS = MINUTE;
export const LONGEST_EVERY_MS = HOUR;
export const LIFETIME_MS = 2 * HOUR;
export const LONGEST_LIFETIME_MS = 24 * HOUR;
export const TIMEOUT_MS = 2 * MINUTE;
export const SHORTEST_TIMEOUT_MS = 5000;
export const LONGEST_TIMEOUT_MS = 10 * MINUTE;
export const MOST_RUNS = 1440;
export const MOST_WAKES = 12;
export const MOST_PENDING_CODES = 4;
export const MOST_PER_OWNER = 5;
export const MOST_IN_HOME = 20;
/** What is kept of each stream of a run's output, and what a wake carries of it. */
export const STREAM_BYTES = 8192;
export const WAKE_OUTPUT = 4000;
export const MOST_HISTORY = 10;
export const MOST_AT_ONCE = 3;
/** An ended schedule shows this long after it ended, and leaves the store a day after. */
export const SHOWN_AFTER_END_MS = HOUR;
export const KEPT_AFTER_END_MS = 24 * HOUR;

export const LIVE_STATES = Object.freeze(['waiting', 'running', 'paused']);
export const ENDED_STATES = Object.freeze(['done', 'cancelled', 'expired', 'failed']);
export const WAKE_ON = Object.freeze(['change', 'failure', 'success', 'always', 'never']);
export const STOP_ON = Object.freeze(['success', 'failure', 'never']);
export const OWNER_KINDS = Object.freeze(['main', 'hobkin', 'run']);

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DURATION = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,5})s)?$/;
const LINE_MOST = 200;

export const isLive = schedule => LIVE_STATES.includes(schedule?.state);
const iso = time => new Date(time).toISOString();
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Milliseconds from a duration such as `90s`, `10m`, `2h` or `1h30m`, or null when it is not one. */
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const match = text.trim().toLowerCase().match(DURATION);
  if (!match || !text.trim()) return null;
  const [hours, minutes, seconds] = match.slice(1).map(part => Number(part ?? 0));
  const ms = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return ms > 0 ? ms : null;
}

/** A span in words: "2 hours", "30 minutes", "1 hour 30 minutes", "90 seconds". */
export function spanWords(ms) {
  if (ms < MINUTE || ms % MINUTE) return plural(Math.round(ms / 1000), 'second');
  const hours = Math.floor(ms / HOUR), minutes = Math.round((ms % HOUR) / MINUTE);
  return [hours && plural(hours, 'hour'), minutes && plural(minutes, 'minute')].filter(Boolean).join(' ');
}

/** The next time the local clock reads `at` after `now`. */
function nextClock(at, now) {
  const [, hour, minute] = at.match(CLOCK).map(Number);
  const day = new Date(now);
  const on = offset => new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, hour, minute).getTime();
  return on(0) > now ? on(0) : on(1);
}

/** A name for a schedule the agent did not name: the first line of its command or note, cut at a word. */
function madeName(text) {
  const line = String(text).trim().split('\n', 1)[0].replace(/\s+/g, ' ');
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(' ');
  return `${(space >= 30 ? cut.slice(0, space) : cut).trim()}…`;
}

const refuse = refused => ({ refused });

/**
 * A schedule the agent asked for with `hobkin_schedule`, or why it is refused, in words the agent acts on. `owner` is
 * who asked, `cwd` the folder its command runs in, and `live` the live schedules hobkin keeps now, every owner's.
 * Answers `{ schedule }` or `{ refused }`.
 */
export function askedSchedule(asked, { now, owner, cwd, live = [], id = randomBytes(4).toString('hex') }) {
  const { name, command, note, wakeOn, stopOn, pendingExit, maxRuns, timeoutMs } = asked ?? {};
  if (!OWNER_KINDS.includes(owner?.kind)) return refuse('Only the main chat, a durable hobkin or a hobkin session run may keep schedules.');
  if (typeof note !== 'string' || !note.trim() || note.length > MOST_NOTE) return refuse(`Give a note of what to do when it wakes you, in 1 to ${MOST_NOTE} characters.`);
  if (name !== undefined && (typeof name !== 'string' || name.length > MOST_NAME)) return refuse(`A name is at most ${MOST_NAME} characters.`);
  if (command !== undefined && (typeof command !== 'string' || !command.trim() || command.length > MOST_COMMAND)) {
    return refuse(`A command is 1 to ${MOST_COMMAND} characters. Leave it out for a plain wake.`);
  }
  const shell = command !== undefined;
  if (!shell && (wakeOn !== undefined || stopOn !== undefined || pendingExit !== undefined || timeoutMs !== undefined)) {
    return refuse('wakeOn, stopOn, pendingExit and timeoutMs are for a command. A plain wake always wakes you with its note.');
  }

  const every = asked?.every === undefined ? null : parseDuration(asked.every);
  if (asked?.every !== undefined && (every === null || every < SHORTEST_EVERY_MS || every > LONGEST_EVERY_MS || every % 1000)) {
    return refuse('Give every as a duration from 1m to 1h, such as 2m or 15m.');
  }
  const lifetime = asked?.expiresIn === undefined ? LIFETIME_MS : parseDuration(asked.expiresIn);
  if (lifetime === null || lifetime < MINUTE || lifetime > LONGEST_LIFETIME_MS) {
    return refuse('A schedule lives at most 24 hours. Give expiresIn as a duration from 1m to 24h, such as 2h.');
  }
  const timeout = timeoutMs === undefined ? TIMEOUT_MS : timeoutMs;
  if (!Number.isInteger(timeout) || timeout < SHORTEST_TIMEOUT_MS || timeout > LONGEST_TIMEOUT_MS) {
    return refuse('Give timeoutMs from 5000 to 600000, which is 5 seconds to 10 minutes.');
  }
  if (maxRuns !== undefined && (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MOST_RUNS)) return refuse(`Give maxRuns from 1 to ${MOST_RUNS}.`);
  if (pendingExit !== undefined && (!Array.isArray(pendingExit) || pendingExit.length > MOST_PENDING_CODES
    || pendingExit.some(code => !Number.isInteger(code) || code < 1 || code > 255))) {
    return refuse(`Give pendingExit as up to ${MOST_PENDING_CODES} exit codes from 1 to 255 that mean "not yet".`);
  }
  if (wakeOn !== undefined && !WAKE_ON.includes(wakeOn)) return refuse(`wakeOn is one of ${WAKE_ON.join(', ')}.`);
  if (stopOn !== undefined && !STOP_ON.includes(stopOn)) return refuse(`stopOn is one of ${STOP_ON.join(', ')}.`);
  if (wakeOn === 'change' && every === null) return refuse('A schedule that fires once has nothing to compare with, so wakeOn change needs every.');
  if (stopOn !== undefined && stopOn !== 'never' && every === null) return refuse('stopOn ends a schedule that repeats, so it needs every.');
  if (pendingExit?.length && every === null) return refuse('pendingExit says "not yet, look again", so it needs every.');

  if (asked?.in !== undefined && asked?.at !== undefined) return refuse('Give in or at for its first time, not both.');
  let first;
  if (asked?.in !== undefined) {
    const delay = parseDuration(asked.in);
    if (delay === null || delay > LONGEST_LIFETIME_MS) return refuse('Give in as a duration up to 24h, such as 90s, 10m or 1h30m.');
    first = now + delay;
  } else if (asked?.at !== undefined) {
    if (typeof asked.at !== 'string' || !CLOCK.test(asked.at)) return refuse('Give at as a 24-hour clock time, HH:MM, such as 19:30.');
    first = nextClock(asked.at, now);
  } else if (every !== null) {
    // A repeating schedule runs at once, so a change is measured from now.
    first = now;
  } else {
    return refuse('Say when it fires: in (such as 10m) or at (HH:MM) for once, or every (such as 2m) to repeat.');
  }
  const until = now + lifetime;
  if (first >= until) {
    return refuse(`It would first fire at ${clockWords(first)}, after its lifetime ends at ${clockWords(until)}. Give a sooner time, or a longer expiresIn up to 24h.`);
  }

  const owned = live.filter(item => isLive(item) && sameOwner(item.owner, owner));
  if (owned.length >= MOST_PER_OWNER) return refuse(`You already keep ${MOST_PER_OWNER} live schedules, the most one agent may. Cancel one with hobkin_schedules first.`);
  if (live.filter(isLive).length >= MOST_IN_HOME) return refuse(`hobkin already keeps ${MOST_IN_HOME} live schedules, the most it holds. Cancel one with hobkin_schedules first.`);

  return {
    schedule: {
      id,
      owner: { kind: owner.kind, ...(owner.id ? { id: owner.id } : {}) },
      cwd,
      name: name?.trim() ? name.trim() : madeName(command ?? note),
      ...(shell ? { command } : {}),
      note: note.trim(),
      ...(every === null ? {} : { every: every / 1000 }),
      ...(shell ? {
        wakeOn: wakeOn ?? (every === null ? 'always' : 'change'),
        stopOn: stopOn ?? 'never',
        pendingExit: [...new Set(pendingExit ?? [])],
        timeoutMs: timeout,
      } : {}),
      ...(maxRuns === undefined ? {} : { maxRuns }),
      lifetimeMs: lifetime,
      createdAt: iso(now),
      until: iso(until),
      nextAt: iso(first),
      state: 'waiting',
      runs: 0,
      wakes: 0,
      history: [],
    },
  };
}

/** A time as the agent reads it: the weekday and the clock in the user's time zone. */
export const clockWords = time => new Date(time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const sameOwner = (left, right) => left?.kind === right?.kind && (left.kind === 'main' || left.id === right.id);

/** Whether a schedule should run now: a waiting one whose time has come, or one asked to run now that is not running. */
export const isDue = (schedule, now) => (schedule.state === 'waiting' && Date.parse(schedule.nextAt) <= now)
  || (schedule.runNow === true && (schedule.state === 'waiting' || schedule.state === 'paused'));

/** A live schedule whose lifetime has passed, and is not running: its end. A running one ends after its run. */
export const isExpired = (schedule, now) => (schedule.state === 'waiting' || schedule.state === 'paused') && Date.parse(schedule.until) <= now;

/** Ends a schedule: `state` one of the ended states, `why` in plain words, `by` who ended it. */
export function ended(schedule, state, why, now, by = 'hobkin') {
  const { runNow: _, nextAt: __, ...rest } = schedule;
  return { ...rest, state, endedWhy: why, endedBy: by, endedAt: iso(now) };
}

export const expiredWhy = (schedule, closed = false) => `its ${spanWords(schedule.lifetimeMs ?? LIFETIME_MS)} ran out${closed ? ' while hobkin was closed' : ''}`;

/**
 * What one run of a command came to, from `executeShell`'s result: `passed` on exit 0, `pending` on a code the agent
 * named as "not yet", `timed-out` when hobkin ended it at its timeout, `interrupted` when hobkin stopped or the
 * schedule was cancelled meanwhile, `error` when it could not start, and `failed` otherwise.
 */
export function runOutcome(schedule, result, { timedOut = false } = {}) {
  if (timedOut) return 'timed-out';
  if (result?.interrupted) return 'interrupted';
  if (result?.code === null || result?.code === undefined) return result?.killed ? 'failed' : 'error';
  if (result.code === 0) return 'passed';
  return schedule.pendingExit?.includes(result.code) ? 'pending' : 'failed';
}

const failing = outcome => outcome === 'failed' || outcome === 'timed-out' || outcome === 'error';

/** The end of each stream, at most `STREAM_BYTES` of it, cut on a character. */
export function keptStream(text) {
  const bytes = Buffer.from(String(text ?? ''), 'utf8');
  if (bytes.length <= STREAM_BYTES) return bytes.toString('utf8');
  return bytes.subarray(bytes.length - STREAM_BYTES).toString('utf8').replace(/^�+/, '');
}

const lastLine = ({ stdout, stderr }) => {
  const lines = `${stdout ?? ''}\n${stderr ?? ''}`.split('\n').map(line => line.trim()).filter(Boolean);
  const line = lines.at(-1) ?? '';
  return line.length > LINE_MOST ? `${line.slice(0, LINE_MOST - 1)}…` : line;
};

/** What a wake carries of the output: its end, up to `WAKE_OUTPUT` characters, with what went to stderr marked. */
export function wakeOutput({ stdout, stderr }) {
  const text = [stdout?.trimEnd(), stderr?.trim() ? `[stderr]\n${stderr.trimEnd()}` : ''].filter(Boolean).join('\n');
  return text.length > WAKE_OUTPUT ? `…${text.slice(-(WAKE_OUTPUT - 1))}` : text;
}

const fingerprint = (code, stdout) => createHash('sha256').update(`${code}\n${stdout ?? ''}`).digest('hex');

/** Whether a settled run wakes the agent, by its `wakeOn`. `changed` says whether its output differs from the last one. */
function wakesBy(wakeOn, outcome, changed) {
  if (wakeOn === 'always') return true;
  if (wakeOn === 'success') return outcome === 'passed';
  if (wakeOn === 'failure') return failing(outcome);
  if (wakeOn === 'change') return changed;
  return false;
}

/**
 * What one firing of a schedule means, `fired` being when it began and `result` the command's result (none for a plain
 * wake). Answers the schedule as it is after this run, and the wake for its agent, or null. A pending run wakes nobody,
 * stops nothing and is no failure. An interrupted run counts for nothing, and the schedule fires again at once. The
 * caps, `stopOn` and the lifetime end it, with the reason kept.
 */
export function afterRun(schedule, { fired, result = null, timedOut = false }, now) {
  const shell = schedule.command !== undefined;
  const outcome = shell ? runOutcome(schedule, result, { timedOut }) : 'passed';
  if (outcome === 'interrupted') {
    const history = [...schedule.history, { at: iso(now), outcome, line: 'It was cut off before it finished.' }].slice(-MOST_HISTORY);
    return { schedule: { ...schedule, state: 'waiting', nextAt: iso(now), history }, wake: null };
  }

  const output = shell ? { stdout: keptStream(result?.stdout), stderr: keptStream(result?.stderr) } : null;
  const code = shell ? result?.code ?? null : null;
  const settledAt = shell && outcome !== 'error' ? fingerprint(code, output.stdout) : schedule.baseline;
  // The first run of a command only sets what to compare with.
  const changed = schedule.baseline !== undefined && settledAt !== schedule.baseline;
  const wakes = outcome !== 'pending' && schedule.wakes < MOST_WAKES && (shell ? wakesBy(schedule.wakeOn, outcome, changed) : true);
  const line = shell ? (outcome === 'error' ? String(result?.error ?? 'It could not start.').slice(0, LINE_MOST) : lastLine(output)) : undefined;
  const last = {
    at: iso(now), startedAt: iso(fired), outcome,
    ...(code === null ? {} : { exitCode: code }),
    woke: wakes,
    ...(line ? { line } : {}),
  };
  let next = {
    ...schedule,
    runs: schedule.runs + 1,
    wakes: schedule.wakes + (wakes ? 1 : 0),
    ...(settledAt === undefined ? {} : { baseline: settledAt }),
    ...(output ? { output } : {}),
    history: [...schedule.history, last].slice(-MOST_HISTORY),
  };
  delete next.runNow;

  const why = endWhy(next, outcome, now);
  if (why) next = ended(next, why.state, why.text, now);
  else next = { ...next, state: schedule.state === 'paused' ? 'paused' : 'waiting', nextAt: nextTime(schedule, fired, now) };

  const wake = wakes ? {
    kind: 'fired', outcome,
    ...(code === null ? {} : { exitCode: code }),
    ...(output ? { output: wakeOutput(output) } : {}),
    ...(line && outcome === 'error' ? { error: line } : {}),
  } : null;
  return { schedule: next, wake };
}

/** Why a schedule ends after this run, or null while it goes on. */
function endWhy(schedule, outcome, now) {
  const shell = schedule.command !== undefined;
  if (outcome === 'error') return { state: 'failed', text: `its command could not start: ${schedule.history.at(-1)?.line ?? 'no reason given'}` };
  if (schedule.every === undefined) return { state: 'done', text: shell ? 'it ran once' : 'it woke you once' };
  if (shell && schedule.stopOn === 'success' && outcome === 'passed') return { state: 'done', text: 'its command passed' };
  if (shell && schedule.stopOn === 'failure' && failing(outcome)) return { state: 'done', text: 'its command failed' };
  if (schedule.wakes >= MOST_WAKES) return { state: 'done', text: `it woke you ${MOST_WAKES} times, the most one schedule may` };
  if (schedule.maxRuns !== undefined && schedule.runs >= schedule.maxRuns) return { state: 'done', text: `it ran its ${plural(schedule.maxRuns, 'run')}` };
  if (Date.parse(schedule.until) <= now) return { state: 'expired', text: expiredWhy(schedule) };
  return null;
}

/** When a repeating schedule fires next: one `every` after it began, or after now when the run took longer than that. */
function nextTime(schedule, fired, now) {
  const step = schedule.every * 1000;
  return iso(fired + step > now ? fired + step : now + step);
}

/** A schedule as the window reads it (`AgentSchedule` in the client's `shared/protocol/schedules.ts`). */
export function scheduleView(schedule, ownerTitle) {
  const last = schedule.history.at(-1);
  const shown = last?.outcome === 'interrupted'
    ? { at: last.at, outcome: 'error', woke: false, line: 'It was cut off before it finished.' }
    : last && { at: last.at, outcome: last.outcome, ...(last.exitCode === undefined ? {} : { exitCode: last.exitCode }), woke: last.woke === true, ...(last.line ? { line: last.line } : {}) };
  const live = isLive(schedule);
  return {
    id: schedule.id,
    owner: { ...schedule.owner },
    ...(ownerTitle ? { ownerTitle } : {}),
    name: schedule.name,
    does: schedule.command === undefined ? 'wake' : 'shell',
    ...(schedule.command === undefined ? {} : { command: schedule.command }),
    note: schedule.note,
    ...(schedule.every === undefined ? {} : { every: schedule.every }),
    state: schedule.state,
    ...(live && schedule.state !== 'paused' && schedule.nextAt && Date.parse(schedule.nextAt) < Date.parse(schedule.until) ? { nextAt: schedule.nextAt } : {}),
    until: schedule.until,
    runs: schedule.runs,
    ...(schedule.maxRuns === undefined ? {} : { maxRuns: schedule.maxRuns }),
    wakes: schedule.wakes,
    maxWakes: MOST_WAKES,
    ...(shown ? { last: shown } : {}),
    ...(live ? {} : { endedWhy: schedule.endedWhy }),
  };
}

const WAKE_WORDS = {
  change: 'when its output changes', failure: 'when a run fails', success: 'when a run passes', always: 'after each run that is not pending', never: 'never: it only runs',
};

/** What `hobkin_schedule` answers its agent: what was made, when it fires, when it ends, when it wakes, and what to do now. */
export function scheduledText(schedule, owner) {
  const repeats = schedule.every === undefined ? '' : `, then every ${spanWords(schedule.every * 1000)}`;
  const wakes = schedule.command === undefined ? 'with your note' : WAKE_WORDS[schedule.wakeOn];
  const then = owner.kind === 'run'
    ? 'End your turn now with one short line saying what you wait for. hobkin closes your process and starts you again on this session when it wakes you, or once more when it ends.'
    : 'You may end your turn: hobkin starts a turn for you when it wakes you.';
  return `Scheduled "${schedule.name}" (id ${schedule.id}). It first fires at ${clockWords(Date.parse(schedule.nextAt))}${repeats}, and it ends by ${clockWords(Date.parse(schedule.until))} at the latest. `
    + `hobkin wakes you ${wakes}, ${MOST_WAKES} times at most. ${then}`;
}

/** What a run that waited on its schedules is told when hobkin starts it once more after they all ended without a word. */
export const SCHEDULES_GONE = 'Your schedules have all ended and none of them woke you since you waited. Carry on from where you left off: look once more at what they watched if it still matters, then end as any run ends, with your report.';

/** One wake as its agent reads it in a `<hobkin-schedule>` block, or in the main chat's `<hobkin-wake>`. */
export const wakeForAgent = wake => ({
  id: wake.scheduleId,
  name: wake.name,
  note: wake.note,
  what: wake.kind,
  at: wake.at,
  ...Object.fromEntries(['outcome', 'exitCode', 'output', 'error', 'wakesLeft', 'until', 'endedWhy']
    .filter(key => wake[key] !== undefined).map(key => [key, wake[key]])),
});

/**
 * Wakes made to fit in `most` characters once `wrap` puts them in their block: each output loses its start, the oldest
 * wakes' first, as far as it must. Answers the wrapped text.
 */
export function fittedWakes(wakes, wrap, most = Infinity) {
  const shown = wakes.map(wakeForAgent);
  let text = wrap(shown);
  for (const wake of shown) {
    if (text.length <= most) break;
    if (!wake.output) continue;
    const keep = Math.max(0, wake.output.length - (text.length - most) - 1);
    wake.output = keep ? `…${wake.output.slice(-keep)}` : '';
    text = wrap(shown);
  }
  return text;
}

/** The block a durable hobkin's turn or a run starts with, or is steered, when its schedules wake it. */
export const scheduleWakeBlock = (wakes, most) => fittedWakes(wakes,
  shown => `<hobkin-schedule>\n${JSON.stringify({ schedules: shown }).replaceAll('</', '<\\/')}\n</hobkin-schedule>`, most);

/** A schedule as its own agent reads it in a tool's answer: what it does, where it stands and what it has left. */
export function scheduleForAgent(schedule) {
  const view = scheduleView(schedule);
  delete view.owner;
  return {
    ...view,
    ...(schedule.command === undefined ? {} : { wakeOn: schedule.wakeOn, stopOn: schedule.stopOn, ...(schedule.pendingExit.length ? { pendingExit: schedule.pendingExit } : {}), timeoutMs: schedule.timeoutMs }),
  };
}
