import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { openDecisions } from '../decisions.mjs';
import { dropReport, readReport, saveReport } from '../reports.mjs';
import { scoresOf } from './classified.mjs';
import { whyWorkModeWaits } from './controls.mjs';
import { readJson, readMode, readProject } from './store.mjs';
import { needOf } from './yolo-parts.mjs';
import { AFTER_DEPLOY_MINUTES, askedOf, deployOf, deployWords, holdOf, holdsOf, kindWords, landingReasons, READINGS, readLedger, waitingToMerge } from './yolo-pass.mjs';
import { pullNoted } from './yolo-pulls.mjs';
import { readYolo, yoloView } from './yolo.mjs';

/**
 * YOLO mode's report on each project, in Reports beside the routines' reports: whether the project is ready, or what holds it and what hobkin
 * is doing about it, the plan, what will merge at what rate and why the rest asks the user, and what merged and deployed, by day, from the
 * ledger. Each project has one. It is written after the owner's pass and after a deploy's reading, and only when its words changed.
 * A change writes it under a new id, so it reads as new and gets a short version of its own, and the one it replaces goes.
 */

const SHORT_SHA = 7;
// The readiness work and the branches it set parts up on are said with the parts, not as changes waiting to merge.
const READINESS_KEYS = 'yolo:';
const indexPath = root => join(root, 'work', 'yolo-reports.json');
const readIndex = root => readJson(indexPath(root), null)?.projects ?? {};
const digestOf = body => createHash('sha256').update(body).digest('hex');
const twoDigits = number => String(number).padStart(2, '0');
const dayOf = at => {
  const date = new Date(at);
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
};
function kindsWords(kinds) {
  const words = kinds.map(kind => kindWords[kind]);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words[0];
}

// What hobkin is doing about a project getting ready. Work that landed leaves each part to say what it waits for.
const workWords = {
  none: 'hobkin files its readiness work on the next pass.',
  queued: 'Its readiness work is queued to run.',
  running: 'Its readiness work is running now.',
  waiting: 'Its readiness work waits for your yes on its branch.',
  closed: 'Its readiness work closed without landing. Check again on the YOLO page to run it once more.',
};

const handedStep = (part, handed) => part.state === 'user' && handed.has(part.action);
const partNeed = (part, handed) => handedStep(part, handed) ? `${part.line} — handed to hobkin; no resolution recorded.` : needOf(part);
const partLine = (part, handed) => `${part.label}: ${partNeed(part, handed)}${part.pr ? ` ${part.pr}` : ''}`;
const listed = lines => lines.map(line => `- ${line}`).join('\n');

function readinessBlocks({ ready, needs, parts, work, checkedAt }, handed) {
  // Before a check every part is only waiting for it, so the parts say nothing yet.
  const pending = checkedAt ? parts.filter(part => part.state !== 'done' && !part.blocks) : [];
  // Several parts may wait on one action. Do not repeat the action or hide a separate gap (or a different PR).
  const grouped = Map.groupBy(pending, part => part.action ? JSON.stringify([part.action, part.state, part.line, part.pr]) : part.name);
  const improving = [...grouped.values()].map(group => {
    const label = group.map(part => part.label).join(', ');
    return partLine({ ...group[0], label }, handed);
  });
  const still = improving.length ? [`Optional setup as last recorded, holding nothing back:\n\n${listed(improving)}`] : [];
  if (ready) return still;
  const doing = workWords[work];
  const holding = needs.map(need => {
    const part = parts.find(part => `${part.label}: ${needOf(part)}` === need);
    return part ? `${part.label}: ${partNeed(part, handed)}` : need;
  });
  return [`## What holds it\n\n${listed(holding)}`, ...(doing ? [doing] : []), ...still];
}

const sentence = text => (/[.!?]$/.test(text) ? text : `${text}.`);

// What a deploy path not set up yet waits on: the user's step, their merge, or hobkin's own work or next check, in the part's line.
function deployWaits(part, handed) {
  const { state, line, pr } = part;
  if (handedStep(part, handed)) return partNeed(part, handed);
  if (state === 'user') return `It waits on you: ${sentence(line)}`;
  if (state === 'pr') return pr ? `Its PR waits for your merge: ${pr}` : 'Its branch waits for your merge.';
  return sentence(line);
}

function planBlock({ name, active, parts, rules }, handed) {
  const deploy = parts.find(part => part.name === 'deploy');
  const deploys = {
    'handed on': `The main agent deploys each one by its deploy path and watches the monitoring for ${AFTER_DEPLOY_MINUTES} minutes: ${deploy.line}`,
    'nothing deploys': deployWords['nothing deploys'],
    'no deploy path': `Nothing is deployed until its deploy path is set up. ${deployWaits(deploy, handed)}`,
  };
  const plan = [
    `hobkin merges a small change on ${name} by itself once its review rates it ${rules.lowestRate} or more: ${kindsWords(rules.kinds)}.`,
    `At most ${rules.mergesAPass === 1 ? 'one change merges' : `${rules.mergesAPass} changes merge`} on ${name} a pass, at the commit its review scored.`,
    deploys[deployOf({ parts: { deploy } }, true)],
    `A regression after a deploy stops merges on ${name} until its readiness is checked again.`,
    ...(rules.mergePulls
      ? [
        'A change waiting on its own pull request merges there the same way, once every check on its commit passed and nothing on the code host holds it.',
        `Still asks you: a feature, a change its review could not place, one under ${rules.lowestRate} or under a floor, and a pull request someone else opened.`,
      ]
      : [`Still asks you: a feature, a change its review could not place, one under ${rules.lowestRate} or under a floor, and every PR.`]),
  ];
  return `## ${active ? 'The plan' : 'The plan when active'}\n\n${listed(plan)}`;
}

function nextFor({ reasons, lastPull, item }, { active }) {
  const known = [...reasons, ...(lastPull && !reasons.includes(lastPull) ? [`last code-host check: ${lastPull}`] : [])];
  if (known.length) return `Not eligible for automatic merge: ${sentence(known.join('; '))}`;
  if (!active) return 'Meets recorded change requirements, but YOLO mode is not active.';
  return item.state === 'pr' ? 'Eligible subject to fresh code-host checks and the pass limit.' : 'Eligible subject to the final merge checks and pass limit.';
}

function changeLine(change, project) {
  const { item, models } = change;
  const { kind, rate } = item.review?.scores ? scoresOf(item.review, models) : {};
  const what = kind ? `${kindWords[kind]} rated ${rate}` : 'no review yet';
  return `"${item.title}": ${what}. ${nextFor(change, project)}`;
}

// What may merge first, then what cannot and every known reason why.
function changesBlock(project, { waits, changes }) {
  const heading = '## Changes waiting to merge';
  const rate = `Your rate is ${project.rules.lowestRate}.${waits ? ` Nothing merges while ${waits}.` : ''}`;
  if (!changes.length) return `${heading}\n\n${rate}\n\nNothing waits to merge on ${project.name}.`;
  const blocked = change => change.reasons.length || change.lastPull;
  const ordered = [...changes.filter(change => !blocked(change)), ...changes.filter(blocked)];
  return `${heading}\n\n${rate}\n\n${listed(ordered.map(change => changeLine(change, project)))}`;
}

// The latest reading of the monitoring after the merge's deploy says how it went, and with none yet, where its deploy stands.
function deployedWords(merge, readings) {
  const reading = readings.findLast(line => line.item === merge.item);
  if (!reading) return deployWords[merge.deploy];
  const saw = names => names.map(name => reading.after[name].saw).filter(Boolean).join(' ');
  if (reading.regressed.length) return `Problem after its deploy: ${saw(reading.regressed)}`;
  if (READINGS.every(name => reading.after[name].notApplicable)) return 'It deployed and is live, with no monitoring to watch.';
  return `It deployed and held for ${reading.after.minutes} minutes: ${saw(READINGS)}`;
}

function mergeLine(merge, readings) {
  const what = `${kindWords[merge.kind]} rated ${merge.rate}, at ${merge.head.slice(0, SHORT_SHA)}`;
  return `"${merge.title}": ${what}. ${deployedWords(merge, readings)}`;
}

// Newest day first, and the newest merge first within it.
function mergedBlock(name, ledger) {
  const merges = ledger.filter(line => line.target).toReversed();
  if (!merges.length) return `## Merged and deployed\n\nNothing has merged by itself on ${name} yet.`;

  const readings = ledger.filter(line => line.after);
  const days = [...Map.groupBy(merges, merge => dayOf(merge.at))].map(([day, onDay]) => {
    const lines = onDay.map(merge => mergeLine(merge, readings));
    return `### ${day}\n\n${listed(lines)}`;
  });
  return `## Merged and deployed\n\n${days.join('\n\n')}`;
}

function reportText(project, facts) {
  const { name, ready, on, active } = project;
  let status = `on for ${name}`;
  if (!facts.yolo.on) status = 'off globally';
  else if (!on) status = `off on ${name}`;
  else if (active) status = `active on ${name}`;
  const readiness = `${name} is ${ready ? 'ready' : 'not ready'}`;
  const paused = facts.waits && on && facts.yolo.on ? `; ${facts.waits}` : '';
  const headline = `Useful: YOLO mode is ${status}; ${readiness}${paused}.`;
  const blocks = [
    headline,
    ...readinessBlocks(project, facts.handed),
    planBlock(project, facts.handed),
    changesBlock(project, facts),
    mergedBlock(name, facts.ledger),
  ];
  return `${blocks.join('\n\n')}\n`;
}

/**
 * Each finished local branch waiting on a project, with why it keeps asking the user or null when it may merge by itself, read as the pass reads
 * it. On a project still getting ready, it is what the change would meet once the project is ready.
 */
function waitingChanges(root, yolo, now, { report = false } = {}) {
  const landing = landingReasons(root);
  return waitingToMerge(root, now)
    .filter(({ item }) => ['branch', 'pr'].includes(item.state) && !String(item.key ?? '').startsWith(READINESS_KEYS))
    .map(({ row, item, unit }) => {
      const { asked, models } = askedOf(root, { yolo, landing, row, item, unit });
      const readiness = { ...asked.readiness, ready: true };
      // A pull request the code host held back at the last pass says why, while the survey reads the same commit.
      const lastPull = item.state === 'pr' ? pullNoted(item, unit) : null;
      const change = { slug: row.slug, item, models };
      if (!report) {
        const held = holdOf({ ...asked, models, readiness });
        return { ...change, why: held?.why ?? lastPull, setting: held?.setting ?? null };
      }
      // Project-wide conditions are shown once at the top. Read every change-specific reason, even when the first is the PR switch.
      const changeOnly = { ...asked, yolo: { ...yolo, on: true }, on: true, project: null, models, readiness };
      const reasons = [...holdsOf(changeOnly)].map(hold => hold.why);
      return { ...change, reasons: [...new Set(reasons)], lastPull };
    });
}

function changeFact({ item, models, why, setting }) {
  const { kind, rate } = item.review?.scores ? scoresOf(item.review, models) : {};
  return { item: item.id, title: item.title, kind: kind ? kindWords[kind] : null, rate: rate ?? null, why, setting };
}

// `held` is what the latest reading after its deploy showed: true when it held, false on a regression, null with no reading yet.
function mergeFact(merge, readings) {
  const reading = readings.findLast(line => line.item === merge.item);
  const held = reading ? !reading.regressed.length : null;
  const { at, item, title, kind, rate, head } = merge;
  return { at, item, title, kind: kindWords[kind], rate, head: head.slice(0, SHORT_SHA), deploy: deployedWords(merge, readings), held };
}

/**
 * YOLO mode as Work status carries it: `yoloView`, and on each project what waits to merge there, as its report says it, with its kind, its rate
 * and why it asks the user, or null when it merges on the next pass, and what merged by itself, newest first, with what became of its deploy.
 * `waits` says why nothing merges by itself anywhere while work mode is off or paused.
 */
export function yoloStatus(root, now = Date.now()) {
  const view = yoloView(root);
  const changes = waitingChanges(root, view, now);
  const ledger = readLedger(root);
  const readings = ledger.filter(line => line.after);
  const projects = view.projects.map(project => ({
    ...project,
    changes: changes.filter(({ slug }) => slug === project.slug).map(changeFact),
    merged: ledger.filter(line => line.slug === project.slug && line.target).toReversed().map(merge => mergeFact(merge, readings)),
  }));
  // Whether YOLO mode takes a change waiting on its pull request at all (`yolo-pulls.mjs`), so the window says what it does.
  return { ...view, waits: whyWorkModeWaits(readMode(root), now), pullRequests: projects.some(({ rules }) => rules.mergePulls), projects };
}

/**
 * Writes each project's report again where its words changed, or only `slug`'s, and answers what it wrote. Existing reports also reflect the
 * switch being turned off; a project never turned on gets none. Called after the owner's pass and after a deploy's reading.
 */
export function writeYoloReports(root, { slug = null, now = Date.now() } = {}) {
  const yolo = readYolo(root);
  const before = readIndex(root);
  const projects = yoloView(root).projects.filter(project => {
    const named = !slug || project.slug === slug;
    return named && ((yolo.on && project.on) || before[project.slug]);
  });
  if (!projects.length) return [];

  const changes = waitingChanges(root, yolo, now, { report: true });
  const ledger = readLedger(root);
  const waits = whyWorkModeWaits(readMode(root), now);
  const handed = new Set(openDecisions(root).filter(decision => decision.handedAt).map(decision => decision.id));
  const at = new Date(now).toISOString();
  const written = [];
  for (const project of projects) {
    const hold = waits ?? (readProject(root, project.slug)?.paused ? `${project.name} is paused` : null);
    const active = yolo.on && project.on && project.ready && !hold;
    const facts = {
      yolo,
      waits: hold,
      handed,
      changes: changes.filter(change => change.slug === project.slug),
      ledger: ledger.filter(line => line.slug === project.slug),
    };
    const body = reportText({ ...project, active }, facts);
    const digest = digestOf(body);
    if (before[project.slug]?.digest === digest) continue;

    const id = `yolo:${project.slug}:${at}:${digest.slice(0, 8)}`;
    saveReport(root, id, body);
    written.push({ slug: project.slug, entry: { id, title: `YOLO mode on ${project.name}`, at, digest } });
  }
  if (!written.length) return [];

  // Read again just before writing, so a report another process wrote meanwhile for another project keeps its place.
  const entries = Object.fromEntries(written.map(({ slug: project, entry }) => [project, entry]));
  atomicJson(indexPath(root), { projects: { ...readIndex(root), ...entries } });
  for (const { slug: project, entry } of written) {
    const replaced = before[project]?.id;
    if (replaced && replaced !== entry.id) dropReport(root, replaced);
  }
  return written.map(({ slug: project, entry }) => ({ slug: project, id: entry.id }));
}

/** Each project's YOLO report as Reports lists it: the project's own work, unless the user deleted it. */
export function yoloReports(root, deleted) {
  return Object.entries(readIndex(root)).flatMap(([slug, { id, title, at }]) => {
    if (deleted.has(id)) return [];
    const body = readReport(root, id, null);
    return body === null ? [] : [{ id, title, scheduleId: `work.${slug}.yolo`, at, body, outcome: 'completed' }];
  });
}
