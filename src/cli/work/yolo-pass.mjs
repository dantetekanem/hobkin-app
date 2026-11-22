import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postClientNotice } from '../client-notices.mjs';
import { CRITERIA, scoresOf, SMALL_KINDS } from './classified.mjs';
import { mergeItem, whyWorkModeWaits } from './controls.mjs';
import { AFTER_DEPLOY_MINUTES, deployHeld, READINGS, readingFrom, sawIn } from './deploys.mjs';
import { userTrouble } from './launches.mjs';
import { readMachines, unmodeledIn } from './machines.mjs';
import { nameOf } from './names.mjs';
import { changeHolds } from './patterns.mjs';
import { startCheck } from './proof-checks.mjs';
import { changeModels, scoresHoldAt, specName } from './proofs.mjs';
import { landingList, weighedRows } from './reads.mjs';
import { readMode, readProject, retryItem, updateItem } from './store.mjs';
import { holdProject, prepareProjects, readinessOf, readYolo } from './yolo.mjs';

/**
 * The one place a change merges with no yes from the user. It runs after the director's own survey and returns at once while YOLO mode is off.
 * A change goes only on a project that is ready, as a finished local branch the landing list would let go, scored by its review at the exact
 * commit the survey read, or at one whose code that commit still has because only models changed since, of a small kind, with no floor broken
 * and at or above the user's rate. The merge is hobkin's own, pinned to the commit the survey read, and every one is written down and said in
 * Chat. Code never deploys: a deploy is handed to the main agent.
 */

const SHORT_SHA = 7;
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

/**
 * Why a finished change keeps asking the user, or null when it may merge by itself. The first reason found is the one said. `models` is what
 * hobkin's own runs say of each TLA+ model covering the change, at its head (`changeModels`), and `unmodeled` the machines the state machines
 * look found that it touches with no model naming those files (`unmodeledIn`). Scores given before commits that changed only models still count.
 * `leftOut` is why the landing list leaves it out, in that list's words, when it does.
 */
export function whyItAsks({ yolo, project, readiness, landable, leftOut = null, row, item, unit = {}, models = [], unmodeled = [] }) {
  if (!yolo.on) return 'YOLO mode is off';
  if (project?.paused) return 'its project is paused';
  if (!readiness.ready) return 'its project is not ready for YOLO mode';
  if (!landable) return leftOut ?? 'the last survey did not list it to land, and hobkin work sync reads it again';
  if (item.state !== 'branch') return 'it is not a finished local branch';
  if (row.holds) return 'it brings earlier branches with it';
  if (!item.review) return 'no review has scored it';

  const { kind, rate, floors, head } = scoresOf(item.review, models);
  if (!scoresHoldAt(head, unit)) return 'its scores are for an older commit';
  if (!SMALL_KINDS.includes(kind)) return `its review calls it ${kind}`;
  if (item.kind === 'feature') return 'its item is a feature';
  // A broken model is a floor, said before the proof score of 3 it leaves.
  const model = models.find(({ state }) => state === 'broken') ?? models.find(({ state }) => state !== 'holds');
  if (model) return modelWords[model.state](model);
  if (unmodeled.length) return `it changes ${unmodeled[0].name}, a state machine no model covers yet`;
  if (floors.length) return `${floors[0].criterion} scored ${floors[0].score}, under ${floors[0].needs}`;
  if (rate < yolo.rate) return `its general rate is ${rate}, under ${yolo.rate}`;
  return changeHolds(item, unit)[0] ?? null;
}

/** The deploy of one merge, for the main agent to hand to one session, as it hands on work a card could not start. */
const deployJob = ({ project, item, target, path, back }) => ({
  project: nameOf(project),
  item: item.id,
  title: item.title,
  branch: item.branch,
  commit: target,
  asked: `YOLO mode merged this change into the default branch at ${target} by itself, and nothing was pushed. `
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

function report(root, { project, item, head, target, readiness, handOff, now }) {
  const { kind, rate, scores } = scoresOf(item.review);
  const deploy = deployOf(readiness, handOff);
  const merged = {
    at: new Date(now).toISOString(),
    slug: project.slug,
    item: item.id,
    title: item.title,
    head,
    target,
    kind,
    rate,
    scores: Object.fromEntries(CRITERIA.map(criterion => [criterion, scores[criterion].score])),
    deploy,
  };
  mkdirSync(join(root, 'work'), { recursive: true, mode: 0o700 });
  appendFileSync(ledgerPath(root), `${JSON.stringify(merged)}\n`, { mode: 0o600 });

  const line = `YOLO mode merged "${item.title}" on ${nameOf(project)} by itself: ${kindWords[kind]} rated ${rate}, at ${head.slice(0, SHORT_SHA)}. ${deployWords[deploy]}`;
  postClientNotice(root, { key: `yolo:${project.slug}:${item.id}`, line, tone: 'useful' }, now);
  if (deploy === 'handed on') {
    // Its deploy is this mode's own, so the pass after merges asks nothing about it, and its issue waits for that deploy's reading.
    updateItem(root, project.slug, item.id, { deploy: { state: 'deploying', by: 'yolo', commit: target, at: merged.at, handedAt: merged.at } }, now);
    handOff(deployJob({ project, item, target, path: readiness.parts.deploy.line, back: readiness.parts.rollback.line }));
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
 * A change heading to a merge by itself that waits only for a model nobody has run at its head, where only the code that model covers changed,
 * gets that model checked by hobkin itself. A change that edited its spec has its own run to cite, unless hobkin sent it back for that model.
 * `startCheck` keeps it to one at a time.
 */
async function checkWaitingModel(root, { asked, models, spawn, now }) {
  const askedFor = Boolean(asked.item.modelAskedFor) && asked.item.modelAskedFor === asked.item.review?.head;
  const waiting = models.filter(({ state, changed }) => state === 'unchecked' && (!changed || askedFor));
  if (!waiting.length) return;

  const others = models.filter(model => !waiting.includes(model));
  const headingToAMerge = !whyItAsks({ ...asked, models: others });
  if (!headingToAMerge) return;

  const { row, item, unit } = asked;
  const check = { slug: row.slug, item: item.id, spec: waiting[0].spec, head: unit.sha };
  await startCheck(root, check, { now, ...(spawn ? { spawn } : {}) });
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
    project: readProject(root, row.slug),
    readiness: readinessOf(root, row.slug),
    landable: landing.get(key) === null,
    leftOut: landing.get(key) ?? null,
    row,
    item,
    unit,
    unmodeled: unmodeledIn(readMachines(root, row.slug)?.machines, unit),
  };
  return { asked, models: changeModels(root, row.slug, unit) };
}

/**
 * Merges what may merge by itself, at most one change a project, and answers a report of each. `handOff` gives a deploy to the main agent.
 * While YOLO mode is on it also files the readiness work of any project that has none yet.
 */
export async function yoloPass(root, { now = Date.now(), handOff, spawn } = {}) {
  const yolo = readYolo(root);
  if (!yolo.on) return [];
  prepareProjects(root, now);
  if (whyWorkModeWaits(readMode(root), now)) return [];

  const landing = landingReasons(root);
  const reports = [];
  const mergedOn = new Set();
  for (const { row, item, unit } of weighedRows(root, now)) {
    if (mergedOn.has(row.slug)) continue;
    const { asked, models } = askedOf(root, { yolo, landing, row, item, unit });
    if (whyItAsks({ ...asked, models })) {
      await checkWaitingModel(root, { asked, models, spawn, now });
      askForModel(root, { asked, models, now });
      continue;
    }

    const landed = await mergeAlone(root, { row, unit, now });
    if (!landed) continue;
    mergedOn.add(row.slug);
    const { project, readiness } = asked;
    reports.push(report(root, { project, item, head: unit.sha, target: landed.target, readiness, handOff, now }));
  }
  return reports;
}
