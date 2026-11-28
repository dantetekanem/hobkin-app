import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A Ludicrous run's plan and its areas as the project's folder holds them (076): `_specs/ludicrous/plan.json`, which the delivery planner
 * writes, each area's spec in `_specs/<area>/spec.md`, and each area's trails under `_specs/ludicrous/trails/<area>/`: the queue of packets
 * and the status its leader writes, and one trail for each packet its worker writes. Every file there has one writer, so nothing here writes.
 */

export const PLAN_FILE = '_specs/ludicrous/plan.json';
export const FOUNDATION = 'foundation';
export const trailsOf = area => `_specs/ludicrous/trails/${area}`;
const AREA_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MOST_AREAS = 24;

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function linesOf(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap(line => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

const strings = value => Array.isArray(value) && value.every(each => typeof each === 'string' && each.trim());

/** Every rule a plan must meet before anything builds from it. It throws the first one it breaks, in words the planners can act on. */
export function assertPlan(plan) {
  const areas = plan?.areas;
  if (!Array.isArray(areas) || !areas.length) throw Error('The plan names no areas.');
  if (areas.length > MOST_AREAS) throw Error(`The plan names ${areas.length} areas, and ${MOST_AREAS} is the most.`);
  const ids = new Set();
  for (const area of areas) {
    if (!AREA_ID.test(area?.id ?? '')) throw Error(`An area's id is lowercase letters, digits and dashes: ${JSON.stringify(area?.id)}.`);
    if (ids.has(area.id)) throw Error(`Two areas are both ${area.id}.`);
    ids.add(area.id);
    if (typeof area.name !== 'string' || !area.name.trim()) throw Error(`${area.id} has no name.`);
    if (area.depends !== undefined && !strings(area.depends)) throw Error(`${area.id}'s depends is a list of area ids.`);
    if (area.checks !== undefined && !strings(area.checks)) throw Error(`${area.id}'s checks is a list of commands.`);
  }
  const foundation = areas.find(area => area.id === FOUNDATION);
  if (!foundation || foundation.depends?.length) throw Error('The plan opens with a foundation area, which depends on no other.');
  for (const area of areas) {
    for (const each of area.depends ?? []) if (!ids.has(each)) throw Error(`${area.id} depends on ${each}, which is no area of the plan.`);
    if (area.id !== FOUNDATION && !area.depends?.length) throw Error(`${area.id} depends on nothing, and every area but the foundation builds on another.`);
  }
  // Each area reaches the foundation, and nothing goes round in a circle.
  const depth = new Map([[FOUNDATION, 0]]);
  const reach = (id, path = []) => {
    if (depth.has(id)) return depth.get(id);
    if (path.includes(id)) throw Error(`The areas go round in a circle: ${[...path, id].join(' → ')}.`);
    const area = areas.find(each => each.id === id);
    const deepest = Math.max(...area.depends.map(each => reach(each, [...path, id])));
    depth.set(id, deepest + 1);
    return deepest + 1;
  };
  areas.forEach(area => reach(area.id));
  if (plan.checkCommands !== undefined && !strings(plan.checkCommands)) throw Error('checkCommands is a list of command names.');
  for (const question of plan.questions ?? []) {
    if (typeof question?.id !== 'string' || typeof question.question !== 'string' || !Array.isArray(question.options) || !question.options.length) {
      throw Error('Each question has an id, its words and its options.');
    }
    if (!question.options.some(option => option?.id === question.pick)) throw Error(`Question ${question.id} has no pick among its options.`);
  }
  return plan;
}

/** The plan as the folder holds it, or null while there is none. A plan that breaks a rule is reported, never built from. */
export function readPlan(folder) {
  const file = join(folder, PLAN_FILE);
  if (!existsSync(file)) return null;
  const plan = readJson(file, undefined);
  if (plan === undefined) throw Error(`${PLAN_FILE} is not JSON.`);
  return assertPlan(plan);
}

/** An area's steps done of total, from the boxes in its spec, which its leader checks when their proof passes. */
export function stepsOf(folder, area) {
  const file = join(folder, '_specs', area, 'spec.md');
  if (!existsSync(file)) return { done: 0, total: 0 };
  const boxes = readFileSync(file, 'utf8').split('\n').filter(line => /^\s*- \[[ xX]\] S\d+/.test(line));
  return { done: boxes.filter(line => /\[[xX]\]/.test(line)).length, total: boxes.length };
}

export const statusOf = (folder, area) => readJson(join(folder, trailsOf(area), 'status.json'), {});

/** An area's packets as its leader wrote them, in the order they came. A packet written again is the newer line. */
export function queueOf(folder, area) {
  const packets = new Map();
  for (const packet of linesOf(join(folder, trailsOf(area), 'queue.jsonl'))) {
    if (typeof packet?.id !== 'string' || !strings(packet.paths)) continue;
    packets.set(packet.id, { ...packet, area });
  }
  return [...packets.values()];
}

const finished = state => ['done', 'failed'].includes(state);
// A packet sent back to its queue, by a restart, a stop or the subscription, is ready again.
const untaken = record => !record || record.state === 'back';

/**
 * Each area as it stands: open once every area it builds on has committed its contracts, done once its leader says so with every step of
 * its spec checked, and its packets ready to start: written by its leader, not taken, not cancelled, and after every packet it waits on.
 */
export function areasNow(folder, plan, packets = {}) {
  const statuses = new Map(plan.areas.map(area => [area.id, statusOf(folder, area.id)]));
  return plan.areas.map(area => {
    const status = statuses.get(area.id);
    const steps = stepsOf(folder, area.id);
    const done = status.done === true && steps.done === steps.total;
    const open = (area.depends ?? []).every(each => statuses.get(each)?.contracts === true || statuses.get(each)?.done === true);
    const queue = queueOf(folder, area.id);
    const ready = queue.filter(packet => !packet.cancelled && untaken(packets[packet.id]) && (packet.after ?? []).every(id => finished(packets[id]?.state)));
    return { id: area.id, name: area.name, depends: area.depends ?? [], open: open && !done, done, contracts: status.contracts === true, steps, queued: queue.length, ready };
  });
}
