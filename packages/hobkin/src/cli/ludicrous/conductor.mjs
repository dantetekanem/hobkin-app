import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from '../config.mjs';
import { ludicrousInvocation } from '../harnesses.mjs';
import { piEnvironment } from '../launcher.mjs';
import { holdAwake } from '../stay-awake.mjs';
import { tierBinding } from '../tiers.mjs';
import { readSubscription, usageLimitIn } from '../work/usage.mjs';
import { paths, readJson } from '../work/store.mjs';
import { gitOrNothing } from '../work/tree.mjs';
import { areasNow, readPlan } from './areas.mjs';
import { groupsLeft, killGroup, lastError, MARK, startProcess, sweep, tokensSince } from './agents.mjs';
import { answersChangePlan, PLANNERS, planningTasks, planView, ROUND_OF } from './planning.mjs';
import { factsOf, fileReport, foldTrails, plainReport, publishRun, reportFile } from './compile.mjs';
import { systemPrompt, taskPrompt } from './prompts.mjs';
import { saveUnfinished } from './stop.mjs';
import { approveRun, buildingMs, changeRun, machineTiers, measureComputer, planRun, readRun, runDirectory, START_SPACING_MS, underWay } from './run.mjs';

/**
 * The conductor (076): the runtime code that owns a Ludicrous run. Every agent of the run is a Pi it starts, in a process group of its own,
 * and only it starts or stops one. It keeps the tier full while the queues hold ready packets, one start each spacing, with one leader for
 * each open area and a share of the workers for each by its ready packets. It writes the counts history once a minute, holds the Mac awake
 * while the run builds, and after a hobkin restart kills what is left of the run's agents and builds again from the trails.
 * hobkin's own tick calls `tick` each second.
 */

const skill = name => fileURLToPath(new URL(`../../skills/${name}/SKILL.md`, import.meta.url));
const script = (role, name) => fileURLToPath(new URL(`../../skills/${role}/${name}.mjs`, import.meta.url));
const MINUTE_MS = 60000;
// A worker that ends this many times without landing its packet is left for its leader to rewrite.
const MOST_TRIES = 3;
const MOST_PLANNER_TRIES = 2;
const MOST_FINAL_ROUNDS = 3;
// A leader that ends this soon after it started rests this long first, so a leader that cannot start does not spin.
const LEADER_REST_MS = 60000;
// With no reset time known, one agent tries this often until one runs (076, The subscription).
const PROBE_EVERY_MS = 30 * MINUTE_MS;
const RESET_MARGIN_MS = MINUTE_MS;
const PROBE_HOLDS_MS = 2 * MINUTE_MS;
const MOST_HISTORY = 24 * 60;
const KILL_WAIT_MS = 10000;
// Commands a worker is always refused besides the ones the plan names: TLC runs on Java, and the leader's own two.
const ALWAYS_REFUSED = ['java', 'check', 'wait'];
const PACKET_TIERS = ['fast', 'mid', 'high'];
const ROLES = {
  planner: { system: 'ludicrous-planner', skill: 'ludicrous-planner', tier: 'max' },
  leader: { system: 'ludicrous-leader', skill: 'ludicrous-leader', tier: 'high' },
  worker: { system: 'ludicrous-worker', skill: 'ludicrous-worker' },
  compile: { system: 'ludicrous-compile', skill: 'ludicrous-compile', tier: 'high' },
  final: { system: 'ludicrous-final', skill: 'ludicrous-compile', tier: 'high' },
};

const iso = time => new Date(time).toISOString();
const agentsFile = directory => join(directory, 'agents.json');
const packetsFile = directory => join(directory, 'packets.json');
const countsFile = directory => join(directory, 'counts.jsonl');
const refusalsFile = directory => join(directory, 'refusals.log');
const branchHead = run => gitOrNothing(run.folder, 'rev-parse', '--verify', '--quiet', `refs/heads/${run.branch}`);

/** The shell script that runs one of the skills' scripts with this Node, so a stand-in named `node` on a worker's PATH cannot stop it. */
const runsScript = path => `#!/bin/sh\nexec "${process.execPath}" "${path}" "$@"\n`;

/** A stand-in for a check command on a worker's PATH: one line of refusal, and the refusal in the run's log. */
const standIn = (name, log) => [
  '#!/bin/sh',
  'echo "Workers don\'t run checks. Your leader does." >&2',
  `printf '%s %s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "\${LUDICROUS_AGENT:-worker}" "${name} $*" >> "${log}"`,
  'exit 1',
  '',
].join('\n');

function writeExecutable(file, text) {
  writeFileSync(file, text, { mode: 0o755 });
  chmodSync(file, 0o755);
}

/**
 * The tools and stand-ins of a run, in its folder: `tools/` holds `land`, `check` and `wait` for its agents, and `bin/`, first on a
 * worker's PATH, a stand-in for each check command the plan names, which refuses with one line and logs the refusal (A19).
 */
export function prepareTools(directory, plan) {
  const tools = join(directory, 'tools');
  const bin = join(directory, 'bin');
  mkdirSync(tools, { recursive: true, mode: 0o700 });
  mkdirSync(bin, { recursive: true, mode: 0o700 });

  writeExecutable(join(tools, 'land'), runsScript(script('ludicrous-worker', 'land')));
  writeExecutable(join(tools, 'check'), runsScript(script('ludicrous-leader', 'check')));
  writeExecutable(join(tools, 'wait'), runsScript(script('ludicrous-leader', 'wait')));

  const named = new Set([...(plan?.checkCommands ?? []), ...ALWAYS_REFUSED]);
  // Only a plain command name can be a file on PATH.
  const refused = [...named].filter(name => /^[\w.+-]+$/.test(name));
  for (const name of refused) {
    writeExecutable(join(bin, name), standIn(name, refusalsFile(directory)));
  }
  return { tools, bin, refused };
}

/** Each line a stand-in logged: when, which agent, and the command it was refused. */
export function refusalsOf(directory) {
  const file = refusalsFile(directory);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

/** The area with the most ready packets for each worker it has running, so each open area gets a share by its ready packets. */
function byShare(areas, running) {
  const share = area => {
    const workers = running.filter(agent => agent.role === 'worker' && agent.area === area.id).length;
    return area.ready.length / (workers + 1);
  };
  let furthestBehind = null;
  for (const area of areas) {
    if (!furthestBehind || share(area) > share(furthestBehind)) furthestBehind = area;
  }
  return furthestBehind;
}

/** A packet that fixes a failing check says so in its worker's task, with the commit and the trail to read first. */
function fixWords({ fix }) {
  if (!fix) return '';
  const trail = fix.trail ? `, whose trail is \`${fix.trail}\`` : '';
  return `This packet fixes a failing check: \`${fix.check}\`, after commit ${fix.commit}${trail}. `;
}

/** The final check's failures in one area, a line each, for its leader. */
function failureLines(final, area) {
  return final.failures
    .filter(failure => failure.area === area)
    .map(({ what, evidence }) => (evidence ? `- ${what} (${evidence})` : `- ${what}`))
    .join('\n');
}

export class LudicrousConductor {
  constructor({ root, config, now = Date.now, start = startProcess, kill = killGroup, left = groupsLeft, sweepRun = sweep, awake = holdAwake, measure = measureComputer, spacingMs = START_SPACING_MS, mcp = true, onChange = () => {}, gh } = {}) {
    Object.assign(this, { root, config, now, start, kill, left, sweepRun, awake, measure, spacingMs, mcp, onChange, gh });
    this.live = new Map();
    this.ended = [];
    this.lastStartAt = -Infinity;
    this.leaderEnds = new Map();
    this.plannerTries = new Map();
    this.offsets = new Map();
    this.minute = null;
    this.release = null;
    this.toolsFor = null;
  }

  get run() {
    return readRun(this.root);
  }

  directory(run) {
    return runDirectory(this.root, run.id);
  }

  machine() {
    return machineTiers(this.measure({ mcp: this.mcp }));
  }

  /** hobkin's settings as they are now, since the user can change a tier while a run builds. */
  settings() {
    return typeof this.config === 'function' ? this.config() : this.config;
  }

  /**
   * After hobkin starts: kills whatever is left of the run's agents by their recorded process groups, and anything carrying the run's mark,
   * puts their packets back in the queue with their edits left in the tree, and lets the next tick build again from the trails (A16).
   */
  async open() {
    const run = this.run;
    if (!run) return;

    const directory = this.directory(run);
    const recorded = readJson(agentsFile(directory), []);
    if (recorded.length) {
      await this.killLeftovers(run, recorded);
      this.backToQueue(run, recorded);
      atomicJson(agentsFile(directory), []);
    }

    if (run.phase === 'building' && run.buildingSince) this.leaveOutDowntime(run);
  }

  async killLeftovers(run, recorded) {
    const groups = recorded.map(agent => agent.pid).filter(Boolean);
    const sessions = join(this.directory(run), 'sessions');
    for (const group of await this.left(groups, sessions)) this.kill(group);
    await this.sweepRun(run.id);
  }

  /** The time hobkin was not running is not time the run built: it built until its last minute in the history. */
  leaveOutDowntime(run) {
    const last = this.history(run).at(-1);
    const since = Date.parse(run.buildingSince);
    const builtUntil = last ? Date.parse(last.at) + MINUTE_MS : since;
    changeRun(this.root, run, {
      builtMs: (run.builtMs ?? 0) + Math.max(0, builtUntil - since),
      buildingSince: iso(this.now()),
    });
  }

  /** Kills every agent of the run at once and waits until they are gone, at most `withinMs`, then sweeps up what left their groups. */
  async killAll(run, withinMs = KILL_WAIT_MS) {
    const agents = [...this.live.values()];
    for (const { record } of agents) {
      if (record.pid) this.kill(record.pid);
    }

    let timer;
    const allExited = Promise.all(agents.map(({ child }) => child.exited));
    const timeUp = new Promise(done => {
      timer = setTimeout(done, withinMs);
    });
    await Promise.race([allExited, timeUp]);
    clearTimeout(timer);

    if (run) await this.sweepRun(run.id);
    return agents.map(({ record }) => record);
  }

  /** hobkin is closing: the run's agents end with it, with no compile, and the next start builds again from the trails. */
  async close() {
    const run = this.run;
    const killed = await this.killAll(run, 5000);
    this.live.clear();
    if (run) {
      this.backToQueue(run, killed);
      atomicJson(agentsFile(this.directory(run)), []);
    }
    this.letGoAwake();
  }

  /** The packets these agents were working, back in their queues: ready again for the next worker. */
  backToQueue(run, agents) {
    const packets = readJson(packetsFile(this.directory(run)), {});
    for (const { packet } of agents) {
      if (packet && packets[packet]?.state === 'running') packets[packet] = { ...packets[packet], state: 'back' };
    }
    atomicJson(packetsFile(this.directory(run)), packets);
  }

  holdAwake() {
    this.release ??= this.awake();
  }

  letGoAwake() {
    this.release?.();
    this.release = null;
  }

  // The window's commands. Each one changes the run and lets the next tick act on it.

  async plan(asked) {
    const run = await planRun(this.root, asked, { now: this.now(), measure: this.measure });
    this.onChange();
    return run;
  }

  /** Go Ludicrous: building from the plan, after one short step for the delivery planner when the user's answers change it. */
  async go({ answers = {} } = {}) {
    let run = approveRun(this.root, { answers }, this.now());
    if (answersChangePlan(run.folder, run.answers)) {
      run = changeRun(this.root, run, { phase: 'planning', step: 'answers', round: ROUND_OF.answers, buildingSince: null });
    }
    this.onChange();
    return run;
  }

  /**
   * Stop (A9): every agent killed at once, its whole process group, then anything left with the run's mark, such as a dev server. A run
   * stopped while it planned compiles nothing. After building, the compile keeps what the agents finished and puts it in the pull request.
   */
  async stop() {
    const asked = this.run;
    if (!asked || !['planning', 'plan-ready', 'building', 'waiting'].includes(asked.phase)) throw Error('Ludicrous has nothing running to stop.');

    const killed = await this.killAll(asked);
    this.live.clear();
    this.ended = [];
    this.writeAgents(asked);
    this.letGoAwake();
    this.plannerTries.clear();

    const run = readRun(this.root, asked.id);
    const now = this.now();
    const stopped = {
      stoppedAt: iso(now),
      builtMs: buildingMs(run, now),
      buildingSince: null,
      waitingUntil: null,
      probing: false,
    };
    if (run.planned) {
      const workers = killed.filter(agent => agent.role === 'worker' && agent.packet).map(({ packet, area }) => ({ packet, area }));
      changeRun(this.root, run, { ...stopped, phase: 'compiling', compile: { reason: 'stop', step: 'save', killed: workers, saved: [] } });
    } else {
      changeRun(this.root, run, { ...stopped, phase: 'stopped', step: null });
    }
    this.onChange();
    return this.run;
  }

  /** Records an agent's end, for the next tick to act on, so everything that changes the run happens in a tick, in order. */
  watch(id, child) {
    child.exited.then(result => {
      this.ended.push({ id, result });
      this.onChange();
    });
  }

  /** What an agent's process is given: Pi's own environment, the run's mark, and where its tools, branch and check worktrees are. */
  environmentFor(run, { id, role, area, read, launcher }) {
    const directory = this.directory(run);
    // A worker meets the stand-ins before any real check command.
    const path = [...(role === 'worker' ? [join(directory, 'bin')] : []), join(directory, 'tools'), process.env.PATH].join(':');
    return {
      ...piEnvironment(launcher),
      PATH: path,
      [MARK]: run.id,
      LUDICROUS_AGENT: id,
      LUDICROUS_RUN: directory,
      LUDICROUS_BRANCH: run.branch,
      LUDICROUS_BASE: run.baseCommit,
      LUDICROUS_READ: read,
      LUDICROUS_CHECKS: paths(this.root, run.slug).trees,
      LUDICROUS_CHECK_SLOTS: String(this.machine().checks),
      ...(area ? { LUDICROUS_AREA: area } : {}),
    };
  }

  async startAgent(given, { role, tier, area = null, packet = null, lens = null, key = null, prompt }) {
    const { system, skill: own, tier: roleTier } = ROLES[role];
    const run = readRun(this.root, given.id);
    const directory = this.directory(run);
    const number = String(run.spawned + 1).padStart(4, '0');
    const about = area ?? lens;
    const id = about ? `${number}-${role}-${about}` : `${number}-${role}`;
    for (const folder of ['sessions', 'logs']) mkdirSync(join(directory, folder), { recursive: true, mode: 0o700 });
    const session = join(directory, 'sessions', `${id}.jsonl`);
    const log = join(directory, 'logs', `${id}.log`);

    const { launcher, ...config } = this.settings();
    const { model, effort } = tierBinding(config, tier ?? roleTier);
    const invocation = ludicrousInvocation({ prompt, system: systemPrompt(system), model, effort, sessionFile: session, skills: [skill(own)], mcp: this.mcp, launcher });
    // What the agent reads first is the branch as it is now: `land` refuses to write over anything that changed after it.
    const read = (await branchHead(run)) || run.baseCommit;
    const env = this.environmentFor(run, { id, role, area, read, launcher });
    const child = this.start({ ...invocation, cwd: run.folder, env, log });

    const record = {
      id,
      role,
      area,
      packet: packet?.id ?? null,
      lens,
      key,
      tier: tier ?? roleTier,
      pid: child.pid,
      startedAt: iso(this.now()),
      session,
      log,
      read,
    };
    this.live.set(id, { record, child });
    this.lastStartAt = this.now();
    changeRun(this.root, readRun(this.root, run.id), { spawned: run.spawned + 1 });
    this.writeAgents(run);
    if (packet) this.takePacket(directory, packet, { area, agent: id });
    this.watch(id, child);
    return record;
  }

  /** A packet a worker starts on is running, one more try, keeping the patch an earlier worker's stop left it. */
  takePacket(directory, packet, { area, agent }) {
    const packets = readJson(packetsFile(directory), {});
    const before = packets[packet.id];
    packets[packet.id] = {
      area,
      state: 'running',
      agent,
      tries: (before?.tries ?? 0) + 1,
      patch: before?.patch ?? null,
    };
    atomicJson(packetsFile(directory), packets);
  }

  writeAgents(run) {
    atomicJson(agentsFile(this.directory(run)), this.running());
  }

  running(role = null) {
    const records = [...this.live.values()].map(({ record }) => record);
    return role ? records.filter(record => record.role === role) : records;
  }

  spaced() {
    return this.now() - this.lastStartAt >= this.spacingMs;
  }

  /** Whether a tick has anything to do: a run under way, an agent still running, or an end not yet settled. */
  busy() {
    return this.live.size > 0 || this.ended.length > 0 || underWay(this.run);
  }

  /** hobkin's tick: what ended first, then the run's phase, then the counts. Nothing here throws into hobkin's tick. */
  async tick() {
    if (!this.run) return;
    try {
      await this.settleEnded(this.run);
      const run = this.run;
      if (run.phase === 'planning') await this.planning(run);
      else if (run.phase === 'building') await this.building(run);
      else if (run.phase === 'waiting') this.waiting(run);
      else if (run.phase === 'compiling') await this.compiling(run);
      this.count(this.run);
    } catch (error) {
      const run = this.run;
      changeRun(this.root, run, { lines: [...(run.lines ?? []).slice(-4), error.message] });
    }
  }

  async settleEnded(run) {
    const directory = this.directory(run);
    while (this.ended.length) {
      const { id, result } = this.ended.shift();
      const entry = this.live.get(id);
      if (!entry) continue;

      const { record } = entry;
      this.live.delete(id);
      this.addTokens(run, record);
      this.offsets.delete(id);

      const error = lastError(record.session) ?? result.error ?? null;
      const limit = error ? usageLimitIn(error, this.now()) : null;
      if (limit) this.subscriptionEnded(limit);

      if (record.role === 'worker') await this.workerEnded(directory, run, record, { limited: Boolean(limit) });
      if (record.role === 'leader') this.leaderEnded(record);
      // A planner the provider stopped did not fail its task, so that try does not count.
      if (record.role === 'planner' && limit) this.plannerTries.set(record.key, Math.max(0, (this.plannerTries.get(record.key) ?? 1) - 1));
      await this.ending(record);
      this.writeAgents(run);
    }
  }

  /** A worker's packet is done once a commit for it is on the branch; else it goes back to the queue, and after three tries it is failed. */
  async workerEnded(directory, run, record, { limited }) {
    const packets = readJson(packetsFile(directory), {});
    const own = packets[record.packet];
    if (!own || own.state !== 'running') return;

    const landed = await gitOrNothing(run.folder, 'log', '-1', '--format=%H', '--fixed-strings', `--grep=Packet: ${record.packet}`, `refs/heads/${run.branch}`);
    const next = { ...own, state: 'back' };
    if (landed) {
      next.state = 'done';
      next.patch = null;
    } else if (limited) {
      // The provider stopped it, not its work, so the try does not count.
      next.tries = own.tries - 1;
    } else if (own.tries >= MOST_TRIES) {
      next.state = 'failed';
    }
    packets[record.packet] = next;
    atomicJson(packetsFile(directory), packets);
  }

  leaderEnded(record) {
    const ranFor = this.now() - Date.parse(record.startedAt);
    this.leaderEnds.set(record.area, { at: this.now(), quick: ranFor < LEADER_REST_MS });
  }

  /** A leader that ended at once rests a minute before the next, so one that cannot start does not spin. */
  leaderResting(area) {
    const ended = this.leaderEnds.get(area.id);
    return Boolean(ended?.quick) && this.now() - ended.at < LEADER_REST_MS;
  }

  addTokens(run, record) {
    const { tokens, offset } = tokensSince(record.session, this.offsets.get(record.id) ?? 0);
    this.offsets.set(record.id, offset);
    if (!tokens) return;
    const current = readRun(this.root, run.id);
    changeRun(this.root, current, { tokens: (current.tokens ?? 0) + tokens });
  }

  /** Planning: the step's owed tasks, five planners at most and no other agent; the next step once the step owes nothing and none runs. */
  async planning(run) {
    const { tasks, next } = planningTasks(run.folder, run);
    const running = this.running('planner');
    if (!tasks.length && !running.length) return this.nextStep(run, next);

    for (const task of tasks) {
      const started = running.some(agent => agent.key === task.key);
      if (started || running.length >= PLANNERS || !this.spaced()) continue;

      const tries = this.plannerTries.get(task.key) ?? 0;
      if (tries >= MOST_PLANNER_TRIES) {
        if (!running.length) {
          const line = `The ${task.lens} planner ended twice without writing ${task.writes.join(', ')}, so planning stopped. Let's plan this tries again.`;
          changeRun(this.root, run, { phase: 'stopped', stoppedAt: iso(this.now()), lines: [line] });
        }
        return;
      }
      this.plannerTries.set(task.key, tries + 1);
      running.push(await this.startAgent(run, { role: 'planner', lens: task.lens, key: task.key, prompt: task.prompt }));
    }
  }

  /** Commits what the step's planners wrote, since only planners run while the run plans, then moves on. */
  async nextStep(run, next) {
    await gitOrNothing(run.folder, 'add', '-A', '--', '_specs');
    await gitOrNothing(run.folder, 'commit', '-q', '-m', `Ludicrous planning: ${run.step ?? 'drafts'}`, '--', '_specs');
    this.plannerTries.clear();
    if (next === 'plan-ready') return changeRun(this.root, run, { phase: 'plan-ready', planned: true, step: null });
    if (next === 'building') return changeRun(this.root, run, { phase: 'building', step: null, buildingSince: iso(this.now()) });
    return changeRun(this.root, run, { step: next, round: ROUND_OF[next] });
  }

  /** Building: a leader for each open area first, then a worker from the area whose share is furthest behind, one start each spacing. */
  async building(run) {
    const plan = readPlan(run.folder);
    if (!plan) throw Error('The run has no plan to build from.');
    const directory = this.directory(run);
    if (this.toolsFor !== run.id) {
      prepareTools(directory, plan);
      this.toolsFor = run.id;
    }
    this.holdAwake();

    const areas = areasNow(run.folder, plan, readJson(packetsFile(directory), {}));
    if (areas.every(area => area.done)) return this.allDone(run);

    const running = this.running();
    const full = running.length >= run.tier;
    // With no reset known, one new agent tries first, and the rest wait until it has run a while (`count`).
    const tryingFirst = run.probing && run.probe;
    if (full || !this.spaced() || tryingFirst) return;

    const leaderless = areas.find(area => area.open && !this.leaderResting(area) && !running.some(agent => agent.role === 'leader' && agent.area === area.id));
    const started = leaderless ? await this.startLeader(run, leaderless) : await this.startNextWorker(run, areas, running);
    if (started && run.probing) changeRun(this.root, readRun(this.root, run.id), { probe: { id: started.id, at: started.startedAt } });
  }

  startNextWorker(run, areas, running) {
    const area = byShare(areas.filter(each => each.open && each.ready.length), running);
    return area ? this.startWorker(run, area, area.ready[0]) : null;
  }

  startLeader(run, area, finalFailures = '') {
    const depends = area.depends.length ? area.depends.join(', ') : 'nothing: it is the foundation';
    const prompt = taskPrompt('ludicrous-tasks', 'leader', { name: run.name, idea: run.idea, area: area.id, areaName: area.name, depends, finalFailures });
    return this.startAgent(run, { role: 'leader', area: area.id, prompt });
  }

  startWorker(run, area, packet) {
    const patch = readJson(packetsFile(this.directory(run)), {})[packet.id]?.patch;
    const prompt = taskPrompt('ludicrous-tasks', 'worker', {
      name: run.name,
      area: area.id,
      packet: packet.id,
      title: packet.title ?? packet.id,
      step: packet.step ?? 'none named',
      brief: packet.brief ?? packet.title ?? 'See the step in the spec.',
      paths: packet.paths.map(path => `- ${path}`).join('\n'),
      trail: `_specs/ludicrous/trails/${area.id}/${packet.id}.md`,
      fix: fixWords(packet),
      patch: patch ? `An earlier worker on this packet was stopped. Its unfinished edits are in ${patch}: apply them first.` : '',
    });
    const tier = PACKET_TIERS.includes(packet.tier) ? packet.tier : 'mid';
    return this.startAgent(run, { role: 'worker', tier, area: area.id, packet, prompt });
  }

  /** The compile, a step a tick: the unfinished work saved and taken out, the compile agent, then the report, the push and the pull request. */
  async compiling(run) {
    const compile = run.compile ?? { reason: 'stop', step: 'save', killed: [] };
    if (compile.step === 'save') return this.saveStep(run, compile);
    if (compile.step === 'agent') return this.compileAgentStep(run, compile);
    if (compile.step === 'publish') return this.publishStep(run, compile);
  }

  /** Each killed packet's edits saved as a patch and taken out of the folder, and the packet back in its queue with its patch. */
  async saveStep(run, compile) {
    const directory = this.directory(run);
    const killed = compile.killed ?? [];
    const { saved } = await saveUnfinished(run, { directory, packets: killed });

    const packets = readJson(packetsFile(directory), {});
    for (const { packet } of killed) {
      if (packets[packet]?.state === 'running') packets[packet] = { ...packets[packet], state: 'back' };
    }
    for (const { packet, patch } of saved) {
      if (packet && packets[packet]) packets[packet] = { ...packets[packet], state: 'back', patch };
    }
    atomicJson(packetsFile(directory), packets);

    const kept = saved.map(({ packet, patch, applies }) => ({ packet, patch, applies }));
    return changeRun(this.root, run, { compile: { ...compile, step: 'agent', saved: kept } });
  }

  /** One compile agent, once, told what hobkin counted and where the unfinished work is. */
  compileAgentStep(run, compile) {
    if (compile.agentStarted || this.running('compile').length) return;
    changeRun(this.root, run, { compile: { ...compile, agentStarted: true } });

    const saved = compile.saved ?? [];
    const unfinished = saved.length ? saved.map(({ packet, patch }) => `- ${packet ?? 'Everything else'}: ${patch}`).join('\n') : '- None.';
    const prompt = taskPrompt('ludicrous-tasks', 'compile', {
      name: run.name,
      ended: compile.reason === 'done' ? 'is done: every area passed the final check' : 'was stopped by the user',
      report: reportFile(this.directory(run)),
      facts: factsOf(run, this.now()),
      unfinished,
    });
    return this.startAgent(run, { role: 'compile', prompt });
  }

  /** The report into Reports, the branch pushed and its one pull request, a draft after a stop. Done also folds the trails first. */
  async publishStep(run, compile) {
    const done = compile.reason === 'done';
    if (done) await foldTrails(run);

    const written = reportFile(this.directory(run));
    const body = existsSync(written) ? readFileSync(written, 'utf8') : plainReport(run, { saved: compile.saved ?? [], now: this.now() });
    fileReport(this.root, run, body, this.now());

    const asked = { body, ready: done, ...(this.gh ? { gh: this.gh } : {}) };
    const published = await publishRun(run, asked).catch(error => ({ pr: run.pr, line: error.message }));
    changeRun(this.root, readRun(this.root, run.id), {
      phase: done ? 'done' : 'stopped',
      doneAt: done ? iso(this.now()) : null,
      pr: published.pr ?? run.pr ?? null,
      compile: null,
      lines: [published.line],
    });
    this.onChange();
  }

  /**
   * What the end of a compile or final agent moves on. The final check commits its own verdict, so its verdict holds for the head it left,
   * and any commit after that asks for a final check again.
   */
  async ending(record) {
    const run = this.run;
    if (record.role === 'compile' && run.phase === 'compiling') {
      changeRun(this.root, run, { compile: { ...run.compile, step: 'publish' } });
    }
    if (record.role === 'final' && run.final?.state === 'running') {
      const verdict = readJson(join(run.folder, '_specs', 'ludicrous', 'final.json'), { passed: false, failures: [] });
      const head = (await branchHead(run)) || run.final.head;
      changeRun(this.root, run, {
        final: {
          ...run.final,
          head,
          state: verdict.passed ? 'passed' : 'failed',
          failures: verdict.passed ? [] : verdict.failures ?? [],
          leaders: [],
        },
      });
    }
  }

  /**
   * Every area says it is done: once their last agents end, one agent on the high tier runs the whole suite and the run guide end to end
   * (A12). It passing compiles the run as done. A failure goes to the leaders of the areas that own it, and the final check runs again once
   * they are done again, on a new head.
   */
  async allDone(run) {
    const head = (await branchHead(run)) || run.baseCommit;
    const final = run.final?.head === head ? run.final : null;
    // A leader whose area is done has nothing left to lead. One started for a failure of the final check on this head is fixing its area.
    const fixing = new Set(final?.state === 'failed' ? final.leaders : []);
    for (const agent of this.running('leader')) {
      if (!fixing.has(agent.area)) this.kill(agent.pid);
    }
    if (this.running().some(agent => !fixing.has(agent.area))) return;

    if (final?.state === 'passed') {
      const compile = { reason: 'done', step: 'save', killed: [], saved: [] };
      return changeRun(this.root, run, { phase: 'compiling', builtMs: buildingMs(run, this.now()), buildingSince: null, compile });
    }
    if (final?.state === 'running') return;
    if (final?.state === 'failed') return this.fixFinal(run, final);

    changeRun(this.root, run, { final: { state: 'running', head, rounds: (run.final?.rounds ?? 0) + 1 } });
    return this.startAgent(run, { role: 'final', prompt: taskPrompt('ludicrous-tasks', 'final', { name: run.name }) });
  }

  /** A failed final check goes to the leader of each area that owns a failure. Three rounds that change nothing stop the run, and say why. */
  async fixFinal(run, final) {
    const owners = [...new Set(final.failures.map(failure => failure.area))];
    const waiting = owners.filter(area => !final.leaders.includes(area));
    if (!waiting.length) {
      if (this.running('leader').length) return;
      if ((final.rounds ?? 1) >= MOST_FINAL_ROUNDS) {
        const line = `The final check failed ${final.rounds} times and nothing changed, so the run waits for you: press Stop to compile what is there.`;
        return changeRun(this.root, run, { lines: [line] });
      }
      return changeRun(this.root, run, { final: { ...final, leaders: [], rounds: (final.rounds ?? 1) + 1 } });
    }
    if (!this.spaced()) return;

    const area = readPlan(run.folder).areas.find(each => each.id === waiting[0]);
    if (!area) return changeRun(this.root, run, { final: { ...final, leaders: [...final.leaders, waiting[0]] } });
    changeRun(this.root, run, { final: { ...final, leaders: [...final.leaders, area.id] } });
    const words = `The final check failed in your area:\n${failureLines(final, area.id)}\nSet "done" back to false in your status.json, write the fix packets, and finish the area again.`;
    return this.startLeader(run, { ...area, depends: area.depends ?? [] }, words);
  }

  // The subscription (076): a used-up window starts nothing until it resets, and then the tier fills again by itself.

  subscriptionEnded({ retryAt }) {
    const run = this.run;
    if (!['building', 'waiting'].includes(run.phase)) return;

    const reset = retryAt ?? this.resetFromReadings();
    const known = reset ? reset + RESET_MARGIN_MS : null;
    if (run.phase === 'waiting' && !this.movesTheWait(run, known)) return;

    changeRun(this.root, run, {
      phase: 'waiting',
      builtMs: buildingMs(run, this.now()),
      buildingSince: null,
      probing: false,
      probe: null,
      waitingUntil: iso(known ?? this.now() + PROBE_EVERY_MS),
      waitingKnown: Boolean(known),
    });
    this.letGoAwake();
  }

  /**
   * Whether another agent failing on the limit changes a wait under way. A known reset takes the place of an unknown one, and a later known
   * reset the place of an earlier one; an unknown one never takes the place of anything.
   */
  movesTheWait(run, known) {
    if (!known) return false;
    if (!run.waitingKnown) return true;
    return known > Date.parse(run.waitingUntil);
  }

  /** The reset of the window that is used up, from hobkin's last usage reading, or null when no reading says. */
  resetFromReadings() {
    const reading = readSubscription(this.root);
    const used = [reading?.primary, reading?.secondary].filter(entry => entry?.usedPercent >= 100 && entry.resetAt > this.now());
    return used.length ? Math.max(...used.map(entry => entry.resetAt)) : null;
  }

  /** At the reset, building again: the whole tier at once with a known reset, one agent first without one, until it runs. */
  waiting(run) {
    if (this.now() < Date.parse(run.waitingUntil)) return;
    changeRun(this.root, run, { phase: 'building', buildingSince: iso(this.now()), waitingUntil: null, probing: !run.waitingKnown, probe: null });
  }

  /** One line a minute: the most agents that ran in it, the spawned total and each area's agents, plus the tokens read since. */
  count(run) {
    if (!run || !['planning', 'building', 'waiting', 'compiling'].includes(run.phase)) return;
    const now = this.now();
    const minute = Math.floor(now / MINUTE_MS);
    const running = this.running();

    // The agent that tried has run two minutes without the limit: the subscription is back, and the tier fills again.
    const tryHeld = run.probing && run.probe && this.live.has(run.probe.id) && now - Date.parse(run.probe.at) > PROBE_HOLDS_MS;
    if (tryHeld) changeRun(this.root, run, { probing: false, probe: null });

    if (this.minute && this.minute.at !== minute) {
      this.writeMinute(run, this.minute, running);
      this.minute = null;
    }
    this.minute = { at: minute, most: Math.max(this.minute?.most ?? 0, running.length) };
  }

  writeMinute(run, { at, most }, running) {
    for (const record of running) this.addTokens(run, record);
    const areas = {};
    for (const agent of running) {
      if (agent.area) areas[agent.area] = (areas[agent.area] ?? 0) + 1;
    }
    const { spawned, tokens = 0 } = this.run;
    const line = { at: iso(at * MINUTE_MS), running: most, spawned, tokens, areas };
    appendFileSync(countsFile(this.directory(run)), `${JSON.stringify(line)}\n`);
  }

  history(run) {
    const file = countsFile(this.directory(run));
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-MOST_HISTORY).map(line => JSON.parse(line));
  }

  /** Each area of the plan with its agents now, whether its leader runs, and its steps. A plan still being written shows none. */
  areasView(run, running) {
    let areas = [];
    try {
      const plan = readPlan(run.folder);
      if (plan) areas = areasNow(run.folder, plan, readJson(packetsFile(this.directory(run)), {}));
    } catch {
      return [];
    }
    return areas.map(area => ({
      id: area.id,
      name: area.name,
      depends: area.depends,
      open: area.open,
      done: area.done,
      steps: area.steps,
      agents: running.filter(agent => agent.area === area.id).length,
      leader: running.some(agent => agent.role === 'leader' && agent.area === area.id),
    }));
  }

  /**
   * The run as the window shows it: its phase and step, the tier, the counts and their history, and each area of the plan with its agents
   * now, its leader and its steps. Nothing about what any single agent is doing.
   */
  view() {
    const run = this.run;
    const machine = this.machine();
    if (!run) return { run: null, machine };

    const running = this.running();
    const showsPlan = run.phase === 'plan-ready' || (run.phase === 'stopped' && run.planned);
    return {
      run: {
        id: run.id,
        slug: run.slug,
        name: run.name,
        branch: run.branch,
        idea: run.idea,
        tier: run.tier,
        phase: run.phase,
        step: run.step ?? null,
        round: run.round ?? null,
        planned: run.planned,
        compiling: run.compile?.reason ?? null,
        waitingUntil: run.waitingUntil,
        pr: run.pr,
        lines: run.lines ?? [],
        running: running.length,
        spawned: run.spawned,
        tokens: run.tokens ?? 0,
        buildingMs: buildingMs(run, this.now()),
        areas: this.areasView(run, running),
        plan: showsPlan ? planView(run.folder) : null,
        history: this.history(run).map(({ at, running: most, spawned }) => ({ at, running: most, spawned })),
      },
      machine,
    };
  }
}

export { underWay };
