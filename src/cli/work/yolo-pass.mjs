import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postClientNotice } from '../client-notices.mjs';
import { CRITERIA, scoresOf } from './classified.mjs';
import { mergeItem, whyWorkModeWaits } from './controls.mjs';
import { AFTER_DEPLOY_MINUTES, deployHeld, READINGS, readingFrom, sawIn } from './deploys.mjs';
import { userTrouble } from './launches.mjs';
import { readMachines, unmodeledIn } from './machines.mjs';
import { askRecheck } from './proof-checks.mjs';
import { GRADED_BY } from './review-grades.mjs';
import { nameOf } from './names.mjs';
import { changeHoldsWith } from './patterns.mjs';
import { changeModels, scoresHoldAt, specName } from './proofs.mjs';
import { heldByItsGrade, landingList, ratingWords, weighedRows } from './reads.mjs';
import { readMode, readProject, retryItem, updateItem } from './store.mjs';
import { readUnmerged } from './unmerged.mjs';
import { holdProject, prepareProjects, readinessOf, readYolo, settleSwitches, yoloOnProject } from './yolo.mjs';
import { FLOOR_RULES, floorsOf, RULE_DEFAULTS, rulesOf } from './yolo-rules.mjs';
import { defaultPullGh, mergeOwnPull, pullCandidates, PULLS_OFF, pullSurveyed, signedInUser } from './yolo-pulls.mjs';

/**
 * The one place a change merges with no yes from the user. It runs after the director's own survey and returns at once while YOLO mode is off.
 * A change goes only on a project that is ready and that YOLO mode is on for, as a finished local branch or its own open pull request the
 * landing list would let go, scored by its review at the exact commit the survey read, or at one whose code that commit still has because only
 * models changed since, of a small kind, with no floor broken and at or above the user's rate. A local branch merges by hobkin's own merge,
 * pinned to the commit the survey read, and a pull request on the code host, pinned the same way, once the host says it may (`yolo-pulls.mjs`).
 * Every merge is written down and said in Chat. Code never deploys: a deploy is handed to the main agent.
 */

const SHORT_SHA = 7;
// A finished change waits to merge as a local branch or as its own open pull request.
const WAITS_TO_MERGE = ['branch', 'pr'];
export { AFTER_DEPLOY_MINUTES, READINGS };
export const kindWords = {
  performance: 'performance work',
  'bug-fix': 'a bug fix',
  'state-machine': 'a state machine fix',
  'package-update': 'a package update',
  'small-change': 'a small change',
  feature: 'a feature',
  unclear: 'a change its review could not place',
};
export const deployWords = {
  'handed on': 'Its deploy is with the main agent.',
  'not handed on': 'Nothing was deployed.',
  'nothing deploys': 'Nothing deploys on this project.',
  'no deploy path': 'Nothing was deployed: its deploy path is not set up yet.',
};

const ledgerPath = root => join(root, 'work', 'yolo.jsonl');
// A change to code a model covers merges by itself only when that model holds at the change's head.
const modelWords = {
  broken: ({ spec, why }) => `its model ${specName(spec)} breaks at this commit${why ? `: ${why}` : ''}`,
  unproven: ({ spec, why }) => `its model ${specName(spec)} did not hold at this commit${why ? `: ${why}` : ''}`,
  unchecked: ({ spec }) => `its model ${specName(spec)} has not been checked at this commit yet`,
};

function readJsonLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      // A line cut short by a crash costs that line and nothing else.
      return [];
    }
  });
}

const asks = (why, setting = null) => ({ why, setting });

const brokenVerb = specs => (specs.length > 1 ? 'break' : 'breaks');

// A project held by a broken model says which, as the models part names it, so the user sees what to fix or which switch to move.
function notReady({ holds = [], brokenModels = [] }) {
  const named = brokenModels.map(specName).join(', ');
  return holds.includes('noModelBreaks') && named ? `its project is not ready for YOLO mode: ${named} ${brokenVerb(brokenModels)} on the default branch` : 'its project is not ready for YOLO mode';
}

// With a change that makes a broken model hold allowed to merge, the change must cover every spec broken on the default branch and hold at its head.
function brokenNotFixed({ brokenModels = [] }, models) {
  const unfixed = brokenModels.filter(spec => models.find(model => model.spec === spec)?.state !== 'holds');
  if (!unfixed.length) return null;
  return `${unfixed.map(specName).join(', ')} ${brokenVerb(unfixed)} on the default branch, and this change does not make ${unfixed.length > 1 ? 'them' : 'it'} hold`;
}
const LEFT_NOTE = /^it still has work left/;

// What the landing list checks after a run's note, which a user who lets that note go still wants held. Earlier branches stay held (`row.holds`).
function otherLeftOut(row) {
  if (heldByItsGrade(row)) return ratingWords(row);
  if (!row.head) return 'the last survey did not read its branch, and hobkin work sync reads it';
  if (row.proved === false) return 'it has no proof';
  return row.holds ? 'it brings earlier branches with it' : null;
}

// The landing list's own reason for leaving a change out, unless it is a run's note the user let go and nothing else holds it.
function landingHold({ landable, leftOut, row, rules }) {
  if (landable) return null;
  const note = LEFT_NOTE.test(String(leftOut));
  if (note && rules.leftNoteMayMerge) {
    const other = otherLeftOut(row);
    return other ? asks(other) : null;
  }
  return asks(leftOut ?? 'the last survey did not list it to land, and hobkin work sync reads it again', note ? 'leftNoteMayMerge' : null);
}

/**
 * Why a finished change keeps asking the user and which setting holds it (null where no setting does), or null when it may merge by itself.
 * The first reason found is the one said. `rules` are YOLO mode's settings for the project (`yolo-rules.mjs`), and with none the usual ones,
 * with the rate of `yolo`. `models` is what hobkin's own runs say of each TLA+ model covering the change, at its head (`changeModels`), and
 * `unmodeled` the machines the state machines look found that it touches with no model naming those files (`unmodeledIn`). Scores given before
 * commits that changed only models still count. `leftOut` is why the landing list leaves it out, in that list's words, when it does.
 */
export function holdOf({ yolo, on, project, readiness, landable, leftOut = null, row, item, unit = {}, models = [], unmodeled = [], rules = { ...RULE_DEFAULTS, lowestRate: yolo.rate } }) {
  if (!yolo.on) return asks('YOLO mode is off');
  // `on` is the project's own switch.
  if (on === false) return asks('YOLO mode is off on its project');
  if (project?.paused) return asks('its project is paused');
  if (!readiness.ready) return asks(notReady(readiness), readiness.holds?.[0] ?? null);
  const unfixed = rules.brokenModelFixMayMerge ? brokenNotFixed(readiness, models) : null;
  if (unfixed) return asks(unfixed, 'brokenModelFixMayMerge');
  const left = landingHold({ landable, leftOut, row, rules });
  if (left) return left;
  if (!WAITS_TO_MERGE.includes(item.state)) return asks(`its item is ${item.state}, not finished work waiting to merge`);
  if (item.state === 'pr' && !rules.mergePulls) return asks(PULLS_OFF, 'mergePulls');
  if (row.holds && !rules.earlierBranchesMayMerge) return asks('it brings earlier branches with it', 'earlierBranchesMayMerge');
  // The grades YOLO mode reads are Change Review's alone (`review-grades.mjs`): hobkin's own scored run, or a record written any other way, is not read.
  if (item.review?.by !== GRADED_BY) return asks('its review has not rated it');

  const { kind, rate, floors, head } = scoresOf(item.review, models, floorsOf(rules));
  if (!scoresHoldAt(head, unit)) {
    // Nothing takes a review's commits to a pull request, so a review that changed the change leaves its scores on a commit the pull request lacks.
    if (item.state === 'pr' && unit.sha) return asks(`its review scored ${String(head).slice(0, SHORT_SHA)}, and its pull request is at ${unit.sha.slice(0, SHORT_SHA)}`);
    return asks('its scores are for an older commit');
  }
  if (!rules.kinds.includes(kind)) return asks(`its review calls it ${kind}`, 'kinds');
  // The readiness work's own branches are features that never merge by themselves, whatever kinds the user lets through.
  if (item.kind === 'feature' && (!rules.kinds.includes('feature') || String(item.key ?? '').startsWith('yolo:'))) return asks('its item is a feature', 'kinds');
  // A broken model is a floor, said before the proof score of 3 it leaves.
  const model = models.find(({ state }) => state === 'broken') ?? models.find(({ state }) => state !== 'holds');
  if (model) return asks(modelWords[model.state](model));
  if (unmodeled.length) return asks(`it changes ${unmodeled[0].name}, a state machine no model covers yet`);
  if (floors.length) return asks(`${floors[0].criterion} scored ${floors[0].score}, under ${floors[0].needs}`, FLOOR_RULES[floors[0].criterion]);
  if (rate < rules.lowestRate) return asks(`its general rate is ${rate}, under ${rules.lowestRate}`, 'lowestRate');
  // What the survey read of a pull request comes first, since the change rules can only read a head this repository holds.
  const surveyed = item.state === 'pr' ? pullSurveyed(item, unit) : null;
  if (surveyed) return asks(surveyed);
  return changeHoldsWith(item, unit, rules)[0] ?? null;
}

/** `holdOf`'s reason alone, or null when the change may merge by itself. */
export const whyItAsks = asked => holdOf(asked)?.why ?? null;

// Where a merge by itself left the default branch, for the deploy job: here, or on the code host for a pull request.
const mergedWords = (target, pr) => (pr
  ? `YOLO mode merged its pull request ${pr} by itself on the code host, so the default branch there is at ${target}. Fetch it first.`
  : `YOLO mode merged this change into the default branch at ${target} by itself, and nothing was pushed.`);

/** The deploy of one merge, for the main agent to hand to one session, as it hands on work a card could not start. */
const deployJob = ({ project, item, target, pr, path, back }) => ({
  project: nameOf(project),
  item: item.id,
  title: item.title,
  branch: item.branch,
  commit: target,
  asked: `${mergedWords(target, pr)} `
    + `Deploy exactly that commit by the project's recorded path: ${path} Its way back: ${back} `
    + 'Prove it with the live revision and a real health check, report what deployed, and deploy nothing else. '
    + `Then watch its monitoring for ${AFTER_DEPLOY_MINUTES} minutes and record what it showed: pipe `
    + '{ "live": "the live revision and what showed the change working", "minutes": 30, "errors": { "regressed": false, "saw": "one line" }, '
    + '"slowQueries": { "regressed": false, "saw": "one line" }, "latency": { "regressed": false, "saw": "the figure against its baseline" } } '
    + `to hobkin work yolo ${project.slug} ${item.id}. A regression is recorded the moment it shows, without waiting for the window to end. `
    + 'Between looks at the monitoring, wait with hobkin_wait and a note of what to look at next, never with a sleep in the shell. '
    + 'A reading the project has no monitoring for is { "notApplicable": "the reason" }, and with none at all it is recorded at once. '
    + 'The issue the change came from closes once that reading says the deploy held.',
  why: 'YOLO mode is on and this project is ready for it',
});

/** Every line of the ledger, oldest first: each merge by itself, with `target`, and each reading of the monitoring after its deploy, with `after`. */
export const readLedger = root => readJsonLines(ledgerPath(root));

const mergedByYolo = (root, slug, id) => readLedger(root).some(line => line.slug === slug && line.item === id && line.target);

/**
 * What the monitoring showed after a change YOLO mode merged was deployed: errors, slow queries, and latency against its baseline, over the
 * window. It is written down and said in Chat. A regression is a problem at once: it is told as critical, recorded as trouble on that change
 * so its fix is filed, and the project stops merging by itself until its readiness is checked again. A calm reading has to cover the window,
 * unless the project has no monitoring at all. Its deploy then held, or not, and the pass after merges closes its issue once it held.
 */
export function recordAfterDeploy(root, project, item, sent, now = Date.now()) {
  const { slug } = project;
  if (!mergedByYolo(root, slug, item.id)) throw Error(`YOLO mode did not merge "${item.title}", so it has no deploy of its own to report on.`);
  const reading = readingFrom(sent);
  const { after, regressed, unmonitored } = reading;

  appendFileSync(ledgerPath(root), `${JSON.stringify({ at: new Date(now).toISOString(), slug, item: item.id, title: item.title, after, regressed })}\n`, { mode: 0o600 });
  if (item.deploy) deployHeld(root, slug, item, reading, now);
  const named = `"${item.title}" on ${nameOf(project)}`;
  const saw = names => sawIn(after, names);
  if (!regressed.length) {
    const line = unmonitored
      ? `After its deploy, ${named} is live, with no monitoring to watch.${after.live ? ` ${after.live}` : ''}`
      : `After its deploy, ${named} held for ${after.minutes} minutes: ${saw(READINGS)}`;
    postClientNotice(root, { key: `yolo-after:${slug}:${item.id}`, line, tone: 'useful' }, now);
    return { regressed, line };
  }

  userTrouble(root, slug, item, { why: `After YOLO mode deployed it: ${saw(regressed)}` }, now);
  holdProject(root, slug, { item: item.id, title: item.title }, now);
  const line = `Problem after YOLO mode deployed ${named}: ${saw(regressed)} Its fix is filed, and ${nameOf(project)} asks you again until its readiness is checked.`;
  postClientNotice(root, { key: `yolo-problem:${slug}:${item.id}`, line, tone: 'critical' }, now);
  return { regressed, line };
}

// A deploy path is an improvement, so a project can be ready without one, and then nothing is deployed.
export function deployOf({ parts: { deploy } }, handOff) {
  if (deploy.state !== 'done') return 'no deploy path';
  if (deploy.deploys === false) return 'nothing deploys';
  return handOff ? 'handed on' : 'not handed on';
}

/**
 * `pr` is the pull request it merged through on the code host, and null for a local merge. `relied` says the checks its branch requires could
 * not be listed, so the merge stood on the host's own clean state alone.
 */
function report(root, { project, item, head, target, pr = null, relied = null, readiness, handOff, now }) {
  const { kind, rate, scores } = scoresOf(item.review);
  const deploy = deployOf(readiness, handOff);
  const merged = {
    at: new Date(now).toISOString(),
    slug: project.slug,
    item: item.id,
    title: item.title,
    head,
    target,
    ...(pr ? { pr } : {}),
    ...(relied ? { checks: 'not listed' } : {}),
    kind,
    rate,
    scores: Object.fromEntries(CRITERIA.map(criterion => [criterion, scores[criterion].score])),
    deploy,
  };
  mkdirSync(join(root, 'work'), { recursive: true, mode: 0o700 });
  appendFileSync(ledgerPath(root), `${JSON.stringify(merged)}\n`, { mode: 0o600 });

  const how = pr ? `by itself, through its pull request ${pr} on the code host` : 'by itself';
  const checks = relied ? ` ${relied}.` : '';
  const line = `YOLO mode merged "${item.title}" on ${nameOf(project)} ${how}: ${kindWords[kind]} rated ${rate}, at ${head.slice(0, SHORT_SHA)}. ${deployWords[deploy]}${checks}`;
  postClientNotice(root, { key: `yolo:${project.slug}:${item.id}`, line, tone: 'useful' }, now);
  if (deploy === 'handed on') {
    // Its deploy is this mode's own, so the pass after merges asks nothing about it, and its issue waits for that deploy's reading.
    updateItem(root, project.slug, item.id, { deploy: { state: 'deploying', by: 'yolo', commit: target, at: merged.at, handedAt: merged.at } }, now);
    handOff(deployJob({ project, item, target, pr, path: readiness.parts.deploy.line, back: readiness.parts.rollback.line }));
  }
  return merged;
}

/**
 * A merge that cannot go, as when the branch moved since the survey read it, changes nothing, and the change keeps asking the user. It is pinned
 * to the head the survey read, whose scores `whyItAsks` found still count.
 */
async function mergeAlone(root, { row, unit, now }) {
  try {
    return await mergeItem(root, row.slug, row.item, { route: 'yolo', head: unit.sha, now });
  } catch {
    return null;
  }
}

/**
 * A change heading to a merge by itself that waits only for the model of a machine it touches goes back to its own item and branch for that
 * model, once for each review. Its run commits the model and nothing else, so the review's scores still count, and hobkin checks the model at
 * the new head itself, with any model nobody ran yet. Like a review, it goes ahead of new work.
 */
function askForModel(root, { asked, models, now }) {
  const { row, item, unmodeled } = asked;
  const checked = models.filter(({ state }) => state !== 'unchecked');
  if (!unmodeled.length || whyItAsks({ ...asked, models: checked, unmodeled: [] })) return;
  if (item.modelAskedFor === item.review.head) return;

  updateItem(root, row.slug, item.id, { modelAsked: { machines: unmodeled }, modelAskedFor: item.review.head }, now);
  retryItem(root, row.slug, item.id, now);
}

/** Each change the landing list names, as `<project>:<item>`: null for one it would let go, and otherwise why it leaves it out. */
export function landingReasons(root) {
  const { landable, leftOut } = landingList(root);
  return new Map([...landable.map(({ slug, item }) => [`${slug}:${item}`, null]), ...leftOut.map(({ slug, item, why }) => [`${slug}:${item}`, why])]);
}

/** What `whyItAsks` reads of one waiting row, with the models covering it apart, as the pass and YOLO mode's report read it. */
export function askedOf(root, { yolo, landing, row, item, unit }) {
  const key = `${row.slug}:${row.item}`;
  const asked = {
    yolo,
    on: yoloOnProject(root, row.slug),
    project: readProject(root, row.slug),
    readiness: readinessOf(root, row.slug),
    landable: landing.get(key) === null,
    leftOut: landing.get(key) ?? null,
    row,
    item,
    unit,
    unmodeled: unmodeledIn(readMachines(root, row.slug)?.machines, unit),
    rules: rulesOf(root, row.slug),
  };
  return { asked, models: changeModels(root, row.slug, unit) };
}

/** Every finished change that may merge by itself, as the pass and YOLO mode's report read them: local branches first, then pull requests. */
export const waitingToMerge = (root, now) => [...weighedRows(root, now), ...pullCandidates(root)];

/**
 * Merges what may merge by itself, as many changes a project as its settings allow (one by default), and answers a report of each. `handOff` gives a deploy to the main agent, and
 * `gh` reaches the code host. While YOLO mode is on it also files the readiness work of any project that has none yet. A pull request whose
 * merge commit the host did not say hands on no deploy, so that merge is asked about like any other.
 */
export async function yoloPass(root, { now = Date.now(), handOff, gh = defaultPullGh } = {}) {
  // From the first pass on, each project's switch is written down, so one taken on Work later starts off.
  settleSwitches(root);
  const yolo = readYolo(root);
  if (!yolo.on) return [];
  prepareProjects(root, now);
  if (whyWorkModeWaits(readMode(root), now)) return [];

  const landing = landingReasons(root);
  const reports = [];
  const mergedOn = new Map();
  let signedIn = null;
  const user = () => (signedIn ??= signedInUser(gh));
  for (const { row, item, unit } of waitingToMerge(root, now)) {
    const { asked, models } = askedOf(root, { yolo, landing, row, item, unit });
    if ((mergedOn.get(row.slug) ?? 0) >= asked.rules.mergesAPass) continue;
    if (whyItAsks({ ...asked, models })) {
      askForModel(root, { asked, models, now });
      continue;
    }

    const landed = item.state === 'pr' ? await mergeOwnPull(root, { row, item, unit, gh, user, now }) : await mergeAlone(root, { row, unit, now });
    if (!landed) continue;
    mergedOn.set(row.slug, (mergedOn.get(row.slug) ?? 0) + 1);
    const { project, readiness } = asked;
    // A merge that made every broken model hold has the default branch checked again at once, and does not wait the week.
    if (readiness.brokenModels?.length) askRecheck(root, row.slug, readiness.brokenModels, readUnmerged(root).projects[row.slug]?.models?.head);
    const known = Boolean(landed.target);
    const { pr = null, relied = null } = landed;
    reports.push(report(root, { project, item, head: unit.sha, target: landed.target ?? unit.sha, pr, relied, readiness, handOff: known ? handOff : undefined, now }));
  }
  return reports;
}
