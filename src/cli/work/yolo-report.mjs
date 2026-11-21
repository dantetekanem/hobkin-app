import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { dropReport, readReport, saveReport } from '../reports.mjs';
import { scoresOf, SMALL_KINDS } from './classified.mjs';
import { whyWorkModeWaits } from './controls.mjs';
import { weighedRows } from './reads.mjs';
import { readJson, readMode } from './store.mjs';
import { needOf } from './yolo-parts.mjs';
import { AFTER_DEPLOY_MINUTES, askedOf, deployOf, deployWords, kindWords, landingReasons, READINGS, readLedger, whyItAsks } from './yolo-pass.mjs';
import { readYolo, yoloView } from './yolo.mjs';

/**
 * YOLO mode's report on each project, in Reports beside the routines' reports: whether the project is ready, or what holds it and what hobkin
 * is doing about it, the plan, what will merge at what rate and why the rest asks the user, and what merged and deployed, by day, from the
 * ledger. Each project has one. It is written while YOLO mode is on, after the owner's pass and after a deploy's reading, and only when its words
 * changed. A change writes it under a new id, so it reads as new and gets a short version of its own, and the one it replaces goes.
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
const smallWords = SMALL_KINDS.map(kind => kindWords[kind]);
const smallKinds = `${smallWords.slice(0, -1).join(', ')} or ${smallWords.at(-1)}`;

// What hobkin is doing about a project getting ready. Work that landed leaves each part to say what it waits for.
const workWords = {
  none: 'hobkin files its readiness work on the next pass.',
  queued: 'Its readiness work is queued to run.',
  running: 'Its readiness work is running now.',
  waiting: 'Its readiness work waits for your yes on its branch.',
  closed: 'Its readiness work closed without landing. Check again on the YOLO page to run it once more.',
};

const partLine = part => `${part.label}: ${needOf(part)}${part.pr ? ` ${part.pr}` : ''}`;
const listed = lines => lines.map(line => `- ${line}`).join('\n');

function readinessBlocks({ ready, needs, parts, work, checkedAt }) {
  // Before a check every part is only waiting for it, so the parts say nothing yet.
  const improving = checkedAt ? parts.filter(part => part.state !== 'done' && !part.blocks).map(partLine) : [];
  const still = improving.length ? [`Still being set up, holding nothing back:\n\n${listed(improving)}`] : [];
  if (ready) return still;
  const doing = workWords[work];
  return [`## What holds it\n\n${listed(needs)}`, ...(doing ? [doing] : []), ...still];
}

const sentence = text => (/[.!?]$/.test(text) ? text : `${text}.`);

// What a deploy path not set up yet waits on: the user's step, their merge, or hobkin's own work or next check, in the part's line.
function deployWaits({ state, line, pr }) {
  if (state === 'user') return `It waits on you: ${sentence(line)}`;
  if (state === 'pr') return pr ? `Its PR waits for your merge: ${pr}` : 'Its branch waits for your merge.';
  return sentence(line);
}

function planBlock({ name, ready, parts }, yolo) {
  const deploy = parts.find(part => part.name === 'deploy');
  const deploys = {
    'handed on': `The main agent deploys each one by its deploy path and watches the monitoring for ${AFTER_DEPLOY_MINUTES} minutes: ${deploy.line}`,
    'nothing deploys': deployWords['nothing deploys'],
    'no deploy path': `Nothing is deployed until its deploy path is set up. ${deployWaits(deploy)}`,
  };
  const plan = [
    `hobkin merges a small change on ${name} by itself once its review rates it ${yolo.rate} or more: ${smallKinds}.`,
    `At most one change merges on ${name} a pass, at the commit its review scored.`,
    deploys[deployOf({ parts: { deploy } }, true)],
    `A regression after a deploy stops merges on ${name} until its readiness is checked again.`,
    `Still asks you: a feature, a change its review could not place, one under ${yolo.rate} or under a floor, and every PR.`,
  ];
  return `## ${ready ? 'The plan' : 'The plan once it is ready'}\n\n${listed(plan)}`;
}

function nextFor(why, { name, ready }) {
  if (why) return `It asks you: ${sentence(why)}`;
  return ready ? 'It merges by itself on the next pass.' : `It merges by itself once ${name} is ready.`;
}

function changeLine({ item, models, why }, project) {
  const { kind, rate } = item.review?.scores ? scoresOf(item.review, models) : {};
  const what = kind ? `${kindWords[kind]} rated ${rate}` : 'no review yet';
  return `"${item.title}": ${what}. ${nextFor(why, project)}`;
}

// What may merge first, then what asks the user and why.
function changesBlock(project, { yolo, waits, changes }) {
  const heading = project.ready ? '## What will merge' : '## What will merge once it is ready';
  const rate = `Your rate is ${yolo.rate}.${waits ? ` Nothing merges while ${waits}.` : ''}`;
  if (!changes.length) return `${heading}\n\n${rate}\n\nNothing waits to merge on ${project.name}.`;
  const ordered = [...changes.filter(({ why }) => !why), ...changes.filter(({ why }) => why)];
  return `${heading}\n\n${rate}\n\n${listed(ordered.map(change => changeLine(change, project)))}`;
}

// The latest reading of the monitoring after the merge's deploy says how it went, and with none yet, where its deploy stands.
function deployedWords(merge, readings) {
  const reading = readings.findLast(line => line.item === merge.item);
  if (!reading) return deployWords[merge.deploy];
  const saw = names => names.map(name => reading.after[name].saw).filter(Boolean).join(' ');
  if (reading.regressed.length) return `Problem after its deploy: ${saw(reading.regressed)}`;
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
  const { name, ready } = project;
  const headline = ready ? `Useful: ${name} is ready for YOLO mode.` : `Useful: ${name} is getting ready for YOLO mode.`;
  const blocks = [headline, ...readinessBlocks(project), planBlock(project, facts.yolo), changesBlock(project, facts), mergedBlock(name, facts.ledger)];
  return `${blocks.join('\n\n')}\n`;
}

/**
 * Each finished local branch waiting on a project, with why it keeps asking the user or null when it may merge by itself, read as the pass reads
 * it. On a project still getting ready, it is what the change would meet once the project is ready.
 */
function waitingChanges(root, yolo, now) {
  const landing = landingReasons(root);
  return weighedRows(root, now)
    .filter(({ item }) => item.state === 'branch' && !String(item.key ?? '').startsWith(READINESS_KEYS))
    .map(({ row, item, unit }) => {
      const { asked, models } = askedOf(root, { yolo, landing, row, item, unit });
      const readiness = { ...asked.readiness, ready: true };
      return { slug: row.slug, item, models, why: whyItAsks({ ...asked, models, readiness }) };
    });
}

function changeFact({ item, models, why }) {
  const { kind, rate } = item.review?.scores ? scoresOf(item.review, models) : {};
  return { item: item.id, title: item.title, kind: kind ? kindWords[kind] : null, rate: rate ?? null, why };
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
  return { ...view, projects };
}

/**
 * Writes each project's report again where its words changed, or only `slug`'s, and answers what it wrote. Nothing is written while YOLO mode is
 * off. Called after the owner's pass and after a deploy's reading, never on a timer of its own.
 */
export function writeYoloReports(root, { slug = null, now = Date.now() } = {}) {
  const yolo = readYolo(root);
  if (!yolo.on) return [];
  const projects = yoloView(root).projects.filter(project => !slug || project.slug === slug);
  if (!projects.length) return [];

  const before = readIndex(root);
  const changes = waitingChanges(root, yolo, now);
  const ledger = readLedger(root);
  const waits = whyWorkModeWaits(readMode(root), now);
  const at = new Date(now).toISOString();
  const written = [];
  for (const project of projects) {
    const facts = {
      yolo,
      waits,
      changes: changes.filter(change => change.slug === project.slug),
      ledger: ledger.filter(line => line.slug === project.slug),
    };
    const body = reportText(project, facts);
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
