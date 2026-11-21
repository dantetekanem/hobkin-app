import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKeptJson } from './store.mjs';
import { PROMPT_FACTS } from './usage-extension.mjs';

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MINUTES = 1440;
// Chat and checks share these windows. Past this much of one, hobkin asks whether to pause work, however late it is.
const CEILING_PERCENT = 70;
// A week could otherwise go on its first day, so work this many points ahead of a window's clock is asked about too.
const HEAD_START_PERCENT = 30;
const FIRST_PAUSE_MS = HOUR_MS / 2;
const LONGEST_PAUSE_MS = 6 * HOUR_MS;
const limitWords = /usage.?limit|rate.?limit|too many requests|quota|out of budget|\b429\b|retry delay/i;

export const usageExtension = fileURLToPath(new URL('./usage-extension.mjs', import.meta.url));

/** Adds the reader to a job's extensions, so checks refresh the numbers too. A launcher decides for itself, so a job with no list is left alone. */
export const readingUsage = run => (request, options) => run(request.extensions ? { ...request, extensions: [...request.extensions, usageExtension] } : request, options);

const promptHash = value => typeof value === 'string' && /^[0-9a-f]{12}$/.test(value);
const promptSize = value => Number.isSafeInteger(value) && value >= 0;

/** What a run's first model request was made of, from the extension's status record, or undefined for any other record. */
export function promptFactsIn(record) {
  if (record?.type !== 'extension_ui_request' || record.method !== 'setStatus' || record.statusKey !== PROMPT_FACTS) return undefined;
  let facts;
  try {
    facts = JSON.parse(record.statusText);
  } catch {
    return undefined;
  }
  const { parts, sizes } = facts ?? {};
  if (!promptHash(parts?.instructions) || !promptHash(parts?.tools)
    || !['instructions', 'tools', 'toolCount'].every(key => promptSize(sizes?.[key]))) return undefined;
  return {
    parts: { instructions: parts.instructions, tools: parts.tools },
    sizes: { instructions: sizes.instructions, tools: sizes.tools, toolCount: sizes.toolCount },
  };
}

/** The last reading a job saw, or `null` before any job has seen one. */
export const readSubscription = root => readKeptJson(join(root, 'work', 'subscription.json'), null);

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

const lengthOf = ({ windowMinutes, resetAt }) => (windowMinutes && resetAt ? windowMinutes * MINUTE_MS : 0);

// How far through its time a window is, or `null` when the reading gives it no clock.
function elapsedPercent(entry, now) {
  const length = lengthOf(entry);
  return length ? 100 * (1 - (entry.resetAt - now) / length) : null;
}

/**
 * Each window still open, with how much of it is used and, when the reading gives its clock, how much of its time has gone. This informs the
 * user and never stops work: a pause for it was a block, and the provider saying no is what stops runs.
 */
export const usageWindows = (reading, now) => openWindows(reading, now).map(entry => {
  const elapsed = elapsedPercent(entry, now);
  return { label: labelFor(entry), usedPercent: entry.usedPercent, ...(elapsed === null ? {} : { elapsedPercent: elapsed }) };
});

function paceLine(entry, now) {
  const elapsed = elapsedPercent(entry, now);
  return elapsed === null ? CEILING_PERCENT : Math.min(CEILING_PERCENT, elapsed + HEAD_START_PERCENT);
}

// When the window's clock catches up with what is used, or its reset once it is past the ceiling.
function catchesUpAt(entry) {
  const length = lengthOf(entry);
  if (!length || entry.usedPercent >= CEILING_PERCENT) return entry.resetAt ?? null;
  return Math.round(entry.resetAt - length * (1 - (entry.usedPercent - HEAD_START_PERCENT) / 100));
}

/**
 * A window used faster than its clock runs, or past the share kept for chat and checks. hobkin only asks whether to pause for it, because a
 * pause it forced was a block. `until` is when a pause the user chooses would end by itself.
 */
export function aheadOfPace(reading, now) {
  const ahead = openWindows(reading, now).find(entry => entry.usedPercent >= paceLine(entry, now));
  if (!ahead) return null;
  return { label: labelFor(ahead), usedPercent: ahead.usedPercent, elapsedPercent: elapsedPercent(ahead, now), until: catchesUpAt(ahead) };
}

/**
 * What a Claude pane spent, from Claude Code's own transcript of that session, or nothing if there is none to read. Only the numbers
 * are read. One reply can take several lines that repeat its usage, so each request counts once.
 */
export function claudeSessionUsage(sessionId, projects = join(homedir(), '.claude', 'projects')) {
  const usages = new Map();
  let folders = [];
  try {
    folders = readdirSync(projects);
  } catch {
    return { tokens: 0, cached: 0 };
  }
  for (const folder of folders) {
    let text;
    try {
      text = readFileSync(join(projects, folder, `${sessionId}.jsonl`), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      try {
        const { type, requestId, uuid, message } = JSON.parse(line);
        if (type === 'assistant' && message?.usage) usages.set(requestId ?? uuid, message.usage);
      } catch {
        // A crash can cut the last line short.
      }
    }
  }
  const total = field => [...usages.values()].reduce((sum, usage) => sum + (usage[field] ?? 0), 0);
  return { tokens: total('input_tokens') + total('cache_creation_input_tokens') + total('output_tokens'), cached: total('cache_read_input_tokens') };
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
