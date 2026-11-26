import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The user's day (075-chief-of-staff), as the morning-brief and meetings routines write it when they read the calendar. No poller or run of its
 * own writes it. Times are ISO strings with their offset, and everything but `date` may be missing in a file an older routine wrote:
 *
 *   {
 *     "version": 1,
 *     "date": "2026-11-26",                    the local date in `timezone`
 *     "timezone": "America/Toronto",
 *     "workDay": true,                         false on a weekend, a holiday or a day off
 *     "hours": { "start": "...", "end": "..." },  working hours on a work day, the waking day on a day off, or null
 *     "events": [{ "start": "...", "end": "...", "withOthers": true }],  timed events, never all-day ones
 *     "gaps": [{ "start": "...", "end": "..." }],  the free stretches between events within `hours`
 *     "source": "...",                         the calendar the routine found and used
 *     "writtenAt": "..."
 *   }
 */
export const dayPath = root => join(root, 'runtime', 'day.json');

/** What a work day holds. */
export const WORK_DAY_MINUTES = 8 * 60;
/** What a normal day off work holds, until hobkin knows the user's own: half a work day, a modest guess on purpose. */
export const DAY_OFF_MINUTES = 4 * 60;
/** From this share of what the day holds, the day is too full. */
export const TOO_FULL = 0.8;

const MINUTE_MS = 60000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

function zoneOrNull(timeZone) {
  if (!text(timeZone)) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return timeZone;
  } catch {
    return null;
  }
}

const dateIn = (timeZone, time) => new Date(time).toLocaleDateString('en-CA', timeZone ? { timeZone } : {});

/** A start before its end, both readable, as written; anything else is no span. */
function span(value) {
  if (!record(value)) return null;
  const start = Date.parse(value.start ?? '');
  const end = Date.parse(value.end ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? { start: value.start, end: value.end } : null;
}

const spans = (values, shape) => (Array.isArray(values) ? values : []).flatMap(value => {
  const read = span(value);
  return read ? [shape(read, value)] : [];
});

/**
 * Today's day, or null when there is none: no file, one that cannot be read, or one written for another date in its own time zone. A file an
 * older routine wrote still reads, with defaults for what it lacks. A time zone that does not work is judged in the machine's own.
 */
export function readDay(root, now = Date.now()) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(dayPath(root), 'utf8'));
  } catch {
    return null;
  }
  if (!record(raw) || !DATE.test(raw.date ?? '')) return null;
  const timezone = zoneOrNull(raw.timezone);
  if (raw.date !== dateIn(timezone, now)) return null;
  return {
    date: raw.date,
    timezone,
    workDay: raw.workDay !== false,
    hours: span(raw.hours),
    events: spans(raw.events, (read, event) => ({ ...read, withOthers: event.withOthers === true })),
    gaps: spans(raw.gaps, read => read),
    source: text(raw.source),
    writtenAt: text(raw.writtenAt),
  };
}

/** Minutes the events take, overlaps counted once, inside `hours` when the day has them. */
function eventMinutes(events, hours) {
  const from = hours ? Date.parse(hours.start) : -Infinity;
  const to = hours ? Date.parse(hours.end) : Infinity;
  const intervals = events
    .map(({ start, end }) => [Math.max(Date.parse(start), from), Math.min(Date.parse(end), to)])
    .filter(([start, end]) => start < end)
    .toSorted(([first], [second]) => first - second);
  let total = 0;
  let reached = -Infinity;
  for (const [start, end] of intervals) {
    if (end <= reached) continue;
    total += end - Math.max(start, reached);
    reached = end;
  }
  return Math.round(total / MINUTE_MS);
}

const minutes = value => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * How full the day is: its events, plus the work committed to it, plus the reviews and decisions waiting on the user, against what the day holds.
 * A work day holds 8 hours and a day off `DAY_OFF_MINUTES`. With no day, it is a work day with no events.
 */
export function dayLoad(day, { committedMinutes = 0, waitingMinutes = 0 } = {}) {
  const capacityMinutes = day?.workDay === false ? DAY_OFF_MINUTES : WORK_DAY_MINUTES;
  const meetingMinutes = day ? eventMinutes(day.events ?? [], day.hours ?? null) : 0;
  const loadMinutes = meetingMinutes + minutes(committedMinutes) + minutes(waitingMinutes);
  const ratio = loadMinutes / capacityMinutes;
  return { capacityMinutes, meetingMinutes, loadMinutes, ratio, tooFull: ratio >= TOO_FULL };
}
