import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileActionItem, latestAnswer, openDecisions } from '../decisions.mjs';
import { publishItem } from './controls.mjs';
import { nameOf } from './names.mjs';
import { chosenProjects, fileItem, ownerView, prFile, readItems, runnableStates, updateItem } from './store.mjs';
import { yoloOnProject } from './yolo.mjs';

/**
 * The parts of a project's readiness for YOLO mode, and what becomes of each one a readiness run found not in place. Its change goes on a branch
 * of its own, which hobkin offers as a PR, and a step only the user can take, such as a secret or an account, becomes one action item. A part is
 * never kept as a verdict alone. Each part is done, in a PR, waiting on the user, in progress, or still to do. Tests, the way back and the models
 * are what YOLO mode needs (`yolo.mjs`). The others are improvements, worked on and shown, and they hold nothing back.
 */

export const READY_KEY = 'yolo:ready';
const PULL_KEY = 'yolo:pr:';
// What a regression has to show up in: exceptions that reach an alert, slow queries and N+1s, request and job timings against a baseline,
// logs that can be searched, and alerts that reach the user. A project with no use for one says why.
export const MONITORING = ['errors', 'slowQueries', 'performance', 'logs', 'alerts'];
// What a readiness run records. `models` is hobkin's to work out, from the machines the state machines look recorded and its own runs of the specs.
export const RECORDED = ['tests', ...MONITORING, 'rollback', 'deploy'];
export const PARTS = [...RECORDED, 'models'];
// The bar: tests that pass on the default branch, a known way back, and no model there that breaks.
const NEEDED = ['tests', 'rollback', 'models'];
export const partWords = {
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
// The readiness work's own branch, waiting for the user's yes, as it is or as a PR.
export const WAITS_FOR_A_YES = ['branch', 'pr'];
const LANDED = ['merged', 'done'];
const CLOSED_UNLANDED = ['declined', 'dropped'];
const LONGEST_LINE = 400;
const LONGEST_STEP = 1000;

const isOneLine = text => typeof text === 'string' && text.trim().length > 0 && text.length <= LONGEST_LINE && !/[\r\n]/.test(text.trim());
const isStep = text => typeof text === 'string' && text.trim().length > 0 && text.length <= LONGEST_STEP;
const isBranch = name => typeof name === 'string' && /^hobkin\/[\w./-]+$/.test(name) && !name.includes('..') && !/[/.]$/.test(name) && !name.endsWith('.lock');
const sentence = text => (/[.!?]$/.test(text) ? text : `${text}.`);
const firstLine = text => String(text ?? '').trim().split('\n', 1)[0].trim();

function madeOn(name, { branch, how, proof }) {
  if (isBranch(branch) && isOneLine(how) && isOneLine(proof)) return { branch, how: how.trim(), proof: proof.trim() };
  throw Error(`${name}: branch is a hobkin/ branch you made its change on, from the default branch, with how it sets this up and proof, each in a line.`);
}

function stepOf(name, user) {
  const { title, step } = user ?? {};
  if (isOneLine(title) && isStep(step)) return { title: title.trim(), step: step.trim() };
  throw Error(`${name}: user is the one step only the user can take: a title in a line, and the step itself, such as where to put which variable or which command to run.`);
}

/**
 * One part as a readiness run sends it: in place on the default branch, not applicable with the reason, or not in place yet, with the branch its
 * change is on, the one step only the user can take, or both. What is only missing is refused, so a run never ends with a verdict alone.
 */
export function partOf(name, part) {
  const { ready, how, deploys, notApplicable, branch, user } = part ?? {};
  const mayNotApply = MONITORING.includes(name);
  const nothingDeploys = name === 'deploy' && deploys === false ? { deploys } : {};
  if (ready === true && isOneLine(how) && branch === undefined && user === undefined) return { ready, how: how.trim(), ...nothingDeploys };
  if (mayNotApply && isOneLine(notApplicable)) return { notApplicable: notApplicable.trim() };
  if (branch !== undefined || user !== undefined) {
    return { ...(branch === undefined ? {} : madeOn(name, part)), ...(user === undefined ? {} : { user: stepOf(name, user) }), ...nothingDeploys };
  }
  throw Error(`${name} needs ready: true with how it works in a line${mayNotApply ? ', notApplicable with the reason' : ''}, branch for the change you made on a branch `
    + 'of its own, or user for the one step only the user can take. A part is never recorded as only missing: make its change, or ask for that step.');
}

const wordsOf = names => {
  const said = names.map(name => partWords[name].toLowerCase());
  return said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said.at(-1)}` : said[0];
};
const titleOf = names => `YOLO readiness: ${wordsOf(names)}`;

const description = (project, names, parts) => [
  `# ${titleOf(names)}`,
  '',
  `What this branch sets up on ${nameOf(project)}, so YOLO mode can merge small changes there and a regression shows when one does:`,
  '',
  ...names.map(name => `- ${partWords[name]}: ${parts[name].how}`),
  '',
  `Proof: ${names.map(name => parts[name].proof).join(' ')}`,
  '',
  'Hobkin\'s YOLO readiness work made this branch. Merging it is your yes, and nothing on it merges or deploys by itself.',
  '',
].join('\n');

/**
 * A branch a readiness run set parts up on becomes finished work of its own, kind feature, so it lands on the user's yes like any feature, with a
 * description written from those parts. Parts on the readiness work's own branch are that work's.
 */
function fileBranch(root, project, { branch, names, parts, own, now }) {
  if (branch === own.branch) return own.id;
  const title = titleOf(names);
  const brief = names.map(name => `${partWords[name]}: ${parts[name].how}`).join(' ');
  const filed = fileItem(root, project.slug, { key: `${PULL_KEY}${branch}`, kind: 'feature', title, brief, impact: 'high', effort: 'small' }, now);
  if (!['open', 'branch'].includes(filed.state)) return filed.id;

  const proof = names.map(name => parts[name].proof).join(' ');
  updateItem(root, project.slug, filed.id, { state: 'branch', branch, title, brief, summary: brief, proof }, now);
  const file = prFile(root, project.slug, filed.id);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, description(project, names, parts), { mode: 0o600 });
  return filed.id;
}

const stepKey = (slug, title) => `yolo:${slug}:${createHash('sha256').update(title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex').slice(0, 16)}`;

/** One action item for each step only the user can take, however many parts wait on it. The same step asked again is the one still open. */
function fileStep(root, project, { user, names, now }) {
  const key = stepKey(project.slug, user.title);
  const why = `For YOLO mode on ${nameOf(project)}: ${wordsOf(names)}. hobkin carries on with the rest.`;
  const from = `YOLO readiness, ${nameOf(project)}`;
  const { id } = fileActionItem(root, { title: user.title, detail: user.step, why, key, from, answerTo: { kind: 'action', yolo: project.slug } }, now);
  return { key, action: id };
}

/** Files what a readiness run found: finished work for each branch and an action item for each step. It answers the parts as hobkin keeps them. */
export function fileParts(root, project, parts, own, now = Date.now()) {
  const byBranch = Map.groupBy(RECORDED.filter(name => parts[name].branch), name => parts[name].branch);
  const byStep = Map.groupBy(RECORDED.filter(name => parts[name].user), name => parts[name].user.title);
  const items = new Map([...byBranch].map(([branch, names]) => [branch, fileBranch(root, project, { branch, names, parts, own, now })]));
  const steps = new Map([...byStep].map(([title, names]) => [title, fileStep(root, project, { user: parts[names[0]].user, names, now })]));
  return Object.fromEntries(RECORDED.map(name => {
    const part = parts[name];
    const item = part.branch ? { item: items.get(part.branch) } : {};
    const user = part.user ? { user: { ...part.user, ...steps.get(part.user.title) } } : {};
    return [name, { ...part, ...item, ...user }];
  }));
}

/** Where the change of a part stands, by the item that holds it: landed, waiting for the user's yes as a branch or a PR, refused, or being worked on. */
function changeOn(item) {
  if (LANDED.includes(item.state)) return { state: 'done' };
  if (CLOSED_UNLANDED.includes(item.state)) return { state: 'todo', said: 'You said no to its branch.' };
  const pr = item.state === 'pr' && item.pr ? { pr: item.pr } : {};
  const problem = item.state === 'branch' && item.prError ? { problem: item.prError } : {};
  return { state: WAITS_FOR_A_YES.includes(item.state) ? 'pr' : 'doing', branch: item.branch, item: item.id, ...pr, ...problem };
}

/** Where a step only the user can take stands: open, done and waiting for the next check to confirm, or not something they will do. */
function stepOn(root, user, open) {
  if (!user?.action) return null;
  if (open.has(user.action)) return { state: 'user' };
  if (latestAnswer(root, user.key)?.answer === 'drop') return { state: 'todo', said: 'You are not taking its step.' };
  return { state: 'doing', said: `You took its step, "${user.title}", and the next check confirms it.` };
}

/**
 * One recorded part, in place or not. One recorded as in place while the readiness work's own branch waits for the user's yes may be on that
 * branch, as readiness used to record it, so it counts once that branch lands. A record from before this has parts that are only missing, and
 * those are still to do.
 */
function recordedPart(root, part, { items, own, open }) {
  if (part.notApplicable) return { state: 'done', line: part.notApplicable };
  if (part.ready === false) return { state: 'todo', line: part.missing };
  const holder = part.item ? items.find(({ id }) => id === part.item) : part.ready && WAITS_FOR_A_YES.includes(own?.state) && own;
  const change = holder ? changeOn(holder) : null;
  const asked = stepOn(root, part.user, open);
  const { said, state, ...where } = change ?? {};
  const action = asked ? { action: part.user.action } : {};

  if (asked?.state === 'user') return { state: 'user', line: part.user.title, ...where, ...action };
  if (change && state !== 'done') return { state, line: said ?? part.how, ...where, ...action };
  if (asked) return { state: asked.state, line: asked.said, ...action };
  return { state: 'done', line: part.how, ...(part.deploys === false ? { deploys: false } : {}) };
}

/**
 * Every part of a project's readiness, from its last record, its readiness work, and the models part hobkin works out, each with whether it is
 * part of the bar and whether it holds YOLO mode back now. Before any record, a part is in progress while the readiness work is under way.
 */
export function partsOf(root, { record, items, own, models }) {
  const asks = RECORDED.some(name => record?.parts?.[name]?.user);
  const open = new Set(asks ? openDecisions(root).map(({ id }) => id) : []);
  const underWay = runnableStates.includes(own?.state);
  const before = underWay ? { state: 'doing', line: 'Its readiness run sets this up.' } : { state: 'todo', line: 'Not checked yet.' };
  const recorded = name => (record?.parts?.[name] ? recordedPart(root, record.parts[name], { items, own, open }) : before);
  return Object.fromEntries(PARTS.map(name => {
    const { blocks, ...part } = name === 'models' ? models : recorded(name);
    const needed = NEEDED.includes(name);
    return [name, { ...part, needed, blocks: blocks ?? (needed && part.state !== 'done') }];
  }));
}

/** A part in a few words, as a readiness run hears it back. */
export function partSaid({ state, line, pr, problem, action }) {
  if (state === 'pr') return pr ? `PR open at ${pr}` : problem ? `its PR did not open: ${problem}` : 'its PR opens next';
  if (state === 'user') return `waits on the user, action item ${action}`;
  return { done: 'done', doing: 'in progress' }[state] ?? `to do: ${line}`;
}

/** A part that holds YOLO mode back, in the line its project's needs say. */
export function needOf({ state, line, pr }) {
  if (state === 'pr') return pr ? 'its PR waits for your merge.' : 'its branch waits for your merge.';
  if (state === 'user') return `waits on you: ${sentence(line)}`;
  return state === 'doing' ? 'in progress.' : sentence(line);
}

// A branch readiness made for itself or for its parts, as it waits for the user's yes, and not offered as a PR at this branch yet.
const toOffer = ({ key, state, branch, prTried }) => (key === READY_KEY || key.startsWith(PULL_KEY)) && state === 'branch' && Boolean(branch) && prTried !== branch;

/**
 * The user asked that readiness open every PR it needs, so hobkin offers each branch readiness made as a PR by itself: the readiness work's own,
 * and each one it set parts up on. It pushes the branch and opens its PR the way the user's own Open PR does (`publishItem`), once for each
 * branch, and a PR that will not open keeps its branch for the user's yes, saying why. Nothing merges. A branch whose run is still going waits.
 * The readiness run's own try, from wherever that run is, is not the last: the owner's survey tries once more, so a push that run's
 * place could not make still gets its chance. A project YOLO mode is off on has nothing pushed or opened, until the user turns it on.
 */
export async function openReadinessPulls(root, { slug = null, gh, lastTry = true, now = Date.now() } = {}) {
  const { running } = ownerView(root);
  const opened = [];
  const offered = chosenProjects(root).filter(chosen => (!slug || chosen.slug === slug) && yoloOnProject(root, chosen.slug));
  for (const project of offered) {
    const runs = item => running.some(run => run.slug === project.slug && run.item === item.id);
    for (const item of readItems(root, project.slug).filter(found => toOffer(found) && !runs(found))) {
      try {
        await publishItem(root, project.slug, item.id, { ...(gh ? { gh } : {}), now });
        updateItem(root, project.slug, item.id, { prTried: item.branch, prError: null }, now);
        opened.push({ slug: project.slug, id: item.id });
      } catch (error) {
        updateItem(root, project.slug, item.id, { ...(lastTry ? { prTried: item.branch } : {}), prError: firstLine(error.message) }, now);
      }
    }
  }
  return opened;
}
