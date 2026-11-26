import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readItems, readProjects } from './store.mjs';

export const nameOf = ({ slug, name = slug }) => name;

/** A project keeps the path it was found at, which is not always the real one. */
function pathsOf(reference) {
  const path = resolve(reference.replace(/^~(?=$|\/)/, homedir()));
  try {
    return [path, realpathSync(path)];
  } catch {
    return [path];
  }
}

// Nothing here guesses. What fits twice fails with what it fits, so the caller can say which.
function fitsSeveral(reference, listed, matches, how) {
  const message = `${reference} fits ${listed.length} things: ${listed.join(', ')}. ${how}`;
  return Object.assign(Error(message), { matches });
}

/** A slug that is also another project's name is no safer than the name, so the two count alike. The path always tells them apart. */
function projectsNamed(root, reference) {
  const lowered = reference.toLowerCase();
  const spellings = pathsOf(reference);
  return readProjects(root).filter(({ slug, name, path, remote }) => slug === lowered
    || name?.toLowerCase() === lowered
    || remote === reference
    || spellings.includes(path));
}

export function projectNamed(root, reference) {
  const matches = projectsNamed(root, reference);
  if (matches.length < 2) return matches[0] ?? null;

  const facts = matches.map(({ slug, name = slug, path = null }) => ({ slug, name, path }));
  const listed = facts.map(({ slug, path }) => (path ? `${slug} (${path})` : slug));
  throw fitsSeveral(reference, listed, facts, 'Name one by its path.');
}

export function findProject(root, reference) {
  if (!reference) throw Error('Say which project.');
  const project = projectNamed(root, reference);
  if (!project) throw Error(`Unknown project: ${reference}. hobkin work projects lists them.`);
  return project;
}

export function findItem(root, { slug }, reference) {
  if (!reference) throw Error('Say which item.');
  const matches = readItems(root, slug).filter(({ id }) => id.startsWith(reference.toLowerCase()));
  if (!matches.length) throw Error(`Unknown item: ${reference} on ${slug}. hobkin work items ${slug} lists them.`);
  if (matches.length === 1) return matches[0];

  const facts = matches.map(({ id, title, state }) => ({ id, title, state }));
  throw fitsSeveral(reference, facts.map(({ id }) => id), facts, 'Give more of the id.');
}

/** What `cancel` can name: a project means everything running there, and the start of a run's or an item's id means that one run. */
export function runsNamed(root, running, reference) {
  const project = projectNamed(root, reference);
  const ownRuns = project ? running.filter(run => run.slug === project.slug) : [];
  const isNamedRun = run => run.id.startsWith(reference)
    || run.item?.startsWith(reference)
    || (reference === 'discover' && run.lane === 'discover');
  const namedRuns = running.filter(run => !ownRuns.includes(run) && isNamedRun(run));

  const candidates = [...(project ? [project.slug] : []), ...namedRuns.map(({ id }) => id)];
  if (candidates.length > 1) throw fitsSeveral(reference, candidates, candidates, 'Give the whole run id.');
  return project ? ownRuns : namedRuns;
}
