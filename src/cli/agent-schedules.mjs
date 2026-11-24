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
const DAY = 24 * HOUR;

export const MOST_NAME = 80;
export const MOST_COMMAND = 4000;
export const MOST_NOTE = 1000;
// A schedule repeats at most once a minute, and as seldom as its agent says.
export const SHORTEST_EVERY_MS = MINUTE;
// A schedule an agent gave no lifetime ends after this. One may live as long as its agent says, or have no end at all.
export const LIFETIME_MS = 2 * HOUR;
/** The lifetime an agent gives for a schedule with no end. */
export const NO_END = 'none';
export const TIMEOUT_MS = 2 * MINUTE;
export const SHORTEST_TIMEOUT_MS = 5000;
export const LONGEST_TIMEOUT_MS = 10 * MINUTE;
// How many times a schedule wakes its agent when the agent says nothing. It may say any number, or none for no cap.
export const DEFAULT_WAKES = 12;
/** A schedule's cap on wakes: its own, null for none, or the default for one stored before schedules had their own. */
export const wakeCap = schedule => (schedule.maxWakes === undefined ? DEFAULT_WAKES : schedule.maxWakes);
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
const DURATION = /^(?:(\d{1,4})d)?(?:(\d{1,5})h)?(?:(\d{1,6})m)?(?:(\d{1,7})s)?$/;
const LINE_MOST = 200;

export const isLive = schedule => LIVE_STATES.includes(schedule?.state);
const iso = time => new Date(time).toISOString();
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Milliseconds from a duration such as `90s`, `10m`, `2h`, `1h30m` or `3d`, or null when it is not one. */
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const match = text.trim().toLowerCase().match(DURATION);
  if (!match || !text.trim()) return null;
  const [days, hours, minutes, seconds] = match.slice(1).map(part => Number(part ?? 0));
  const ms = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  return ms > 0 ? ms : null;
}

/** A span in words: "3 days", "1 day 12 hours", "2 hours", "30 minutes", "1 hour 30 minutes", "90 seconds". */
export function spanWords(ms) {
  if (ms < MINUTE || ms % MINUTE) return plural(Math.round(ms / 1000), 'second');
  const days = Math.floor(ms / DAY), hours = Math.floor((ms % DAY) / HOUR), minutes = Math.round((ms % HOUR) / MINUTE);
  return [days && plural(days, 'day'), hours && plural(hours, 'hour'), minutes && plural(minutes, 'minute')].filter(Boolean).join(' ');
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

/** Why the words of a request do not hold up: its note, name and command, and options only a command takes. */
function wordsRefusal({ name, command, note, wakeOn, stopOn, pendingExit, timeoutMs }) {
  if (typeof note !== 'string' || !note.trim() || note.length > MOST_NOTE) {
    return `Give a note of what to do when it wakes you, in 1 to ${MOST_NOTE} characters.`;
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > MOST_NAME)) return `A name is at most ${MOST_NAME} characters.`;
  if (command !== undefined && (typeof command !== 'string' || !command.trim() || command.length > MOST_COMMAND)) {
    return `A command is 1 to ${MOST_COMMAND} characters. Leave it out for a plain wake.`;
  }
  const commandOnly = [wakeOn, stopOn, pendingExit, timeoutMs].some(option => option !== undefined);
  if (command === undefined && commandOnly) {
    return 'wakeOn, stopOn, pendingExit and timeoutMs are for a command. A plain wake always wakes you with its note.';
  }
  return null;
}

/**
 * How often, how long and how it wakes and stops, in milliseconds where it is a span: `{ every, lifetime, timeout }`
 * with `every` null for a schedule that fires once, or `{ refused }`.
 */
function timing({ every: everyAsked, expiresIn, timeoutMs, maxRuns, maxWakes, pendingExit, wakeOn, stopOn }) {
  const every = everyAsked === undefined ? null : parseDuration(everyAsked);
  const everyFits = every !== null && every >= SHORTEST_EVERY_MS && every % 1000 === 0;
  if (everyAsked !== undefined && !everyFits) return refuse('every is a duration from 1m, such as 2m, 6h or 1d.');

  // How long it lives is the agent's to say, with no most, and `none` gives it no end. Null is no end.
  const endless = typeof expiresIn === 'string' && expiresIn.trim().toLowerCase() === NO_END;
  const lifetime = expiresIn === undefined ? LIFETIME_MS : endless ? null : parseDuration(expiresIn);
  if (!endless && (lifetime === null || lifetime < MINUTE)) {
    return refuse(`expiresIn is a duration from 1m, such as 2h or 3d, or ${NO_END} for no end. Without it, it ends after 2h.`);
  }

  const timeout = timeoutMs === undefined ? TIMEOUT_MS : timeoutMs;
  if (!Number.isInteger(timeout) || timeout < SHORTEST_TIMEOUT_MS || timeout > LONGEST_TIMEOUT_MS) {
    return refuse('Give timeoutMs from 5000 to 600000, which is 5 seconds to 10 minutes.');
  }
  // As many runs as its agent caps it at, with no most, and no cap unless it says one.
  if (maxRuns !== undefined && (!Number.isInteger(maxRuns) || maxRuns < 1)) return refuse('maxRuns is a number of runs from 1. Without it, there is no cap on runs.');
  const capped = Number.isInteger(maxWakes) && maxWakes >= 1;
  if (maxWakes !== undefined && maxWakes !== NO_END && !capped) {
    return refuse(`maxWakes is a number of wakes from 1, or ${NO_END} for no cap. Without it, ${DEFAULT_WAKES}.`);
  }

  // As many codes as its agent names, each kept once, 0 too for a command that exits 0 while it waits.
  const exitCode = code => Number.isInteger(code) && code >= 0 && code <= 255;
  if (pendingExit !== undefined && (!Array.isArray(pendingExit) || !pendingExit.every(exitCode))) {
    return refuse('pendingExit is a list of exit codes from 0 to 255 that mean "not yet".');
  }
  if (wakeOn !== undefined && !WAKE_ON.includes(wakeOn)) return refuse(`wakeOn is one of ${WAKE_ON.join(', ')}.`);
  if (stopOn !== undefined && !STOP_ON.includes(stopOn)) return refuse(`stopOn is one of ${STOP_ON.join(', ')}.`);

  // What only a schedule that repeats can do.
  if (every === null) {
    if (wakeOn === 'change') return refuse('A schedule that fires once has nothing to compare with, so wakeOn change needs every.');
    if (stopOn !== undefined && stopOn !== 'never') return refuse('stopOn ends a schedule that repeats, so it needs every.');
    if (pendingExit?.length) return refuse('pendingExit says "not yet, look again", so it needs every.');
  }
  return { every, lifetime, timeout };
}

/** When it first fires: after `in`, at the next `at`, or at once for one that repeats. `{ first }` or `{ refused }`. */
function firstTime({ in: delayAsked, at }, every, now) {
  if (delayAsked !== undefined && at !== undefined) return refuse('Give in or at for its first time, not both.');
  if (delayAsked !== undefined) {
    const delay = parseDuration(delayAsked);
    if (delay === null) return refuse('Give in as a duration, such as 90s, 10m, 1h30m or 2d.');
    return { first: now + delay };
  }
  if (at !== undefined) {
    if (typeof at !== 'string' || !CLOCK.test(at)) return refuse('Give at as a 24-hour clock time, HH:MM, such as 19:30.');
    return { first: nextClock(at, now) };
  }
  // A repeating schedule runs at once, so a change is measured from now.
  if (every !== null) return { first: now };
  return refuse('Say when it fires: in (such as 10m) or at (HH:MM) for once, or every (such as 2m) to repeat.');
}

/** Why there is no room for another: the owner keeps the most one agent may, or hobkin the most it holds. */
function roomRefusal(live, owner) {
  const kept = live.filter(isLive);
  if (kept.filter(item => sameOwner(item.owner, owner)).length >= MOST_PER_OWNER) {
    return `You already keep ${MOST_PER_OWNER} live schedules, the most one agent may. Cancel one with hobkin_schedules first.`;
  }
  if (kept.length >= MOST_IN_HOME) return `hobkin already keeps ${MOST_IN_HOME} live schedules, the most it holds. Cancel one with hobkin_schedules first.`;
  return null;
}

/**
 * A schedule the agent asked for with `hobkin_schedule`, or why it is refused, in words the agent acts on. `owner` is
 * who asked, `cwd` the folder its command runs in, and `live` the live schedules hobkin keeps now, every owner's.
 * Answers `{ schedule }` or `{ refused }`.
 */
export function askedSchedule(request, { now, owner, cwd, live = [], id = randomBytes(4).toString('hex') }) {
  const asked = request ?? {};
  if (!OWNER_KINDS.includes(owner?.kind)) return refuse('Only the main chat, a durable hobkin or a hobkin session run may keep schedules.');
  const wordsRefused = wordsRefusal(asked);
  if (wordsRefused) return refuse(wordsRefused);

  const times = timing(asked);
  if (times.refused) return times;
  const { every, lifetime, timeout } = times;

  const fires = firstTime(asked, every, now);
  if (fires.refused) return fires;
  const { first } = fires;
  const until = lifetime === null ? null : now + lifetime;
  if (until !== null && first >= until) {
    return refuse(`It would first fire at ${clockWords(first)}, after its lifetime ends at ${clockWords(until)}. Give a sooner time, or a longer expiresIn.`);
  }

  const noRoom = roomRefusal(live, owner);
  if (noRoom) return refuse(noRoom);

  const { name, command, note, wakeOn, stopOn, pendingExit, maxRuns, maxWakes } = asked;
  const shell = command !== undefined;
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
      // Null is no cap on wakes.
      maxWakes: maxWakes === undefined ? DEFAULT_WAKES : maxWakes === NO_END ? null : maxWakes,
      lifetimeMs: lifetime,
      createdAt: iso(now),
      until: until === null ? null : iso(until),
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

/** Whether a schedule's lifetime has passed by `now`. One with no end (`until` null) never passes. */
const outlived = (schedule, now) => schedule.until != null && Date.parse(schedule.until) <= now;

/** A live schedule whose lifetime has passed, and is not running: its end. A running one ends after its run. */
export const isExpired = (schedule, now) => (schedule.state === 'waiting' || schedule.state === 'paused') && outlived(schedule, now);

/** Ends a schedule: `state` one of the ended states, `why` in plain words, `by` who ended it. */
/**
 * Ends a schedule: `state` one of the ended states, `why` in plain words, `by` who ended it. `why` is the words the
 * window shows the user, about the agent, or `{ user, agent }` when the agent reads it differently, about itself.
 */
export function ended(schedule, state, why, now, by = 'hobkin') {
  const { runNow: _, nextAt: __, ...rest } = schedule;
  const { user, agent } = typeof why === 'string' ? { user: why } : why;
  return { ...rest, state, endedWhy: user, ...(agent && agent !== user ? { toldWhy: agent } : {}), endedBy: by, endedAt: iso(now) };
}

/** Why a schedule ended, as its own agent reads it. */
export const endedWhyForAgent = schedule => schedule.toldWhy ?? schedule.endedWhy;

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
  // A code its agent named as "not yet" is pending first, 0 included.
  if (schedule.pendingExit?.includes(result.code)) return 'pending';
  return result.code === 0 ? 'passed' : 'failed';
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
  // What the next run is compared with. The first run of a command only sets it, and one that could not start keeps it.
  const baseline = shell && outcome !== 'error' ? fingerprint(code, output.stdout) : schedule.baseline;
  const changed = schedule.baseline !== undefined && baseline !== schedule.baseline;
  const wakeRuleSays = shell ? wakesBy(schedule.wakeOn, outcome, changed) : true;
  const cap = wakeCap(schedule);
  const wakes = outcome !== 'pending' && (cap === null || schedule.wakes < cap) && wakeRuleSays;

  let line;
  if (shell) line = outcome === 'error' ? String(result?.error ?? 'It could not start.').slice(0, LINE_MOST) : lastLine(output);
  const last = {
    at: iso(now),
    startedAt: iso(fired),
    outcome,
    ...(code === null ? {} : { exitCode: code }),
    woke: wakes,
    ...(line ? { line } : {}),
  };
  let next = {
    ...schedule,
    runs: schedule.runs + 1,
    wakes: schedule.wakes + (wakes ? 1 : 0),
    ...(baseline === undefined ? {} : { baseline }),
    ...(output ? { output } : {}),
    history: [...schedule.history, last].slice(-MOST_HISTORY),
  };
  delete next.runNow;

  const why = endWhy(next, outcome, now);
  if (why) next = ended(next, why.state, why.words, now);
  else next = { ...next, state: schedule.state === 'paused' ? 'paused' : 'waiting', nextAt: nextTime(schedule, fired, now) };

  const wake = wakes ? {
    kind: 'fired',
    outcome,
    ...(code === null ? {} : { exitCode: code }),
    ...(output ? { output: wakeOutput(output) } : {}),
    ...(line && outcome === 'error' ? { error: line } : {}),
  } : null;
  return { schedule: next, wake };
}

/**
 * Why a schedule ends after this run, or null while it goes on: its state and its `words`, the user's or, where the
 * agent reads them about itself, `{ user, agent }`.
 */
function endWhy(schedule, outcome, now) {
  const shell = schedule.command !== undefined;
  if (outcome === 'error') return { state: 'failed', words: `its command could not start: ${schedule.history.at(-1)?.line ?? 'no reason given'}` };
  if (schedule.every === undefined) {
    return { state: 'done', words: shell ? 'it ran once' : { user: 'it woke its agent once', agent: 'it woke you once' } };
  }
  if (shell && schedule.stopOn === 'success' && outcome === 'passed') return { state: 'done', words: 'its command passed' };
  if (shell && schedule.stopOn === 'failure' && failing(outcome)) return { state: 'done', words: 'its command failed' };
  const cap = wakeCap(schedule);
  if (cap !== null && schedule.wakes >= cap) {
    const most = `${plural(cap, 'time')}, its cap on wakes`;
    return { state: 'done', words: { user: `it woke its agent ${most}`, agent: `it woke you ${most}` } };
  }
  if (schedule.maxRuns !== undefined && schedule.runs >= schedule.maxRuns) return { state: 'done', words: `it ran its ${plural(schedule.maxRuns, 'run')}` };
  if (outlived(schedule, now)) return { state: 'expired', words: expiredWhy(schedule) };
  return null;
}

/** When a repeating schedule fires next: one `every` after it began, or after now when the run took longer than that. */
function nextTime(schedule, fired, now) {
  const step = schedule.every * 1000;
  return iso(fired + step > now ? fired + step : now + step);
}

/** A schedule as the window reads it (`AgentSchedule` in the client's `shared/protocol/schedules.ts`). */
export function scheduleView(schedule, ownerTitle) {
  const last = lastRunView(schedule.history.at(-1));
  const live = isLive(schedule);
  // Its next time shows while it can still come: not once it ended, not while it is held, not past its lifetime.
  const comes = live && schedule.state !== 'paused' && schedule.nextAt && !outlived(schedule, Date.parse(schedule.nextAt));
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
    ...(comes ? { nextAt: schedule.nextAt } : {}),
    // One with no end has no end time.
    ...(schedule.until == null ? {} : { until: schedule.until }),
    runs: schedule.runs,
    ...(schedule.maxRuns === undefined ? {} : { maxRuns: schedule.maxRuns }),
    wakes: schedule.wakes,
    // None with no cap on wakes.
    ...(wakeCap(schedule) === null ? {} : { maxWakes: wakeCap(schedule) }),
    ...(last ? { last } : {}),
    ...(live ? {} : { endedWhy: schedule.endedWhy }),
  };
}

/**
 * A run in the protocol's words. The window knows no `interrupted`, so a run a restart cut off shows as one that could
 * not finish, with the line that says why.
 */
function lastRunView(run) {
  if (!run) return undefined;
  if (run.outcome === 'interrupted') return { at: run.at, outcome: 'error', woke: false, line: 'It was cut off before it finished.' };
  return {
    at: run.at,
    outcome: run.outcome,
    ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
    woke: run.woke === true,
    ...(run.line ? { line: run.line } : {}),
  };
}

const WAKE_WORDS = {
  change: 'when its output changes',
  failure: 'when a run fails',
  success: 'when a run passes',
  always: 'after each run that is not pending',
  never: 'never: it only runs',
};

/** What an agent may do once it has scheduled: a run that waits ends its turn, one that cannot keeps working. */
function afterScheduling(owner, canWait, id) {
  if (owner.kind !== 'run') return 'You may end your turn: hobkin starts a turn for you when it wakes you.';
  if (canWait) {
    return 'End your turn now with one short line saying what you wait for. hobkin closes your process and starts you again on this session when it wakes you, or once more when it ends.';
  }
  return 'This run cannot wait, so your schedules end when this turn ends. Keep working while you need it: when it wakes you, '
    + `it reaches you in this turn as a message. Cancel it with hobkin schedule cancel ${id} once you have what you need.`;
}

/**
 * What `hobkin_schedule` answers its agent: what was made, when it fires, when it ends, when it wakes, and what to do
 * now. `canWait` is false for a run that cannot wait for it, such as a session run on Claude Code.
 */
export function scheduledText(schedule, owner, { canWait = true } = {}) {
  const repeats = schedule.every === undefined ? '' : `, then every ${spanWords(schedule.every * 1000)}`;
  const wakes = schedule.command === undefined ? 'with your note' : WAKE_WORDS[schedule.wakeOn];
  const then = afterScheduling(owner, canWait, schedule.id);
  const ends = schedule.until == null ? '. It has no end: cancel it when you are done.' : `, and it ends by ${clockWords(Date.parse(schedule.until))} at the latest.`;
  return `Scheduled "${schedule.name}" (id ${schedule.id}). It first fires at ${clockWords(Date.parse(schedule.nextAt))}${repeats}${ends} `
    + `hobkin wakes you ${wakes}, ${wakeCap(schedule) === null ? 'with no cap on wakes' : `${plural(wakeCap(schedule), 'time')} at most`}. ${then}`;
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
    ...(view.endedWhy === undefined ? {} : { endedWhy: endedWhyForAgent(schedule) }),
    ...(schedule.command === undefined ? {} : { wakeOn: schedule.wakeOn, stopOn: schedule.stopOn, ...(schedule.pendingExit.length ? { pendingExit: schedule.pendingExit } : {}), timeoutMs: schedule.timeoutMs }),
  };
}
