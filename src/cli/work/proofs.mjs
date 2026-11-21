import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { gitOrNothing } from './tree.mjs';

/**
 * TLA+ models as work mode reads them (_specs/050-tla-proofs). A model lives in its project at `_specs/tla/<area>/<Machine>.tla`, and its `\* models:`
 * comments name the files it models. Only the `hobkin proof check` process writes a run, as `<home>/proofs/<id>/result.json`: this file only
 * reads runs and matches them to a commit. hobkin's own checks start in `proof-checks.mjs`.
 */

const SPECS_FOLDER = '_specs/tla';
// The spec's sha256 as the check read it, so a run of an edit nobody committed counts for no commit.
const SPEC_HASH = 'specHash';
const SHORT_SHA = 7;
const LONGEST_LINE = 400;

const run = promisify(execFile);
const number = value => Number(value ?? 0).toLocaleString('en-US');

/** A spec as a sentence names it: its file name. */
export const specName = spec => basename(spec);

/** The files a spec says it models, from each `\* models: a, b` comment. */
export const modeledFiles = text => [...String(text).matchAll(/^\s*\\\*\s*models:(.*)$/gm)]
  .flatMap(([, list]) => list.split(','))
  .map(path => path.trim().replace(/^\.\//, ''))
  .filter(Boolean);

/**
 * Each result as last read, by its file, and the size and time it had then. Work mode reads every run on each tick, once for each project,
 * and a run of a real model keeps its whole state graph, tens of megabytes, so a result is parsed again only once its file changed, and kept
 * without the graph, which work mode never reads.
 */
const results = new Map();

/** A run's result, or null for a run still going, or one that never ended. */
function readResult(folder, id) {
  const file = join(folder, id, 'result.json');
  try {
    const { mtimeMs, size } = statSync(file);
    const held = results.get(file);
    if (held?.mtimeMs === mtimeMs && held.size === size) return held.result;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const { graph, ...result } = parsed && typeof parsed === 'object' ? parsed : {};
    const kept = parsed && typeof parsed === 'object' ? { ...result, id: result.id ?? id } : null;
    results.set(file, { mtimeMs, size, result: kept });
    return kept;
  } catch {
    results.delete(file);
    return null;
  }
}

const endOf = ({ finished, started }) => String(finished ?? started ?? '');

/** Every run that ended, newest first. */
export function readRuns(root) {
  const folder = join(root, 'proofs');
  if (!existsSync(folder)) return [];

  const ids = readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  const runs = ids.map(id => readResult(folder, id)).filter(Boolean);
  return runs.toSorted((first, second) => endOf(second).localeCompare(endOf(first)));
}

/** One spec as committed at `head`, read as bytes so its sha256 matches the file the check read. Null when git cannot show it. */
async function readSpec(repo, head, spec) {
  try {
    const { stdout } = await run('git', ['-C', repo, 'show', `${head}:${spec}`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    return {
      spec,
      sha256: createHash('sha256').update(stdout).digest('hex'),
      models: modeledFiles(stdout.toString('utf8')),
    };
  } catch {
    return null;
  }
}

/** Each spec at a commit, with the sha256 of its committed bytes and the files it models. */
export async function specsAt(repo, head) {
  if (!head) return [];

  const listed = await gitOrNothing(repo, 'ls-tree', '-r', '--name-only', head, '--', SPECS_FOLDER);
  const specs = listed.split('\n').filter(path => path.endsWith('.tla'));
  const read = await Promise.all(specs.map(spec => readSpec(repo, head, spec)));
  return read.filter(Boolean);
}

/**
 * The specs at a change's head that model a file it touches, or that it edits, whether it edited the spec or its cfg, and which of the files it
 * touches each one names in `\* models:`.
 */
export async function modelsAt(repo, head, changed = []) {
  const touched = new Set(changed);
  const edits = spec => touched.has(spec) || touched.has(spec.replace(/\.tla$/, '.cfg'));
  return (await specsAt(repo, head))
    .filter(({ spec, models }) => edits(spec) || models.some(file => touched.has(file)))
    .map(({ spec, sha256, models }) => ({ spec, sha256, changed: edits(spec), covers: models.filter(file => touched.has(file)) }));
}

/**
 * The commits on a branch whose code its head still has, because every commit after them changed only TLA+ models. Empty when the head itself
 * changed code. A review of any of them still speaks for the head (`scoresHoldAt`).
 */
export async function sameCodeAs(repo, base, name) {
  const code = (await gitOrNothing(repo, 'rev-list', '--max-count=1', `${base}..${name}`, '--', '.', `:(exclude)${SPECS_FOLDER}`)).trim();
  if (!code) return [];
  const later = (await gitOrNothing(repo, 'rev-list', `${code}..${name}`)).split('\n').filter(Boolean);
  return later.length ? [code, ...later] : [];
}

/**
 * Whether scores given at `head` speak for a change as the survey read it: at that very commit, or at one whose code it still has. A model
 * written after the review moves the head and leaves alone the code the review scored.
 */
export const scoresHoldAt = (head, unit = {}) => Boolean(head && unit.sha) && (head === unit.sha || (unit.sameCode ?? []).includes(head));

const unfired = ({ actions }) => (Array.isArray(actions) ? actions : []).filter(({ count }) => !(count > 0)).map(({ name }) => name);

/** A run is evidence the model holds only when it ended `holds` and every action fired: an action that never fired checked nothing it guards. */
const counts = run => run.outcome === 'holds' && Array.isArray(run.actions) && run.actions.length > 0 && !unfired(run).length;

function stateOf(run) {
  if (!run) return 'unchecked';
  if (run.outcome === 'broken') return 'broken';
  return counts(run) ? 'holds' : 'unproven';
}

function whyNot(run) {
  if (run.outcome === 'broken') return run.broken ?? null;
  if (run.outcome === 'holds') return unfired(run).length ? `${unfired(run).join(', ')} never fired` : 'no action was counted';
  return run.message ?? `it was ${run.outcome ?? 'never finished'}`;
}

function tlcWords(run) {
  const rules = Array.isArray(run.rules) ? run.rules : [];
  const states = `${number(run.stats?.distinct)} states`;
  if (run.outcome === 'broken') return `TLC: ${run.broken ?? 'a rule'} breaks${run.traceLength ? ` in ${run.traceLength} steps` : ''}`;
  if (run.outcome !== 'holds') return `TLC did not finish: ${whyNot(run)}`;
  const held = rules.length ? `TLC: ${rules.filter(({ status }) => status === 'holds').length} of ${rules.length} hold in ${states}` : `TLC: holds in ${states}`;
  return counts(run) ? held : `${held}, but ${whyNot(run)}`;
}

function tlapsWords({ proof }) {
  const steps = proof?.strict && Array.isArray(proof.obligations) ? proof.obligations : [];
  return steps.length ? `TLAPS: ${steps.filter(({ status }) => status === 'proved').length} of ${steps.length}, strict` : null;
}

/** What a run showed, in the line a proof score's evidence takes. */
function lineOf(run) {
  const where = run.head ? `at ${run.head.slice(0, SHORT_SHA)}` : null;
  const parts = [tlcWords(run), tlapsWords(run), where].filter(Boolean);
  return parts.join(' · ').slice(0, LONGEST_LINE);
}

function factOf(spec, run, extra = {}) {
  const state = stateOf(run);
  if (!run) return { spec, state, ...extra };
  const why = state === 'holds' ? null : whyNot(run);
  return { spec, state, ...extra, run: run.id, ...(why ? { why } : {}), line: lineOf(run) };
}

/**
 * What the runs say of each spec a change's survey found covering it, at that change's head: `holds`, `broken`, `unproven` (it ran and ended
 * otherwise, or an action never fired) or `unchecked`. A run counts only at that head and on the spec committed there, and one that broke there
 * outweighs one that held.
 */
export function modelFacts(runs, { slug, head, specs = [] }) {
  return specs.map(({ spec, sha256, changed = false }) => {
    const here = runs.filter(run => run.project === slug && run.spec === spec && run.head === head && run[SPEC_HASH] === sha256);
    const speaking = here.find(run => run.outcome === 'broken') ?? here.find(counts) ?? here[0];
    return factOf(spec, speaking, { changed });
  });
}

/** The same for a change as the survey left it, reading the runs only when a model covers it. */
export const changeModels = (root, slug, unit = {}) => (unit.models?.length ? modelFacts(readRuns(root), { slug, head: unit.sha, specs: unit.models }) : []);

/**
 * The latest run of one spec as the default branch has it: a run made for no item, at any commit of that same spec, such as hobkin's weekly
 * recheck or the look's own check. `runs` is newest first, as `readRuns` reads them.
 */
export const latestMainRun = (runs, { slug, spec, sha256 }) => runs
  .find(run => run.project === slug && !run.item && run.spec === spec && run[SPEC_HASH] === sha256) ?? null;

/** What the latest run on the default branch says of each spec there. */
export const mainFacts = (runs, { slug, specs = [] }) => specs.map(({ spec, sha256 }) => factOf(spec, latestMainRun(runs, { slug, spec, sha256 })));
