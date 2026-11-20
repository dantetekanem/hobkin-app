import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postClientNotice } from '../client-notices.mjs';
import { CRITERIA, scoresOf, SMALL_KINDS } from './classified.mjs';
import { mergeItem, whyWorkModeWaits } from './controls.mjs';
import { userTrouble } from './launches.mjs';
import { nameOf } from './names.mjs';
import { changeHolds } from './patterns.mjs';
import { startCheck } from './proof-checks.mjs';
import { changeModels, specName } from './proofs.mjs';
import { landingList, weighedRows } from './reads.mjs';
import { readMode, readProject } from './store.mjs';
import { holdProject, prepareProjects, readinessOf, readYolo } from './yolo.mjs';

/**
 * The one place a change merges with no yes from the user. It runs after the director's own survey and returns at once while YOLO mode is off.
 * A change goes only on a project that is ready, as a finished local branch the landing list would let go, scored by its review at the exact
 * commit the survey read, of a small kind, with no floor broken and at or above the user's rate. The merge is hobkin's own, pinned to that
 * commit, and every one is written down and said in Chat. Code never deploys: a deploy is handed to the main agent.
 */

const SHORT_SHA = 7;
// How long a deploy is watched before its monitoring is called calm.
const AFTER_DEPLOY_MINUTES = 30;
const READINGS = ['errors', 'slowQueries', 'latency'];
const LONGEST_LINE = 400;
const kindWords = {
  performance: 'performance work',
  'bug-fix': 'a bug fix',
  'state-machine': 'a state machine fix',
  'package-update': 'a package update',
  'small-change': 'a small change',
};
const deployWords = {
  'handed on': 'Its deploy is with the main agent.',
  'not handed on': 'Nothing was deployed.',
  'nothing deploys': 'Nothing deploys on this project.',
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
 * hobkin's own runs say of each TLA+ model covering the change, at its head (`changeModels`).
 */
export function whyItAsks({ yolo, project, readiness, landable, row, item, unit = {}, models = [] }) {
  if (!yolo.on) return 'YOLO mode is off';
  if (project?.paused) return 'its project is paused';
  if (!readiness.ready) return 'its project is not ready for YOLO mode';
  if (item.state !== 'branch' || !landable) return 'it cannot land as a local branch yet';
  if (row.holds) return 'it brings earlier branches with it';
  if (!item.review) return 'no review has scored it';

  const { kind, rate, floors, head } = scoresOf(item.review, models);
  if (!unit.sha || head !== unit.sha) return 'its scores are for an older commit';
  if (!SMALL_KINDS.includes(kind)) return `its review calls it ${kind}`;
  if (item.kind === 'feature') return 'its item is a feature';
  // A broken model is a floor, said before the proof score of 3 it leaves.
  const model = models.find(({ state }) => state === 'broken') ?? models.find(({ state }) => state !== 'holds');
  if (model) return modelWords[model.state](model);
  if (floors.length) return `${floors[0].criterion} scored ${floors[0].score}, under ${floors[0].needs}`;
  if (rate < yolo.rate) return `its general rate is ${rate}, under ${yolo.rate}`;
  return changeHolds(item, unit)[0] ?? null;
}

/** The deploy of one merge, for the main agent to hand to one session, as it hands on work a card could not start. */
const deployJob = ({ project, item, target, parts }) => ({
  project: nameOf(project),
  item: item.id,
  title: item.title,
  branch: item.branch,
  commit: target,
  asked: `YOLO mode merged this change into the default branch at ${target} by itself, and nothing was pushed. `
    + `Deploy exactly that commit by the project's recorded path: ${parts.deploy.how} Its way back: ${parts.rollback.how} `
    + 'Prove it with the live revision and a real health check, report what deployed, and deploy nothing else. '
    + `Then watch its monitoring for ${AFTER_DEPLOY_MINUTES} minutes and record what it showed: pipe `
    + '{ "minutes": 30, "errors": { "regressed": false, "saw": "one line" }, "slowQueries": { "regressed": false, "saw": "one line" }, '
    + '"latency": { "regressed": false, "saw": "the figure against its baseline" } } '
    + `to hobkin work yolo ${project.slug} ${item.id}. A regression is recorded the moment it shows, without waiting for the window to end.`,
  why: 'YOLO mode is on and this project is ready for it',
});

const isOneLine = text => typeof text === 'string' && text.trim().length > 0 && text.length <= LONGEST_LINE && !/[\r\n]/.test(text.trim());

function readingOf(name, reading) {
  const { regressed, saw, notApplicable } = reading ?? {};
  if (typeof regressed === 'boolean' && isOneLine(saw)) return { regressed, saw: saw.trim() };
  if (isOneLine(notApplicable)) return { regressed: false, notApplicable: notApplicable.trim() };
  throw Error(`${name} needs regressed, true or false, with what the monitoring showed in a line as saw, or notApplicable with the reason.`);
}

const mergedByYolo = (root, slug, id) => readJsonLines(ledgerPath(root)).some(line => line.slug === slug && line.item === id && line.target);

/**
 * What the monitoring showed after a change YOLO mode merged was deployed: errors, slow queries, and latency against its baseline, over the
 * window. It is written down and said in Chat. A regression is a problem at once: it is told as critical, recorded as trouble on that change
 * so its fix is filed, and the project stops merging by itself until its readiness is checked again. A calm reading has to cover the window.
 */
export function recordAfterDeploy(root, project, item, sent, now = Date.now()) {
  const { slug } = project;
  if (!mergedByYolo(root, slug, item.id)) throw Error(`YOLO mode did not merge "${item.title}", so it has no deploy of its own to report on.`);
  if (!Number.isInteger(sent?.minutes) || sent.minutes < 1) throw Error('minutes is how long the monitoring was watched, as a whole number.');
  const after = { minutes: sent.minutes, ...Object.fromEntries(READINGS.map(name => [name, readingOf(name, sent[name])])) };
  const regressed = READINGS.filter(name => after[name].regressed);
  if (!regressed.length && after.minutes < AFTER_DEPLOY_MINUTES) throw Error(`A reading with no regression covers the whole ${AFTER_DEPLOY_MINUTES} minutes. Record it once they have passed.`);

  appendFileSync(ledgerPath(root), `${JSON.stringify({ at: new Date(now).toISOString(), slug, item: item.id, title: item.title, after, regressed })}\n`, { mode: 0o600 });
  const named = `"${item.title}" on ${nameOf(project)}`;
  const saw = names => names.map(name => after[name].saw).filter(Boolean).join(' ');
  if (!regressed.length) {
    const line = `After its deploy, ${named} held for ${after.minutes} minutes: ${saw(READINGS)}`;
    postClientNotice(root, { key: `yolo-after:${slug}:${item.id}`, line, tone: 'useful' }, now);
    return { regressed, line };
  }

  userTrouble(root, slug, item, { why: `After YOLO mode deployed it: ${saw(regressed)}` }, now);
  holdProject(root, slug, { item: item.id, title: item.title }, now);
  const line = `Problem after YOLO mode deployed ${named}: ${saw(regressed)} Its fix is filed, and ${nameOf(project)} asks you again until its readiness is checked.`;
  postClientNotice(root, { key: `yolo-problem:${slug}:${item.id}`, line, tone: 'critical' }, now);
  return { regressed, line };
}

function report(root, { project, item, target, readiness, handOff, now }) {
  const { kind, rate, scores, head } = scoresOf(item.review);
  const deploys = readiness.parts.deploy.deploys !== false;
  const deploy = deploys ? (handOff ? 'handed on' : 'not handed on') : 'nothing deploys';
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
  if (deploy === 'handed on') handOff(deployJob({ project, item, target, parts: readiness.parts }));
  return merged;
}

/** A merge that cannot go, as when the branch moved since its review, changes nothing, and the change keeps asking the user. */
async function mergeAlone(root, { row, item, now }) {
  try {
    return await mergeItem(root, row.slug, row.item, { route: 'yolo', head: item.review.head, now });
  } catch {
    return null;
  }
}

/**
 * A change heading to a merge by itself that waits only for a model nobody has run at its head, where only the code that model covers changed,
 * gets that model checked by hobkin itself. A change that edited its spec has its own run to cite. `startCheck` keeps it to one at a time.
 */
async function checkWaitingModel(root, { asked, models, spawn, now }) {
  const waiting = models.filter(({ state, changed }) => state === 'unchecked' && !changed);
  if (!waiting.length) return;

  const others = models.filter(model => !waiting.includes(model));
  const headingToAMerge = !whyItAsks({ ...asked, models: others });
  if (!headingToAMerge) return;

  const { row, item, unit } = asked;
  const check = { slug: row.slug, item: item.id, spec: waiting[0].spec, head: unit.sha };
  await startCheck(root, check, { now, ...(spawn ? { spawn } : {}) });
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

  const landable = new Set(landingList(root).landable.map(({ slug, item }) => `${slug}:${item}`));
  const reports = [];
  const mergedOn = new Set();
  for (const { row, item, unit } of weighedRows(root, now)) {
    if (mergedOn.has(row.slug)) continue;
    const project = readProject(root, row.slug);
    const readiness = readinessOf(root, row.slug);
    const models = changeModels(root, row.slug, unit);
    const asked = { yolo, project, readiness, landable: landable.has(`${row.slug}:${row.item}`), row, item, unit };
    if (whyItAsks({ ...asked, models })) {
      await checkWaitingModel(root, { asked, models, spawn, now });
      continue;
    }

    const landed = await mergeAlone(root, { row, item, now });
    if (!landed) continue;
    mergedOn.add(row.slug);
    reports.push(report(root, { project, item, target: landed.target, readiness, handOff, now }));
  }
  return reports;
}
