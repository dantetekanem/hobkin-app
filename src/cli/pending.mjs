import { reportTriage } from './reports.mjs';
import { heldByItsGrade } from './work/reads.mjs';

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const CARD_BAR = 8;
export const CARD_QUIET_MS = 4 * HOUR_MS;
export const PRESENT_MS = 2 * MINUTE_MS;
const CARD_MORE = 5;

const TO_READ = ['land', 'rebase', 'elsewhere', 'unlanded'];
const WENT_WRONG = ['critical', 'blocked'];
const ASKS = ['allowance', 'proposal'];
// Each of these is about a branch that already has its row, or is the card itself.
const NOT_QUESTIONS = ['land', 'merge', 'read', 'pending'];

const plural = (amount, noun) => `${amount} ${noun}${amount === 1 ? '' : 's'}`;
const pad = number => String(number).padStart(2, '0');

function shortNumber(amount) {
  if (amount < 1000) return String(amount);
  return amount < 10000 ? `${Math.round(amount / 100) / 10}k` : `${Math.round(amount / 1000)}k`;
}

function age(ms) {
  if (ms >= DAY_MS) return plural(Math.floor(ms / DAY_MS), 'day');
  if (ms >= HOUR_MS) return plural(Math.floor(ms / HOUR_MS), 'hour');
  return plural(Math.max(1, Math.floor(ms / MINUTE_MS)), 'minute');
}

function sinceWhen(at, now) {
  if (!at) return '';
  const date = new Date(at);
  const today = date.toDateString() === new Date(now).toDateString();
  const when = today ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return ` since ${when}`;
}

const oldest = (dated, now) => age(now - Math.min(...dated.map(({ at }) => Date.parse(at))));
const linesIn = rows => rows.reduce((sum, { size }) => sum + (size?.additions ?? 0) + (size?.deletions ?? 0), 0);

const wellBuilt = ({ quality }) => !quality || (!quality.stale && ['A', 'B'].includes(quality.rating));
// A grade is information: work with its proof is ready graded or not, unless a review rated this commit below safe.
const landsOnItsProof = row => row.proved !== false && !heldByItsGrade(row) && wellBuilt(row);
const isReady = row => row.gap === 'land' && !row.left && (Boolean(row.offer) || landsOnItsProof(row));
const isToRead = row => TO_READ.includes(row.gap) && !row.left && !isReady(row);

/** Each routine's newest report speaks for it, so one that says the same thing every day is one call, and a later report with no call ends it. */
function reportCalls(reports, read) {
  const newest = new Map();
  for (const report of reports) {
    const routine = report.scheduleId ?? report.id;
    const known = newest.get(routine);
    if (!known || Date.parse(report.at) > Date.parse(known.at)) newest.set(routine, report);
  }
  return [...newest.values()]
    .filter(({ id }) => !read.has(id))
    .map(report => ({ ...report, triage: reportTriage({ status: report.outcome, result: { text: report.body } }) }))
    .filter(({ triage }) => triage?.next);
}

const launchTrouble = ({ slug, project, item, note, liveAt, pushedAt, mergedAt }, now) => ({
  key: `launch:${slug}:${item}`,
  tab: 'work',
  fact: `${project}, ${note ?? 'trouble'}${sinceWhen(liveAt ?? pushedAt ?? mergedAt, now)}`,
});

const reportTrouble = ({ id, title, triage }) => ({ key: `report:${id}`, tab: 'reports', report: id, fact: `${title}: ${triage.next}` });

// A step can be in both places. The finished-work row comes first and stays, because it has the branch its page shows.
function yoursRows(ready, attention) {
  const steps = [...ready.filter(({ gap, left }) => gap === 'yours' || left), ...attention.filter(({ kind }) => kind === 'item')];
  const once = new Map();
  for (const step of steps) {
    const key = `${step.slug}:${step.item}`;
    if (!once.has(key)) once.set(key, step);
  }
  return [...once.values()];
}

function readFact(branches, calls, now) {
  const reports = calls.length ? plural(calls.length, 'report') : '';
  if (!branches.length) return `${reports}, oldest ${oldest(calls, now)}`;
  const projects = new Set(branches.map(({ project }) => project));
  const spread = projects.size === 1 ? `in ${branches[0].project}` : `across ${projects.size} projects`;
  const lines = linesIn(branches);
  return [lines ? `${shortNumber(lines)} lines ${spread}` : spread, reports].filter(Boolean).join(', ');
}

function questionFact(questions, now) {
  const dated = questions.filter(({ at }) => at);
  return dated.length ? `oldest ${oldest(dated, now)}` : questions[0].title;
}

function readyFact(rows) {
  const lines = linesIn(rows);
  return lines ? `with proof, about ${shortNumber(Math.round(lines / 10) * 10)} lines` : 'with proof';
}

const row = (name, label, items, fact) => (items.length ? [{ name, count: items.length, label, fact: fact() }] : []);

/**
 * Everything the card counts, one row each, for the Decisions tab to list under the questions it already holds. A report that went wrong
 * keeps what opens it, `asks` are work mode's questions and `proposals` learning's. Nothing here reads or writes anything.
 */
export function waitingRows({ ready = [], attention = [], proposals = [], launches = [], reports = [], read = new Set(), now }) {
  const calls = reportCalls(reports, read);
  const wentWrong = ({ triage }) => WENT_WRONG.includes(triage.level);
  return {
    wrong: [
      ...launches.filter(({ outcome, fixed }) => outcome === 'trouble' && !fixed).map(launch => launchTrouble(launch, now)),
      ...calls.filter(wentWrong).map(reportTrouble),
    ],
    asks: attention.filter(({ kind }) => ASKS.includes(kind)),
    proposals,
    branches: ready.filter(entry => isReady(entry) || isToRead(entry)),
    yours: yoursRows(ready, attention),
    reports: calls.filter(call => !wentWrong(call)),
  };
}

/** What waits on the user, across every routine and work mode, as the card's rows. Each fact is worked out from what is given, and nothing here reads or writes anything. */
export function pendingCard({ decisions = [], now, ...given }) {
  const { wrong, asks, proposals, branches, yours, reports } = waitingRows({ now, ...given });
  const landable = branches.filter(isReady);
  const branchesToRead = branches.filter(isToRead);
  const open = decisions.filter(({ answerTo }) => !NOT_QUESTIONS.includes(answerTo?.kind));
  const questions = [...open, ...asks, ...proposals];
  const groups = [
    ...row('ready', 'ready', landable, () => readyFact(landable)),
    ...row('read', 'to read', [...branchesToRead, ...reports], () => readFact(branchesToRead, reports, now)),
    ...row('wrong', 'went wrong', wrong, () => wrong[0].fact),
    ...row('questions', questions.length === 1 ? 'question' : 'questions', questions, () => questionFact(questions, now)),
    ...row('yours', 'yours', yours, () => yours.slice(0, 2).map(({ title }) => title).join(', ')),
  ];
  const total = groups.reduce((sum, { count }) => sum + count, 0);
  return {
    total,
    groups,
    trouble: wrong.map(({ fact, ...target }) => target),
    // Decisions lists all of it, with work mode on or off.
    walk: total ? 'decisions' : 'chat',
  };
}

export const cardQuestion = ({ total }) => `${total} waiting. How do you want to tackle them?`;

/** `Not now` comes first because Enter takes the first. */
export function cardChoices({ groups }) {
  const ready = groups.find(({ name }) => name === 'ready');
  return [
    { value: 'later', label: 'Not now' },
    ...(ready ? [{ value: 'ready', label: `Start with the ${ready.count} ready` }] : []),
    ...(groups.some(({ name }) => name === 'wrong') ? [{ value: 'wrong', label: 'Just what went wrong' }] : []),
    { value: 'walk', label: 'Walk it all' },
  ];
}

/** The card in plain words, for the main agent when the user types their own answer. */
export const cardEvidence = ({ total, groups }) => [
  `${total} waiting.`,
  ...groups.map(({ count, label, fact }) => `${count} ${label}: ${fact}`),
].join('\n');

/** The card comes to a user who is there and whose screen is free. A key or a click is enough, because Herdr may never pass focus reports on. */
export const canShowCard = ({ presence: { seenAt, away, occupied }, busy, now }) => !away && !occupied && !busy && now - seenAt < PRESENT_MS;

/** Whether there is enough to bring up. After a card it stays quiet for 4 hours, unless 5 more arrive or something new went wrong. */
export function cardDue({ total, trouble, last, now }) {
  if (total < CARD_BAR) return false;
  if (!last) return true;

  const quietIsOver = now - Date.parse(last.at) >= CARD_QUIET_MS;
  const moreArrived = total >= last.total + CARD_MORE;
  const seen = new Set(last.trouble.map(({ key }) => key));
  const newTrouble = trouble.some(({ key }) => !seen.has(key));
  return quietIsOver || moreArrived || newTrouble;
}
