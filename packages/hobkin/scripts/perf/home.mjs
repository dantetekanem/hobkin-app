// A throwaway hobkin home the size of the real one on 2026-11-21: 1,500 finished runs (an 11.7 MB runtime document), 24 projects with
// real one-commit git repositories, 47 routines, and the decisions, token and card-action logs at their real lengths. It lives under the
// system temp folder, HOME and Pi's agent folder point inside it, and it is removed when the process exits. It never opens ~/.hobkin.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const HOBKIN = new URL('../..', import.meta.url).pathname;
const cli = file => import(join(process.env.HOBKIN_ROOT ?? HOBKIN, 'src/cli', file));

/** A scratch folder for one benchmark, removed on exit, and a hard stop after `seconds` so nothing is left running. */
export function scratch(label, seconds = 120) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), `hobkin-perf-${label}-`)));
  const user = join(base, 'user');
  mkdirSync(join(user, '.pi', 'agent'), { recursive: true });
  process.env.HOME = user;
  process.env.PI_CODING_AGENT_DIR = join(user, '.pi', 'agent');
  process.env.PI_OFFLINE = '1';
  process.env.PI_TELEMETRY = '0';
  process.on('exit', () => rmSync(base, { recursive: true, force: true }));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGALRM']) process.on(signal, () => process.exit(130));
  setTimeout(() => {
    console.error(`${label}: stopped after ${seconds} s`);
    process.exit(124);
  }, seconds * 1000).unref();
  return base;
}

const words = 'the check read the ledger and found rows still missing from the table while the build passed and tests ran green on main branch with one flaky step retried twice before review'.split(' ');
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = list => list[Math.floor(rand() * list.length)];
const text = bytes => {
  const out = [];
  let n = 0;
  while (n < bytes) {
    const word = pick(words);
    out.push(word);
    n += word.length + 1;
    if (rand() < 0.08) out.push('\n');
  }
  return out.join(' ');
};
const iso = ms => new Date(ms).toISOString();
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Builds the home inside `base` (from `scratch`). Returns its root and the size of its document. */
export async function makeHome(base, {
  runs = 1500, projects = 24, itemsPerProject = 60, routines = 47, decisions = 230, tokens = 800, cardActions = 540,
  workOn = true, quietRoutines = false, learning = false, now = Date.parse('2026-11-21T19:00:00Z'), promptBytes = 6000, resultBytes = 4000,
} = {}) {
  const { atomicJson, initialize, loadConfig } = await cli('config.mjs');
  const { HobkinRuntime } = await cli('runtime.mjs');
  const { saveReport } = await cli('reports.mjs');
  const { chooseProject, writeMode } = await cli('work/store.mjs');
  const root = join(base, 'home');
  const repos = join(base, 'repos');
  mkdirSync(repos, { recursive: true });
  initialize(root, { cwd: base, now: '2026-01-01T00:00:00Z' });
  const config = loadConfig(root);
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  // Nothing before the home began is due, so no routine fires during a benchmark.
  if (quietRoutines) config.initializedAt = new Date().toISOString();
  if (learning) config.learning = { enabled: true };
  atomicJson(join(root, 'config.json'), config);

  const routineIds = [];
  const cadences = [['daily', 0.6], ['weekly', 0.2], ['monthly', 0.12], ['once', 0.08]];
  for (let i = 0; i < routines; i++) {
    let share = i / routines, cadence = 'daily';
    for (const [name, part] of cadences) {
      if (share < part) { cadence = name; break; }
      share -= part;
    }
    const id = `routine-${i}`;
    routineIds.push({ id, cadence });
    const meta = { id, title: `Routine ${i} checks the thing`, timezone: 'America/Toronto', enabled: i % 9 !== 0, harness: 'pi', model: 'fixture/check', effort: 'low', cwd: base, context: [] };
    if (i % 7 === 3) meta.window = { start: '08:00', end: '20:00', everyMinutes: 30 };
    else if (i % 5 === 1) meta.at = ['07:00', '12:00', '18:30'];
    else meta.at = `${String(6 + (i % 14)).padStart(2, '0')}:${i % 2 ? '15' : '45'}`;
    if (cadence === 'weekly') meta.weekday = [1, 3, 5];
    if (cadence === 'monthly') meta.day = 1 + (i % 28);
    if (cadence === 'once') meta.date = `2026-11-${String(10 + (i % 15)).padStart(2, '0')}`;
    writeFileSync(join(root, 'routines', cadence, `${id}.md`), `---\n${JSON.stringify(meta, null, 2)}\n---\n${text(1500)}\n`, { mode: 0o600 });
  }

  const slugs = [];
  for (let p = 0; p < projects; p++) {
    const name = `proj-${p}`;
    const checkout = join(repos, name);
    execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
    git(checkout, 'config', 'user.email', 'bench@example.invalid');
    git(checkout, 'config', 'user.name', 'Bench');
    git(checkout, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(checkout, 'app.txt'), 'one\n');
    git(checkout, 'add', '.');
    git(checkout, 'commit', '-qm', 'first');
    const project = chooseProject(root, checkout, ['important', 'casual', 'critical'][p % 3], now - 30 * 86400000);
    slugs.push(project.slug);
    const dir = join(root, 'work', project.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'project.md'), `# What it is\n${text(p % 4 === 0 ? 60000 : 12000)}\n`);
    const looked = iso(now - 3600000);
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ lastLookAt: looked, lastLensAt: looked, lastIdeasAt: looked, lastSignalsAt: looked }));
    const count = p % 5 === 0 ? itemsPerProject * 4 : itemsPerProject;
    const lines = [];
    for (let k = 0; k < count; k++) {
      const key = `${name}-item-${k}`;
      const id = createHash('sha256').update(key).digest('hex').slice(0, 6);
      const at = iso(now - (count - k) * 3600000);
      lines.push({ id, key, kind: pick(['fix', 'improvement', 'feature', 'chore', 'update']), title: `Item ${k} ${text(40)}`.slice(0, 80), brief: text(300), urgent: false, state: 'open', attempts: 0, at, impact: pick(['high', 'medium', 'low']), effort: pick(['small', 'medium', 'large']) });
      const final = k > count - 6 ? 'open' : k > count - 9 ? 'branch' : pick(['done', 'merged', 'declined', 'dropped', 'merged']);
      if (final !== 'open') {
        lines.push({ id, state: 'doing', updatedAt: at });
        lines.push({ id, state: final, note: text(120), updatedAt: at, ...(final === 'branch' ? { branch: `hobkin/${id}` } : {}) });
      }
    }
    writeFileSync(join(dir, 'items.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  }
  writeMode(root, { enabled: workOn, agents: 4, startGapMs: 300000, lastDiscoveryAt: iso(now), lastReviewAt: iso(now), folder: workOn ? repos : null });
  writeFileSync(join(root, 'work', 'subscription.json'), JSON.stringify({ at: iso(now), secondary: { usedPercent: 31, windowMinutes: 10080, resetAt: now + 3 * 86400000 }, primary: { usedPercent: 12, windowMinutes: 300, resetAt: now + 2 * 3600000 } }));

  const tokenLines = Array.from({ length: tokens }, (_, k) => JSON.stringify({ at: iso(now - (tokens - k) * 1800000), slug: pick(slugs), lane: pick(['do', 'look']), tokens: Math.floor(rand() * 900000), kind: pick(['do', 'study', 'bugs']), startedAt: iso(now - (tokens - k) * 1800000 - 900000), level: 'important', cached: Math.floor(rand() * 4e6), usageIncomplete: false, cleanupUnknown: false, incompleteEvents: {} }));
  writeFileSync(join(root, 'work', 'tokens.jsonl'), tokenLines.join('\n') + '\n');
  const cardLines = [];
  for (let k = 0; k < cardActions / 3; k++) {
    const id = randomUUID();
    cardLines.push({ id, at: iso(now - k * 600000), title: 'Merge', did: 'merged the branch', line: `You merged ${text(60)}` }, { id, posted: true }, { id, heard: true });
  }
  writeFileSync(join(root, 'work', 'card-actions.jsonl'), cardLines.map(line => JSON.stringify(line)).join('\n') + '\n');
  const decisionLines = [];
  for (let k = 0; k < decisions / 2; k++) {
    const id = randomUUID();
    decisionLines.push({ id, key: `k-${k}`, from: 'work', question: `${text(250)}?`, tldr: text(60).slice(0, 100), choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], answerTo: { kind: 'land-offer' }, recommended: 'yes', why: null, changed: null, at: iso(now - k * 3600000), shown: true });
    if (k > 8) decisionLines.push({ id, answer: 'yes', answeredAt: iso(now - k * 3600000 + 60000) });
  }
  writeFileSync(join(root, 'decisions.jsonl'), decisionLines.map(line => JSON.stringify(line)).join('\n') + '\n', { mode: 0o600 });

  // The runtime document in one commit, then a report for each background run.
  const runtime = await HobkinRuntime.open(root, config, {});
  const docRuns = {};
  const reportIds = [];
  const perf = id => ({ schemaVersion: 1, runId: id, sessionId: randomUUID(), responses: 14, incomplete: false, firstObservedOutputMs: 2100, dispatchElapsedMs: 120000, origin: 'run', kind: 'work', engine: 'pi', model: 'fixture/check', effort: 'low', stages: { since: 0, spawned: 300, ready: 900, prompted: 950, requested: 1000, text: 2100, ended: 120000 }, input: { value: 21000, state: 'complete' }, output: { value: 9000, state: 'complete' }, cacheRead: { value: 300000, state: 'complete' }, cacheWrite: { value: 20000, state: 'complete' }, estimatedUsd: { value: 0.42, state: 'complete' }, responseDurationMs: { value: 99000, state: 'complete' } });
  for (let k = 0; k < runs; k++) {
    const startedAt = iso(now - (runs - k) * 1200000);
    const finishedAt = iso(now - (runs - k) * 1200000 + 300000);
    const harnessId = randomUUID();
    const slot = k % 20;
    let run;
    if (slot < 8) {
      const id = randomUUID();
      run = { id, kind: 'main', title: 'Conversation', prompt: text(promptBytes * (0.2 + rand() * 1.6)), harness: 'pi', sessionId: 'main-session', model: 'fixture/local', effort: 'medium',
        status: 'completed', startedAt, cost: { usd: 0.2, kind: 'estimate', cumulative: true, sessionId: 'main-session' }, finishedAt,
        result: { status: 'completed', stopReason: 'stop', cost: null, text: text(resultBytes * 0.5), performance: perf(id) }, performance: perf(id) };
    } else if (slot < 15) {
      const routine = pick(routineIds);
      const date = startedAt.slice(0, 10);
      const id = `${routine.id}:${date}:${k}`;
      run = { id, scheduledAt: startedAt, localDate: date, kind: 'background', scheduleId: routine.id, title: `Routine ${routine.id}`, harness: 'pi', model: 'fixture/check', effort: 'low', cwd: base, harnessId, definition: createHash('sha256').update(id).digest('hex'),
        status: pick(['completed', 'completed', 'no_change', 'failed']), startedAt, cost: { usd: 0.1, kind: 'estimate', cumulative: true, sessionId: harnessId }, finishedAt,
        result: { id: harnessId, harness: 'pi', status: 'completed', text: `Useful: ${text(resultBytes * (0.3 + rand()))}`, cost: null, model: 'fixture/check', effort: 'low', sessionId: harnessId, freshSession: true, tokens: 30000, performance: perf(harnessId) }, performance: perf(harnessId) };
      reportIds.push(id);
    } else {
      const slug = pick(slugs);
      const lane = pick(['do', 'look']);
      const id = `work:${slug}:${lane}:${harnessId}`;
      run = { id, kind: 'background', scheduleId: `work.${slug}.${lane}`, title: `Work on ${slug}`, harness: 'pi', model: 'fixture/check', effort: 'high', cwd: base, harnessId, work: { slug, lane, item: 'abc123', planKey: `item:${slug}:abc123` },
        status: 'completed', startedAt, cost: { usd: 1.1, kind: 'estimate', cumulative: true, sessionId: harnessId }, finishedAt,
        result: { id: harnessId, harness: 'pi', status: 'completed', text: `Useful: ${text(resultBytes * (0.5 + rand() * 1.5))}`, cost: null, model: 'fixture/check', effort: 'high', sessionId: harnessId, freshSession: true, tokens: 400000, performance: perf(harnessId) }, performance: perf(harnessId) };
      reportIds.push(id);
    }
    docRuns[run.id] = run;
  }
  await runtime.change(state => { Object.assign(state.runs, docRuns); });
  const docBytes = JSON.stringify(await runtime.state()).length;
  await runtime.close();
  for (const id of reportIds) saveReport(root, id, docRuns[id].result.text);
  return { root, repos, slugs, docBytes, runs, reports: reportIds.length };
}

/** Opens the application on `root` with the test suite's fake main chat and a fake harness: no model, no network. */
export async function openApp(root, { intervalMs = 3600000, onChange = () => {}, createSession } = {}) {
  const { HobkinApplication } = await cli('application.mjs');
  const { fakePi } = await import(join(process.env.HOBKIN_ROOT ?? HOBKIN, 'test/helpers/pi-session.mjs'));
  const fake = fakePi(root);
  if (createSession) {
    const create = fake.dependencies.createSession;
    fake.dependencies.createSession = async options => createSession(await create(options));
  }
  return HobkinApplication.open(root, {
    createMain: fake.createMain,
    runHarness: async request => ({ status: 'completed', text: `Useful: fake ${request.purpose ?? 'check'} result.`, cost: null }),
    intervalMs,
    onChange,
    fetch: async () => { throw Error('no network in a benchmark'); },
  });
}

/** Counts every whole-file read (sync and async) by path while `on` is true. Named imports of node:fs see the wrapper. */
export async function countReads() {
  const fs = (await import('node:fs')).default;
  const fsp = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const counter = { on: false, reads: 0, bytes: 0, files: new Map() };
  const note = (path, bytes) => {
    counter.reads++;
    counter.bytes += bytes;
    const name = String(path).replace(/.*\/home\//, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '<id>');
    counter.files.set(name, (counter.files.get(name) ?? 0) + 1);
  };
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (path, ...rest) {
    const out = readFileSync.call(this, path, ...rest);
    if (counter.on && typeof path !== 'number') note(path, out?.length ?? 0);
    return out;
  };
  const readFile = fsp.readFile;
  fsp.readFile = function (path, ...rest) {
    if (counter.on && typeof path !== 'number' && typeof path?.fd !== 'number') note(path, 0);
    return readFile.call(this, path, ...rest);
  };
  syncBuiltinESMExports();
  return counter;
}

export const median = list => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
