import { isActionItem } from './decisions.mjs';
import { heldByItsGrade } from './work/reads.mjs';

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const PRESENT_MS = 2 * MINUTE_MS;

// A layer of a stack that waits for the one under it (`stacked`) is a change of its own to read, and the window needs every layer to draw the stack.
const TO_READ = ['land', 'rebase', 'elsewhere', 'unlanded', 'stacked'];
const ASKS = ['allowance', 'proposal'];
// Each of these is about branches that already have their rows, or is the old card about the pile itself.
const NOT_QUESTIONS = ['land', 'merge', 'read', 'pair', 'pending'];

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

const launchTrouble = ({ slug, project, item, note, liveAt, pushedAt, mergedAt }, now) => ({
  key: `launch:${slug}:${item}`,
  tab: 'work',
  fact: `${project}, ${note ?? 'trouble'}${sinceWhen(liveAt ?? pushedAt ?? mergedAt, now)}`,
});

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

function readFact(branches) {
  const projects = new Set(branches.map(({ project }) => project));
  const spread = projects.size === 1 ? `in ${branches[0].project}` : `across ${projects.size} projects`;
  const lines = linesIn(branches);
  return lines ? `${shortNumber(lines)} lines ${spread}` : spread;
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
 * Everything the card counts, one row each, for Action Items to list under the questions and items it already holds.
 * `asks` are work mode's questions and `proposals` learning's. Nothing here reads or writes anything.
 */
export function waitingRows({ ready = [], attention = [], proposals = [], launches = [], now }) {
  return {
    wrong: launches.filter(({ outcome, fixed }) => outcome === 'trouble' && !fixed).map(launch => launchTrouble(launch, now)),
    asks: attention.filter(({ kind }) => ASKS.includes(kind)),
    proposals,
    branches: ready.filter(entry => isReady(entry) || isToRead(entry)),
    yours: yoursRows(ready, attention),
    reports: [],
  };
}

/** What waits on the user, across every routine and work mode, one row per group. Each fact is worked out from what is given, and nothing here reads or writes anything. */
export function pendingCard({ decisions = [], now, ...given }) {
  const { wrong, asks, proposals, branches, yours } = waitingRows({ now, ...given });
  const landable = branches.filter(isReady);
  const branchesToRead = branches.filter(isToRead);
  const open = decisions.filter(({ answerTo }) => !NOT_QUESTIONS.includes(answerTo?.kind));
  const toDo = open.filter(isActionItem);
  const questions = [...open.filter(decision => !isActionItem(decision)), ...asks, ...proposals];
  const groups = [
    ...row('ready', 'ready', landable, () => readyFact(landable)),
    ...row('read', 'to read', branchesToRead, () => readFact(branchesToRead)),
    ...row('wrong', 'went wrong', wrong, () => wrong[0].fact),
    ...row('questions', questions.length === 1 ? 'question' : 'questions', questions, () => questionFact(questions, now)),
    ...row('todo', 'to do', toDo, () => toDo[0].tldr),
    ...row('yours', 'yours', yours, () => yours.slice(0, 2).map(({ title }) => title).join(', ')),
  ];
  const total = groups.reduce((sum, { count }) => sum + count, 0);
  return { total, groups };
}

/** The user is there for two minutes after a key, a click or gaining focus. A key or a click is enough, because a terminal may never pass focus reports on. */
export const isPresent = ({ seenAt, away }, now) => !away && now - seenAt < PRESENT_MS;

/** A question comes to a user who is there and whose screen is free. */
export const canShowCard = ({ presence, busy, now }) => isPresent(presence, now) && !presence.occupied && !busy;
