/**
 * A run that waits (053-run-waits): its agent calls `hobkin_wait` (`wait-extension.mjs`), ends its turn, and the run
 * ends as `waiting`, holding no process and no place. At its time hobkin starts it again on its own session with its
 * note. This module holds the rules and the words: what a wait may ask, what the agent hears, and the follow-up for a
 * run that stopped on one of Pi's own waits instead.
 */

/** A run's status while it waits. Not finished, not failed, and no report yet. */
export const WAITING = 'waiting';
export const MOST_WAITS = 12;
const LONGEST_MS = 24 * 3600000;
const MOST_NOTE = 1000;
const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** Pi's own ways to wait, from the user's packages: pi-solid-tasks and @jl1990/pi-scheduler. Both need Pi to keep running. */
export const PI_WAIT_TOOLS = Object.freeze(['task_wait', 'schedule_task']);

const FINISH = 'finish what you can now and end your turn with your report, saying what is left to look at later';
const minutesWord = count => `${count} minute${count === 1 ? '' : 's'}`;
const iso = time => new Date(time).toISOString();

/** A time as the agent reads it: the weekday and the clock in the user's time zone. */
export const clockTime = time => new Date(time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** The next time the local clock reads `at` after `now`. */
function nextClock(at, now) {
  const [, hour, minute] = at.match(CLOCK).map(Number);
  const day = new Date(now);
  const on = offset => new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, hour, minute).getTime();
  return on(0) > now ? on(0) : on(1);
}

/**
 * The host's answer to a `hobkin_wait` call: `{ wait, text }` with when and why, or `{ refused }` with what the agent
 * should do instead. `waits` is how many times the run has waited, and a run that cannot wait has none. A run's agents
 * live in its process, so a run with agents out cannot wait yet.
 */
export function askedWait({ minutes, at, note } = {}, { now, waits, agentsOut = 0 }) {
  if (!Number.isInteger(waits)) {
    return { refused: `This run cannot wait: hobkin ends it when this turn ends. So ${FINISH}.` };
  }
  if (waits >= MOST_WAITS) {
    return { refused: `This run has waited ${MOST_WAITS} times, the most one run may. Do not wait again: ${FINISH}.` };
  }
  if (agentsOut > 0) {
    return { refused: "Your agents are still working, and they live in this run's process, so it cannot wait yet. Their reports come to you here: wait after they report." };
  }
  if (typeof note !== 'string' || !note.trim() || note.length > MOST_NOTE) {
    return { refused: `Give a note of what to do when the time comes, in at most ${MOST_NOTE} characters.` };
  }

  const { until, refused } = timeAsked({ minutes, at }, now);
  if (refused) return { refused };

  const wait = { until: iso(until), note: note.trim(), askedAt: iso(now) };
  const minutesAway = minutesWord(Math.round((until - now) / 60000));
  const text = `hobkin will start you again on this session at ${clockTime(until)}, ${minutesAway} from now, and give you your note. `
    + 'End your turn now with one short line saying you are waiting and until when. Do not sleep, poll or schedule anything for it.';
  return { wait, text };
}

/** When a wait ends, from either its minutes or its clock time, within the longest wait: `{ until }` or `{ refused }`. */
function timeAsked({ minutes, at }, now) {
  if ((minutes === undefined) === (at === undefined)) return { refused: 'Give either the minutes to wait or a clock time to carry on at.' };

  let until;
  if (minutes !== undefined) {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1) return { refused: 'Give the minutes to wait as a number from 1 to 1440.' };
    until = now + Math.round(minutes * 60000);
  } else {
    if (typeof at !== 'string' || !CLOCK.test(at)) return { refused: 'Give the clock time as 24-hour HH:MM, such as 19:30.' };
    until = nextClock(at, now);
  }

  if (until - now > LONGEST_MS) return { refused: `A wait is at most 24 hours. Ask for less, or ${FINISH}.` };
  return { until };
}

/** What a run that waited is told when hobkin starts it again: the time it asked for, its note and how long it has been. */
export function resumeNote(wait, now) {
  const since = Math.max(0, Math.round((now - Date.parse(wait.askedAt)) / 60000));
  return `You asked hobkin to wait until ${clockTime(Date.parse(wait.until))} and then carry on with this note:\n\n${wait.note}\n\n`
    + `hobkin started you again on your own session ${minutesWord(since)} after you asked. Carry on from your note. `
    + 'End as any run ends, with your report, or wait again with hobkin_wait if the work still needs it.';
}

/**
 * The one follow-up for a run that stopped on Pi's own wait. Those wait inside the Pi process, which hobkin closes when
 * the turn ends, so nothing would wake the agent. A run that can wait is pointed at `hobkin_wait`, and one that cannot is
 * told to finish.
 */
export function piWaitNote(tools, canWait) {
  const instead = canWait
    ? 'Then, to carry on at a time, call hobkin_wait with the minutes or a clock time and a note of what to do then, and end your turn saying you are waiting. If nothing needs to wait, finish now with your report.'
    : `This run cannot wait, so ${FINISH}.`;
  return `You stopped on ${tools.join(' and ')}. Pi's own waits live inside this Pi process, `
    + 'and hobkin closes that process when your turn ends, so nothing would wake you. '
    + `If you scheduled something with schedule_task, cancel it with cancel_scheduled_task. ${instead}`;
}

/** What a run that ended in the middle of a step failed of, naming the calls it stopped on. */
export function stoppedMidStep(tools) {
  const calls = tools.length ? `, a call to ${tools.join(' and ')},` : '';
  return `The agent stopped in the middle of a step${calls} and did not come back.`;
}
