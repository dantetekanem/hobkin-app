import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { nameOf } from './names.mjs';
import { chosenProjects, fileItem, paths, readItems, readJson, readMode, writeMode } from './store.mjs';

/**
 * YOLO mode: the user's switch for letting small, well-reviewed changes merge and deploy by themselves, and the lowest general rate they accept.
 * It is off until they turn it on in the window, and turning it on merges nothing. Its first job on each project is to get that project ready,
 * which is work filed as a feature and landed on the user's yes. This file holds the switch and each project's readiness. What merges is the
 * pass's (`yolo-pass.mjs`).
 */

// The floors already put every change that passes them above 6, so a lower rate would ask for nothing.
export const LOWEST_RATE = 6;
export const HIGHEST_RATE = 10;
const USUAL_RATE = 8;
const READY_KEY = 'yolo:ready';
// What a regression has to show up in: exceptions that reach an alert, slow queries and N+1s, request and job timings against a baseline,
// logs that can be searched, and alerts that reach the user. A project with no use for one says why.
const MONITORING = ['errors', 'slowQueries', 'performance', 'logs', 'alerts'];
const PARTS = ['tests', ...MONITORING, 'rollback', 'deploy'];
const partWords = {
  tests: 'Tests',
  errors: 'Error tracking',
  slowQueries: 'Slow queries',
  performance: 'Performance metrics',
  logs: 'Searchable logs',
  alerts: 'Alerts',
  rollback: 'Rollback',
  deploy: 'Deploy',
};
// The readiness work has landed: the user merged it, or its run found nothing to change.
const LANDED = ['merged', 'done'];
const WAITS_FOR_A_YES = ['branch', 'pr'];
const CLOSED_UNLANDED = ['declined', 'dropped'];
const LONGEST_LINE = 400;

const READY_BRIEF = 'YOLO mode is on, and hobkin merges and deploys small changes by itself only on a project that is ready for it. '
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

/** Each chosen project gets its readiness work once, as a feature in the queue. It answers what it filed. */
export function prepareProjects(root, now = Date.now()) {
  return chosenProjects(root).flatMap(project => {
    if (readinessItem(root, project.slug)) return [];
    const title = `Get ${nameOf(project)} ready for YOLO mode`;
    const { id } = fileItem(root, project.slug, { key: READY_KEY, kind: 'feature', title, brief: READY_BRIEF, impact: 'high', effort: 'medium' }, now);
    return [{ slug: project.slug, id, title }];
  });
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
  const parts = Object.fromEntries(PARTS.map(name => [name, partOf(name, report?.[name])]));
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
  const record = readJson(readinessFile(root, slug), null);
  const item = readinessItem(root, slug);
  const needs = needsOf(record, item);
  return { ready: needs.length === 0, needs, parts: record?.parts ?? null, at: record?.at ?? null, item: item?.id ?? null };
}

/**
 * Whether a finished branch on this project gets its review with no one asking: the user turned reviews on, or YOLO mode is on and the project
 * is ready, since nothing merges by itself without a review's scores.
 */
export const reviewsByItself = (root, slug) => readMode(root).reviewOnFinish === true || (readYolo(root).on && readinessOf(root, slug).ready);

/** YOLO mode as the window and Home read it: the switch, the rate, how many projects are ready, and what each of the others still needs. */
export function yoloView(root) {
  const projects = chosenProjects(root).map(project => {
    const { ready, needs } = readinessOf(root, project.slug);
    return { slug: project.slug, name: nameOf(project), ready, needs };
  });
  return { ...readYolo(root), lowest: LOWEST_RATE, highest: HIGHEST_RATE, ready: projects.filter(({ ready }) => ready).length, projects };
}
