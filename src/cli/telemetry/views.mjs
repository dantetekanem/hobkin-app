import { AWAY_GAP_MS, localDay, readEvents } from '../events.mjs';
import { readMemories } from '../memories.mjs';
import { readMemoryUse } from '../memory-use.mjs';

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const QUESTION_ENDS = ['answered', 'settled', 'handed', 'later', 'open'];
// The terminal's sheet says `escaped` for a question the user closed without an answer.
const SHEET_ENDS = { answered: 'answered', escaped: 'dismissed', expired: 'expired' };
const WHERE = ['away', 'on', 'unknown'];

const timeOf = ({ at }) => Date.parse(at);
const ofType = (events, type) => events.filter(event => event.type === type);
const zeros = keys => Object.fromEntries(keys.map(key => [key, 0]));
const hours = () => Array.from({ length: 24 }, () => 0);
const pad = number => String(number).padStart(2, '0');
const clock = time => `${pad(new Date(time).getHours())}:${pad(new Date(time).getMinutes())}`;

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(counts);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const byDay = (rows, summary) => Object.fromEntries([...Map.groupBy(rows, ({ day }) => day)].map(([day, own]) => [day, summary(own)]));

/** The sightings that say something: each day's first, and each return after a gap. A second first on the same day after a short gap is neither. */
function sightings(events) {
  const daysWithFirst = new Set();
  return ofType(events, 'presence').filter(event => {
    const day = localDay(event.at);
    const daysFirst = event.kind === 'first' && !daysWithFirst.has(day);
    if (daysFirst) daysWithFirst.add(day);
    return daysFirst || event.awayMs >= AWAY_GAP_MS;
  });
}

/**
 * Whether the user was away at a time: inside a gap a sighting closed, on between the earliest and the latest sighting otherwise, and
 * unknown outside them, since a gap still open has no sighting yet.
 */
function whereWasTheUser(seen) {
  const gaps = seen.filter(({ awayMs }) => Number.isFinite(awayMs)).map(event => [timeOf(event) - event.awayMs, timeOf(event)]);
  const from = seen.length ? timeOf(seen[0]) - (seen[0].awayMs ?? 0) : Infinity;
  const to = seen.length ? timeOf(seen.at(-1)) : -Infinity;
  return time => {
    if (gaps.some(([left, back]) => time >= left && time < back)) return 'away';
    return time >= from && time <= to ? 'on' : 'unknown';
  };
}

/** From each sighting to when the user left before the next one. The last stretch has no end yet, so it is not one. */
const stretchesOn = seen => seen.flatMap((event, index) => {
  const next = seen[index + 1];
  const left = next && Number.isFinite(next.awayMs) ? timeOf(next) - next.awayMs : NaN;
  return left > timeOf(event) ? [[timeOf(event), left]] : [];
});

/** A stretch cut at each local hour, so it can be added up by day and by hour. */
function* byHourOf([start, end]) {
  for (let time = start; time < end;) {
    const nextHour = new Date(time);
    nextHour.setMinutes(60, 0, 0);
    const until = Math.min(end, nextHour.getTime());
    yield { day: localDay(time), hour: new Date(time).getHours(), ms: until - time };
    time = until;
  }
}

function questions(events) {
  const where = whereWasTheUser(sightings(events));
  const answered = new Map(ofType(events, 'decision_answered').map(event => [event.id, event]));
  const settled = new Set(ofType(events, 'action_settled').map(({ id }) => id));
  const handed = new Set(ofType(events, 'action_handed').map(({ id }) => id));
  // A question the main agent asked in Chat is filed only when the user puts it off, so one still open is waiting for later.
  const endOf = ({ id, source }) => {
    if (answered.has(id)) return 'answered';
    if (settled.has(id)) return 'settled';
    if (handed.has(id)) return 'handed';
    return source === 'chat' ? 'later' : 'open';
  };
  const asked = ofType(events, 'decision_filed').map(event => ({
    day: localDay(event.at),
    source: event.source ?? 'unknown',
    ended: endOf(event),
    where: where(timeOf(event)),
    ms: answered.get(event.id)?.ms,
  }));
  const summary = own => ({
    asked: own.length,
    bySource: tally(own.map(({ source }) => source)),
    ended: { ...zeros(QUESTION_ENDS), ...tally(own.map(({ ended }) => ended)) },
    whileAway: { ...zeros(WHERE), ...tally(own.map(({ where }) => where)) },
  });
  const sheetEnds = ofType(events, 'question_ended');

  return {
    ...summary(asked),
    medianAnswerMs: median(asked.map(({ ms }) => ms)),
    byDay: byDay(asked, summary),
    sheet: {
      shown: ofType(events, 'question_shown').length,
      ended: { ...zeros(Object.values(SHEET_ENDS)), ...tally(sheetEnds.flatMap(({ how }) => (Object.hasOwn(SHEET_ENDS, how) ? [SHEET_ENDS[how]] : []))) },
      medianAnswerMs: median(sheetEnds.filter(({ how }) => how === 'answered').map(({ ms }) => ms)),
    },
  };
}

function interruptions(events) {
  const notices = ofType(events, 'notice_posted').map(event => ({
    day: localDay(event.at),
    hour: new Date(timeOf(event)).getHours(),
    source: event.source ?? 'unknown',
    tone: event.tone ?? 'none',
  }));
  const summary = own => ({ notices: own.length, bySource: tally(own.map(({ source }) => source)), byTone: tally(own.map(({ tone }) => tone)) });
  const byHour = hours();
  for (const { hour } of notices) byHour[hour] += 1;
  return { ...summary(notices), byDay: byDay(notices, summary), byHour };
}

function presence(events) {
  const seen = sightings(events);
  const days = {};
  const dayOf = day => (days[day] ??= { firstOn: null, returns: [], onMs: 0 });
  for (const event of seen) {
    const day = dayOf(localDay(event.at));
    const moment = { at: event.at, local: clock(timeOf(event)), ...(Number.isFinite(event.awayMs) ? { awayMs: event.awayMs } : {}) };
    if (event.kind === 'first' && !day.firstOn) day.firstOn = moment;
    else day.returns.push(moment);
  }
  const onByHour = hours();
  for (const stretch of stretchesOn(seen)) {
    for (const { day, hour, ms } of byHourOf(stretch)) {
      dayOf(day).onMs += ms;
      onByHour[hour] += ms;
    }
  }
  return { byDay: days, minutesOnByHour: onByHour.map(ms => Math.round(ms / MINUTE_MS)), onSince: seen.at(-1)?.at ?? null };
}

/**
 * The views `hobkin telemetry <view>` prints, each with its line for `hobkin telemetry help`. A view gets the events since `since`, oldest
 * first, with `{ root, since, now }`, and returns facts only. A new view is one more entry here.
 */
/**
 * Which shared memories agents recalled or had in their index, from the local memory-use file, and the shared ones nobody
 * used in that time. A private memory is left out, as everywhere outside the main chat and durable hobkins (057).
 */
function memory(events, { root, since, now }) {
  const { memories: shared } = readMemories(root, { private: false, now });
  const names = new Set(shared.map(({ name }) => name));
  const used = readMemoryUse(root, { days: Math.max(1, Math.round((now - since) / DAY_MS)), now }).filter(({ name }) => names.has(name));
  const usedNames = new Set(used.map(({ name }) => name));
  return { used, unused: shared.filter(({ name }) => !usedNames.has(name)).map(({ name, kind }) => ({ name, kind })) };
}

export const TELEMETRY_VIEWS = {
  questions: { line: 'questions filed per day by source, how each ended, the median time to answer, and whether the user was away when each came', view: questions },
  interruptions: { line: 'Chat notices per day by source and tone, and how many came in each local hour', view: interruptions },
  presence: { line: 'when the user was first on each day, each return after 15 minutes or more away, and the minutes on in each local hour', view: presence },
  memory: { line: 'which shared memories agents recalled or had in their index, and the ones nobody used', view: memory },
};

const NAMES = [...Object.keys(TELEMETRY_VIEWS), 'help'];
export const VIEW_USAGE = `Usage: hobkin telemetry [--days n] | hobkin telemetry <${NAMES.join(' | ')}> [--days n] | hobkin telemetry upload [on | off | status]`;

export function telemetryHelp(defaultDays) {
  const width = Math.max(...NAMES.map(name => name.length)) + 2;
  const lines = [...Object.entries(TELEMETRY_VIEWS).map(([name, { line }]) => [name, line]), ['help', 'this list']];
  return `Usage: hobkin telemetry <view> [--days n]. Each view prints JSON from this machine's events, ${defaultDays} days by default. Facts only, never text.\n${lines.map(([name, line]) => `  ${name.padEnd(width)}${line}`).join('\n')}\n`;
}

export function telemetryView(root, name, { days, now = Date.now() }) {
  if (!Object.hasOwn(TELEMETRY_VIEWS, name)) throw Error(VIEW_USAGE);
  const since = now - days * DAY_MS;
  return { view: name, days, since: new Date(since).toISOString(), ...TELEMETRY_VIEWS[name].view(readEvents(root, { since }), { root, since, now }) };
}
