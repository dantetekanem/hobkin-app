import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import lockfile from 'proper-lockfile';
import { atomicJson } from './config.mjs';
import { cadences } from './schedules.mjs';

const OLD_DATABASE = 'companion.sqlite';
const DATABASE = 'hobkin.sqlite';
const OWNER_STALE_MS = 300000;
const TEXT_ROOTS = ['schedules', 'checks', 'notes', 'work', 'memory.md', 'config.json'];

const hasDatabase = root => [OLD_DATABASE, DATABASE].some(name => existsSync(join(root, 'runtime', name)));

const entries = path => (existsSync(path) ? readdirSync(path) : []);

/** Starting Hobkin once leaves a database and an empty session behind, and neither is worth protecting. */
const hasOwnHistory = root => entries(join(root, 'reports')).length > 0
  || cadences.some(cadence => entries(join(root, 'schedules', cadence)).length > 0)
  || entries(join(root, 'sessions')).some(name => readFileSync(join(root, 'sessions', name), 'utf8').includes('"type":"message"'));

const isRunning = root => existsSync(join(root, 'runtime')) && lockfile.check(join(root, 'runtime'), { stale: OWNER_STALE_MS });

const readConfig = root => {
  const file = join(root, 'config.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

const textFiles = path => {
  if (!existsSync(path) || basename(path) === 'trees') return [];
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap(name => textFiles(join(path, name)));
  return /\.(md|json|jsonl)$/.test(path) ? [path] : [];
};

const shortForm = path => (path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path);

/** Schedules name their notes by absolute path, and those notes moved with them. Files beside the old folder did not. */
function movePathsInText(staged, from, to) {
  for (const file of TEXT_ROOTS.flatMap(name => textFiles(join(staged, name)))) {
    const text = readFileSync(file, 'utf8');
    const moved = text.replaceAll(`${from}/`, `${to}/`).replaceAll('~/.companion/', `${shortForm(to)}/`);
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

/**
 * Copies pi-companion's folder into this one. The old folder is only read, so going back stays possible,
 * and the new one changes in a single step at the end, so a failure part way leaves it as it was.
 */
export async function importHome(root, requested) {
  const to = resolve(root);
  const from = resolve(requested ?? join(homedir(), '.companion'));
  const staged = `${to}.importing`;
  if (!hasDatabase(from)) throw Error(`Nothing to import from ${from}.`);
  if (await isRunning(from)) throw Error('pi-companion is still running. Close it first, so nothing changes during the copy.');
  if (await isRunning(to)) throw Error('Hobkin is running. Close it first.');
  if (hasOwnHistory(to)) throw Error(`${to} already has its own history.`);

  rmSync(staged, { recursive: true, force: true });
  try {
    cpSync(from, staged, { recursive: true, verbatimSymlinks: true, filter: path => basename(path) !== 'runtime.lock' });
    movePathsInDatabase(staged, from, to);
    movePathsInText(staged, from, to);
    const { jev } = readConfig(to);
    if (jev) atomicJson(join(staged, 'config.json'), { ...readConfig(staged), jev });
    if (existsSync(join(to, 'AGENTS.md'))) copyFileSync(join(to, 'AGENTS.md'), join(staged, 'AGENTS.md'));
    rmSync(to, { recursive: true, force: true });
    renameSync(staged, to);
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    throw error;
  }
  return { from, to };
}
