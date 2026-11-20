import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProject } from '../work/store.mjs';
import { startProcess } from './child.mjs';
import { isRunId, newRunId, openRecord, proofsFolder, readRun, recordStopped, runCounts, runFolder } from './record.mjs';
import { readSany } from './sany.mjs';
import { modelLine, readCfg, readSpec } from './spec.mjs';
import { defaultWorkers, heapMegabytes, sanyArguments, tlcArguments, tlcOutcome } from './tlc.mjs';
import { messageReader } from './tool-messages.mjs';
import { inspectTools, jarPath, MINIMUM_JAVA, TLA2TOOLS } from './tools.mjs';
import { parseDot, parseState } from './values.mjs';

/**
 * `hobkin proof check` (_specs/050-tla-proofs): SANY parses the spec, TLC checks its model, and TLAPS proves it when it
 * has a proof. Agents run it as a command, the host starts it through `checkProof`, and only this process writes the
 * run's record (record.mjs).
 */

const DEFAULT_MINUTES = 20;
/** The most distinct states hobkin draws. A bigger model gets no graph. */
const MOST_GRAPH_STATES = 50000;
/** After SIGTERM, Java gets this long before SIGKILL, so a stop ends it inside 2 seconds. */
const JAVA_GRACE_MS = 1000;
/** `stop` waits this long for the run's own process to record the stop before it kills it and records it. */
const STOP_WAIT_MS = 1500;
const POLL_MS = 50;
const LOCK_POLL_MS = 250;
/** TLC's working files, which go when the run ends. */
const SCRATCH = ['states', 'states-graph'];

export const CHECK_USAGE = 'Usage: hobkin proof check <spec.tla> [--cfg file] [--project slug] [--item id] [--head sha] [--workers n] [--minutes n]';
// `--root` and `--id` are for `checkProof`, which starts this command for the host.
const VALUED = {
  '--cfg': 'cfg',
  '--project': 'project',
  '--item': 'item',
  '--head': 'head',
  '--workers': 'workers',
  '--minutes': 'minutes',
  '--root': 'root',
  '--id': 'id',
};

export function parseCheckArgs(args) {
  const options = {};
  const values = [...args];
  while (values.length) {
    const word = values.shift();
    const key = VALUED[word];
    if (key) {
      if (!values.length || values[0].startsWith('--')) throw Error(`${word} needs a value. ${CHECK_USAGE}`);
      options[key] = values.shift();
    } else if (word.startsWith('-')) {
      throw Error(`Unknown option ${word}. ${CHECK_USAGE}`);
    } else if (options.spec) {
      throw Error(`One spec at a time. ${CHECK_USAGE}`);
    } else {
      options.spec = word;
    }
  }
  if (!options.spec) throw Error(CHECK_USAGE);

  if (options.workers !== undefined) {
    options.workers = Number(options.workers);
    if (!Number.isInteger(options.workers) || options.workers < 1) throw Error(`--workers takes a whole number from 1. ${CHECK_USAGE}`);
  }
  if (options.minutes !== undefined) {
    options.minutes = Number(options.minutes);
    if (!(options.minutes > 0)) throw Error(`--minutes takes a number above 0. ${CHECK_USAGE}`);
  }
  return options;
}

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The fields that have a value, so an event or the record carries no empty ones. */
const defined = fields => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

const plural = (count, word) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

function git(cwd, args) {
  try {
    const said = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return said.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The spec and cfg on disk, and the folder their paths in the record are relative to: the spec's git checkout, else its
 * folder. Without `--cfg`, the cfg is the one named like the spec beside it, when there is one.
 */
function locate({ spec, cfg, root, cwd }) {
  const base = root ?? cwd;
  const asked = resolve(base, spec);
  if (!existsSync(asked)) throw Error(`There is no spec at ${asked}.`);

  const specPath = realpathSync(asked);
  const beside = join(dirname(specPath), `${basename(specPath, '.tla')}.cfg`);
  let cfgPath = null;
  if (cfg) cfgPath = realpathSync(resolve(base, cfg));
  else if (existsSync(beside)) cfgPath = beside;

  const checkout = git(dirname(specPath), ['rev-parse', '--show-toplevel']);
  const folder = checkout ? realpathSync(checkout) : dirname(specPath);
  const inFolder = path => (relative(folder, path).startsWith('..') ? path : relative(folder, path));
  return {
    spec: specPath,
    cfg: cfgPath,
    root: folder,
    specRel: inFolder(specPath),
    cfgRel: cfgPath ? inFolder(cfgPath) : undefined,
  };
}

/** The tools on this machine, in the shape a run uses. */
async function toolsOnMachine(home, env) {
  const { java, jar, tlapm } = await inspectTools(home, { env });
  return { java: java.path, javaProblem: java.problem, jar, tlapm };
}

/** Why a run cannot start, when Java or the jar is missing. */
function missingTool(found) {
  if (!found.java) {
    return { note: 'Java is missing', message: found.javaProblem ?? `Java is not installed. TLC needs Java ${MINIMUM_JAVA} or newer.` };
  }
  if (!found.jar) return { note: 'TLC is missing', message: 'TLC is not set up here. Run `hobkin proof setup` to download it.' };
  return null;
}

/** Each definition's name to its `words:` or `code:` comment, for the definitions that have one. */
const byName = (definitions, field) => Object.fromEntries(definitions.filter(definition => definition[field]).map(definition => [definition.name, definition[field]]));

const pidAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const signal = (pid, name) => {
  try {
    process.kill(pid, name);
  } catch {
    // Gone already.
  }
};

const sleep = ms => new Promise(done => setTimeout(done, ms));

const readPid = path => {
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8'), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const lockPath = home => join(proofsFolder(home), 'tlc.lock');

/** The lock that keeps one TLC running at a time. A holder whose process is gone, or whose run has ended, holds nothing. */
async function takeLock(home, id, { onWait, stopped }) {
  const path = lockPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const release = () => {
    try {
      if (JSON.parse(readFileSync(path, 'utf8')).id === id) rmSync(path, { force: true });
    } catch {
      // Already gone.
    }
  };

  let told = false;
  for (;;) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, id }), { flag: 'wx' });
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    let holder = null;
    try {
      holder = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // Half written by its taker, or gone: look again.
    }
    if (holder && (!pidAlive(holder.pid) || readRun(home, holder.id))) {
      rmSync(path, { force: true });
      continue;
    }
    if (holder && !told) {
      onWait(holder.id);
      told = true;
    }
    if (stopped()) return null;
    await sleep(LOCK_POLL_MS);
  }
}

/** What must stay true, from the cfg, each with the spec's words for it. */
function rulesOf(cfg, words) {
  const rules = [
    ...cfg.invariants.map(name => ({ name, kind: 'invariant' })),
    ...cfg.properties.map(name => ({ name, kind: 'property' })),
    ...(cfg.checkDeadlock ? [{ name: 'Deadlock', kind: 'deadlock' }] : []),
  ];
  return rules.map(rule => defined({ ...rule, words: words[rule.name] }));
}

/** The trace as the window steps through it: each state with the action that led to it, its code and its variables. */
function traceOf(states, codes) {
  const trace = [];
  for (const state of states) {
    const previous = trace.at(-1);
    if (state.kind === 'state') {
      trace.push(defined({
        n: state.n,
        action: state.action,
        code: codes[state.action],
        vars: parseState(state.text),
      }));
    } else if (state.kind === 'stuttering') {
      trace.push({ n: state.n, action: 'Stuttering', vars: previous?.vars ?? [] });
    } else if (state.kind === 'back') {
      const loopsTo = trace.find(earlier => earlier.n === state.n);
      trace.push({ n: (previous?.n ?? 0) + 1, action: `Back to state ${state.n}`, vars: loopsTo?.vars ?? [] });
    }
  }
  return trace;
}

/** How TLC's run ended, and each rule's status after it. */
function judge(seen, ended, rules) {
  const every = status => Object.fromEntries(rules.map(({ name }) => [name, status]));
  const properties = rules.filter(({ kind }) => kind === 'property').map(({ name }) => name);

  if (seen.violation) {
    const { ruleKind, rule } = seen.violation;
    const statuses = every('holds');
    // TLC checks temporal properties once it has explored every state, so a break before then leaves them unchecked.
    // When one breaks, TLC does not say which, so with several none can be called intact.
    const temporal = ruleKind === 'property' && !rule;
    if (!temporal || properties.length > 1) for (const name of properties) statuses[name] = 'unchecked';

    let broken = rule;
    if (!broken && ruleKind === 'deadlock') broken = 'Deadlock';
    else if (!broken) broken = properties.join(' or ') || 'A temporal property';
    if (broken in statuses) statuses[broken] = 'broken';
    return { outcome: 'broken', broken, statuses };
  }
  if (seen.error) return { outcome: 'error', message: seen.error.text, statuses: every('unchecked') };
  if (seen.success) return { outcome: 'holds', statuses: every('holds') };

  const message = ended.error ? `TLC did not start: ${ended.error.message}` : `TLC exited with ${ended.code ?? ended.signal} without a result.`;
  return { outcome: 'error', message, statuses: every('unchecked') };
}

/** How a run with no model to check ends. */
const noModelEnding = () => ({ outcome: 'error', message: 'Nothing checked: the spec has no .cfg for TLC.' });

const CLOSING = {
  holds: { text: 'Done: it holds', tone: 'ok' },
  broken: { text: 'Done: it broke', tone: 'bad' },
  stopped: { text: 'Done: stopped before the end', tone: 'done' },
  error: { text: 'Done: the run failed', tone: 'done' },
};

/**
 * One check, start to end, in this process: it writes `<home>/proofs/<id>/` as it goes and returns the run as recorded.
 * `tools` stands in for the ones `inspectTools` finds, and `signal` stops it.
 */
export async function runCheck({
  home,
  spec,
  cfg,
  project,
  item,
  head,
  workers,
  minutes = DEFAULT_MINUTES,
  id,
  root,
  cwd = process.cwd(),
  tools,
  signal: stopSignal,
  env = process.env,
}) {
  const place = locate({ spec, cfg, root, cwd });
  const found = tools ?? await toolsOnMachine(home, env);
  const parts = readSpec(readFileSync(place.spec, 'utf8'));
  const cfgInfo = place.cfg ? readCfg(readFileSync(place.cfg, 'utf8')) : null;
  const words = byName(parts.definitions, 'words');
  const codes = byName(parts.definitions, 'code');
  const workerCount = workers ?? defaultWorkers();

  const record = openRecord(home, id ?? newRunId(place.spec), {
    spec: place.specRel,
    cfg: place.cfgRel,
    project,
    item,
    head: head ?? git(place.root, ['rev-parse', 'HEAD']),
    tool: found.jar === jarPath(home) ? `TLC ${TLA2TOOLS.version}` : 'TLC',
    workers: workerCount,
    model: cfgInfo ? modelLine(cfgInfo) : undefined,
    root: place.root,
  });
  const { run, emit, folder } = record;
  const log = (text, tone, detail) => emit(defined({ type: 'log', text, tone, detail }));
  const step = (which, state, note) => emit({ type: 'step', step: which, state, note });
  emit({ type: 'definitions', definitions: parts.definitions });

  // A stop and the time limit both end whatever runs now, and every step after it is skipped.
  let stopping = null;
  let active = null;
  const stop = reason => {
    stopping ??= reason;
    active?.stop(JAVA_GRACE_MS);
  };
  const onAbort = () => stop('Stopped by the user.');
  stopSignal?.addEventListener('abort', onAbort, { once: true });
  if (stopSignal?.aborted) onAbort();
  const timer = setTimeout(() => stop(`Stopped at the time limit of ${plural(minutes, 'minute')}.`), minutes * 60000);

  /** Java, with its pid kept beside the run's so `stop` can end it. */
  const runTool = async (command, args, handlers = {}) => {
    const child = startProcess(command, args, { cwd: dirname(place.spec), env, ...handlers });
    active = child;
    if (child.pid) writeFileSync(join(folder, 'java.pid'), `${child.pid}\n`);
    if (stopping) child.stop(JAVA_GRACE_MS);
    try {
      return await child.done;
    } finally {
      active = null;
      rmSync(join(folder, 'java.pid'), { force: true });
    }
  };

  /** A tool's whole output, both streams, once it ends. */
  const runAndRead = async (command, args) => {
    let said = '';
    const keep = chunk => {
      said += chunk;
    };
    const ended = await runTool(command, args, { onStdout: keep, onStderr: keep });
    return { ended, said };
  };

  const ending = { outcome: 'error' };
  const extra = {};

  /** SANY's parse. False when the run cannot go on. */
  const parse = async () => {
    const missing = missingTool(found);
    if (missing) {
      ending.message = missing.message;
      step('parse', 'failed', missing.note);
      log(missing.message, 'bad');
      return false;
    }

    step('parse', 'running', 'SANY');
    log('Parsing the spec with SANY', 'running');
    const started = Date.now();
    const { ended, said } = await runAndRead(found.java, sanyArguments({ jar: found.jar, spec: place.spec }));
    if (stopping) return false;

    const sany = readSany(said, ended.code);
    if (!sany.ok) {
      const where = sany.line ? `${sany.file}, line ${sany.line}, column ${sany.column}` : null;
      ending.message = `The spec does not parse: ${where ? `${where}. ` : ''}${sany.message}`;
      step('parse', 'failed', where ? `SANY · line ${sany.line}, column ${sany.column}` : 'SANY · does not parse');
      log('The spec does not parse', 'bad', ending.message);
      return false;
    }
    step('parse', 'done', `SANY · no errors · ${((Date.now() - started) / 1000).toFixed(1)} s`);
    log('Parsed the spec: no errors', 'done');
    return true;
  };

  /** TLC's check: how it ended, or null when it was stopped. */
  const modelCheck = async () => {
    const rules = rulesOf(cfgInfo, words);
    const release = await takeLock(home, run.id, {
      onWait: holder => log(`Waiting for run ${holder} to finish: one TLC check runs at a time`, 'running'),
      stopped: () => Boolean(stopping),
    });
    if (!release) return null;
    try {
      step('check', 'running', `TLC · breadth first · ${plural(workerCount, 'worker')}`);
      for (const rule of rules) emit({ type: 'rule', ...rule, status: 'holding' });
      log('Checking the model with TLC', 'running', `${plural(workerCount, 'worker')}, breadth first`);

      const heap = heapMegabytes();
      const watched = await watchTlc(heap);
      if (!watched) return null;

      const judged = judge(watched.seen, watched.ended, rules);
      for (const rule of rules) emit({ type: 'rule', ...rule, status: judged.statuses[rule.name] });
      if (judged.outcome === 'error') {
        step('check', 'failed', 'TLC · error');
        log('TLC stopped with an error', 'bad', judged.message);
      } else {
        if (judged.outcome === 'broken') reportCounterexample(watched.seen.states, judged.broken);
        else reportHolds();
        reportUnfiredActions();
        await drawGraph(heap);
      }
      return defined({ outcome: judged.outcome, message: judged.message, broken: judged.broken });
    } finally {
      release();
    }
  };

  /** TLC itself, its counts and coverage going into the record as they come. Null when it was stopped. */
  const watchTlc = async heap => {
    const reported = { ...run.stats };
    const report = stats => {
      if (JSON.stringify(stats) === JSON.stringify(reported)) return;
      Object.assign(reported, stats);
      emit({ type: 'progress', ...stats });
    };
    const tlc = tlcOutcome({
      onProgress: report,
      onCoverage: coverage => {
        for (const [name, distinct] of coverage) emit(defined({ type: 'action', name, count: distinct, code: codes[name] }));
      },
    });
    const reader = messageReader(tlc.message);
    const args = tlcArguments({
      jar: found.jar,
      spec: place.spec,
      cfg: place.cfg,
      workers: workerCount,
      heap,
      metadir: join(folder, 'states'),
    });
    const ended = await runTool(found.java, args, { onStdout: chunk => reader.push(chunk) });
    reader.end();
    if (stopping) return null;

    // The depth comes after the final counts, so the record gets the last of them once TLC has ended.
    report(tlc.seen.stats);
    return { seen: tlc.seen, ended };
  };

  const reportCounterexample = (states, broken) => {
    const trace = traceOf(states, codes);
    writeFileSync(join(folder, 'trace.json'), `${JSON.stringify(trace)}\n`);
    extra.files = { trace: 'trace.json' };
    emit({ type: 'trace', states: trace });
    step('check', 'failed', `TLC · counterexample at depth ${trace.length}`);
    log(`Found a counterexample: ${broken} breaks after ${plural(trace.length, 'state')}`, 'bad');
  };

  const reportHolds = () => {
    step('check', 'done', `TLC · ${plural(run.stats.distinct, 'state')} · no errors`);
    log(`The model holds: TLC looked at all ${plural(run.stats.distinct, 'distinct state')}`, 'ok');
  };

  const reportUnfiredActions = () => {
    for (const action of run.actions.filter(({ count }) => count === 0)) {
      log(`${action.name} never fired, so nothing it guards was checked`, 'bad', 'A run where an action never fires is not evidence that the model holds.');
    }
  };

  /** TLC again, on a model small enough to draw, with the graph dump. */
  const drawGraph = async heap => {
    const distinct = run.stats.distinct;
    if (distinct > MOST_GRAPH_STATES) {
      extra.graphNote = `The model has ${plural(distinct, 'state')}, more than the ${MOST_GRAPH_STATES.toLocaleString('en-US')} hobkin draws, so there is no state graph.`;
      log(extra.graphNote, 'done');
      return;
    }

    log('Drawing the state graph', 'running');
    const dot = join(folder, 'states.dot');
    const args = tlcArguments({
      jar: found.jar,
      spec: place.spec,
      cfg: place.cfg,
      workers: workerCount,
      heap,
      metadir: join(folder, 'states-graph'),
      dot,
    });
    await runTool(found.java, args);
    if (stopping) return;
    if (!existsSync(dot)) {
      extra.graphNote = 'TLC did not write the state graph.';
      log(extra.graphNote, 'done');
      return;
    }

    extra.graph = parseDot(readFileSync(dot, 'utf8'), distinct);
    extra.files = { ...extra.files, graph: 'states.dot' };
    log(`Drew the state graph: ${plural(extra.graph.nodes.length, 'state')}`, 'done');
  };

  /** The proof step, which TLAPS does not take yet. */
  const prove = () => step('prove', 'skipped', parts.hasProof ? 'TLAPS does not run yet' : 'The spec has no proof');

  const steps = async () => {
    if (!await parse()) return;

    let model = null;
    if (place.cfg) model = await modelCheck();
    else step('check', 'skipped', 'No .cfg next to the spec, so TLC did not run');
    if (stopping) return;

    prove();
    Object.assign(ending, model ?? noModelEnding());
  };

  /** Ends the record: the steps still open, the closing line, the end event and `result.json`. */
  const settle = () => {
    clearTimeout(timer);
    stopSignal?.removeEventListener('abort', onAbort);
    if (stopping) Object.assign(ending, { outcome: 'stopped', message: stopping, broken: undefined });

    for (const each of run.steps) {
      if (each.state === 'running') step(each.id, 'failed', stopping ? 'Stopped' : each.note);
      if (each.state === 'waiting') step(each.id, 'skipped', each.note);
    }
    const closing = CLOSING[ending.outcome];
    log(closing.text, closing.tone, ending.message);
    for (const scratch of SCRATCH) rmSync(join(folder, scratch), { recursive: true, force: true });
    emit(defined({ type: 'end', outcome: ending.outcome, message: ending.message, broken: ending.broken }));

    const specHash = sha256(place.spec);
    record.finish(defined({
      ...extra,
      specHash,
      cfgHash: place.cfg ? sha256(place.cfg) : undefined,
      counts: runCounts({ ...run, specHash }, { head: run.head, specHash }),
    }));
  };

  try {
    await steps();
  } catch (error) {
    // Whatever went wrong, the run still ends with a record that says so.
    Object.assign(ending, { outcome: 'error', message: error.message });
  } finally {
    settle();
  }
  return run;
}

const MAIN = fileURLToPath(new URL('../main.mjs', import.meta.url));

/**
 * For the host's `proof.again` and the YOLO rerun: starts `hobkin proof check` as a process of its own, so the run's
 * record is written by the proof process, and answers at once with the run's id. A relative spec or cfg is read from
 * `root`, else from the project's folder.
 */
export function checkProof({ home, spec, cfg, project, item, head, root, env = process.env }) {
  const base = root ?? (project ? readProject(home, project)?.path : undefined);
  const id = newRunId(spec);
  const flags = { '--cfg': cfg, '--project': project, '--item': item, '--head': head, '--root': base };
  const args = [MAIN, 'proof', 'check', spec, '--home', home, '--id', id];
  for (const [flag, value] of Object.entries(flags)) {
    if (value) args.push(flag, value);
  }

  const child = spawn(process.execPath, args, {
    cwd: base && isAbsolute(base) ? base : process.cwd(),
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { id, message: `Started the check of ${spec}.` };
}

/**
 * `hobkin proof stop <id>`: ends the run's process and its Java within 2 seconds and records `stopped`. The run's own
 * process records the stop when it can. When it does not go in time, it is killed, and the stop is recorded here.
 */
export async function stopProof({ home, id }) {
  if (!isRunId(id)) throw Error(`${id} is not a proof run id.`);
  const folder = runFolder(home, id);
  const ended = readRun(home, id);
  if (ended) return { message: `Run ${id} had already ended: ${ended.outcome}.` };
  if (!existsSync(folder)) throw Error(`There is no proof run ${id}.`);

  const pid = readPid(join(folder, 'pid'));
  const java = readPid(join(folder, 'java.pid'));
  // A run in this very process, as in a test, is stopped through its signal, never by killing this process.
  if (pid && pid !== process.pid && pidAlive(pid)) {
    signal(pid, 'SIGTERM');
    for (let waited = 0; pidAlive(pid) && waited < STOP_WAIT_MS; waited += POLL_MS) await sleep(POLL_MS);
    if (pidAlive(pid)) {
      signal(pid, 'SIGKILL');
      // Its Java started from it a moment ago, so the pid is still Java's. A pid left by a process that ended long
      // before can belong to another program by now, so it is never signaled.
      if (java && pidAlive(java)) signal(java, 'SIGKILL');
    }
  }
  if (!readRun(home, id)) recordStopped(home, id, 'Stopped by the user.');
  return { message: `Stopped run ${id}.` };
}
