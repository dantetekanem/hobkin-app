import { execFile } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson } from '../config.mjs';
import { shortPath } from './chat.mjs';
import { proposeProject, readDiscovery, readJson, readProjects, readState, recordDiscovery, slugOf, writeState } from './store.mjs';

const DAY_MS = 86400000;
const RECENT_DAYS = 90;
// About a commit a week over the 90 days, the same bar discovery sets for `important`.
const BUSY_COMMITS = 12;
const CLEAR_NEW_ACTIVITY = 5;
const MAX_README_LINE = 120;
const LEFT_ALONE = new Set(['node_modules', 'vendor', 'dist', 'build', 'target']);
const READMES = ['README.md', 'readme.md', 'Readme.md', 'README', 'README.txt'];

const run = promisify(execFile);
// GIT_OPTIONAL_LOCKS keeps even these reads from refreshing the index. The watcher never writes to a repository, not even a fetch.
const askGit = (cwd, ...args) => run('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  .then(({ stdout }) => stdout.trim(), () => '');
const watchPath = root => join(root, 'work', 'watch.json');
const typeOf = path => lstatSync(path, { throwIfNoEntry: false });

export const readWatch = root => readJson(watchPath(root), null);

function foldersIn(folder) {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !LEFT_ALONE.has(entry.name))
      .map(entry => join(folder, entry.name));
  } catch {
    return [];
  }
}

// `.git` is a file in a linked worktree or a submodule, and those are part of another repository.
const isRepository = path => Boolean(typeOf(join(path, '.git'))?.isDirectory());

/** The user's directions name folders to leave out, as paths or as a pattern such as `advent*`, and that covers what is inside them. */
function ruledOutBy(directions) {
  const prefixes = [...directions.matchAll(/`([^`/*\s]+)\*`/g)].map(match => match[1]);
  const named = path => directions.includes(path) || directions.includes(shortPath(path)) || prefixes.some(prefix => basename(path).startsWith(prefix));
  return (path, top) => {
    for (let at = path; at !== top && at !== dirname(at); at = dirname(at)) {
      if (named(at)) return true;
    }
    return false;
  };
}

function readDirections(root) {
  try {
    return readFileSync(join(root, 'work', 'AGENTS.md'), 'utf8');
  } catch {
    return '';
  }
}

/** The top level, and one level down for a folder of projects. */
function shallowList(folder, ruledOut) {
  const allowed = path => !ruledOut(path, folder);
  return foldersIn(folder).filter(allowed).flatMap(path => {
    if (isRepository(path)) return [{ path, repository: true }];
    return [{ path, repository: false }, ...foldersIn(path).filter(allowed).filter(isRepository).map(child => ({ path: child, repository: true }))];
  });
}

async function factsOf(path, now) {
  const since = new Date(now - RECENT_DAYS * DAY_MS).toISOString();
  const [head, lastCommit, recent, remote, branch] = await Promise.all([
    askGit(path, 'rev-parse', 'HEAD'),
    askGit(path, 'log', '-1', '--format=%cI'),
    askGit(path, 'rev-list', '--count', `--since=${since}`, 'HEAD'),
    askGit(path, 'remote', 'get-url', 'origin'),
    askGit(path, 'branch', '--show-current'),
  ]);
  return { repository: true, head, lastCommit: lastCommit || null, recent: Number(recent) || 0, remote: remote || null, branch };
}

function readmeLine(path) {
  for (const name of READMES) {
    try {
      const line = readFileSync(join(path, name), 'utf8').split('\n').map(text => text.replace(/^[#\s]+/, '').trim()).find(Boolean);
      if (line) return line.slice(0, MAX_README_LINE);
    } catch {
      // Not every repository has this name of README.
    }
  }
  return '';
}

const suggestedLevel = ({ recent, remote }) => (recent >= BUSY_COMMITS && remote ? 'important' : 'casual');

/** Git facts alone. They cannot show what is deployed or who depends on it, so this never suggests `critical`. */
function proposalFrom(path, facts, because) {
  const commits = `${facts.recent} commit${facts.recent === 1 ? '' : 's'} in ${RECENT_DAYS} days`;
  const last = facts.lastCommit ? `Last commit ${facts.lastCommit.slice(0, 10)}, ` : '';
  const name = basename(path);
  return {
    name,
    path,
    level: suggestedLevel(facts),
    summary: readmeLine(path) || `A repository in ${shortPath(dirname(path))}.`,
    found: `${last}${commits}, ${facts.remote ? `remote ${facts.remote}` : 'no remote'}.`,
    reason: `The daily watch noticed ${because}. It was not looked at in depth.`,
    first: [],
  };
}

const newerThan = (path, sha, at) => askGit(path, 'rev-list', '--count', ...(sha ? [`${sha}..HEAD`] : [`--since=${at}`, 'HEAD'])).then(Number);

/** A skipped project comes back once, and only for clear new activity since the user said no. */
async function offerAgain(root, project, path, facts, now, watch) {
  if (watch.offered.includes(project.slug)) return;
  if (await newerThan(path, null, project.at) < CLEAR_NEW_ACTIVITY) return;

  proposeProject(root, proposalFrom(path, facts, 'new activity since it was skipped'), now, { reoffer: true });
  const { told = [] } = readDiscovery(root);
  recordDiscovery(root, { told: told.filter(slug => slug !== project.slug) });
  watch.offered.push(project.slug);
  watch.noted.proposed.push(project.slug);
}

async function compare(root, { path, facts, before, known, now, watch }) {
  const name = basename(path);
  const isNew = !before?.repository;
  if (isNew) watch.noted.added.push(name);
  if (known?.state === 'chosen') {
    const moved = before?.head && facts.head !== before.head;
    if (!moved) return;
    const newCommits = await newerThan(path, before.head);
    if (!newCommits) return;
    writeState(root, known.slug, { newCommits: (readState(root, known.slug).newCommits ?? 0) + newCommits });
    watch.noted.changed.push(name);
    return;
  }
  if (known?.state === 'skipped') return offerAgain(root, known, path, facts, now, watch);
  if (known) return;

  const revived = !isNew && !before.recent && facts.recent > 0;
  if (!facts.recent || !(isNew || revived)) return;
  proposeProject(root, proposalFrom(path, facts, revived ? 'it is active again' : 'a new repository'), now);
  watch.noted.proposed.push(slugOf(name));
}

/**
 * Code only: no model, no agent and no tokens. It looks at what changed since the last watch, and proposals go the way discovery's do,
 * so the user still picks. The first watch of a folder only records it, because discovery has covered what is there.
 */
export async function watchFolder(root, { folder, now = Date.now() }) {
  const last = readWatch(root);
  const first = !last || last.folder !== folder;
  const ruledOut = ruledOutBy(readDirections(root));
  const projects = readProjects(root);
  const watch = { offered: first ? [] : last.offered ?? [], noted: { added: [], removed: [], changed: [], proposed: [] } };
  const seen = {};

  for (const { path, repository } of shallowList(folder, ruledOut)) {
    const before = first ? null : last.seen[path];
    if (!repository) {
      seen[path] = { repository: false };
      if (!first && !before) watch.noted.added.push(basename(path));
      continue;
    }
    const facts = await factsOf(path, now);
    // A run's branch says nothing about the project, so this waits for the folder to come back to its default branch.
    if (before?.repository && facts.branch.startsWith('hobkin/')) {
      seen[path] = before;
      continue;
    }
    seen[path] = facts;
    if (first) continue;
    const known = projects.find(project => project.path === path) ?? projects.find(project => project.slug === slugOf(basename(path)));
    await compare(root, { path, facts, before, known, now, watch });
  }
  if (!first) watch.noted.removed = Object.keys(last.seen).filter(path => !seen[path] && !ruledOut(path, folder)).map(path => basename(path));
  atomicJson(watchPath(root), { at: new Date(now).toISOString(), folder, seen, ...watch });
}
