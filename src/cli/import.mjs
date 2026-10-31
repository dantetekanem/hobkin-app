import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import lockfile from 'proper-lockfile';
import { atomicJson } from './config.mjs';

const OLD_DATABASE = 'companion.sqlite';
const DATABASE = 'hobkin.sqlite';
const OWNER_STALE_MS = 300000;
const TEXT_ROOTS = ['schedules', 'checks', 'notes', 'work', 'memory.md', 'config.json'];

const hasHistory = root => [OLD_DATABASE, DATABASE].some(name => existsSync(join(root, 'runtime', name)));

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
function movePathsInText(to, from) {
  for (const file of TEXT_ROOTS.flatMap(name => textFiles(join(to, name)))) {
    const text = readFileSync(file, 'utf8');
    const moved = text.replaceAll(`${from}/`, `${to}/`).replaceAll('~/.companion/', `${shortForm(to)}/`);
    if (moved !== text) writeFileSync(file, moved);
  }
}

/** The saved conversation is refused unless its path is inside this folder, so the stored paths move too. */
function movePathsInDatabase(to, from) {
  for (const ending of ['', '-wal', '-shm']) {
    const file = join(to, 'runtime', `${OLD_DATABASE}${ending}`);
    if (existsSync(file)) renameSync(file, join(to, 'runtime', `${DATABASE}${ending}`));
  }
  const database = new DatabaseSync(join(to, 'runtime', DATABASE));
  try {
    database.prepare('UPDATE document_revisions SET content = replace(content, ?, ?) WHERE instr(content, ?) > 0')
      .run(`${from}/`, `${to}/`, `${from}/`);
  } finally {
    database.close();
  }
}

/** Copies pi-companion's folder into this one. The old folder is only read, so going back stays possible. */
export async function importHome(root, requested) {
  const to = resolve(root);
  const from = resolve(requested ?? join(homedir(), '.companion'));
  if (!hasHistory(from)) throw Error(`Nothing to import from ${from}.`);
  if (await isRunning(from)) throw Error('pi-companion is still running. Close it first, so nothing changes during the copy.');
  if (await isRunning(to)) throw Error('Hobkin is running. Close it first.');
  if (hasHistory(to)) throw Error(`${to} already has its own history.`);

  const { jev } = readConfig(to);
  cpSync(from, to, { recursive: true, force: true, verbatimSymlinks: true, filter: path => basename(path) !== 'runtime.lock' });
  movePathsInDatabase(to, from);
  movePathsInText(to, from);
  if (jev) atomicJson(join(to, 'config.json'), { ...readConfig(to), jev });
  return { from, to };
}
