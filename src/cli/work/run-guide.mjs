import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { reply, triggerRow } from './controls.mjs';
import { findItem, findProject, nameOf } from './names.mjs';
import { isGoal, ownerView, paths, readGuideLog, readMode, recordGuideLog } from './store.mjs';
import { defaultBranch, gitOrNothing } from './tree.mjs';
import { landingTip } from './unmerged.mjs';

/*
 * A code project's run guide (spec 068): the steps to run it end to end on the user's Mac, so they can try a change. It is kept in hobkin's
 * home and never in the project. A study or the `guide` look writes `run-guide.md`, and every run of it, theirs or a change's, is a `ran` line in
 * the log beside it. A `written` line marks each time the file changed, with the project's commit then and the files it was written from.
 */

export const GOAL_HAS_NO_GUIDE = 'A goal has no app to run, so it has no run guide.';

const FIELDS = ['worked', 'reached', 'note', 'sources', 'item'];
const guideKey = slug => `guide:${slug}`;

/** The guide's text, or null while it has none worth showing. */
function guideText(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return text.trim() ? text : null;
}

/** `writing` while a guide look runs, as the owner says, and `queued` while the user's press waits in the queue. */
function pendingOf(root, slug) {
  const key = guideKey(slug);
  if (ownerView(root).running.some(run => run.planKey === key)) return 'writing';
  return readMode(root).queueNext.includes(key) ? 'queued' : null;
}

const runOf = ({ at, by, item = null, worked, reached = null, note = null }) => ({ at, by, item, worked, reached, note });

/** A project's run guide as the window shows it. It only reads. A goal has none, and says why. */
export function readRunGuide(root, slug) {
  const project = findProject(root, slug);
  const none = { slug: project.slug, text: null, writtenAt: null, commit: null, sources: [], lastRun: null, pending: null, refused: null };
  if (isGoal(project)) return { ...none, refused: GOAL_HAS_NO_GUIDE };

  const log = readGuideLog(root, project.slug);
  const written = log.findLast(line => line.type === 'written');
  const ran = log.findLast(line => line.type === 'ran');
  return {
    ...none,
    text: guideText(paths(root, project.slug).runGuide),
    writtenAt: written?.at ?? null,
    commit: written?.commit ?? null,
    sources: written?.sources ?? [],
    lastRun: ran ? runOf(ran) : null,
    pending: pendingOf(root, project.slug),
  };
}

/**
 * The user's press, Write the run guide or Check it again: a `guide` look first in the queue, as a trigger puts it, so it starts when work mode
 * and the workload let it. A press while one waits or runs files nothing more.
 */
export function requestRunGuide(root, slug) {
  const project = findProject(root, slug);
  if (isGoal(project)) throw Error(GOAL_HAS_NO_GUIDE);
  const pending = project.state === 'chosen' ? pendingOf(root, project.slug) : null;
  const named = nameOf(project);
  if (pending === 'writing') return { message: `An agent is writing the run guide for ${named} now, so nothing more was filed.` };
  if (pending === 'queued') return { message: `The run guide for ${named} is already queued, so nothing more was filed.` };
  return { message: triggerRow(root, project.slug, 'guide').message };
}

const oneLine = text => text?.replace(/\s+/g, ' ').trim() || null;
const isFileList = value => Array.isArray(value) && value.every(file => typeof file === 'string' && file.trim());

/** A run as a run reports it, checked before anything is written. `item` is the change whose run this was, by its id or the start of it. */
function checkedRun(root, project, report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw Error('Pipe one run as JSON, such as { "worked": true, "reached": null, "note": "..." }.');
  const wrong = Object.keys(report).filter(name => !FIELDS.includes(name));
  if (wrong.length) throw Error(`Not a field of a run: ${wrong.join(', ')}. A run takes worked, reached, note, sources and item.`);

  const { worked, reached = null, note = null, sources, item } = report;
  if (typeof worked !== 'boolean') throw Error('worked is true or false: whether the app answered where the guide says to open it.');
  if (reached !== null && typeof reached !== 'string') throw Error('reached is the last step that worked, in the guide\'s words, or null when it worked.');
  if (note !== null && typeof note !== 'string') throw Error('note is one line about the run.');
  if (sources !== undefined && !isFileList(sources)) throw Error('sources is a list of the project\'s files the guide was written from, such as README.md and bin/setup.');
  if (item !== undefined && typeof item !== 'string') throw Error('item is the id of the change whose run this was.');

  return {
    worked,
    reached: worked ? null : oneLine(reached),
    note: oneLine(note),
    sources: sources?.map(source => source.trim()),
    item: item === undefined ? null : findItem(root, project, item).id,
  };
}

/** The commit of the project's default branch the guide was written from, as a look's tree has it, or what is checked out when it has none. */
async function commitOf(root, project) {
  const repo = project.path ?? paths(root, project.slug).clone;
  const tip = await landingTip(repo, await defaultBranch(repo));
  return tip || await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', 'HEAD') || null;
}

const hashOf = file => createHash('sha256').update(readFileSync(file)).digest('hex');

/** A `written` line, only when the guide's file differs from the one the last `written` line saw. */
async function noteWritten(root, project, sources, at) {
  const file = paths(root, project.slug).runGuide;
  if (!sources || guideText(file) === null) return null;
  const hash = hashOf(file);
  if (readGuideLog(root, project.slug).findLast(line => line.type === 'written')?.hash === hash) return null;
  const written = { type: 'written', at, commit: await commitOf(root, project), sources, hash };
  recordGuideLog(root, project.slug, written);
  return written;
}

function ranWords({ worked, reached }) {
  if (worked) return 'it worked';
  return reached ? `it got as far as ${reached}` : 'it did not work';
}

/**
 * `hobkin work guide <project> [study]`: one run of the guide, piped by the run that followed it. `caller` is `study` when the director gave the
 * command to a study. A run with an item is that change's, and any other is the `guide` look's. With `sources`, a guide that changed is recorded
 * as written too.
 */
export async function recordGuideRun(root, slug, report, caller, now = Date.now()) {
  const project = findProject(root, slug);
  if (isGoal(project)) throw Error(GOAL_HAS_NO_GUIDE);
  if (caller !== undefined && caller !== 'study') throw Error('Say guide <project>, or guide <project> study.');
  const { sources, ...run } = checkedRun(root, project, report);

  const at = new Date(now).toISOString();
  const written = await noteWritten(root, project, sources, at);
  const by = run.item ? 'item' : caller ?? 'guide';
  const ran = { type: 'ran', at, by, ...run };
  recordGuideLog(root, project.slug, ran);

  const said = [`Recorded a run of the run guide for ${nameOf(project)}: ${ranWords(run)}.`];
  if (written) said.push(`The guide is recorded as written${written.commit ? ` at ${written.commit.slice(0, 7)}` : ''}.`);
  return reply(said.join(' '), { run: runOf(ran), written: Boolean(written) });
}
