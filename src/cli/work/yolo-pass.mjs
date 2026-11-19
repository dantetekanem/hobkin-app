import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { postClientNotice } from '../client-notices.mjs';
import { CRITERIA, scoresOf, SMALL_KINDS } from './classified.mjs';
import { mergeItem, whyWorkModeWaits } from './controls.mjs';
import { nameOf } from './names.mjs';
import { changeHolds } from './patterns.mjs';
import { landingList, weighedRows } from './reads.mjs';
import { readMode, readProject } from './store.mjs';
import { prepareProjects, readinessOf, readYolo } from './yolo.mjs';

/**
 * The one place a change merges with no yes from the user. It runs after the director's own survey and returns at once while YOLO mode is off.
 * A change goes only on a project that is ready, as a finished local branch the landing list would let go, scored by its review at the exact
 * commit the survey read, of a small kind, with no floor broken and at or above the user's rate. The merge is hobkin's own, pinned to that
 * commit, and every one is written down and said in Chat. Code never deploys: a deploy is handed to the main agent.
 */

const SHORT_SHA = 7;
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

/** Why a finished change keeps asking the user, or null when it may merge by itself. The first reason found is the one said. */
export function whyItAsks({ yolo, project, readiness, landable, row, item, unit = {} }) {
  if (!yolo.on) return 'YOLO mode is off';
  if (project?.paused) return 'its project is paused';
  if (!readiness.ready) return 'its project is not ready for YOLO mode';
  if (item.state !== 'branch' || !landable) return 'it cannot land as a local branch yet';
  if (row.holds) return 'it brings earlier branches with it';
  if (!item.review) return 'no review has scored it';

  const { kind, rate, floors, head } = scoresOf(item.review);
  if (!unit.sha || head !== unit.sha) return 'its scores are for an older commit';
  if (!SMALL_KINDS.includes(kind)) return `its review calls it ${kind}`;
  if (item.kind === 'feature') return 'its item is a feature';
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
    + 'Prove it with the live revision and a real health check, report what deployed, and deploy nothing else.',
  why: 'YOLO mode is on and this project is ready for it',
});

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
 * Merges what may merge by itself, at most one change a project, and answers a report of each. `handOff` gives a deploy to the main agent.
 * While YOLO mode is on it also files the readiness work of any project that has none yet.
 */
export async function yoloPass(root, { now = Date.now(), handOff } = {}) {
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
    if (whyItAsks({ yolo, project, readiness, landable: landable.has(`${row.slug}:${row.item}`), row, item, unit })) continue;

    const landed = await mergeAlone(root, { row, item, now });
    if (!landed) continue;
    mergedOn.add(row.slug);
    reports.push(report(root, { project, item, target: landed.target, readiness, handOff, now }));
  }
  return reports;
}
