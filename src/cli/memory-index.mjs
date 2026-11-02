import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { glob, lstat, readFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { atomicJson } from './config.mjs';
import { writeLessonsView } from './learning/store.mjs';
import { writePrivate } from './reports.mjs';

const POLL_MS = 10000;
const QUIET_MS = 20000;
const RETRY_MS = 600000;
const GRACE_MS = 2000;
// On a machine without qmd's model, the first embed downloads it.
const LIMIT_MS = { update: 120000, embed: 3600000, status: 30000 };
const MAX_OUTPUT_LENGTH = 65536;
// qmd counts a file of spaces as empty, and one this short costs nothing to read.
const BLANK_BELOW_BYTES = 16;

// Reports and check logs are left out: this is what agents and the user chose to keep.
const KEPT = [
  { name: 'memory', folder: '', pattern: 'memory.md', about: 'The short list of what matters right now.' },
  { name: 'directions', folder: '', pattern: 'AGENTS.md', about: 'Standing directions for every agent Hobkin runs.' },
  { name: 'checks', folder: 'checks', pattern: '*/memory.md', about: 'The working memory each check keeps between runs.' },
  { name: 'notes', folder: 'notes', pattern: '**/*.md', about: 'Notes and the taste profile.' },
];
const LESSONS = { name: 'lessons', folder: 'runtime', pattern: 'lessons.md', about: 'Lessons from how runs ended. Advice only, and they grant nothing.' };
// Hobkin writes the lessons file itself, so these show when it is due, not the file.
const LESSON_SOURCES = ['config.json', 'runtime/learning.json', 'runtime/learning-actions.jsonl'];

// In `runtime/` because `hobkin import` takes any other new entry in a home for a folder that is not Hobkin's.
const indexDirectory = root => join(root, 'runtime', '.qmd');
const healthPath = root => join(root, 'runtime', 'memory-index.json');

const readText = file => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const readHealth = root => {
  try {
    return JSON.parse(readText(healthPath(root)));
  } catch {
    return {};
  }
};

/** The line `hobkin status` shows, from the last pass. It starts nothing, so it works without qmd. */
export function indexStatus(root) {
  const { files, pending, problem, checkedAt } = readHealth(root);
  if (!checkedAt) return 'Index not built yet';

  const counts = files === undefined ? [] : [
    `${files} ${files === 1 ? 'file' : 'files'}`,
    pending ? `${pending} waiting for embeddings` : 'embeddings up to date',
  ];
  return `Index ${[...counts, problem, `checked ${checkedAt}`].filter(Boolean).join(' · ')}`;
}

// A database made here first gives SQLite the mode it copies to its journal files.
function keepPrivate(root) {
  const directory = indexDirectory(root);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  closeSync(openSync(join(directory, 'index.sqlite'), 'a', 0o600));
  for (const name of readdirSync(directory)) chmodSync(join(directory, name), 0o600);
  chmodSync(directory, 0o700);
}

function collectionsFor(root, blank) {
  const entries = [...KEPT, LESSONS].map(({ name, folder, pattern, about }) => [name, {
    path: join(root, folder),
    pattern,
    ...(blank[name] ? { ignore: blank[name].toSorted() } : {}),
    context: { '/': about },
  }]);
  return Object.fromEntries(entries);
}

/** qmd rewrites this file to add its models, so a stamp says what it was written for, and a copied or moved home gets it again. */
function writeCollections(root, blank = {}) {
  const collections = collectionsFor(root, blank);
  const stamp = createHash('sha256').update(JSON.stringify(collections)).digest('hex');
  const file = join(indexDirectory(root), 'index.yml');
  if (readText(file).includes(stamp)) return;

  writePrivate(file, `${JSON.stringify({ hobkin: stamp, collections }, null, 2)}\n`);
}

async function isBlank(path, { size }) {
  if (size >= BLANK_BELOW_BYTES) return false;

  const text = await readFile(path, 'utf8').catch(() => '');
  return !text.trim();
}

/** What the index covers as it stands now. qmd holds on to the last text of a file that went empty, so those come back to be hidden from it. */
async function readCoverage(root) {
  const seen = [];
  const blank = {};

  for (const { name, folder, pattern } of KEPT) {
    const cwd = join(root, folder);
    for (const file of await Array.fromAsync(glob(pattern, { cwd }))) {
      const path = join(cwd, file);
      const stat = await lstat(path).catch(() => null);
      if (!stat?.isFile()) continue;

      seen.push(`${name}/${file} ${stat.mtimeMs} ${stat.size}`);
      if (await isBlank(path, stat)) blank[name] = [...(blank[name] ?? []), file];
    }
  }

  for (const file of LESSON_SOURCES) {
    const stat = await lstat(join(root, file)).catch(() => null);
    if (stat) seen.push(`${file} ${stat.mtimeMs} ${stat.size}`);
  }

  return { signature: seen.toSorted().join('\n'), blank };
}

function readCounts(status) {
  const files = status.match(/Total:\s+(\d+) files? indexed/)?.[1];
  if (files === undefined) throw Object.assign(Error('Unreadable qmd status.'), { problem: 'qmd status failed' });

  const pending = status.match(/Pending:\s+(\d+)/)?.[1] ?? 0;
  return { files: Number(files), pending: Number(pending) };
}

// qmd finds this index by itself from `runtime/`. Naming it as well means no change in qmd can send a pass to the index other tools share.
const qmdEnvironment = root => ({
  ...process.env,
  INDEX_PATH: join(indexDirectory(root), 'index.sqlite'),
  QMD_CONFIG_DIR: indexDirectory(root),
  QMD_EMBED_PARALLELISM: '1',
  GGML_METAL_NO_RESIDENCY: '1',
});

// qmd 2.5 runs under a launcher that passes on no signal, so only the whole group reaches it.
const signalGroup = (child, signal) => {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // Already gone.
  }
};

const lowerPriority = child => {
  try {
    if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW);
  } catch {
    // Already gone.
  }
};

/**
 * Keeps a private qmd index of what Hobkin remembers, for agents to search. It looks at file times instead of waiting
 * for events, because agents write these files from their own processes. Nothing depends on it, so a problem is told once.
 */
export class MemoryIndex {
  note = null;
  child = null;

  constructor({ root, onNote = () => {}, pollMs = POLL_MS, quietMs = QUIET_MS, retryMs = RETRY_MS, graceMs = GRACE_MS }) {
    Object.assign(this, { root, onNote, pollMs, quietMs, retryMs, graceMs });
    this.retryAt = -Infinity;
  }

  start() {
    try {
      keepPrivate(this.root);
      writeCollections(this.root);
    } catch {
      this.fail('its files could not be written');
      return this;
    }

    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
    void this.tick();
    return this;
  }

  // A change restarts the wait, and a tick that finds a pass under way leaves everything for the first one after it.
  async tick() {
    if (this.busy || this.stopped) return;

    this.busy = true;
    try {
      const { signature, blank } = await readCoverage(this.root);
      if (signature !== this.seen) {
        this.seen = signature;
        this.changedAt = Date.now();
      }

      const quiet = Date.now() - this.changedAt >= this.quietMs;
      if (this.stopped || !quiet || signature === this.indexed || Date.now() < this.retryAt) return;

      await this.pass(blank);
      this.indexed = signature;
    } catch (error) {
      this.fail(error.problem ?? 'its files could not be written', error.counts);
    } finally {
      this.busy = false;
    }
  }

  async pass(blank) {
    writeCollections(this.root, blank);
    writeLessonsView(this.root);
    await this.qmd('update');

    // Metal can abort qmd on its way out after everything was saved, so what is left to embed decides, not how it ended.
    const failure = await this.qmd('embed').then(() => null, error => error);
    const counts = readCounts(await this.qmd('status'));
    if (failure && counts.pending) throw Object.assign(failure, { counts });

    atomicJson(healthPath(this.root), { ...counts, checkedAt: new Date().toISOString() });
  }

  qmd(command) {
    if (this.stopped) return Promise.reject(Error('Stopped.'));

    const child = spawn('qmd', [command], {
      cwd: join(this.root, 'runtime'),
      env: qmdEnvironment(this.root),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    this.child = child;
    lowerPriority(child);

    const limit = setTimeout(() => signalGroup(child, 'SIGTERM'), LIMIT_MS[command]);
    limit.unref();

    let output = '';
    child.stdout.setEncoding('utf8').on('data', text => {
      output = `${output}${text}`.slice(-MAX_OUTPUT_LENGTH);
    });

    return new Promise((resolve, reject) => {
      const finish = problem => {
        clearTimeout(limit);
        if (this.child === child) this.child = null;
        if (problem) reject(Object.assign(Error(problem), { problem }));
        else resolve(output);
      };
      child.once('error', error => finish(error.code === 'ENOENT' ? 'qmd is not installed' : `qmd ${command} failed`));
      child.once('close', code => finish(code === 0 ? null : `qmd ${command} failed`));
    });
  }

  /** The same problem is told once, across restarts, until a pass has worked. */
  fail(problem, counts) {
    if (this.stopped) return;

    this.retryAt = Date.now() + this.retryMs;
    const at = new Date().toISOString();
    const health = readHealth(this.root);
    try {
      atomicJson(healthPath(this.root), { ...health, ...counts, problem, checkedAt: at });
    } catch {
      // The problem is still told, and the next start tells it again.
    }
    if (health.problem === problem) return;

    this.note = {
      id: `notice:memory-index:${at}`,
      role: 'notice',
      content: `Memory search paused: ${problem}. Everything else carries on, and hobkin tries again later.`,
      at,
    };
    this.onNote();
  }

  takeNote() {
    const { note } = this;
    this.note = null;
    return note;
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);

    const { child } = this;
    if (!child) return;

    const closed = new Promise(resolve => { child.once('close', () => resolve(true)); });
    signalGroup(child, 'SIGTERM');
    const ended = await Promise.race([closed, wait(this.graceMs, false, { ref: false })]);
    if (!ended) signalGroup(child, 'SIGKILL');
  }
}
