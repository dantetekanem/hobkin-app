import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from './config.mjs';
import { fileDecision, openDecisions } from './decisions.mjs';
import { isGuardedKind } from './outward.mjs';

/**
 * How much a task class may do alone (075-chief-of-staff). Trust belongs to a task class, never to an agent, because what an agent does
 * well in one kind of work says nothing about another (notes §5). The ledger is local, in `runtime/autonomy.json`:
 *
 *   {
 *     "version": 1,
 *     "classes": {
 *       "code-fix:hobkin": {
 *         "level": "recommend",
 *         "runs": 7,                      every run's own outcome
 *         "cleanStreak": 2,               clean runs in a row since the level last changed, an override, an undo or the user's no
 *         "checks": { "passed": 6, "failed": 1 },
 *         "overrides": 1,
 *         "undos": 0,
 *         "reviewMinutes": { "sum": 31, "count": 5, "recent": [4, 9, ...] },  measured, never asked; `recent` keeps the median
 *         "changedAt": "..."              when the level last changed, or null
 *       }
 *     }
 *   }
 *
 * A task class is a kind of work, `<kind>` or `<kind>:<project slug>`: lowercase words joined by hyphens, then the project's work-mode
 * slug when the class is one project's. `code-fix` is fixes anywhere and `code-fix:hobkin` fixes in that one project. Each key is its own
 * class with its own row, so trust earned in one project does not carry to another. Only a standing level (`SEEDED_LEVELS`) is set by
 * kind, and reaches every project's class of that kind.
 */
export const autonomyPath = root => join(root, 'runtime', 'autonomy.json');

/** The five levels, from the one the user watches most to the one they watch least. */
export const LEVELS = ['draft', 'recommend', 'deadline', 'report', 'log'];

/** What a class at each level does, said to the user: `does` in a choice, `ask` in the question. */
const LEVEL_WORDS = {
  draft: { does: 'drafts and leaves the rest to you', ask: 'draft and leave the rest to you' },
  recommend: { does: 'recommends and waits for your yes', ask: 'recommend and wait for your yes' },
  deadline: { does: 'acts at a deadline unless you object', ask: 'act at a deadline unless you object' },
  report: { does: 'acts and reports in the digest', ask: 'act and report in the digest' },
  log: { does: 'acts and logs', ask: 'act and log' },
};

/** Where a class starts when nothing set it: hobkin recommends and the user decides. */
const STARTING_LEVEL = 'recommend';

/** Clean runs in a row before hobkin asks, once, to let the class do more alone. */
export const PROMOTION_STREAK = 5;

/** Review times kept one by one, for the median. The sum and the count keep every one. */
const RECENT_REVIEWS = 25;

/** Branch work on code, in any project. */
export const CODE_BRANCH_WORK = 'code-branch';

/** The user's choices of 2026-11-26, the first rows: code branch work acts and reports in the digest. */
export const SEEDED_LEVELS = Object.freeze({ [CODE_BRANCH_WORK]: 'report' });

const TASK_CLASS = /^[a-z][a-z0-9-]{0,59}(?::[a-z0-9][a-z0-9-]{0,59})?$/;
// A brief's `Task class: code-fix:hobkin` line, in any case, with what follows the colon taken as written.
const TASK_CLASS_LINE = /^[ \t]*task class:[ \t]*(.*?)\s*$/im;
const GUARD_CEILING = LEVELS.indexOf('recommend');

function assertTaskClass(taskClass) {
  if (typeof taskClass !== 'string' || !TASK_CLASS.test(taskClass)) {
    throw Error('A task class is a lowercase kind joined by hyphens, with a project slug after one colon or none, such as code-fix:hobkin.');
  }
}

const kindOf = taskClass => taskClass.split(':')[0];

/**
 * Whether a class stays at recommend or above without a standing rule: sending anything in the user's name, spending, deleting, committing
 * the user's time to other people, anything irreversible, and anything about health, money or law, by any word of the class (`outward.mjs`).
 */
export function needsStandingRule(taskClass) {
  assertTaskClass(taskClass);
  return isGuardedKind(taskClass);
}

/** A level no further from draft than the class may go. */
function capped(taskClass, level) {
  const pastTheGuard = needsStandingRule(taskClass) && LEVELS.indexOf(level) > GUARD_CEILING;
  return pastTheGuard ? LEVELS[GUARD_CEILING] : level;
}

const startingLevel = taskClass => capped(taskClass, SEEDED_LEVELS[kindOf(taskClass)] ?? STARTING_LEVEL);

const count = value => (Number.isInteger(value) && value >= 0 ? value : 0);
const isMinutes = value => Number.isFinite(value) && value >= 0;
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A row as saved, with what a hand edit or an older file lacks filled in. A level hobkin does not know is the class's start. */
function rowOf(taskClass, saved = {}) {
  const reviews = record(saved.reviewMinutes) ? saved.reviewMinutes : {};
  const recentReviews = Array.isArray(reviews.recent) ? reviews.recent : [];
  return {
    level: capped(taskClass, LEVELS.includes(saved.level) ? saved.level : startingLevel(taskClass)),
    runs: count(saved.runs),
    cleanStreak: count(saved.cleanStreak),
    checks: { passed: count(saved.checks?.passed), failed: count(saved.checks?.failed) },
    overrides: count(saved.overrides),
    undos: count(saved.undos),
    reviewMinutes: {
      sum: isMinutes(reviews.sum) ? reviews.sum : 0,
      count: count(reviews.count),
      recent: recentReviews.filter(isMinutes).slice(-RECENT_REVIEWS),
    },
    changedAt: typeof saved.changedAt === 'string' ? saved.changedAt : null,
  };
}

/** Every saved class whose key is a task class. A file that cannot be read is a fresh start, as the other runtime files are. */
function readLedger(root) {
  try {
    const saved = JSON.parse(readFileSync(autonomyPath(root), 'utf8'));
    if (saved?.version !== 1 || !record(saved.classes)) return {};
    return Object.fromEntries(Object.entries(saved.classes).filter(([key, row]) => TASK_CLASS.test(key) && record(row)));
  } catch {
    return {};
  }
}

/** Each class hobkin knows, with the standing ones that have no run yet, by task class. */
export function readAutonomy(root) {
  const saved = readLedger(root);
  const keys = [...new Set([...Object.keys(SEEDED_LEVELS), ...Object.keys(saved)])].toSorted();
  return Object.fromEntries(keys.map(key => [key, rowOf(key, saved[key])]));
}

/** Changes one class's row and saves the ledger. */
function change(root, taskClass, edit) {
  assertTaskClass(taskClass);
  const saved = readLedger(root);
  const row = rowOf(taskClass, saved[taskClass]);
  edit(row);
  atomicJson(autonomyPath(root), { version: 1, classes: { ...saved, [taskClass]: row } });
  return row;
}

function moveTo(row, level, now) {
  if (level !== row.level) Object.assign(row, { level, changedAt: new Date(now).toISOString() });
  row.cleanStreak = 0;
}

/** The level one step back toward draft, or draft itself. */
const levelBefore = level => LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)];

/** What a class may do alone now. A class with no row starts at its kind's standing level, or at recommend. */
export function levelFor(root, taskClass) {
  assertTaskClass(taskClass);
  return rowOf(taskClass, readLedger(root)[taskClass]).level;
}

/**
 * One outcome for a class. A run's own outcome carries `clean`, and only that counts a run. An override or an undo that comes later, alone,
 * is no new run. `checksPassed` is whether the run's checks passed, left out when none ran. `reviewMinutes` is how long the user took to
 * review it, as measured. A run is clean only when it says so, its checks did not fail and nobody overrode or undid it.
 *
 * An override or an undo moves the class one level back toward draft at once, with no question, and its clean streak starts again.
 */
export function recordOutcome(root, taskClass, { clean, checksPassed, override = false, undo = false, reviewMinutes } = {}, now = Date.now()) {
  assertTaskClass(taskClass);
  if (reviewMinutes !== undefined && !isMinutes(reviewMinutes)) throw Error('`reviewMinutes` is a number of minutes, 0 or more.');
  return change(root, taskClass, row => {
    if (typeof clean === 'boolean') row.runs += 1;
    if (checksPassed === true) row.checks.passed += 1;
    if (checksPassed === false) row.checks.failed += 1;
    if (override) row.overrides += 1;
    if (undo) row.undos += 1;
    if (reviewMinutes !== undefined) {
      row.reviewMinutes.sum += reviewMinutes;
      row.reviewMinutes.count += 1;
      row.reviewMinutes.recent = [...row.reviewMinutes.recent, reviewMinutes].slice(-RECENT_REVIEWS);
    }
    if (override || undo) moveTo(row, levelBefore(row.level), now);
    else if (clean === true && checksPassed !== false) row.cleanStreak += 1;
    else if (typeof clean === 'boolean') row.cleanStreak = 0;
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The level one step further from draft, or null when the class is at log or may not go further without a standing rule. */
function nextLevel(taskClass, level) {
  const next = LEVELS[LEVELS.indexOf(level) + 1];
  return next && capped(taskClass, next) === next ? next : null;
}

const isDue = (taskClass, row) => row.cleanStreak >= PROMOTION_STREAK && nextLevel(taskClass, row.level) !== null;

const plural = (number, word) => `${number} ${word}${number === 1 ? '' : 's'}`;

/**
 * The question for a class that is due, as a plain `hobkin decide` card. Its `kind` only labels it: it keeps no rule, because a yes moves
 * this class one level once and must never answer a later promotion.
 */
function promotionCard(taskClass, row) {
  const next = nextLevel(taskClass, row.level);
  const reviewed = median(row.reviewMinutes.recent);
  const reasons = [`${row.cleanStreak} clean runs in a row since its last change, none overridden or undone.`];
  if (reviewed !== null) reasons.push(`Your review took a median of ${plural(Math.round(reviewed), 'minute')}.`);
  const why = reasons.join(' ');
  return {
    key: `autonomy:${taskClass}:${next}`,
    taskClass,
    question: `${taskClass} ran clean ${row.cleanStreak} times in a row. Should it ${LEVEL_WORDS[next].ask} from now on?`,
    choices: [
      { value: 'yes', label: `Yes, it ${LEVEL_WORDS[next].does}` },
      { value: 'no', label: `No, it still ${LEVEL_WORDS[row.level].does}` },
    ],
    recommended: 'yes',
    why,
    kind: 'autonomy',
  };
}

/**
 * The one question to file once a class has run clean `PROMOTION_STREAK` times in a row, or null. Asking changes nothing: only the user's
 * yes does, through `promote`, and their no through `declinePromotion`. The card's `key` keeps it one question while it is open.
 */
export function promotionDue(root, taskClass) {
  assertTaskClass(taskClass);
  const row = rowOf(taskClass, readLedger(root)[taskClass]);
  return isDue(taskClass, row) ? promotionCard(taskClass, row) : null;
}

/** The user's yes: the class moves one level further from draft, and its clean streak starts again. */
export function promote(root, taskClass, now = Date.now()) {
  return change(root, taskClass, row => {
    if (row.level === 'log') throw Error(`${taskClass} already acts and logs.`);
    const next = nextLevel(taskClass, row.level);
    if (!next) throw Error(`${taskClass} stays at recommend or above without a standing rule.`);
    moveTo(row, next, now);
  });
}

/** The user's no: the level stays, and the streak starts again, so hobkin asks again only after another full streak. */
export function declinePromotion(root, taskClass) {
  return change(root, taskClass, row => {
    row.cleanStreak = 0;
  });
}

/** Branch work on code in one work-mode project, by its slug. */
export const codeBranchClass = slug => `${CODE_BRANCH_WORK}:${slug}`;

/**
 * The task class a session's brief names on a line of its own, `Task class: code-fix:hobkin`, or null when no line names one. A class hobkin
 * cannot read is refused, so the brief's writer fixes it before the session starts.
 */
export function taskClassIn(brief) {
  const named = TASK_CLASS_LINE.exec(brief)?.[1];
  if (named === undefined) return null;

  assertTaskClass(named);
  return named;
}

const isAskingFor = taskClass => ({ answerTo }) => answerTo?.kind === 'autonomy' && answerTo.taskClass === taskClass;

/** Files the promotion question when the class is due and none is open for it, whatever level that one would move the class to. */
function askToPromote(root, taskClass, now) {
  const card = promotionDue(root, taskClass);
  if (!card || openDecisions(root).some(isAskingFor(taskClass))) return null;
  return fileDecision(root, { ...card, from: 'hobkin', answerTo: { kind: 'autonomy', taskClass } }, now);
}

/**
 * One outcome, as `recordOutcome` takes it, from the places work ends: a merge, the user's no, a branch sent back, an undo or a session's end.
 * After a clean one, the promotion question is filed once it is due. It never throws: the work it records has already happened, and a ledger
 * that cannot take it costs only the record. Gives the class's row, or null when nothing was recorded.
 */
export function noteOutcome(root, taskClass, outcome, now = Date.now()) {
  let row;
  try {
    row = recordOutcome(root, taskClass, outcome, now);
  } catch {
    return null;
  }
  try {
    if (outcome.clean === true) askToPromote(root, taskClass, now);
  } catch {
    // A question that cannot be filed now is asked after the next clean run, since the streak still stands.
  }
  return row;
}

/** The user's answer to a promotion question (`answer.mjs`): yes moves the class one level further from draft, and no keeps it where it is. */
export function answerPromotion(root, taskClass, value, now = Date.now()) {
  const promoted = value === 'yes';
  const { level } = promoted ? promote(root, taskClass, now) : declinePromotion(root, taskClass);
  return { ok: true, message: `${taskClass} ${promoted ? 'now' : 'still'} ${LEVEL_WORDS[level].does}.` };
}

const classView = (taskClass, row) => ({
  level: row.level,
  cleanStreak: row.cleanStreak,
  overrides: row.overrides,
  undos: row.undos,
  medianReviewMinutes: median(row.reviewMinutes.recent),
  promotionDue: isDue(taskClass, row),
});

/** `hobkin telemetry autonomy`: each class's level, clean streak, overrides, undos, median review minutes and whether a promotion is due. */
export function autonomyView(root) {
  const classes = Object.entries(readAutonomy(root)).map(([taskClass, row]) => [taskClass, classView(taskClass, row)]);
  return { classes: Object.fromEntries(classes) };
}
