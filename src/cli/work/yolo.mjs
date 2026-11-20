import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { triggerRow } from './controls.mjs';
import { nameOf } from './names.mjs';
import { mainFacts, readRuns, specName } from './proofs.mjs';
import { chosenProjects, fileItem, ownerView, paths, readItems, readJson, readMode, runnableStates, updateItem, workName, writeMode } from './store.mjs';
import { BRANCH_PREFIX } from './tree.mjs';
import { readUnmerged } from './unmerged.mjs';

/**
 * YOLO mode: the user's switch for letting small, well-reviewed changes merge and deploy by themselves, and the lowest general rate they accept.
 * It is off until they turn it on in the window, and turning it on merges nothing. Its first job on each project is to get that project ready,
 * which is work filed as a feature and landed on the user's yes, and the user can run that work on one project before turning it on. This file
 * holds the switch and each project's readiness. What merges is the pass's (`yolo-pass.mjs`).
 */

// The floors already put every change that passes them above 6, so a lower rate would ask for nothing.
export const LOWEST_RATE = 6;
export const HIGHEST_RATE = 10;
const USUAL_RATE = 8;
const READY_KEY = 'yolo:ready';
// What a regression has to show up in: exceptions that reach an alert, slow queries and N+1s, request and job timings against a baseline,
// logs that can be searched, and alerts that reach the user. A project with no use for one says why.
const MONITORING = ['errors', 'slowQueries', 'performance', 'logs', 'alerts'];
// What a readiness run records. `models` is hobkin's to work out, from the state machines look's machines and its own runs of their specs.
const RECORDED = ['tests', ...MONITORING, 'rollback', 'deploy'];
const PARTS = [...RECORDED, 'models'];
const MACHINE_KEY = 'machine:';
const partWords = {
  tests: 'Tests',
  errors: 'Error tracking',
  slowQueries: 'Slow queries',
  performance: 'Performance metrics',
  logs: 'Searchable logs',
  alerts: 'Alerts',
  rollback: 'Rollback',
  deploy: 'Deploy',
  models: 'Models',
};
const modelOnMain = {
  broken: ({ spec, why }) => `${specName(spec)} breaks on the default branch${why ? `: ${why}` : ''}`,
  unproven: ({ spec, why }) => `${specName(spec)} did not hold on the default branch${why ? `: ${why}` : ''}`,
  unchecked: ({ spec }) => `${specName(spec)} has not been checked on the default branch yet`,
};
// The readiness work has landed: the user merged it, or its run found nothing to change.
const LANDED = ['merged', 'done'];
const WAITS_FOR_A_YES = ['branch', 'pr'];
const CLOSED_UNLANDED = ['declined', 'dropped'];
const LONGEST_LINE = 400;

// The user may run it before turning YOLO mode on, so it never says the switch is on.
const READY_BRIEF = 'With YOLO mode on, hobkin merges and deploys small changes by itself, and only on a project that is ready for it. '
  + 'Check that this project has tests that can cover a change, monitoring a regression would show up in (error tracking that reaches an alert, slow query '
  + 'and N+1 detection, request and job timings with a baseline, logs that can be searched, alerts that reach the user), a way back with a flag mechanism '
  + 'where one makes sense, and a deploy path hobkin can run and undo. Build what is missing for this project\'s stack, and record what you found as the '
  + 'YOLO readiness section of your directions says.';

const isRate = rate => Number.isInteger(rate) && rate >= LOWEST_RATE && rate <= HIGHEST_RATE;
const isOneLine = text => typeof text === 'string' && text.trim().length > 0 && text.length <= LONGEST_LINE && !/[\r\n]/.test(text.trim());

/** The switch as it stands. A home that never set it has it off. */
export function readYolo(root) {
  const { on, rate } = readMode(root).yolo ?? {};
  return { on: on === true, rate: isRate(rate) ? rate : USUAL_RATE };
}

const readinessFile = (root, slug) => join(paths(root, slug).directory, 'yolo.json');
const readinessItem = (root, slug) => readItems(root, slug).find(({ key }) => key === READY_KEY) ?? null;

function fileReadiness(root, project, now) {
  const readiness = {
    key: READY_KEY,
    kind: 'feature',
    title: `Get ${nameOf(project)} ready for YOLO mode`,
    brief: READY_BRIEF,
    impact: 'high',
    effort: 'medium',
  };
  return fileItem(root, project.slug, readiness, now);
}

/** Each chosen project gets its readiness work once, as a feature in the queue. It answers what it filed. */
export function prepareProjects(root, now = Date.now()) {
  return chosenProjects(root).flatMap(project => {
    if (readinessItem(root, project.slug)) return [];
    const { id, title } = fileReadiness(root, project, now);
    return [{ slug: project.slug, id, title }];
  });
}

// Each fresh check gets a branch of its own from the default branch, since the branch of a check that landed stays behind.
function freshBranch(item, now) {
  const stamp = new Date(now).toISOString().replace(/\D/g, '').slice(0, 14);
  return `${BRANCH_PREFIX}${workName(item)}-${stamp}`;
}

/**
 * Runs one chosen project's readiness now, whether YOLO mode is on or off, so a project can be got ready before the switch is turned on. It files
 * the readiness work when there is none, and opens work that landed or closed again for a fresh check. It starts the way Start now starts a queue
 * row, so work mode's own limits and stops still hold it. Work that waits for the user's yes is theirs to answer first. Nothing merges or deploys.
 */
export function runReadiness(root, slug, now = Date.now()) {
  const project = chosenProjects(root).find(chosen => chosen.slug === slug);
  if (!project) throw Error(`${slug} is not a project work mode works on.`);
  const known = readinessItem(root, slug);
  if (WAITS_FOR_A_YES.includes(known?.state)) throw Error(`The readiness work on ${nameOf(project)} waits for your yes on its branch. Merge it or say no to it first.`);

  const item = known ?? fileReadiness(root, project, now);
  if (!runnableStates.includes(item.state)) {
    const freshCheck = {
      state: 'open',
      attempts: 0,
      lastError: null,
      branch: freshBranch(item, now),
      pr: null,
      brief: READY_BRIEF,
    };
    updateItem(root, slug, item.id, freshCheck, now);
  }

  return triggerRow(root, `item:${slug}:${item.id}`, undefined, { now: true });
}

/**
 * The user's word on YOLO mode, from the window alone: no `hobkin work` command calls this. Turning it on files each project's readiness work and
 * merges nothing. A value left out keeps what it was.
 */
export function setYolo(root, { on, rate } = {}, now = Date.now()) {
  const before = readYolo(root);
  const next = { on: on ?? before.on, rate: rate ?? before.rate };
  if (typeof next.on !== 'boolean') throw Error('YOLO mode is on or off.');
  if (!isRate(next.rate)) throw Error(`The lowest general rate YOLO mode accepts is a whole number from ${LOWEST_RATE} to ${HIGHEST_RATE}.`);
  writeMode(root, { yolo: next });
  return { ...next, filed: next.on ? prepareProjects(root, now) : [] };
}

function partOf(name, part) {
  const { ready, how, missing, deploys, notApplicable } = part ?? {};
  const mayNotApply = MONITORING.includes(name);
  if (ready === true && isOneLine(how)) return { ready, how: how.trim(), ...(name === 'deploy' && deploys === false ? { deploys } : {}) };
  if (ready === false && isOneLine(missing)) return { ready, missing: missing.trim() };
  if (mayNotApply && isOneLine(notApplicable)) return { notApplicable: notApplicable.trim() };
  throw Error(`${name} needs ready: true with how it works in a line, or ready: false with what is missing in a line${mayNotApply ? ', or notApplicable with the reason' : ''}.`);
}

const inPlace = part => part?.ready === true || Boolean(part?.notApplicable);

/** What a readiness run found, part by part. hobkin keeps it only from the run of that project's readiness item, and the date is hobkin's. */
export function recordReadiness(root, slug, report, now = Date.now()) {
  if (readinessItem(root, slug)?.state !== 'doing') throw Error('Only the run of this project\'s readiness item records it.');
  const parts = Object.fromEntries(RECORDED.map(name => [name, partOf(name, report?.[name])]));
  atomicJson(readinessFile(root, slug), { parts, at: new Date(now).toISOString() });
  return readinessOf(root, slug);
}

/**
 * A regression that showed after a change YOLO mode deployed stops changes merging by themselves on that project. The next readiness check
 * writes a new record, which is what lifts it, so the user retries the readiness work once the regression is fixed.
 */
export function holdProject(root, slug, { item, title }, now = Date.now()) {
  const record = readJson(readinessFile(root, slug), null) ?? { parts: {}, at: null };
  atomicJson(readinessFile(root, slug), { ...record, held: { item, title, at: new Date(now).toISOString() } });
}

// A machine the state machines look filed with its model's path, and nobody closed without landing.
const isFiledMachine = ({ key, spec, state }) => Boolean(key?.startsWith(MACHINE_KEY) && spec) && !CLOSED_UNLANDED.includes(state);

/** What hobkin's latest run of each TLA+ spec on the project's default branch says of it, as the last survey found them there. */
export const mainModels = (root, slug) => mainFacts(readRuns(root), { slug, specs: readUnmerged(root).projects[slug]?.models?.specs });

/**
 * Ready when each machine has a model that holds on the default branch: each spec there, and each spec the state machines look filed with its
 * machine. A project with none has no use for the part.
 */
function modelsPart(root, slug) {
  const facts = mainModels(root, slug);
  const filedSpecs = new Set(readItems(root, slug).filter(isFiledMachine).map(({ spec }) => spec));
  const notOnMain = [...filedSpecs].filter(spec => !facts.some(fact => fact.spec === spec));
  if (!facts.length && !notOnMain.length) return { notApplicable: 'It has no state machine models.' };

  const missing = [
    ...notOnMain.map(spec => `${specName(spec)} is not on the default branch yet`),
    ...facts.filter(({ state }) => state !== 'holds').map(fact => modelOnMain[fact.state](fact)),
  ];
  if (missing.length) return { ready: false, missing: `${missing.join('; ')}.` };

  const held = facts.length === 1 ? '1 model holds' : `${facts.length} models hold`;
  return { ready: true, how: `${held} on the default branch: ${facts.map(({ spec }) => specName(spec)).join(', ')}.` };
}

function needsOf(record, item) {
  if (!record) return ['Its readiness has not been checked yet.'];
  if (record.held) return [`A regression showed after "${record.held.title}" deployed. Retry its readiness work once that is fixed.`];
  const missing = PARTS.filter(name => !inPlace(record.parts[name])).map(name => `${partWords[name]}: ${record.parts[name]?.missing ?? 'Not recorded yet.'}`);
  if (missing.length || LANDED.includes(item?.state)) return missing;
  if (WAITS_FOR_A_YES.includes(item?.state)) return ['Its readiness work waits for your yes.'];
  if (!item || CLOSED_UNLANDED.includes(item.state)) return ['Its readiness work was closed without landing.'];
  return ['Its readiness work is still under way.'];
}

/**
 * Whether a project may have changes merge by themselves, and what it still needs when it may not. Every part has to be in place and the
 * readiness work landed: work that waits for the user's yes does not count.
 */
export function readinessOf(root, slug) {
  const recorded = readJson(readinessFile(root, slug), null);
  const record = recorded && { ...recorded, parts: { ...recorded.parts, models: modelsPart(root, slug) } };
  const item = readinessItem(root, slug);
  const needs = needsOf(record, item);
  return { ready: needs.length === 0, needs, parts: record?.parts ?? null, at: record?.at ?? null, item: item?.id ?? null };
}

/**
 * Whether a finished branch on this project gets its review with no one asking: the user turned reviews on, or YOLO mode is on and the project
 * is ready, since nothing merges by itself without a review's scores.
 */
export const reviewsByItself = (root, slug) => readMode(root).reviewOnFinish === true || (readYolo(root).on && readinessOf(root, slug).ready);

/** Where a project's readiness work stands: none filed, queued, running, waiting for the user's yes, landed, or closed without landing. */
function workOf(item, running) {
  if (!item) return 'none';
  if (running.some(run => run.item === item.id)) return 'running';
  if (runnableStates.includes(item.state)) return 'queued';
  if (WAITS_FOR_A_YES.includes(item.state)) return 'waiting';
  return LANDED.includes(item.state) ? 'landed' : 'closed';
}

/**
 * YOLO mode as the window and Home read it: the switch, the rate, how many projects are ready, what each of the others still needs, where each
 * project's readiness work stands and its item, so the window can offer the yes to its branch, when its readiness was last recorded, and what hobkin's runs say of its models on the default branch.
 */
export function yoloView(root) {
  const { running } = ownerView(root);
  const projects = chosenProjects(root).map(project => {
    const { ready, needs, at } = readinessOf(root, project.slug);
    const runs = running.filter(run => run.slug === project.slug);
    const item = readinessItem(root, project.slug);
    const work = workOf(item, runs);
    const models = mainModels(root, project.slug);
    return { slug: project.slug, name: nameOf(project), ready, needs, work, item: item?.id ?? null, checkedAt: at, ...(models.length ? { models } : {}) };
  });
  return { ...readYolo(root), lowest: LOWEST_RATE, highest: HIGHEST_RATE, ready: projects.filter(({ ready }) => ready).length, projects };
}
