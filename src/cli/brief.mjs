import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decisionRow } from './decisions.mjs';
import { reportTriage, writePrivate } from './reports.mjs';

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Away this long and seen again, the user is back. */
export const AWAY_MS = 2 * HOUR_MS;
/** What has to have come in while they were away for a brief to be worth offering. */
export const BRIEF_BAR = 3;
// Well under Runtime's 64 KiB message limit, beside the work note and what the user wrote, as a referenced report is.
const MOST_BRIEF_BYTES = 24576;
const MOST_EACH = 12;
const LONGEST_QUESTION = 600;
const LONGEST_EXCERPT = 500;
const LONGEST_TITLE = 200;

// "brief me", with or without a please, alone in the message. A longer request about one thing is a question like any other.
const BRIEF_WORDS = /^\W*(?:please\s+)?brief me(?:\s+please)?\W*$/i;
export const asksForBrief = text => BRIEF_WORDS.test(String(text ?? ''));

/** The guide hobkin's report editor writes by, which the main agent follows for a brief. */
export const WRITING_GUIDE = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'humanizer.md');

const statePath = root => join(root, 'runtime', 'brief.json');
const EMPTY = { lastSeenAt: null, offer: null, briefedAt: null };

/** When the user was last here, the offer standing in Chat and their last brief. A file that cannot be read is a fresh start. */
export function readBriefState(root) {
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(statePath(root), 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

export function writeBriefState(root, patch) {
  const next = { ...readBriefState(root), ...patch };
  mkdirSync(dirname(statePath(root)), { recursive: true, mode: 0o700 });
  writePrivate(statePath(root), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Seen again two hours or more after they were last here: they are back, and what came in since they left is news. */
export function returnedSince({ lastSeenAt, seenAt }) {
  const left = Date.parse(lastSeenAt ?? '');
  return Number.isFinite(left) && seenAt - left >= AWAY_MS ? lastSeenAt : null;
}

/** A minute is close enough for when they were last here, and it keeps the writes rare. A time ahead, after a clock change, or unreadable is rewritten. */
export function seenMoved({ lastSeenAt }, seenAt) {
  const last = Date.parse(lastSeenAt ?? '');
  return !Number.isFinite(last) || Math.abs(seenAt - last) >= MINUTE_MS;
}

const triageOf = ({ outcome, body }) => reportTriage({ status: outcome, result: { text: body } });
const hasNews = report => triageOf(report)?.level !== 'nothing';
const after = (at, since) => Date.parse(at ?? '') > Date.parse(since);
const isWorkRun = ({ id }) => /^work:[^:]+:do:/.test(String(id));
// A session's report reached the main agent when it ended, and work mode's runs are counted on their own.
const isRoutineReport = ({ id }) => !/^(?:work|session):/.test(String(id));

/** What came in since `since` that the user has not seen: open questions, routine reports with news, and what work mode finished. */
export function arrivedSince({ decisions = [], reports = [], read = new Set(), since }) {
  const fresh = reports.filter(report => after(report.at, since) && !read.has(report.id) && hasNews(report));
  const routine = fresh.filter(isRoutineReport);
  return {
    decisions: decisions.filter(({ at }) => after(at, since)).length,
    reports: routine.length,
    calls: routine.filter(report => triageOf(report)?.next).length,
    work: fresh.filter(isWorkRun).length,
  };
}

export const arrivedCount = ({ decisions, reports, work }) => decisions + reports + work;

const plural = (amount, noun) => `${amount} ${noun}${amount === 1 ? '' : 's'}`;
const inWords = parts => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '');

/** One line in Chat that asks for nothing: what came in, and the two words that bring the brief. */
export function offerLine({ decisions, reports, calls, work }) {
  const parts = [
    decisions && plural(decisions, 'decision'),
    reports && `${plural(reports, 'report')}${calls ? ` (${calls} with a call)` : ''}`,
    work && `${work} from work mode`,
  ].filter(Boolean);
  return `It's been a while. While you were away: ${inWords(parts)}. Want a brief? Just say: brief me`;
}

/** A brief covers what came in since the user left, or since their last brief if that came later, and the last day when there is neither. */
export function briefSince({ offer, briefedAt }, now) {
  const marks = [offer?.since, briefedAt].map(at => Date.parse(at ?? '')).filter(Number.isFinite);
  return new Date(marks.length ? Math.max(...marks) : now - DAY_MS).toISOString();
}

// One line whatever was written, so nothing in it can pass for a line of its own.
function flat(text, longest) {
  const line = String(text ?? '').replace(/[\s\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
  return line.length > longest ? `${line.slice(0, longest - 1)}…` : line;
}

const newestFirst = (left, right) => (right.at ?? '').localeCompare(left.at ?? '');
const linesOf = ({ size }) => (size?.additions ?? 0) + (size?.deletions ?? 0);

// As `hobkin decisions` lists it, on one line, so a long question cannot crowd out the rest.
const decisionFor = decision => ({ ...decisionRow(decision), question: flat(decision.question, LONGEST_QUESTION) });

function reportFor(report, read, reportPath) {
  const triage = triageOf(report);
  return {
    id: report.id,
    title: flat(report.title ?? report.id, LONGEST_TITLE),
    at: report.at ?? null,
    level: triage?.level ?? null,
    next: triage?.next ?? null,
    read: read.has(report.id),
    excerpt: flat(report.body, LONGEST_EXCERPT),
    path: reportPath(report.id),
  };
}

const branchFor = row => ({
  project: row.project,
  item: row.item,
  title: flat(row.title, LONGEST_TITLE),
  gap: row.gap ?? null,
  lines: linesOf(row),
});

// A step only the user can take says what is left for them, as its branch recorded it or as work mode put it.
const stepFor = row => ({
  project: row.project ?? null,
  item: row.item ?? null,
  title: flat(row.title, LONGEST_TITLE),
  left: row.left ?? row.reason ?? null,
});

const troubleFor = ({ fact, report }) => ({
  fact: flat(fact, LONGEST_EXCERPT),
  report: report ?? null,
});

const askFor = ({ kind, project, title, reason, answer }) => ({
  kind,
  project: project ?? null,
  title: flat(title, LONGEST_TITLE),
  reason: reason ?? null,
  answer: answer ?? null,
});

const proposalFor = ({ id, title, question }) => ({
  id,
  title: flat(title, LONGEST_TITLE),
  question: flat(question, LONGEST_QUESTION),
});

const workFor = ({ branches = [], yours = [], wrong = [], asks = [], proposals = [] }) => ({
  branches: branches.slice(0, MOST_EACH).map(branchFor),
  yours: yours.slice(0, MOST_EACH).map(stepFor),
  wrong: wrong.slice(0, MOST_EACH).map(troubleFor),
  asks: asks.slice(0, MOST_EACH).map(askFor),
  proposals: proposals.slice(0, MOST_EACH).map(proposalFor),
});

/**
 * Everything a brief is written from: what waits, every open question with its choices, the reports that came in or still make a call, and the
 * work. Each report keeps its path, so the main agent opens one only when its excerpt is not enough. Nothing here reads or writes anything.
 */
export function briefMaterial({
  since,
  now,
  decisions = [],
  reports = [],
  read = new Set(),
  waiting = null,
  rows = {},
  reportPath = () => null,
  guide = WRITING_GUIDE,
}) {
  // What came in since, and what is older but still makes a call, as Decisions lists it, where each routine's newest report speaks for it.
  // A session's report already reached the main agent.
  const calling = new Set((rows.reports ?? []).map(({ id }) => id));
  const belongs = report => hasNews(report) && !String(report.id).startsWith('session:');
  const news = reports
    .filter(belongs)
    .filter(report => after(report.at, since) || calling.has(report.id))
    .toSorted(newestFirst);

  const workLists = [rows.branches, rows.yours, rows.wrong, rows.asks, rows.proposals].filter(Array.isArray);
  const cut = decisions.length > 2 * MOST_EACH || news.length > MOST_EACH || workLists.some(list => list.length > MOST_EACH);
  return {
    since,
    now: new Date(now).toISOString(),
    guide,
    waiting: { total: waiting?.total ?? 0, groups: waiting?.groups ?? [] },
    decisions: decisions.slice(0, 2 * MOST_EACH).map(decisionFor),
    reports: news.slice(0, MOST_EACH).map(report => reportFor(report, read, reportPath)),
    work: workFor(rows),
    ...(cut ? { trimmed: true } : {}),
  };
}

// JSON keeps it on one line, and escaping `</` means nothing in a report or a question can end the block early. JSON leaves the line and
// paragraph separators as they are, and a line break of any kind would let the block show in Chat, so those are escaped too.
const oneLine = json => json.replaceAll('</', '<\\/').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const blockOf = material => `<hobkin-brief>\n${oneLine(JSON.stringify(material))}\n</hobkin-brief>\n\n`;

const withoutExcerpts = material => ({
  ...material,
  reports: material.reports.map(({ excerpt, ...report }) => report),
  trimmed: true,
});

const cutTo = (material, most) => ({
  ...material,
  decisions: material.decisions.slice(0, most),
  reports: material.reports.slice(0, most),
  work: Object.fromEntries(Object.entries(material.work).map(([name, list]) => [name, list.slice(0, most)])),
});

// How many of each list stay as the room runs out, down to the counts alone.
const LIST_CUTS = [6, 3, 1, 0];

/**
 * The material as one block ahead of the user's words, in no more than `most` bytes and never past its own limit. What does not fit goes in
 * this order: report excerpts, then the tail of every list. With no room even for the counts there is no block, and the words go alone.
 */
export function briefNote(material, { most = MOST_BRIEF_BYTES } = {}) {
  const room = Math.min(most, MOST_BRIEF_BYTES);
  const lean = withoutExcerpts(material);
  const { since, now, guide, waiting } = material;
  const candidates = [material, lean, ...LIST_CUTS.map(count => cutTo(lean, count)), { since, now, guide, waiting, trimmed: true }];
  for (const candidate of candidates) {
    const block = blockOf(candidate);
    if (Buffer.byteLength(block) <= room) return block;
  }
  return '';
}

/** What Chat shows of the message: the user's own words. */
export const withoutBriefNote = text => text.replace(/^<hobkin-brief>\n.*\n<\/hobkin-brief>\n\n/, '');
