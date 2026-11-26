import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { readEvents } from '../events.mjs';
import { allCardActions } from './card-actions.mjs';
import { landedRecords } from './scoreboard.mjs';
import { readJson } from './store.mjs';

// A streak looks this far back, which is longer than anyone keeps one going without a break.
const LOOK_BACK_DAYS = 60;
// The days the window shows, today last.
const WEEK_DAYS = 7;
// The card that asks how to tackle the pile stands for what is on it, so what the user did from it is counted there instead.
const CARD = 'pending';

const pad = value => String(value).padStart(2, '0');
const dayKey = time => {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const daysBefore = (time, days) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days, 12).getTime();
};
const startOfDay = time => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const nothingDone = () => ({ merged: 0, decided: 0, asked: 0 });

/**
 * Each of the user's own days: work that merged, the questions and cards they answered, and the decisions hobkin asked of them. Answering is
 * kept as a fact and is no win (075): the fewer decisions a day needed, the better.
 */
function tallyByDay(root, since) {
  const days = new Map();
  const add = (at, kind) => {
    const time = Date.parse(at);
    if (!(time >= since)) return;
    const tally = days.get(dayKey(time)) ?? nothingDone();
    tally[kind] += 1;
    days.set(dayKey(time), tally);
  };
  for (const { at } of landedRecords(root)) add(at, 'merged');
  for (const { at, type, source } of readEvents(root, { since })) {
    if (type === 'decision_answered' && source !== CARD) add(at, 'decided');
    if (type === 'decision_filed' && source !== CARD) add(at, 'asked');
  }
  // Each card a group's yes answered is counted, so the line that sums the group up is no decision of its own.
  for (const { at, item } of allCardActions(root)) {
    if (item) add(at, 'decided');
  }
  return days;
}

const tallyOn = (days, time) => days.get(dayKey(time)) ?? nothingDone();
const askedBefore = (days, time) => tallyOn(days, daysBefore(time, 1)).asked;
const isToday = (time, now) => dayKey(time) === dayKey(now);

/**
 * A day is good when work merged, or when it needed fewer decisions from the user than the day before. Fewer is known only once the day is
 * over, so today, still so far, is good once work merged and undecided (null) until then.
 */
function goodOn(days, time, now) {
  const { merged, asked } = tallyOn(days, time);
  if (merged > 0) return true;
  if (isToday(time, now)) return null;
  return asked < askedBefore(days, time);
}

const dayOf = (days, time, now) => ({
  ...tallyOn(days, time),
  good: goodOn(days, time, now),
  soFar: isToday(time, now),
});

/** Good days in a row, up to `from`, or up to the day before while `from` is not good yet. */
function streakTo(days, from, now) {
  let day = goodOn(days, from, now) ? from : daysBefore(from, 1);
  let streak = 0;
  while (goodOn(days, day, now)) {
    streak += 1;
    day = daysBefore(day, 1);
  }
  return streak;
}

const lookBackFrom = time => startOfDay(daysBefore(time, LOOK_BACK_DAYS));

/** Each of the last `days` days, oldest first, with today's wins and the good days in a row, for `hobkin wins`. */
export function winsReport(root, { days = WEEK_DAYS, now = Date.now() } = {}) {
  const tallied = tallyByDay(root, lookBackFrom(now));
  const times = Array.from({ length: days }, (_, back) => daysBefore(now, days - 1 - back));
  return {
    today: dayOf(tallied, now, now),
    streak: streakTo(tallied, now, now),
    days: times.map(time => ({ day: dayKey(time), ...dayOf(tallied, time, now) })),
  };
}

/** Today's wins so far, the good days in a row, and the week's days, today last, for the Decisions tab and the window. */
export const winsNow = (root, now = Date.now()) => winsReport(root, { days: WEEK_DAYS, now });

const decisions = count => (count ? `${count} decision${count === 1 ? '' : 's'}` : 'no decisions');

/** What made a day good, in sentences: what merged, and how few decisions it needed against the day before, when that was fewer. */
export const winsWords = ({ merged, asked }, before) => [
  merged > 0 && `${merged} merged.`,
  asked < before && `hobkin needed ${decisions(asked)} from you, down from ${before}.`,
].filter(Boolean).join(' ');

const toldPath = root => join(root, 'runtime', 'wins-told.json');

/**
 * One line for Chat about yesterday, the first time hobkin looks on a new day, so the cadence shows. The first look ever only remembers, and a day
 * that was not good says nothing.
 */
export function yesterdayLine(root, now = Date.now()) {
  const today = dayKey(now);
  const told = readJson(toldPath(root), null)?.day ?? null;
  if (told === today) return null;

  atomicJson(toldPath(root), { version: 1, day: today });
  if (!told) return null;
  const yesterday = daysBefore(now, 1);
  const days = tallyByDay(root, lookBackFrom(yesterday));
  if (!goodOn(days, yesterday, now)) return null;
  const streak = streakTo(days, yesterday, now);
  const inARow = streak > 1 ? ` ${streak} days in a row.` : '';
  return `Yesterday: ${winsWords(tallyOn(days, yesterday), askedBefore(days, yesterday))}${inARow}`;
}
