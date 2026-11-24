import { CRITERIA, KINDS, SMALL_KINDS } from './classified.mjs';
import { chosenProjects, isGoal, readMode, REVIEW_PULLS, writeMode } from './store.mjs';

/**
 * Every rule that decides whether YOLO mode merges a change, as a setting (spec 063). Each default is what the code did before the setting
 * existed, so a home that set nothing answers as it always did. They are kept in work mode's own file: `yolo.rules` for all projects,
 * `yoloProjectRules.<slug>` for what one project differs in, and the lowest rate stays at `yolo.rate`. Only the window's click writes one, as
 * with the main switch: no `hobkin work` command and no agent tool calls `setYoloRules`.
 */

export const USUAL_RATE = 8;
export const LOWEST_RATE = 1;
export const HIGHEST_RATE = 10;
/** The words today's rule asks about in a path, as plain text matched anywhere in the lowercased path. `/ci/` is a folder named ci, as before. */
export const SENSITIVE_WORDS = [
  'migrat', 'schema', 'auth', 'session', 'token', 'secret', 'credential', 'password', 'payment', 'billing', 'deploy', 'kamal', 'dockerfile',
  'docker-compose', 'fly.toml', 'procfile', 'vercel.json', 'netlify.toml', 'render.yml', 'render.yaml', '.github/', '.gitlab-ci', '.circleci', 'jenkinsfile', '/ci/',
];
const MOST_PATH_WORDS = 100;
const LONGEST_WORD = 80;
const MOST_PER_PASS = 5;
const MOST_TRIES = 10;

export const RULE_DEFAULTS = {
  testsPass: true,
  wayBackKnown: true,
  noModelBreaks: true,
  brokenModelFixMayMerge: false,
  holdAfterRegression: true,
  mergePulls: false,
  mergeWhenChecksUnlisted: false,
  lowestRate: USUAL_RATE,
  floorCoverage: 5,
  floorProof: 5,
  floorSafety: 8,
  floorVisibility: 7,
  floorRollback: 7,
  kinds: SMALL_KINDS,
  mostLines: 300,
  mostAreas: 2,
  deletedTestsMayMerge: false,
  oneWayUndoMayMerge: false,
  earlierBranchesMayMerge: false,
  leftNoteMayMerge: false,
  askPaths: SENSITIVE_WORDS,
  mergesAPass: 1,
  keptCurrent: 3,
  backgroundADay: 20,
  tries: 3,
  reviewPulls: 'none',
};

/** The settings only all projects share: reviews are made for a repository, not for a project's rules. */
export const ALL_PROJECTS_ONLY = ['keptCurrent', 'backgroundADay', 'tries', 'reviewPulls'];
/** Where a score's lowest is kept, for each of the five questions. */
export const FLOOR_RULES = Object.fromEntries(CRITERIA.map(criterion => [criterion, `floor${criterion[0].toUpperCase()}${criterion.slice(1)}`]));

const isCount = value => Number.isInteger(value) && value >= 1;
const inRange = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

/** A rate is a number from 1 to 10 with at most one decimal. */
export const isRate = rate => Number.isFinite(rate) && rate >= LOWEST_RATE && rate <= HIGHEST_RATE && Math.abs(rate * 10 - Math.round(rate * 10)) < 1e-9;

const switchOf = words => on => {
  if (typeof on !== 'boolean') throw Error(`${words} is on or off.`);
  return on;
};
const countOrNone = words => count => {
  if (count !== null && !isCount(count)) throw Error(`${words} is a whole number of 1 or more, or none for no limit.`);
  return count;
};
const floorOf = words => score => {
  if (!Number.isInteger(score)) throw Error(`${words} is a whole number from 1 to 10.`);
  if (!inRange(score, 1, 10)) throw Error(`${words} is from 1 to 10.`);
  return score;
};

const checks = {
  testsPass: switchOf('Merging only while tests pass on the default branch'),
  wayBackKnown: switchOf('Merging only while a way back is known'),
  noModelBreaks: switchOf('Merging only while no model breaks on the default branch'),
  brokenModelFixMayMerge: switchOf('A change that makes a broken model hold merging while it breaks'),
  holdAfterRegression: switchOf('Holding a project after a regression its deploy showed'),
  mergePulls: switchOf('Merging hobkin\'s own pull requests'),
  mergeWhenChecksUnlisted: switchOf('Merging a pull request when GitHub\'s required checks cannot be listed'),
  lowestRate: rate => {
    if (!Number.isFinite(rate)) throw Error(`The lowest general rate is a number from ${LOWEST_RATE} to ${HIGHEST_RATE}.`);
    if (rate < LOWEST_RATE || rate > HIGHEST_RATE) throw Error(`The lowest general rate is from ${LOWEST_RATE} to ${HIGHEST_RATE}.`);
    if (!isRate(rate)) throw Error('The lowest general rate takes one decimal at most.');
    return rate;
  },
  floorCoverage: floorOf('The lowest score for coverage'),
  floorProof: floorOf('The lowest score for proof'),
  floorSafety: floorOf('The lowest score for safety'),
  floorVisibility: floorOf('The lowest score for visibility'),
  floorRollback: floorOf('The lowest score for rollback'),
  kinds: kinds => {
    if (!Array.isArray(kinds)) throw Error('Kinds that may merge is a list of kinds.');
    const unknown = kinds.filter(kind => !KINDS.includes(kind));
    if (unknown.length) throw Error(`Not a kind of change: ${unknown.join(', ')}. The kinds are ${KINDS.join(', ')}.`);
    if (!kinds.length) throw Error('Kinds that may merge needs at least one kind.');
    return KINDS.filter(kind => kinds.includes(kind));
  },
  mostLines: countOrNone('The largest change, in changed lines,'),
  mostAreas: countOrNone('The most areas a change may touch'),
  deletedTestsMayMerge: switchOf('A change that deletes tests merging'),
  oneWayUndoMayMerge: switchOf('A change whose way back is one-way merging'),
  earlierBranchesMayMerge: switchOf('A change that brings earlier branches merging'),
  leftNoteMayMerge: switchOf('A change whose run left a note for the user merging'),
  askPaths: words => {
    if (!Array.isArray(words)) throw Error('Paths that always ask is a list of words.');
    if (words.length > MOST_PATH_WORDS) throw Error(`Paths that always ask takes at most ${MOST_PATH_WORDS} words.`);
    const kept = words.map(word => (typeof word === 'string' ? word.trim().toLowerCase() : ''));
    if (kept.some(word => !word)) throw Error('Each word in paths that always ask is plain text, not empty.');
    if (kept.some(word => word.length > LONGEST_WORD)) throw Error(`Each word in paths that always ask is at most ${LONGEST_WORD} characters.`);
    return [...new Set(kept)];
  },
  mergesAPass: count => {
    if (!inRange(count, 1, MOST_PER_PASS)) throw Error(`Most merges a project in one pass is a whole number from 1 to ${MOST_PER_PASS}.`);
    return count;
  },
  keptCurrent: countOrNone('Reviews kept current for a repository'),
  backgroundADay: countOrNone('Background reviews a day'),
  tries: count => {
    if (!inRange(count, 1, MOST_TRIES)) throw Error(`Tries to get all five ratings is a whole number from 1 to ${MOST_TRIES}.`);
    return count;
  },
  reviewPulls: which => {
    if (!REVIEW_PULLS.includes(which)) throw Error('Pull requests rated by themselves are none, mine, waiting or both.');
    return which;
  },
};

const hasOwn = (object, name) => Object.hasOwn(object ?? {}, name);
const plain = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

// A stored value no setter would write reads as unset, so a damaged file never changes what merges.
function valid(name, value) {
  try {
    checks[name](value);
    return true;
  } catch {
    return false;
  }
}

function kept(stored) {
  return Object.fromEntries(Object.entries(plain(stored)).filter(([name, value]) => hasOwn(checks, name) && valid(name, value)).map(([name, value]) => [name, checks[name](value)]));
}

const projectRulesOf = (mode, slug) => kept(plain(mode.yoloProjectRules)[slug]);
const everyRulesOf = mode => kept(plain(mode.yolo).rules);

function allRatesOf(mode) {
  const { rate } = plain(mode.yolo);
  return isRate(rate) ? { lowestRate: rate } : {};
}

const pullsOf = mode => (REVIEW_PULLS.includes(mode.reviewPulls) ? { reviewPulls: mode.reviewPulls } : {});

/** Every rule in force for a project, or for all of them with no slug: the defaults, then what the user set for all projects, then for the project. */
export function rulesOf(root, slug = null, mode = readMode(root)) {
  const all = { ...RULE_DEFAULTS, ...everyRulesOf(mode), ...allRatesOf(mode), ...pullsOf(mode) };
  return slug ? { ...all, ...projectRulesOf(mode, slug) } : all;
}

/** The names of the rules a project sets for itself, which differ from the rest. */
export const overridesOf = (root, slug, mode = readMode(root)) => Object.keys(projectRulesOf(mode, slug));

function checkedChange(change) {
  const names = Object.keys(change ?? {}).filter(name => name !== 'same');
  const unknown = names.filter(name => !hasOwn(checks, name));
  if (unknown.length) throw Error(`Not a YOLO setting: ${unknown.join(', ')}.`);
  return Object.fromEntries(names.map(name => [name, checks[name](change[name])]));
}

function sameNames(change) {
  const same = change?.same ?? [];
  if (!Array.isArray(same)) throw Error('Same as all projects is a list of settings.');
  const unknown = same.filter(name => !hasOwn(checks, name));
  if (unknown.length) throw Error(`Not a YOLO setting: ${unknown.join(', ')}.`);
  return same;
}

/**
 * What a change to the settings of all projects writes into the mode, every value checked first. The lowest rate goes where the main switch
 * keeps it, and the pull requests rated by themselves where the workload keeps them, so nothing a home holds moves.
 */
export function everyProjectPatch(mode, change) {
  if (sameNames(change).length) throw Error('Same as all projects is for one project: the settings of all projects have nothing to return to.');
  const { lowestRate, reviewPulls, ...rules } = checkedChange(change);
  const yolo = plain(mode.yolo);
  const rate = lowestRate === undefined ? {} : { rate: lowestRate };
  const pulls = reviewPulls === undefined ? {} : { reviewPulls };
  return { rules: { ...plain(yolo.rules), ...rules }, ...rate, ...pulls };
}

function projectPatch(mode, slug, change) {
  const picked = checkedChange(change);
  const returned = sameNames(change);
  const apart = ALL_PROJECTS_ONLY.filter(name => hasOwn(picked, name) || returned.includes(name));
  if (apart.length) throw Error(`${apart.join(', ')} is a setting of all projects, not of one project.`);
  const own = { ...plain(plain(mode.yoloProjectRules)[slug]), ...picked };
  for (const name of returned) delete own[name];
  return { ...plain(mode.yoloProjectRules), [slug]: own };
}

/**
 * The user's word on what YOLO mode may do, from the window alone, for all projects (no slug) or the differences of one project. Every value is
 * checked before any is written, and one that is refused changes nothing. `same` returns a project's named settings to those of all projects.
 */
export function setYoloRules(root, slug, change) {
  if (!Object.keys(change ?? {}).length) throw Error('Name a YOLO setting to change.');
  const mode = readMode(root);
  if (slug === null || slug === undefined) {
    const { rules, rate, reviewPulls } = everyProjectPatch(mode, change);
    const yolo = { ...plain(mode.yolo), rules, ...(rate === undefined ? {} : { rate }) };
    writeMode(root, { yolo, ...(reviewPulls === undefined ? {} : { reviewPulls }) });
    return rulesOf(root, null);
  }
  const project = chosenProjects(root).find(chosen => chosen.slug === slug);
  if (!project) throw Error(`${slug} is not a project work mode works on.`);
  if (isGoal(project)) throw Error('A goal has nothing to merge, so YOLO mode does nothing there.');
  writeMode(root, { yoloProjectRules: projectPatch(mode, slug, change) });
  return rulesOf(root, slug);
}

/** The lowest score of each question, from the rules, in the shape `scoresOf` takes. */
export const floorsOf = rules => Object.fromEntries(Object.entries(FLOOR_RULES).map(([criterion, name]) => [criterion, rules[name]]));
