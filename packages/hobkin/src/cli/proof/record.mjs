import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Proof run records (_specs/050-tla-proofs). Each run lives in `<home>/proofs/<id>/`: `events.jsonl` and a `pid` while it
 * runs, and `result.json`, the whole `ProofRun`, when it ends. Only the `hobkin proof` process writes them, through
 * `openRecord`, and a run is written once: nothing here changes a run that ended. The events are the ones the host folds
 * into the `proofs` slice (hobkin-client host/src/proofs.ts): start, step, progress, rule, action, definitions, trace,
 * proof, log and end.
 */

export const proofsFolder = home => join(home, 'proofs');
export const runFolder = (home, id) => join(proofsFolder(home), id);

const RUN_ID = /^\d{8}-\d{6}-[a-z0-9-]+-[a-z0-9]{4}$/;
/** An id is the run's folder name, never a path. */
export const isRunId = id => typeof id === 'string' && RUN_ID.test(id);

/** `20261120-103000-workitem-ab12`: when it started (UTC), the spec it checks and four random characters. */
export function newRunId(spec, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = basename(spec, '.tla').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'spec';
  const random = [...randomBytes(4)].map(byte => (byte % 36).toString(36)).join('');
  return `${stamp}-${name}-${random}`;
}

const STEPS = ['parse', 'check', 'prove'];

export const emptyRun = id => ({
  id,
  spec: '',
  tool: 'TLC',
  workers: 0,
  started: '',
  outcome: 'checking',
  steps: STEPS.map(step => ({ id: step, state: 'waiting', note: '' })),
  stats: { generated: 0, distinct: 0, queue: 0, depth: 0 },
  rules: [],
  actions: [],
  samples: [],
  definitions: [],
  log: [],
});

const START_FIELDS = ['spec', 'cfg', 'project', 'item', 'head', 'tool', 'model', 'workers', 'root'];

const upsert = (list, entry) => {
  const at = list.findIndex(held => held.name === entry.name);
  if (at === -1) list.push(entry);
  else list[at] = { ...list[at], ...entry };
};

/** One event onto the run, the way the host folds it, so the events and the result never disagree. */
export function applyEvent(run, event) {
  const { type, at, ...fields } = event;
  switch (type) {
    case 'start':
      for (const key of START_FIELDS) if (fields[key] !== undefined) run[key] = fields[key];
      run.started = at;
      break;
    case 'step': {
      const step = run.steps.find(candidate => candidate.id === fields.step);
      if (step) Object.assign(step, { state: fields.state, note: fields.note ?? step.note });
      break;
    }
    case 'progress':
      run.stats = { ...run.stats, ...fields };
      run.samples.push({ at: Math.max(0, Date.parse(at) - Date.parse(run.started)), distinct: run.stats.distinct });
      break;
    case 'rule':
    case 'action':
      upsert(type === 'rule' ? run.rules : run.actions, fields);
      break;
    case 'definitions':
      run.definitions = fields.definitions;
      break;
    case 'trace':
      run.trace = fields.states;
      run.traceLength = fields.states.length;
      break;
    case 'graph':
      run.graph = fields.graph;
      break;
    case 'proof':
      run.proof = fields;
      break;
    case 'log':
      run.log.push({ at, ...fields });
      break;
    case 'end':
      Object.assign(run, fields);
      run.finished = at;
      break;
  }
  return run;
}

export const foldEvents = (id, events) => events.reduce(applyEvent, emptyRun(id));

function readEvents(folder) {
  try {
    return readFileSync(join(folder, 'events.jsonl'), 'utf8').split('\n').flatMap(line => {
      try {
        return line.trim() ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Compact, and whole or not at all: a reader never sees half a result. */
function writeResult(folder, run) {
  const temporary = join(folder, `result.json.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(run)}\n`);
  renameSync(temporary, join(folder, 'result.json'));
}

/**
 * A new run's record, for the proof process that runs it: it writes the start event and the pid, and each `emit` after
 * appends an event and folds it into `run`. `finish` writes `result.json` with any fields the events do not carry, and
 * removes the pid. A run that already has a record cannot be opened again.
 */
export function openRecord(home, id, start, { pid = process.pid, now = () => new Date() } = {}) {
  if (!isRunId(id)) throw Error(`${id} is not a proof run id.`);
  const folder = runFolder(home, id);
  if (existsSync(join(folder, 'events.jsonl')) || existsSync(join(folder, 'result.json'))) throw Error(`Run ${id} is already recorded.`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'pid'), `${pid}\n`);

  const run = emptyRun(id);
  const emit = event => {
    const stamped = { type: event.type, at: now().toISOString(), ...event };
    appendFileSync(join(folder, 'events.jsonl'), `${JSON.stringify(stamped)}\n`);
    applyEvent(run, stamped);
    return run;
  };
  emit({ type: 'start', ...start });
  return {
    id,
    folder,
    run,
    emit,
    finish(extra = {}) {
      Object.assign(run, extra);
      writeResult(folder, run);
      rmSync(join(folder, 'pid'), { force: true });
      return run;
    },
  };
}

/** For `hobkin proof stop` when the process that ran it is gone: the run as its events left it, ended as stopped. */
export function recordStopped(home, id, message) {
  const folder = runFolder(home, id);
  if (existsSync(join(folder, 'result.json'))) return readRun(home, id);
  const run = foldEvents(id, readEvents(folder));
  const at = new Date().toISOString();
  const end = { type: 'end', at, outcome: 'stopped', message };
  applyEvent(run, end);
  for (const step of run.steps) {
    if (step.state === 'running') step.state = 'failed';
    if (step.state === 'waiting') step.state = 'skipped';
  }
  appendFileSync(join(folder, 'events.jsonl'), `${JSON.stringify(end)}\n`);
  writeResult(folder, { ...run, counts: false });
  rmSync(join(folder, 'pid'), { force: true });
  return run;
}

/** A finished run's record, or null while it runs, when there is none, or when the id is not a run's. */
export function readRun(home, id) {
  if (!isRunId(id)) return null;
  try {
    return JSON.parse(readFileSync(join(runFolder(home, id), 'result.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Every finished run, newest first. */
export function listRuns(home) {
  let names;
  try {
    names = readdirSync(proofsFolder(home)).filter(isRunId);
  } catch {
    return [];
  }
  return names.map(id => readRun(home, id)).filter(Boolean).sort((a, b) => String(b.started).localeCompare(String(a.started)));
}

/**
 * Whether a run is evidence for an item: it ended `holds`, every action fired (a model that never reaches an action
 * checks nothing that action guards), and it checked the item's head and the spec as the item has it.
 */
export function runCounts(run, { head, specHash } = {}) {
  if (!run || run.outcome !== 'holds') return false;
  if (!run.actions?.length || !run.actions.every(action => action.count > 0)) return false;
  return Boolean(run.head) && run.head === head && Boolean(run.specHash) && run.specHash === specHash;
}
