import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './store.mjs';

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MINUTES = 1440;
// Chat and checks share these windows. Work keeps this much of any of them back, however late it is.
const CEILING_PERCENT = 70;
// A week would otherwise be free to go on its first day, so work may be this far ahead of a window's clock and no further.
const HEAD_START_PERCENT = 30;
const FIRST_PAUSE_MS = HOUR_MS / 2;
const LONGEST_PAUSE_MS = 6 * HOUR_MS;
const limitWords = /usage.?limit|rate.?limit|too many requests|quota|out of budget|\b429\b|retry delay/i;

export const usageExtension = fileURLToPath(new URL('./usage-extension.mjs', import.meta.url));

/** The last reading a job saw, or `null` before any job has seen one. */
export const readSubscription = root => readJson(join(root, 'work', 'subscription.json'), null);

/** Windows that still say something about now. Without a reset time a reading only holds for a while. */
export function openWindows(reading, now) {
  const fresh = now - Date.parse(reading?.at) < HOUR_MS;
  return [reading?.primary, reading?.secondary]
    .filter(entry => Number.isFinite(entry?.usedPercent))
    .filter(entry => (entry.resetAt ? entry.resetAt > now : fresh));
}

const labelFor = ({ windowMinutes }) => {
  if (!windowMinutes) return 'window';
  return windowMinutes >= DAY_MINUTES ? 'week' : `${Math.round(windowMinutes / 60)}h`;
};

export const usageWindows = (reading, now) => openWindows(reading, now)
  .map(entry => ({ label: labelFor(entry), usedPercent: entry.usedPercent }));

const lengthOf = ({ windowMinutes, resetAt }) => (windowMinutes && resetAt ? windowMinutes * MINUTE_MS : 0);

function allowedPercent(entry, now) {
  const length = lengthOf(entry);
  if (!length) return CEILING_PERCENT;
  const elapsed = 100 * (1 - (entry.resetAt - now) / length);
  return Math.min(CEILING_PERCENT, elapsed + HEAD_START_PERCENT);
}

function clearsAt(entry) {
  const length = lengthOf(entry);
  if (!length || entry.usedPercent >= CEILING_PERCENT) return entry.resetAt ?? null;
  return Math.round(entry.resetAt - length * (1 - (entry.usedPercent - HEAD_START_PERCENT) / 100));
}

/** The window that says stop, if one does. It clears by itself as the window's clock moves on. */
export function overReserve(reading, now) {
  const over = openWindows(reading, now).find(entry => entry.usedPercent >= allowedPercent(entry, now));
  if (!over) return null;
  return { label: labelFor(over), usedPercent: over.usedPercent, allowedPercent: allowedPercent(over, now), until: clearsAt(over) };
}

/** A failure that was the provider saying stop, with when it lifts if it said. Anything else is the project's own. */
export function usageLimitIn(text, now) {
  if (!text || !limitWords.test(text)) return null;
  const minutes = /try again in ~?(\d+)\s*min/i.exec(text)?.[1];
  const seconds = /(\d+)s retry delay/i.exec(text)?.[1];
  const retryAt = minutes ? now + Number(minutes) * MINUTE_MS : seconds ? now + Number(seconds) * 1000 : null;
  return { reason: String(text).trim().split('\n', 1)[0].slice(0, 200), retryAt };
}

/** One limit can fail several agents, and they are all the same pause. Each pause that fails again waits longer. */
export function nextPause(previous, { reason, retryAt }, now) {
  const holding = previous && Date.parse(previous.until) > now;
  const strikes = (previous?.strikes ?? 0) + (holding ? 0 : 1);
  const wait = Math.min(FIRST_PAUSE_MS * 2 ** (strikes - 1), LONGEST_PAUSE_MS);
  const until = Math.max(holding ? Date.parse(previous.until) : 0, retryAt ?? now + wait);
  return { at: holding ? previous.at : new Date(now).toISOString(), until: new Date(until).toISOString(), reason, strikes };
}
