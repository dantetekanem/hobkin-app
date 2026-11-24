import { spawn as spawnProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from '../config.mjs';
import { latestMainRun, modelFacts, readRuns } from './proofs.mjs';
import { chosenProjects, paths, readItems, readJson, readMode, readProject } from './store.mjs';
import { gitOrNothing, gitWithin } from './tree.mjs';

/**
 * TLA+ checks hobkin starts itself (_specs/050-tla-proofs): each model of a finished change that no run speaks for at the change's head, and
 * every model on the default branch once a week. Each is `hobkin proof check`, run as hobkin's own job, never an agent's, in a tree of hobkin's
 * own at that commit. That process writes the run, and `proofs.mjs` reads it.
 */

// A check stops itself after 20 minutes, so one older than this is over whatever its process id now names.
const CHECK_LASTS_MS = 25 * 60000;
// As often as the state machines look (`plan.mjs`): a check hobkin tried is not tried again for a week.
const CHECK_EVERY_MS = 7 * 24 * 3600000;
const GIT_TIMEOUT_MS = 120000;

const git = gitWithin(GIT_TIMEOUT_MS);
const mainScript = fileURLToPath(new URL('../main.mjs', import.meta.url));
const checksPath = root => join(root, 'work', 'proof-checks.jsonl');

function readChecks(root) {
  if (!existsSync(checksPath(root))) return [];
  return readFileSync(checksPath(root), 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const sameCheck = (first, second) => ['slug', 'item', 'spec', 'head'].every(key => (first[key] ?? null) === (second[key] ?? null));
const isGoing = ({ at, pid }, now) => now - Date.parse(at) < CHECK_LASTS_MS && alive(pid);
const triedLately = (earlier, check, now) => sameCheck(earlier, check) && now - Date.parse(earlier.at) < CHECK_EVERY_MS;

/** hobkin's own tree for checks, detached at `head`. Nothing else works in it, so what a check left there goes. */
async function treeAt(root, slug, head) {
  const project = readProject(root, slug);
  const repo = project?.path ?? paths(root, slug).clone;
  const tree = join(paths(root, slug).trees, 'proof');
  await gitOrNothing(repo, 'worktree', 'prune');
  if (!existsSync(join(tree, '.git'))) {
    mkdirSync(paths(root, slug).trees, { recursive: true, mode: 0o700 });
    await git(repo, 'worktree', 'add', '--quiet', '--detach', tree, head);
    return tree;
  }
  await git(tree, 'reset', '--quiet', '--hard');
  await git(tree, 'clean', '-fdq');
  await git(tree, 'switch', '--quiet', '--detach', head);
  return tree;
}

/**
 * Starts `hobkin proof check` on one spec at one commit, as hobkin's own job, in a tree at that commit. One goes at a time, and a check tried in
 * the last week is not tried again, so a check that cannot run costs one try. It answers what it started, or null.
 */
export async function startCheck(root, check, { now = Date.now(), spawn = spawnProcess } = {}) {
  const tried = readChecks(root);
  if (tried.some(earlier => isGoing(earlier, now))) return null;
  if (tried.some(earlier => triedLately(earlier, check, now))) return null;

  const { slug, item = null, spec, head } = check;
  const started = { at: new Date(now).toISOString(), slug, item, spec, head, pid: null };
  try {
    const tree = await treeAt(root, slug, head);
    const args = [mainScript, 'proof', 'check', spec, '--project', slug, ...(item ? ['--item', item] : []), '--head', head, '--home', root];
    const child = spawn(process.execPath, args, { cwd: tree, detached: true, stdio: 'ignore' });
    child.on?.('error', () => {});
    child.unref?.();
    started.pid = child.pid ?? null;
  } catch (error) {
    // A tree git cannot make today would fail the same way on every pass, so this try counts too.
    started.error = String(error.message ?? error).split('\n', 1)[0];
  }
  mkdirSync(join(root, 'work'), { recursive: true, mode: 0o700 });
  appendFileSync(checksPath(root), `${JSON.stringify(started)}\n`, { mode: 0o600 });
  return started.error ? null : started;
}

/** The check of each model no run speaks for at a finished change's head, as the survey read that head, naming the change's item. */
function uncheckedModels(root, slug, units, runs) {
  const modeled = units.filter(unit => unit.kind === 'branch' && unit.models?.length);
  return readItems(root, slug).filter(({ state }) => state === 'branch').flatMap(item => {
    const unit = modeled.find(({ branch }) => branch === item.branch);
    if (!unit) return [];
    return modelFacts(runs, { slug, head: unit.sha, specs: unit.models })
      .filter(({ state }) => state === 'unchecked')
      .map(({ spec }) => ({ slug, item: item.id, spec, head: unit.sha }));
  });
}

/**
 * After each survey hobkin checks, itself, each model of a finished change that no run speaks for at the change's head, with YOLO mode on or
 * off and whether or not the change edited the spec. It goes one at a time and only while work mode is on, like the weekly recheck. `survey`
 * is the survey's projects, which hold each change's head and the models covering it. It answers what it started, or null.
 */
export async function checkChangeModels(root, { now = Date.now(), survey = {}, spawn } = {}) {
  if (!readMode(root).enabled) return null;
  const runs = readRuns(root);
  for (const { slug } of chosenProjects(root)) {
    for (const check of uncheckedModels(root, slug, survey[slug]?.open ?? [], runs)) {
      const started = await startCheck(root, check, { now, ...(spawn ? { spawn } : {}) });
      if (started) return started;
    }
  }
  return null;
}

const rechecksPath = root => join(root, 'work', 'model-rechecks.json');
const readRechecks = root => {
  const asked = readJson(rechecksPath(root), []);
  return Array.isArray(asked) ? asked : [];
};

/**
 * Asks for a check of these specs on the default branch as soon as it moves past `from`, the commit the last survey read there, without waiting
 * out the week. YOLO mode calls it after a merge that fixed a model broken there (`yolo-pass.mjs`).
 */
export function askRecheck(root, slug, specs, from) {
  const kept = readRechecks(root).filter(asked => asked.slug !== slug || !specs.includes(asked.spec));
  mkdirSync(join(root, 'work'), { recursive: true, mode: 0o700 });
  atomicJson(rechecksPath(root), [...kept, ...specs.map(spec => ({ slug, spec, from: from ?? null }))]);
}

const forgetRecheck = (root, slug, spec) => atomicJson(rechecksPath(root), readRechecks(root).filter(asked => asked.slug !== slug || asked.spec !== spec));

/**
 * Once a week, and as soon as a spec reaches the default branch with no run of it, hobkin checks each spec there itself, one at a time and only
 * while work mode is on. `survey` is the survey's projects, which hold each one's specs on the default branch.
 */
export async function recheckModels(root, { now = Date.now(), survey = {}, spawn } = {}) {
  if (!readMode(root).enabled) return null;
  const runs = readRuns(root);
  for (const { slug } of chosenProjects(root)) {
    const { head, specs = [] } = survey[slug]?.models ?? {};
    const asked = readRechecks(root).filter(each => each.slug === slug);
    for (const { spec, sha256 } of specs) {
      const last = latestMainRun(runs, { slug, spec, sha256 });
      const checkedThisWeek = last && now - Date.parse(last.finished ?? last.started) < CHECK_EVERY_MS;
      // A spec asked for after a merge is due once the default branch has moved past the commit it was asked at.
      const movedOn = asked.some(each => each.spec === spec && head && head !== each.from);
      if (checkedThisWeek && !movedOn) continue;

      const started = await startCheck(root, { slug, spec, head }, { now, ...(spawn ? { spawn } : {}) });
      if (started) {
        if (movedOn) forgetRecheck(root, slug, spec);
        return started;
      }
    }
  }
  return null;
}
