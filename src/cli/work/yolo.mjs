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

// The floors already put every change that passes them at 6.0 or more, so a lower rate would ask for nothing.
export const LOWEST_RATE = 6;
export const HIGHEST_RATE = 10;
const USUAL_RATE = 8;
const READY_KEY = 'yolo:ready';
const PARTS = ['tests', 'visibility', 'rollback', 'deploy'];
const partWords = { tests: 'Tests', visibility: 'Visibility', rollback: 'Rollback', deploy: 'Deploy' };
// The readiness work has landed: the user merged it, or its run found nothing to change.
const LANDED = ['merged', 'done'];
const WAITS_FOR_A_YES = ['branch', 'pr'];
const CLOSED_UNLANDED = ['declined', 'dropped'];
const LONGEST_LINE = 400;

const READY_BRIEF = 'YOLO mode is on, and hobkin merges and deploys small changes by itself only on a project that is ready for it. '
  + 'Check that this project has tests that can cover a change, a way to see a failure after a change, a way back with a flag mechanism where one makes sense, '
  + 'and a deploy path hobkin can run and undo. Build what is missing, and record what you found as the YOLO readiness section of your directions says.';

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
  const { ready, how, missing, deploys } = part ?? {};
  if (ready === true && isOneLine(how)) return { ready, how: how.trim(), ...(name === 'deploy' && deploys === false ? { deploys } : {}) };
  if (ready === false && isOneLine(missing)) return { ready, missing: missing.trim() };
  throw Error(`${name} needs ready: true with how it works in a line, or ready: false with what is missing in a line.`);
}

/** What a readiness run found, part by part. hobkin keeps it only from the run of that project's readiness item, and the date is hobkin's. */
export function recordReadiness(root, slug, report, now = Date.now()) {
  if (readinessItem(root, slug)?.state !== 'doing') throw Error('Only the run of this project\'s readiness item records it.');
  const parts = Object.fromEntries(PARTS.map(name => [name, partOf(name, report?.[name])]));
  atomicJson(readinessFile(root, slug), { parts, at: new Date(now).toISOString() });
  return readinessOf(root, slug);
}

function needsOf(record, item) {
  if (!record) return ['Its readiness has not been checked yet.'];
  const missing = PARTS.filter(name => !record.parts[name].ready).map(name => `${partWords[name]}: ${record.parts[name].missing}`);
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
