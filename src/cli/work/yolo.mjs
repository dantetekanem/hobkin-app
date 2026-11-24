import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { triggerRow } from './controls.mjs';
import { readMachines } from './machines.mjs';
import { nameOf } from './names.mjs';
import { machinesLookDue } from './plan.mjs';
import { mainFacts, readRuns, specName } from './proofs.mjs';
import { chosenProjects, fileItem, isGoal, ownerView, paths, pickNow, putBackInQueue, readItems, readJson, readKeptJson, readMode, runnableStates, skipInQueue, updateItem, workName, writeMode } from './store.mjs';
import { BRANCH_PREFIX } from './tree.mjs';
import { readUnmerged } from './unmerged.mjs';
import { everyProjectPatch, HIGHEST_RATE, isRate, LOWEST_RATE, overridesOf, rulesOf, USUAL_RATE } from './yolo-rules.mjs';
import { fileParts, needOf, PARTS, partOf, partsOf, partWords, READY_KEY, RECORDED, WAITS_FOR_A_YES } from './yolo-parts.mjs';

/**
 * YOLO mode: the user's switch for letting small, well-reviewed changes merge and deploy by themselves, and the lowest general rate they accept.
 * It is off until they turn it on in the window, and turning it on merges nothing. Its first job on each project is to get that project ready:
 * readiness work, filed as a feature, sets up what is missing as PRs and asks the user for what only they can give, and the user can run it on
 * one project before turning YOLO mode on. A project may have changes merge by themselves once its tests pass on the default branch, its way
 * back is known and no model there breaks. This file holds the switch and that bar. The parts are `yolo-parts.mjs`'s, and what merges is the
 * pass's (`yolo-pass.mjs`).
 */

export { HIGHEST_RATE, LOWEST_RATE };
const modelOnMain = {
  broken: ({ spec, why }) => `${specName(spec)} breaks on the default branch${why ? `: ${why}` : ''}`,
  unproven: ({ spec, why }) => `${specName(spec)} did not hold on the default branch${why ? `: ${why}` : ''}`,
  unchecked: ({ spec }) => `${specName(spec)} has not been checked on the default branch yet`,
};
// The readiness work has landed: the user merged it, or its run had nothing to put on its own branch.
const LANDED = ['merged', 'done'];

// The user may run it before turning YOLO mode on, so it never says the switch is on.
const READY_BRIEF = 'With YOLO mode on, hobkin merges and deploys small changes by itself, on a project whose tests pass on the default branch, whose '
  + 'way back is known and whose models there hold. Make this project ready rather than report on it: tests that can cover a change, monitoring a '
  + 'regression would show up in (error tracking that reaches an alert, slow query and N+1 detection, request and job timings with a baseline, logs '
  + 'that can be searched, alerts that reach the user), a way back with a flag mechanism where one makes sense, and a deploy path hobkin can run and '
  + 'undo. Set up each part that is missing on a branch of its own for hobkin to open as a PR, ask the user for each step only they can take, and '
  + 'record every part as the YOLO readiness section of your directions says.';

const goalMerges = 'A goal has nothing to merge, so YOLO mode does nothing there.';

/** The switch as it stands. A home that never set it has it off. */
export function readYolo(root) {
  const { on, rate } = readMode(root).yolo ?? {};
  return { on: on === true, rate: isRate(rate) ? rate : USUAL_RATE };
}

const readinessFile = (root, slug) => join(paths(root, slug).directory, 'yolo.json');
const readinessItem = (root, slug) => readItems(root, slug).find(({ key }) => key === READY_KEY) ?? null;

// Each project's own switch, as the window set it, or null in a home where no switch was set yet.
const projectSwitches = ({ yoloProjects }) => (yoloProjects && typeof yoloProjects === 'object' && !Array.isArray(yoloProjects) ? yoloProjects : null);

/**
 * Whether YOLO mode works on this project, by the project's own switch, which only the window sets. The main switch still decides first, and
 * this says nothing about it. A home where no project's switch was set yet keeps what it had: with YOLO mode off, every project, and with it
 * on, each project it took on, which is each one its readiness work was filed on. Once any switch is set, or the owner's pass has run
 * (`settleSwitches`), they are all written down, so a project chosen after that starts off, and only the user turns it on.
 */
export function yoloOnProject(root, slug, mode = readMode(root)) {
  const set = projectSwitches(mode);
  if (set) return set[slug] === true;
  return mode.yolo?.on === true ? Boolean(readinessItem(root, slug)) : true;
}

// Every chosen project's switch as it stands now, so writing one, or flipping the main switch, changes no other project.
const settledSwitches = (root, mode) => projectSwitches(mode)
  ?? Object.fromEntries(chosenProjects(root).map(({ slug }) => [slug, yoloOnProject(root, slug, mode)]));

/**
 * Writes every chosen project's switch down as it stands, once, in a home with none written yet. The owner's pass does it, so from the first
 * pass of a hobkin that has the switches, which is when the window can show them, a project taken on Work later starts off.
 */
export function settleSwitches(root) {
  const mode = readMode(root);
  if (projectSwitches(mode)) return;
  writeMode(root, { yoloProjects: settledSwitches(root, mode) });
}

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

/** Each chosen project YOLO mode is on for gets its readiness work once, as a feature in the queue. It answers what it filed. */
export function prepareProjects(root, now = Date.now()) {
  const mode = readMode(root);
  return chosenProjects(root).flatMap(project => {
    if (isGoal(project) || !yoloOnProject(root, project.slug, mode) || readinessItem(root, project.slug)) return [];
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
 * A state machines look that is due goes first, since readiness counts the project's models only after a look with the TLA+ tools.
 */
export function runReadiness(root, slug, now = Date.now()) {
  const project = chosenProjects(root).find(chosen => chosen.slug === slug);
  if (!project) throw Error(`${slug} is not a project work mode works on.`);
  if (isGoal(project)) throw Error(goalMerges);
  if (!yoloOnProject(root, slug)) throw Error(`YOLO mode is off on ${nameOf(project)}, so its readiness is not run. Turn it on there first.`);
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

  const started = triggerRow(root, `item:${slug}:${item.id}`, undefined, { now: true });
  if (!machinesLookDue(root, project, now)) return started;
  pickNow(root, `machines:${slug}`);
  return { ...started, message: `${started.message} Its state machines look goes first.` };
}

const plainYolo = ({ yolo }) => (yolo && typeof yolo === 'object' && !Array.isArray(yolo) ? yolo : {});

/**
 * The user's word on YOLO mode, from the window alone: no `hobkin work` command calls this. Turning it on files each project's readiness work and
 * merges nothing. A value left out keeps what it was. `rules` is a change to the settings of all projects (`setYoloRules`), checked with the rest.
 */
export function setYolo(root, { on, rate, rules } = {}, now = Date.now()) {
  const mode = readMode(root);
  const before = readYolo(root);
  const next = { on: on ?? before.on, rate: rate ?? before.rate };
  if (typeof next.on !== 'boolean') throw Error('YOLO mode is on or off.');
  if (!isRate(next.rate)) throw Error(`The lowest general rate YOLO mode accepts is a number from ${LOWEST_RATE} to ${HIGHEST_RATE}, with one decimal at most.`);
  // Every rule is checked before anything is written. The lowest rate of the call's own `rate` wins over one named in `rules`.
  const asked = rules ? everyProjectPatch(mode, rules) : {};
  const kept = { ...plainYolo(mode), ...next, ...(asked.rules ? { rules: asked.rules } : {}), ...(asked.rate !== undefined && rate === undefined ? { rate: asked.rate } : {}) };
  // A home with no project switches yet reads them through the main switch, so flipping it writes each project's down first.
  const flipped = next.on !== before.on;
  writeMode(root, { yolo: kept, ...(asked.reviewPulls === undefined ? {} : { reviewPulls: asked.reviewPulls }), ...(flipped ? { yoloProjects: settledSwitches(root, mode) } : {}) });
  return { on: kept.on, rate: kept.rate, filed: kept.on ? prepareProjects(root, now) : [] };
}

/**
 * The user's word on YOLO mode for one project, from the window alone, as with the main switch. Every other project keeps its switch. Off, its
 * readiness work that has not started is set aside in the queue, so YOLO mode makes nothing ready there, and on puts it back, and files it
 * while YOLO mode is on. Nothing running is stopped, and nothing merges.
 */
export function setYoloProject(root, slug, on, now = Date.now()) {
  if (typeof on !== 'boolean') throw Error('YOLO mode on a project is on or off.');
  const project = chosenProjects(root).find(chosen => chosen.slug === slug);
  if (!project) throw Error(`${slug} is not a project work mode works on.`);
  if (isGoal(project)) throw Error(goalMerges);
  writeMode(root, { yoloProjects: { ...settledSwitches(root, readMode(root)), [slug]: on } });

  const item = readinessItem(root, slug);
  const key = item && `item:${slug}:${item.id}`;
  if (!on && item && ['open', 'stuck'].includes(item.state)) skipInQueue(root, key);
  if (on && key && readMode(root).queueSkipped.includes(key)) putBackInQueue(root, key);
  const filed = on && readYolo(root).on ? prepareProjects(root, now).filter(each => each.slug === slug) : [];
  return { slug, on, filed };
}

/**
 * What a readiness run found and did, part by part. hobkin keeps it only from the run of that project's readiness item, and the date is hobkin's.
 * Every part is checked before anything is filed, then each branch becomes finished work for a PR and each step for the user one action item.
 */
export function recordReadiness(root, slug, report, now = Date.now()) {
  const own = readinessItem(root, slug);
  if (own?.state !== 'doing') throw Error('Only the run of this project\'s readiness item records it.');
  const found = Object.fromEntries(RECORDED.map(name => [name, partOf(name, report?.[name])]));
  const project = chosenProjects(root).find(chosen => chosen.slug === slug);
  const parts = fileParts(root, project, found, own, now);
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

// Each TLA+ spec on the project's default branch as the last survey found it, with the files it models.
const mainSpecs = (root, slug) => readUnmerged(root).projects[slug]?.models?.specs ?? [];

/** What hobkin's latest run of each TLA+ spec on the project's default branch says of it, as the last survey found them there. */
export const mainModels = (root, slug) => mainFacts(readRuns(root), { slug, specs: mainSpecs(root, slug) });

// The part of the bar each switch lets go of. The others are improvements and never hold anything back.
const BAR_RULES = { tests: 'testsPass', rollback: 'wayBackKnown', models: 'noModelBreaks' };

const machineCount = count => (count === 1 ? '1 machine has' : `${count} machines have`);

/**
 * In progress until a state machines look ran with Java and TLC found and recorded what it found (`machines.mjs`), since a look without them
 * could check no model. Then done when each spec on the default branch holds there, and when the look found no machine and no spec is there.
 * Only a spec that breaks on the default branch holds YOLO mode back. One hobkin has not checked there yet is in progress, since its own weekly
 * check runs it, and one that did not hold is to do. A machine with no model yet holds nothing back: a change to it is sent back for its model
 * first (`yolo-pass.mjs`).
 */
function modelsPart(root, slug) {
  const looked = readMachines(root, slug);
  if (looked?.tlc !== true) return { state: 'doing', line: 'Its state machines have not been looked for with TLC yet.', blocks: false };
  const facts = mainModels(root, slug);
  if (!facts.length && !looked.machines.length) return { state: 'done', line: 'Its state machines look found none.', blocks: false };

  const said = state => facts.filter(fact => fact.state === state).map(fact => modelOnMain[state](fact));
  const [broken, unproven, unchecked] = ['broken', 'unproven', 'unchecked'].map(said);
  if (broken.length) return { state: 'todo', line: `${broken.join('; ')}.`, blocks: true };
  if (unproven.length) return { state: 'todo', line: `${unproven.join('; ')}.`, blocks: false };
  if (unchecked.length) return { state: 'doing', line: `${unchecked.join('; ')}.`, blocks: false };

  const modeled = new Set(mainSpecs(root, slug).flatMap(({ models = [] }) => models));
  const unmodeled = looked.machines.filter(({ files }) => !files.every(file => modeled.has(file))).length;
  const held = facts.length === 1 ? '1 model holds' : `${facts.length} models hold`;
  const holding = facts.length ? `${held} on the default branch: ${facts.map(({ spec }) => specName(spec)).join(', ')}.` : '';
  const waiting = unmodeled ? `${machineCount(unmodeled)} no model on the default branch yet, so a change to it gets its model first.` : '';
  return { state: 'done', line: [holding, waiting].filter(Boolean).join(' '), blocks: false };
}

/** What holds YOLO mode back on a project: no check yet, a regression after a deploy, or a part of the bar not in place, each in a line. */
function needsOf(record, parts, rules) {
  if (!record) return { needs: ['Its readiness has not been checked yet.'], holds: [] };
  if (record.held && rules.holdAfterRegression) return { needs: [`A regression showed after "${record.held.title}" deployed. Retry its readiness work once that is fixed.`], holds: ['holdAfterRegression'] };
  // A broken model does not hold the project while the user lets a change that makes it hold go (`holdOf` reads `brokenModels` for that).
  const lifted = name => name === 'models' && rules.brokenModelFixMayMerge;
  const holding = PARTS.filter(name => parts[name].blocks && rules[BAR_RULES[name]] !== false && !lifted(name));
  return { needs: holding.map(name => `${partWords[name]}: ${needOf(parts[name])}`), holds: holding.map(name => BAR_RULES[name]).filter(Boolean) };
}

/**
 * Whether a project may have changes merge by themselves, what holds it back when it may not, and every part as it stands. The bar is tests that
 * pass on the default branch, a known way back, and no model there that breaks. Monitoring, the deploy path and models still to be looked at or
 * checked are improvements: shown and worked on, never holding it back. A change that lives on a branch still waiting for the user's yes is not
 * on the default branch yet, so it counts once that branch lands.
 */
export function readinessOf(root, slug) {
  const record = readKeptJson(readinessFile(root, slug), null);
  const items = readItems(root, slug);
  const own = items.find(({ key }) => key === READY_KEY) ?? null;
  const parts = partsOf(root, { record, items, own, models: modelsPart(root, slug) });
  const rules = rulesOf(root, slug);
  const { needs, holds } = needsOf(record, parts, rules);
  // The specs that break on the default branch while the project may not merge on top of them, by name, for each change to answer.
  const broken = parts.models.blocks && rules.noModelBreaks ? mainModels(root, slug).filter(({ state }) => state === 'broken').map(({ spec }) => spec) : [];
  return { ready: needs.length === 0, needs, holds, brokenModels: broken, parts, at: record?.at ?? null, item: own?.id ?? null };
}

/** Where a project's readiness work stands: none filed, queued, running, waiting for the user's yes, landed, or closed without landing. */
function workOf(item, running) {
  if (!item) return 'none';
  if (running.some(run => run.item === item.id)) return 'running';
  if (runnableStates.includes(item.state)) return 'queued';
  if (WAITS_FOR_A_YES.includes(item.state)) return 'waiting';
  return LANDED.includes(item.state) ? 'landed' : 'closed';
}

/**
 * YOLO mode as the window and Home read it: the switch, the rate, how many projects are ready, what holds each of the others back, every part of
 * each project as it stands with its PR or action item, where each project's readiness work stands and its item, so the window can offer the yes
 * to its branch, when its readiness was last recorded, what hobkin's runs say of its models on the default branch, and its own switch as `on`.
 */
export function yoloView(root) {
  const { running } = ownerView(root);
  const mode = readMode(root);
  const projects = chosenProjects(root).filter(project => !isGoal(project)).map(project => {
    const { ready, needs, parts, at } = readinessOf(root, project.slug);
    const runs = running.filter(run => run.slug === project.slug);
    const item = readinessItem(root, project.slug);
    const work = workOf(item, runs);
    const models = mainModels(root, project.slug);
    const each = PARTS.map(name => ({ name, label: partWords[name], ...parts[name] }));
    const on = yoloOnProject(root, project.slug, mode);
    return { slug: project.slug, name: nameOf(project), on, rules: rulesOf(root, project.slug, mode), overrides: overridesOf(root, project.slug, mode), ready, needs, parts: each, work, item: item?.id ?? null, checkedAt: at, ...(models.length ? { models } : {}) };
  });
  return { ...readYolo(root), rules: rulesOf(root, null, mode), lowest: LOWEST_RATE, highest: HIGHEST_RATE, ready: projects.filter(({ ready }) => ready).length, projects };
}

export { setYoloRules } from './yolo-rules.mjs';
