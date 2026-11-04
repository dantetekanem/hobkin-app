import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { readEvents } from '../events.mjs';
import { allCardActions } from './card-actions.mjs';
import { landedRecords } from './scoreboard.mjs';
import { readJson } from './store.mjs';

// A streak looks this far back, which is longer than anyone keeps one going without a break.
const LOOK_BACK_DAYS = 60;
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
const nothingDone = () => ({ merged: 0, decided: 0 });

/** What the user got done on each of their own days: work that merged, and the questions and cards they answered. */
function winsByDay(root, since) {
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
  }
  for (const { at } of allCardActions(root)) add(at, 'decided');
  return days;
}

/** Days in a row with something done, up to `from`, or up to the day before while `from` has nothing yet. */
function streakTo(days, from) {
  let day = days.has(dayKey(from)) ? from : daysBefore(from, 1);
  let streak = 0;
  while (days.has(dayKey(day))) {
    streak += 1;
    day = daysBefore(day, 1);
  }
  return streak;
}

const lookBackFrom = time => startOfDay(daysBefore(time, LOOK_BACK_DAYS));

/** Today's wins and the days in a row, for the Decisions tab. */
export function winsNow(root, now = Date.now()) {
  const days = winsByDay(root, lookBackFrom(now));
  return { today: days.get(dayKey(now)) ?? nothingDone(), streak: streakTo(days, now) };
}

/** Each of the last `days` days, oldest first, with today's wins and the days in a row, for `hobkin wins`. */
export function winsReport(root, { days = 7, now = Date.now() } = {}) {
  const tallied = winsByDay(root, lookBackFrom(now));
  const shown = Array.from({ length: days }, (_, back) => daysBefore(now, days - 1 - back))
    .map(time => ({ day: dayKey(time), ...(tallied.get(dayKey(time)) ?? nothingDone()) }));
  return { today: tallied.get(dayKey(now)) ?? nothingDone(), streak: streakTo(tallied, now), days: shown };
}

const listed = parts => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
export const winsWords = ({ merged, decided }) => listed([merged && `${merged} merged`, decided && `${decided} decided`].filter(Boolean));

const toldPath = root => join(root, 'runtime', 'wins-told.json');

/**
 * One line for Chat about yesterday, the first time hobkin looks on a new day, so the cadence shows. The first look ever only remembers, and a day
 * with nothing done says nothing.
 */
export function yesterdayLine(root, now = Date.now()) {
  const today = dayKey(now);
  const told = readJson(toldPath(root), null)?.day ?? null;
  if (told === today) return null;

  atomicJson(toldPath(root), { version: 1, day: today });
  if (!told) return null;
  const yesterday = daysBefore(now, 1);
  const days = winsByDay(root, lookBackFrom(yesterday));
  const done = days.get(dayKey(yesterday));
  if (!done) return null;
  const streak = streakTo(days, yesterday);
  return `Yesterday: ${winsWords(done)}.${streak > 1 ? ` ${streak} days in a row.` : ''}`;
}
