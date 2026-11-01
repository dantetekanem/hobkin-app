import {
  copyFileSync, cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import lockfile from 'proper-lockfile';
import { atomicJson } from './config.mjs';
import { cadences } from './schedules.mjs';

const OLD_DATABASE = 'companion.sqlite';
const DATABASE = 'hobkin.sqlite';
const OWNER_STALE_MS = 300000;
const TEXT_ROOTS = ['schedules', 'checks', 'notes', 'work', 'memory.md', 'config.json'];
// All that starting Hobkin once leaves behind. Anything else means this folder is not one to replace.
const FRESH_ENTRIES = new Set(['AGENTS.md', 'config.json', 'runtime', 'runtime.lock', 'schedules', 'sessions']);

const hasDatabase = root => [OLD_DATABASE, DATABASE].some(name => existsSync(join(root, 'runtime', name)));

const entries = path => (existsSync(path) ? readdirSync(path) : []);

const hasOwnHistory = root => entries(join(root, 'reports')).length > 0
  || cadences.some(cadence => entries(join(root, 'schedules', cadence)).length > 0)
  || entries(join(root, 'sessions')).some(name => readFileSync(join(root, 'sessions', name), 'utf8').includes('"type":"message"'));

const isInside = (path, parent) => path === parent || path.startsWith(`${parent}/`);

const isRunning = root => existsSync(join(root, 'runtime')) && lockfile.check(join(root, 'runtime'), { stale: OWNER_STALE_MS });

const readConfig = root => {
  const file = join(root, 'config.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

/** Links are skipped, because a write would land on whatever they point at. */
const textFiles = path => {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || basename(path) === 'trees') return [];
  if (stat.isDirectory()) return readdirSync(path).flatMap(name => textFiles(join(path, name)));
  return /\.(md|json|jsonl)$/.test(path) ? [path] : [];
};

const shortForm = path => (path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path);

// A whole path only: not `.companion-notes` beside the old folder, and not the same path under another disk.
const wholePath = path => new RegExp(`(?<![\\w./-])${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/"'\`\\s.,;:)]*(?:[/"'\`\\s)]|$))`, 'gm');

/** Schedules name their notes by absolute path, and those notes moved with them. Files beside the old folder did not. */
function movePathsInText(staged, from, to) {
  for (const file of TEXT_ROOTS.flatMap(name => textFiles(join(staged, name)))) {
    const text = readFileSync(file, 'utf8');
    const moved = text.replace(wholePath(from), () => to).replace(wholePath('~/.companion'), () => shortForm(to));
    if (moved !== text) writeFileSync(file, moved);
  }
}

/** The saved conversation is refused unless its path is inside this folder, so the stored paths move too. */
function movePathsInDatabase(staged, from, to) {
  for (const ending of ['', '-wal', '-shm']) {
    const file = join(staged, 'runtime', `${OLD_DATABASE}${ending}`);
    if (existsSync(file)) renameSync(file, join(staged, 'runtime', `${DATABASE}${ending}`));
  }
  const database = new DatabaseSync(join(staged, 'runtime', DATABASE));
  try {
    database.prepare('UPDATE document_revisions SET content = replace(content, ?, ?) WHERE instr(content, ?) > 0')
      .run(`${from}/`, `${to}/`, `${from}/`);
  } finally {
    database.close();
  }
}

// A work tree's .git file points into the old folder, so a copy would work on the old checkout. Work mode builds new ones.
const copied = (path, from) => {
  const inside = relative(from, path);
  return inside !== 'runtime.lock' && !/^work\/[^/]+\/trees$/.test(inside);
};

// A started Hobkin publishes this file before anyone has used work mode.
const isUnusedWork = to => entries(join(to, 'work')).every(name => name === 'owner.json');

function assertReplaceable(to) {
  if (hasOwnHistory(to)) throw Error(`${to} already has its own history.`);
  const others = entries(to).filter(name => !FRESH_ENTRIES.has(name) && !(name === 'work' && isUnusedWork(to)));
  if (others.length) throw Error(`${to} is not a Hobkin folder, so nothing was changed. It holds ${others.slice(0, 3).join(', ')}.`);
}

/** Only a folder that passed `assertReplaceable` is moved aside, and it comes back if the new one cannot go in. */
function swapIn(staged, to) {
  const aside = `${staged}-aside`;
  if (existsSync(to)) renameSync(to, aside);
  try {
    renameSync(staged, to);
  } catch (error) {
    if (existsSync(aside)) renameSync(aside, to);
    throw error;
  }
  rmSync(aside, { recursive: true, force: true });
}

/** Copies pi-companion's folder into this one. The old folder is only read, so going back stays possible. */
export async function importHome(root, requested) {
  const to = resolve(root);
  const from = resolve(requested ?? join(homedir(), '.companion'));
  if (isInside(to, from) || isInside(from, to)) throw Error(`${from} and ${to} overlap, so nothing was changed.`);
  if (!hasDatabase(from)) throw Error(`Nothing to import from ${from}.`);
  if (await isRunning(from)) throw Error('pi-companion is still running. Close it first, so nothing changes during the copy.');
  if (await isRunning(to)) throw Error('Hobkin is running. Close it first.');
  assertReplaceable(to);

  const staged = mkdtempSync(join(dirname(to), `${basename(to)}.importing-`));
  try {
    cpSync(from, staged, { recursive: true, verbatimSymlinks: true, filter: path => copied(path, from) });
    movePathsInDatabase(staged, from, to);
    movePathsInText(staged, from, to);
    const { jev, learning } = readConfig(to);
    if (jev || learning) atomicJson(join(staged, 'config.json'), { ...readConfig(staged), ...(jev ? { jev } : {}), ...(learning ? { learning } : {}) });
    if (existsSync(join(to, 'AGENTS.md'))) copyFileSync(join(to, 'AGENTS.md'), join(staged, 'AGENTS.md'));
    if (await isRunning(to)) throw Error('Hobkin started during the copy. Close it and run this again.');
    swapIn(staged, to);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
  return { from, to };
}
