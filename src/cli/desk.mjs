// The desk (075-chief-of-staff): how urgent an incoming item is, when the user usually is on, and so when and how an item reaches them.
// Nothing here reads a clock or a file. Every answer takes the time it is about, and presence comes in as the events lane TEL records:
// `{ at, type: 'presence', kind: 'first' | 'returned', awayMs }`, where `at` is when the user was seen again and `at - awayMs` when they left.

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const DAY_MINUTES = 24 * 60;
// A night that runs past midnight belongs to the day it started, so the user's day turns at 04:00.
const DAY_TURNS_MINUTES = 4 * 60;
// Away this long is a break. Shorter is a coffee.
const BREAK_MS = 30 * MINUTE_MS;
// Digests come about three times a day and never hourly (notes §3).
const MOST_DIGESTS = 3;
const DIGEST_GAP_MS = 2 * HOUR_MS;
const DIGEST_GAP_MINUTES = DIGEST_GAP_MS / MINUTE_MS;
// The last digest comes this long before the user usually stops, so they still see it.
const STOP_LEAD_MINUTES = 30;
// With no learned digest, a deadline this close counts as before the next one: about a third of a waking day.
const DIGEST_HORIZON_MS = 4 * HOUR_MS;
// A P0 waits for a break this close instead of interrupting.
const NEAR_MS = 15 * MINUTE_MS;
const TOO_LITTLE = 'Less than a week of presence data, so a digest comes when the user returns after a gap.';

const machineZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const formatters = new Map();
const formatterFor = timeZone => {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
};

/** The wall clock in `timeZone` at `time`: its date, its hour and its minute of the day. */
function wallClock(time, timeZone) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(time).map(({ type, value }) => [type, value]));
  const hour = Number(parts.hour);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, minute: hour * 60 + Number(parts.minute) };
}

const dateBefore = date => new Date(Date.parse(`${date}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/**
 * The user's day at `time` in `timeZone` and its minute counted from when that day turns. It turns at 04:00 on the clock, so it is
 * read from the clock time and not from four real hours before, which a day the clocks change would put an hour off.
 */
export function userDay(time, timeZone = machineZone()) {
  const { date, minute } = wallClock(time, timeZone);
  return minute >= DAY_TURNS_MINUTES
    ? { date, minute: minute - DAY_TURNS_MINUTES }
    : { date: dateBefore(date), minute: minute + DAY_MINUTES - DAY_TURNS_MINUTES };
}

const fromUserMinute = minute => (minute + DAY_TURNS_MINUTES) % DAY_MINUTES;
const toUserMinute = minute => (minute - DAY_TURNS_MINUTES + DAY_MINUTES) % DAY_MINUTES;
const clockText = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const clockMinute = text => {
  const [hour, minute] = String(text).split(':').map(Number);
  return hour * 60 + minute;
};
const instant = value => (typeof value === 'number' ? value : Date.parse(value));
const median = values => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

/** The presence events inside the last `days` before `now`, oldest first, and whether they reach back a week. */
function presenceWithin(events, { now, days }) {
  const since = now - days * DAY_MS;
  const kept = events
    .filter(event => event?.type === 'presence' && Date.parse(event.at) >= since && Date.parse(event.at) <= now)
    .toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return { kept, enough: kept.length > 0 && Date.parse(kept[0].at) <= now - WEEK_MS };
}

const leftAt = event => (Number.isFinite(event?.awayMs) ? Date.parse(event.at) - event.awayMs : null);

/**
 * About three digest moments a day, from when the user is usually on: when they first come on, when they come back from the day's main
 * break (or the middle of the day when they take none on most days), and a little before they usually stop. Each moment is a wall time
 * in `timeZone`, at least two hours from the others. Today is still under way, so only the days before it are learned from.
 * With less than a week of data there is no moment, and `reason` says the digest comes when the user returns after a gap.
 */
export function learnMoments(presenceEvents, { now, days = 14, timeZone = machineZone() }) {
  const { kept, enough } = presenceWithin(presenceEvents, { now, days });
  if (!enough) return { moments: [], enough: false, days: 0, reason: TOO_LITTLE };

  const today = userDay(now, timeZone).date;
  const byDay = new Map();
  const dayOf = date => byDay.get(date) ?? byDay.set(date, { first: Infinity, stop: -Infinity, back: null, longest: 0 }).get(date);
  for (const event of kept) {
    const seen = userDay(Date.parse(event.at), timeZone);
    const day = dayOf(seen.date);
    day.first = Math.min(day.first, seen.minute);
    day.stop = Math.max(day.stop, seen.minute);
    const left = leftAt(event);
    if (left === null) continue;
    const gone = userDay(left, timeZone);
    dayOf(gone.date).stop = Math.max(dayOf(gone.date).stop, gone.minute);
    // A break starts and ends on the same day, and the longest one is the day's main break.
    if (gone.date === seen.date && event.awayMs >= BREAK_MS && event.awayMs > day.longest) Object.assign(day, { back: seen.minute, longest: event.awayMs });
  }
  const learned = [...byDay].filter(([date, { first }]) => date < today && Number.isFinite(first)).map(([, day]) => day);
  if (!learned.length) return { moments: [], enough: false, days: 0, reason: TOO_LITTLE };

  const first = median(learned.map(day => day.first));
  const stop = Math.max(first, median(learned.map(day => day.stop)) - STOP_LEAD_MINUTES);
  const returns = learned.flatMap(({ back }) => (back === null ? [] : [back]));
  const candidates = [
    { minute: first, why: 'first' },
    { minute: stop, why: 'stop' },
    ...(returns.length * 2 >= learned.length ? [{ minute: median(returns), why: 'return' }] : []),
    { minute: Math.round((first + stop) / 2), why: 'middle' },
  ];
  const chosen = [];
  for (const candidate of candidates) {
    if (chosen.length < MOST_DIGESTS && chosen.every(({ minute }) => Math.abs(minute - candidate.minute) >= DIGEST_GAP_MINUTES)) chosen.push(candidate);
  }
  return {
    moments: chosen.toSorted((left, right) => left.minute - right.minute).map(({ minute, why }) => ({ at: clockText(fromUserMinute(minute)), why })),
    enough: true,
    days: learned.length,
    reason: `Learned from ${learned.length} days of presence.`,
  };
}

/**
 * The hours of the day, in `timeZone`, that the user is usually away: those they were on in fewer than half the days they were on at all.
 * The user is on from each time they are seen until they next leave. Today is still under way, so it does not count.
 * With less than a week of data no hour is quiet yet.
 */
export function learnQuietHours(presenceEvents, { now, days = 14, timeZone = machineZone() }) {
  const { kept, enough } = presenceWithin(presenceEvents, { now, days });
  if (!enough) return { hours: [], enough: false, days: 0, reason: 'Less than a week of presence data, so no hour is quiet yet.' };

  const today = userDay(now, timeZone).date;
  const daysOn = new Set();
  const hoursOn = Array.from({ length: 24 }, () => new Set());
  const mark = time => {
    const { date } = userDay(time, timeZone);
    if (date >= today) return;
    daysOn.add(date);
    hoursOn[wallClock(time, timeZone).hour].add(date);
  };
  kept.forEach((event, index) => {
    const start = Date.parse(event.at);
    const end = Math.max(start, leftAt(kept[index + 1]) ?? start);
    // Half-hour steps reach every hour the span crosses, and the span ends just before the user left.
    for (let time = start; time < end; time += HOUR_MS / 2) mark(time);
    mark(end > start ? end - 1 : start);
  });
  return {
    hours: hoursOn.flatMap((dates, hour) => (dates.size * 2 < daysOn.size ? [hour] : [])),
    enough: true,
    days: daysOn.size,
    reason: `Learned from ${daysOn.size} days of presence.`,
  };
}

/** When the next learned digest comes after `now`, tomorrow's first once today's have passed, or null with none learned. */
export function nextDigestAt(moments, now, timeZone = machineZone()) {
  if (!moments?.length) return null;
  const { minute } = wallClock(now, timeZone);
  const minuteStart = now - (now % MINUTE_MS);
  // Counted in wall minutes, so a day the clocks change can be off by that hour.
  return minuteStart + Math.min(...moments.map(({ at }) => (clockMinute(at) - minute + DAY_MINUTES) % DAY_MINUTES)) * MINUTE_MS;
}

/** When the latest learned digest moment came, at or before `now`. */
function lastMomentAt(moments, now, timeZone) {
  const { minute } = wallClock(now, timeZone);
  return now - (now % MINUTE_MS) - Math.min(...moments.map(({ at }) => (minute - clockMinute(at) + DAY_MINUTES) % DAY_MINUTES)) * MINUTE_MS;
}

/**
 * The level of an incoming item, from facts only: `source` ('routine', 'agent', 'reminder', 'email', ...), `triage` (reportTriage's
 * result or its level), `deadline` (an ISO time or milliseconds) and `blocksWork` (work is stopped until the user acts).
 *
 * Interrupting (P0) costs less than waiting only when a deadline falls before the next digest, or critical work is stopped on the user.
 * What should not wait past today is P1: critical or blocked news, work stopped on the user, a deadline within a day or already missed
 * (interrupting can no longer save it), and a reminder (it is for today). A run that found nothing is P3, and everything else P2.
 */
export function itemLevel(item, { now, nextDigest } = {}) {
  const triage = item.triage?.level ?? item.triage;
  if (triage === 'nothing') return 'P3';
  const due = instant(item.deadline);
  if (Number.isFinite(due) && !Number.isFinite(now)) throw TypeError('itemLevel needs now to judge a deadline.');
  const digest = nextDigest ?? now + DIGEST_HORIZON_MS;
  if ((due > now && due <= digest) || (triage === 'critical' && item.blocksWork)) return 'P0';
  if (triage === 'critical' || triage === 'blocked' || item.blocksWork || due - now <= DAY_MS || item.source === 'reminder') return 'P1';
  return 'P2';
}

/** What holds deliveries back at `now`: an event in the day file or quiet hours, and when that hold ends. */
function holdAt(now, { day, quiet = [], timeZone }) {
  const event = day?.events?.find(({ start, end }) => Date.parse(start) <= now && now < Date.parse(end));
  const { hour, minute } = wallClock(now, timeZone);
  let quietEnd = null;
  if (quiet.includes(hour)) {
    let quietHours = 1;
    while (quietHours < 24 && quiet.includes((hour + quietHours) % 24)) quietHours += 1;
    quietEnd = quietHours === 24 ? Infinity : now + (quietHours * 60 - minute % 60) * MINUTE_MS;
  }
  if (!event && quietEnd === null) return null;
  return { what: event ? 'an event' : 'quiet hours', until: Math.max(event ? Date.parse(event.end) : -Infinity, quietEnd ?? -Infinity) };
}

/**
 * How an item reaches the user: `now`, at the next `breakpoint` (a pause in their work, or the end of the event or quiet hours that holds
 * it), in the next `digest`, or only in the `log`. `level` defaults to itemLevel's, against the next learned digest.
 * `moments` and `quiet` are what learnMoments and learnQuietHours learned. `day` is the day file, `{ events: [{ start, end }] }` with ISO
 * times, and `present` says whether the user is on now. Nothing but P0 is delivered during an event or quiet hours, and P0 waits for
 * their end when it is near and comes before its deadline.
 */
export function deliveryFor(item, { now, level, moments = [], quiet = [], day, present = false, timeZone = machineZone() }) {
  const chosen = level ?? itemLevel(item, { now, nextDigest: nextDigestAt(moments, now, timeZone) });
  const answer = (delivery, reason) => ({ delivery, level: chosen, reason });
  if (chosen === 'P3') return answer('log', 'P3 is logged only.');
  if (chosen === 'P2') return answer('digest', 'P2 waits for the next digest.');

  const hold = holdAt(now, { day, quiet, timeZone });
  if (chosen === 'P1') {
    if (hold) return answer('digest', `P1 waits for the digest during ${hold.what}.`);
    if (!moments.length) return answer('digest', 'P1 waits for the digest when the user is back from a break.');
    const { minute } = wallClock(now, timeZone);
    const leftToday = moments.some(({ at }) => toUserMinute(clockMinute(at)) > toUserMinute(minute));
    return leftToday ? answer('digest', 'P1 lands in the next digest today.') : answer('breakpoint', 'No digest is left today, so P1 goes at the next pause.');
  }

  const due = instant(item.deadline);
  if (hold) {
    const wait = hold.until - now;
    const beforeDeadline = !Number.isFinite(due) || hold.until <= due;
    return wait <= NEAR_MS && beforeDeadline
      ? answer('breakpoint', `P0 waits ${Math.ceil(wait / MINUTE_MS)} minutes for ${hold.what} to end.`)
      : answer('now', `P0 cannot wait for ${hold.what} to end.`);
  }
  if (!present) return answer('now', 'P0 goes now, because the user is away and it interrupts nothing.');
  return Number.isFinite(due) && due - now <= NEAR_MS
    ? answer('now', 'P0 cannot wait for a pause, because its deadline is minutes away.')
    : answer('breakpoint', 'P0 goes at the next pause in the user\'s work.');
}

/**
 * Whether a digest should post now. The user must be on, with no event or quiet hours holding deliveries, and the last digest at least
 * two hours back. Then a learned moment must have come since the last digest, or, with none learned yet, the user has just come back
 * after a gap (`awayMs`, from the presence event that saw them return).
 */
export function digestDue({ now, moments = [], lastDigest = -Infinity, present = false, awayMs, day, quiet = [], timeZone = machineZone() }) {
  if (!present) return { due: false, reason: 'The user is not on.' };
  const hold = holdAt(now, { day, quiet, timeZone });
  if (hold) return { due: false, reason: `No digest during ${hold.what}.` };
  if (now - lastDigest < DIGEST_GAP_MS) return { due: false, reason: 'The last digest was less than two hours ago.' };
  if (!moments.length) {
    return awayMs >= BREAK_MS
      ? { due: true, reason: 'The user is back after a gap, and no digest time is learned yet.' }
      : { due: false, reason: 'No digest time is learned yet, so the digest waits for the user to return after a gap.' };
  }
  return lastMomentAt(moments, now, timeZone) > lastDigest
    ? { due: true, reason: 'A digest time has come since the last digest.' }
    : { due: false, reason: 'No digest time has come since the last digest.' };
}
