import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { JobActivity } from './job-activity.mjs';

/**
 * The agents a run's own Pi started with pi-extended-teams, for the window to show (`046-teams-layer`). Display only:
 * hobkin never starts, stops, messages or waits for them, and they are never its helpers. Nothing here is custody, a
 * stop target or a cost, and nothing that decides those reads it.
 *
 * Rows come from the run's own events first: its spawn calls, the messages it sent the agents, and the reports and
 * wakes that reached it. When teams' own files for the run's session exist, they fill in the status, times, steps and
 * messages. Those files belong to a run only through the session its own spawn result named, and an agent in them
 * only by that session, its name and a start after the spawn call, never by a name alone. Plain reads, no locks.
 *
 * `agentsOut` is the one read outside the window: a run's harness asks it whether a lead still has agents working
 * before it settles that run, since the run's own records can miss one: a spawn seen only inside a `codemode` script's
 * record, or a member of a group that wakes the lead once per report, still working after the group's first wake.
 */

const SPAWNS = new Set(['spawn_agent', 'spawn_swarm_agents']);
const OUT = new Set(['queued', 'running']);
// teams' completion-group slots that have not settled (its `src/results/completion-group.ts`).
const UNSETTLED = new Set(['pending', 'queued', 'running']);
const ORDER = ['running', 'queued', 'unknown', 'failed', 'done'];
const TEAM = /^session-([A-Za-z0-9_-]{1,200})$/;
// teams' names are letters, digits, `-` and `_` (its `sanitizeName`). Anything else is not a name it made.
const NAME = /^[A-Za-z0-9_-]{1,120}$/;
const SLACK_MS = 2000;
const READ_MS = 2000;
const HEARTBEAT_MS = 90000;
const MOST_ROWS = 24;
const MOST_ENDED_RUNS = 20;
const MOST_MESSAGES = 12;
const MOST_JSON_BYTES = 8 * 1024 * 1024;
const SESSION_TAIL_BYTES = 256 * 1024;
const MODEL_CHARS = 120;
const LEVEL_CHARS = 20;
const PROGRESS_CHARS = 200;
// What a session hobkin could not read gives: no steps and no measure of its context.
const NO_SESSION = Object.freeze({ steps: Object.freeze([]) });
// A run never seen running in a refresh, and this old, has ended.
const UNSEEN_MS = 30000;

const clean = value => typeof value === 'string'
  ? stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '') : '';
const cut = (value, most) => {
  const text = clean(value).trim();
  return text ? text.slice(0, most) : undefined;
};
const nameOf = value => typeof value === 'string' && NAME.test(value) ? value : undefined;
const timeOf = value => {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) && at > 0 ? at : undefined;
};
const teamOf = value => {
  const match = typeof value === 'string' ? TEAM.exec(value) : null;
  // teams' session for a Pi with no session id is shared by every such process, so it is no one run's.
  return match && match[1] !== 'local-session' ? value : undefined;
};
const fields = row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

/** Where pi-extended-teams keeps its sessions: `.pi/teams` in the user's home (its `src/utils/paths.ts`). */
export const defaultTeamsDir = () => join(homedir(), '.pi', 'teams');

const defaultSchedule = (task, ms) => {
  const timer = setTimeout(task, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export class TeamsAgents {
  /** By run id, in the order hobkin first saw each. */
  runs = new Map();
  /** What was last read of each session's folder, by team name. */
  sessions = new Map();
  /** Each file's size and time when it was last parsed, and what it held. */
  files = new Map();
  published = {};
  publishedText = '{}';
  dirty = false;

  constructor({ teamsDir = defaultTeamsDir(), now = Date.now, onChange = () => {}, schedule = defaultSchedule, mostSteps = 16 } = {}) {
    Object.assign(this, { teamsDir, now, onChange, schedule, mostSteps });
  }

  /** One event of a run's own Pi, as hobkin received it. It is only read: nothing in it is changed or kept whole. */
  observe(runId, event) {
    try {
      if (this.follow(runId, event)) {
        this.dirty = true;
        this.due();
      }
    } catch {
      /* Display data must not fail execution. */
    }
  }

  follow(runId, event) {
    const type = event?.type;
    const tool = event?.toolName;
    const call = SPAWNS.has(tool) || tool === 'send_message';
    if (type === 'tool_execution_start' && call) {
      const run = SPAWNS.has(tool) ? this.runOf(runId) : this.runs.get(runId);
      run?.calls.set(event.toolCallId, { at: this.now(), args: event.args && typeof event.args === 'object' ? event.args : {} });
      return false;
    }
    if (type === 'tool_execution_end' && call) {
      const run = SPAWNS.has(tool) ? this.runOf(runId) : this.runs.get(runId);
      if (!run) return false;
      const started = run.calls.get(event.toolCallId) ?? { at: this.now(), args: {} };
      run.calls.delete(event.toolCallId);
      if (tool === 'send_message') return !event.isError && this.said(run, started);
      return this.spawned(run, event, started);
    }
    if (type === 'message_end' && event.message?.role === 'custom') {
      const run = this.runs.get(runId);
      const { customType, details } = event.message;
      if (run && customType === 'pi-extended-teams-report') return this.reported(run, details);
      if (run && customType === 'pi-extended-teams-wake') return this.woke(run, details?.completionGroup?.groupId);
    }
    return false;
  }

  runOf(runId) {
    let run = this.runs.get(runId);
    if (!run) this.runs.set(runId, run = { rows: [], calls: new Map(), createdAt: this.now(), seenActive: false, endedAt: undefined });
    return run;
  }

  /** The rows a spawn call's result gives: each agent it started or queued, and each one that could not start. */
  spawned(run, event, call) {
    const details = event.isError ? {} : event.result?.details ?? {};
    const single = event.toolName === 'spawn_agent';
    const asked = single ? [call.args] : Array.isArray(call.args.agents) ? call.args.agents : [];
    const shared = {
      team: teamOf(details.session),
      callAt: call.at,
      startedAt: this.now(),
      group: cut(details.completionGroup?.groupId, 200),
      delivery: cut(call.args.completion_group?.delivery, 40),
    };
    const addRow = (agent, state) => {
      const name = nameOf(agent?.name);
      if (!name) return false;
      // What it was asked: its own entry in the call, by name, or the whole call when the call spawned one agent.
      const args = asked.find(other => other?.name === name) ?? (single ? call.args : {});
      return this.add(run, fields({
        ...shared,
        key: cut(`${event.toolCallId}:${name}`, 240),
        name,
        task: cut(args.prompt, 2000) ?? '',
        modelSlot: cut(agent.modelSlot ?? args.model_slot ?? call.args.defaults?.model_slot, 60),
        // What teams chose for it, as its result names it. A harness's are null there: its record says them, if anything.
        model: cut(agent.model, MODEL_CHARS),
        thinking: cut(agent.thinking, LEVEL_CHARS),
        state,
        endedAt: state === 'failed' ? shared.startedAt : undefined,
      }));
    };

    // A refused call started nothing. Each agent it named is one that could not start.
    if (event.isError) return asked.slice(0, MOST_ROWS).map(args => addRow(args, 'failed')).some(Boolean);

    const started = single ? [details] : Array.isArray(details.spawned) ? details.spawned : [];
    const failed = Array.isArray(details.failed) ? details.failed : [];
    const added = [
      ...started.map(agent => addRow(agent, agent.queued === true ? 'queued' : 'running')),
      ...failed.map(agent => addRow(agent, 'failed')),
    ];
    return added.some(Boolean);
  }

  add(run, row) {
    if (run.rows.length >= MOST_ROWS) {
      const ended = run.rows.findIndex(other => !OUT.has(other.state));
      if (ended === -1) return false;
      run.rows.splice(ended, 1);
    }
    run.rows.push({ ...row, said: [] });
    return true;
  }

  said(run, call) {
    const name = nameOf(call.args.recipient);
    const row = name ? run.rows.findLast(other => other.name === name) : undefined;
    const text = cut(call.args.content, 600);
    if (!row || !text) return false;
    row.said.push({ by: 'run', text, at: call.at });
    row.said.splice(0, Math.max(0, row.said.length - MOST_MESSAGES));
    return true;
  }

  /** A report ends the newest row of this run still out under that name: teams keeps one run of a name alive in a session. */
  reported(run, details) {
    const name = nameOf(details?.name);
    const row = name ? run.rows.findLast(other => other.name === name && OUT.has(other.state)) : undefined;
    if (!row) return false;
    const summary = cut(details.summary, 400);
    Object.assign(row, fields({ state: details.ok === false ? 'failed' : 'done', endedAt: this.now(), summary }));
    if (summary) row.said.push({ by: 'agent', text: summary, at: row.endedAt });
    return true;
  }

  /**
   * A grouped swarm reports once for all its agents, through one wake, unless its group delivers each report as it
   * comes (`immediate`). That group wakes once per member, so its agents end only as teams' file for the group, or its
   * reports, say; the wake has the files read soon.
   */
  woke(run, group) {
    const rows = group ? run.rows.filter(row => row.group === group && OUT.has(row.state)) : [];
    const perReport = row => (row.delivery ?? this.groupOf(row)?.delivery) === 'immediate';
    const endingNow = rows.filter(row => !perReport(row));
    for (const row of endingNow) Object.assign(row, { state: 'done', endedAt: this.now() });
    return rows.length > 0;
  }

  /** The completion group a row's agent belongs to, as its file was last read. */
  groupOf(row) {
    return row.group ? this.sessions.get(row.team)?.groups?.get(row.group) : undefined;
  }

  /**
   * The rows by run id. With `active`, the runs still running: one that was and no longer is has ended, and only the
   * 20 that ended last are kept. The same object comes back while nothing changed, so it is not sent again.
   */
  snapshot(active) {
    try {
      if (active) this.settle(active);
      // A refresh's `active` can turn a row unknown with the clock alone (a heartbeat going stale), so it always projects.
      if (!this.dirty && !active) return this.published;
      this.dirty = false;

      const withRows = [...this.runs].filter(([, run]) => run.rows.length);
      const next = Object.fromEntries(withRows.map(([id, run]) => [id, this.rowsOf(run)]));
      const text = JSON.stringify(next);
      if (text !== this.publishedText) {
        this.published = next;
        this.publishedText = text;
      }
    } catch {
      /* The rows stay as they were. */
    }
    return this.published;
  }

  settle(active) {
    const now = this.now();
    for (const [id, run] of this.runs) {
      if (active.has(id)) run.seenActive = true;
      else if (run.endedAt === undefined && (run.seenActive || now - run.createdAt > UNSEEN_MS)) {
        // One more read after the end, for what teams wrote last.
        Object.assign(run, { endedAt: now, lastRead: true });
        this.due();
      }
    }

    const ended = [...this.runs]
      .filter(([, run]) => run.endedAt !== undefined)
      .sort(([, a], [, b]) => a.endedAt - b.endedAt);
    const dropped = ended.slice(0, Math.max(0, ended.length - MOST_ENDED_RUNS));
    for (const [id] of dropped) this.runs.delete(id);

    // What was read of a session no kept run names is let go.
    const named = new Set([...this.runs.values()].flatMap(run => run.rows.map(row => row.team)));
    for (const team of this.sessions.keys()) {
      if (!named.has(team)) this.sessions.delete(team);
    }
  }

  rowsOf(run) {
    return run.rows.map((row, index) => ({ row: this.project(run, row), index }))
      .sort((a, b) => ORDER.indexOf(a.row.state) - ORDER.indexOf(b.row.state) || a.index - b.index)
      .map(({ row }) => row);
  }

  factsOf(row) {
    return row.team ? this.sessions.get(row.team)?.facts.get(row.key) : undefined;
  }

  /** One row as the window gets it: what the run's events said, with what teams' files say over it. */
  project(run, row) {
    const facts = this.factsOf(row);
    const { state, phase } = this.standing(run, row, facts);
    const ended = state === 'done' || state === 'failed';
    const steps = facts?.steps.length ? facts.steps : undefined;
    // What it says it is doing holds only while it runs. What its context holds stays, as its last measure.
    const progress = state === 'running' ? facts?.runtime?.latestProgress : undefined;
    const messages = facts?.messages.length ? facts.messages : row.said.length ? row.said : undefined;

    return fields({
      key: row.key,
      name: row.name,
      task: row.task || facts?.prompt || '',
      modelSlot: row.modelSlot,
      model: row.model ?? facts?.ranOn?.model,
      thinking: row.thinking ?? facts?.ranOn?.thinking,
      state,
      phase,
      progress,
      tokens: facts?.tokens,
      startedAt: row.startedAt,
      endedAt: ended ? timeOf(facts?.report?.createdAt) ?? row.endedAt : undefined,
      summary: facts?.report?.summary ?? row.summary,
      group: row.group,
      from: facts ? 'teams' : 'run',
      steps: steps?.map(step => ({ ...step })),
      messages: messages?.map(message => ({ ...message })),
    });
  }

  /**
   * How a row stands, by the strongest word there is: teams' stored report, then the run's own report or wake, then
   * whether teams still lists it as running. An agent never seen to end whose run is over, or that teams lists no
   * more, is unknown: how it ended is not known.
   */
  standing(run, row, facts) {
    if (facts?.report) return { state: facts.report.status === 'failed' ? 'failed' : 'done' };
    if (!OUT.has(row.state)) return { state: row.state };
    const slot = this.groupOf(row)?.slots.get(row.name);
    if (slot && !UNSETTLED.has(slot)) return { state: slot === 'reported' ? 'done' : 'failed' };

    const listed = facts?.member && facts.member.isActive !== false;
    if (listed && (run.endedAt === undefined || this.beating(facts.runtime))) {
      return { state: 'running', phase: facts.runtime?.activeToolName ?? facts.runtime?.currentAction };
    }
    if (run.endedAt !== undefined) return { state: 'unknown' };

    const session = this.sessions.get(row.team);
    const readSinceItStarted = session?.valid && session.readAt >= row.startedAt + SLACK_MS;
    return { state: readSinceItStarted && row.state === 'running' ? 'unknown' : row.state };
  }

  beating(runtime) {
    const at = timeOf(runtime?.lastHeartbeatAt);
    return at !== undefined && this.now() - at <= HEARTBEAT_MS;
  }

  /** Reads soon, unless a read is already waiting. */
  due() {
    if (this.closed || this.waiting) return;
    this.waiting = this.schedule(() => {
      this.waiting = null;
      void this.read().then(changed => { if (changed && !this.closed) this.onChange(); }, () => {});
    }, READ_MS);
  }

  /** A row teams still lists as running, which is read on after its run ends. */
  stillListed(run, row) {
    return OUT.has(this.project(run, row).state) && Boolean(this.factsOf(row)?.member);
  }

  /** Reads every session a live run named, and once more each one whose run just ended. True when a row changed. */
  async read() {
    this.snapshot();
    const before = this.publishedText;

    const wanted = new Map();
    for (const run of this.runs.values()) {
      const reading = this.watched(run) || run.lastRead;
      run.lastRead = false;
      if (!reading) continue;
      for (const row of run.rows) {
        if (row.team) wanted.set(row.team, [...wanted.get(row.team) ?? [], row]);
      }
    }

    this.touched = new Set();
    for (const [team, rows] of wanted) {
      try {
        this.sessions.set(team, await this.readSession(team, rows));
      } catch {
        /* What was read before stays. */
      }
    }
    // Parsed files no session is read for any more are let go.
    for (const path of this.files.keys()) {
      if (!this.touched.has(path)) this.files.delete(path);
    }

    this.dirty = true;
    this.snapshot();
    if ([...this.runs.values()].some(run => this.watched(run))) this.due();
    return this.publishedText !== before;
  }

  /** A run still running, or one with an agent teams still lists as running, is read again. */
  watched(run) {
    return run.endedAt === undefined || run.rows.some(row => this.stillListed(run, row));
  }

  async readSession(team, rows) {
    const dir = join(this.teamsDir, team);
    const readAt = this.now();
    const id = TEAM.exec(team)[1];
    const config = await this.json(join(dir, 'config.json'));
    const lead = await this.json(join(dir, 'lead-session.json'));
    if (config?.name !== team || config.leadSessionId !== id || lead?.sessionId !== id || !Array.isArray(config.members)) {
      return { valid: false, readAt, facts: new Map() };
    }
    const records = recordsOf(config.members, await this.json(join(dir, 'reports.json')));
    const inboxes = new Map();
    const inbox = async name => {
      if (!inboxes.has(name)) inboxes.set(name, await this.json(join(dir, 'inboxes', `${name}.json`)));
      return inboxes.get(name);
    };

    const facts = new Map();
    for (const row of rows) {
      // The earliest run of its name that began with or after its own spawn call, with every record of that run.
      const after = records.filter(record => record.name === row.name && record.at >= row.callAt - SLACK_MS);
      if (!after.length) continue;
      const first = after.reduce((earliest, record) => (record.at < earliest.at ? record : earliest));
      const runId = nameOf(first.runId);
      const matched = after.filter(record => record === first || (runId && record.runId === runId));

      const report = matched.find(record => record.report)?.report;
      const member = matched.find(record => record.member)?.member;
      const runtime = member ? await this.json(join(dir, 'runtime', `${row.name}.json`)) : undefined;
      const ownRuntime = runtime && (!runId || runtime.lifecycleRunId === runId);
      facts.set(row.key, {
        report: report && { status: report.status, createdAt: report.createdAt, summary: cut(report.summary, 400) },
        member: member && { isActive: member.isActive },
        ranOn: member && ranOn(member),
        prompt: cut(member?.prompt ?? report?.metadata?.initialPrompt, 2000),
        runtime: ownRuntime ? fields({
          activeToolName: cut(runtime.activeToolName, 80),
          currentAction: cut(runtime.currentAction, 80),
          latestProgress: cut(runtime.latestProgress, PROGRESS_CHARS),
          lastHeartbeatAt: runtime.lastHeartbeatAt,
        }) : undefined,
        ...(runId ? await this.session(join(dir, 'agent-sessions', row.name, runId)) : NO_SESSION),
        messages: messagesOf(row.name, runId, first.at, await inbox(row.name), await inbox('team-lead')),
      });
    }

    // Each completion group the rows belong to, by teams' own file for it: how it delivers, and how each slot stands.
    const groups = new Map();
    for (const groupId of new Set(rows.map(row => row.group))) {
      const path = groupFile(dir, groupId);
      const group = path && await this.json(path);
      if (group?.sessionId === id) groups.set(groupId, { delivery: group.policy?.delivery, slots: slotsOf(group) });
    }
    return { valid: true, readAt, facts, groups };
  }

  /** A JSON file teams wrote, parsed again only when its size or time changed. Missing, too big or broken is nothing. */
  async json(path) {
    try {
      this.touched?.add(path);
      const { size, mtimeMs } = await stat(path);
      const known = this.files.get(path);
      if (known?.size === size && known.mtimeMs === mtimeMs) return known.value;
      const value = size > MOST_JSON_BYTES ? undefined : JSON.parse(await readFile(path, 'utf8'));
      this.files.set(path, { size, mtimeMs, value });
      return value;
    } catch {
      return undefined;
    }
  }

  /**
   * What the agent's own Pi session says, from the end of its newest file: its last steps, kept as hobkin keeps any
   * agent's, and how many tokens its context held at its last whole response.
   */
  async session(dir) {
    try {
      const names = (await readdir(dir)).filter(name => name.endsWith('.jsonl')).sort();
      if (!names.length) return NO_SESSION;
      const path = join(dir, names.at(-1));
      this.touched?.add(path);
      const { size, mtimeMs } = await stat(path);
      const known = this.files.get(path);
      if (known?.size === size && known.mtimeMs === mtimeMs) return known.value;
      const value = sessionOf(await tail(path, size), this.mostSteps);
      this.files.set(path, { size, mtimeMs, value });
      return value;
    } catch {
      return NO_SESSION;
    }
  }

  close() {
    this.closed = true;
    this.waiting?.();
    this.waiting = null;
  }
}

/** Where teams keeps the file of a completion group it made (`group:` and 64 hex digits) in a session folder. */
function groupFile(dir, groupId) {
  const hex = typeof groupId === 'string' ? /^group:([a-f0-9]{64})$/.exec(groupId)?.[1] : undefined;
  return hex && join(dir, 'completion-groups', `${hex}.json`);
}

/** A completion group's slots, from its file: each member's name and status. */
function slotsOf(group) {
  const members = Array.isArray(group?.members) ? group.members : [];
  const named = members.filter(member => nameOf(member?.name) && typeof member.status === 'string');
  return new Map(named.map(member => [member.name, member.status]));
}

/**
 * The model and thinking level teams started a member on, as its record says: an agent in Pi has its own fields, and
 * Claude Code run as an external harness has the `--model` and `--effort` its profile passes. Another harness's
 * arguments are not read, so what it runs on is left out.
 */
function ranOn(member) {
  const harness = member.externalHarness;
  const claudeArgs = harness?.kind === 'claude' && Array.isArray(harness.args) ? harness.args : [];
  return fields({
    model: cut(member.model, MODEL_CHARS) ?? cut(flagValue(claudeArgs, '--model'), MODEL_CHARS),
    thinking: cut(member.thinking, LEVEL_CHARS) ?? cut(flagValue(claudeArgs, '--effort'), LEVEL_CHARS),
  });
}

/** What a command line gives a flag, as `--flag value` or `--flag=value`. */
function flagValue(args, flag) {
  for (const [index, arg] of args.entries()) {
    if (arg === flag) return args[index + 1];
    if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

/** A JSON file teams wrote, with when it was last written. Missing, too big or broken is nothing. */
async function jsonFile(path) {
  try {
    const { size, mtimeMs } = await stat(path);
    return size > MOST_JSON_BYTES ? undefined : { mtimeMs, value: JSON.parse(await readFile(path, 'utf8')) };
  } catch {
    return undefined;
  }
}

/**
 * What teams still has out for a lead's Pi session, by its own files: each teammate it lists as active that joined or
 * beat within teams' heartbeat staleness, and, in a completion group written within that time, each slot not settled
 * and each wake not yet seen by the lead (as `wake:<delivery id>`). A file nothing writes any more stops counting then.
 */
export async function agentsOut(sessionId, { teamsDir = defaultTeamsDir(), now = Date.now() } = {}) {
  const team = teamOf(`session-${sessionId}`);
  if (!team) return [];
  const dir = join(teamsDir, team);
  const config = (await jsonFile(join(dir, 'config.json')))?.value;
  const ownConfig = config?.name === team && config.leadSessionId === sessionId && Array.isArray(config.members);
  if (!ownConfig) return [];

  const fresh = at => at !== undefined && now - at <= HEARTBEAT_MS;
  const out = new Set();

  for (const member of config.members) {
    const listed = member?.agentType === 'teammate' && member.isActive !== false;
    const name = listed ? nameOf(member.name) : undefined;
    if (!name) continue;
    const runtime = (await jsonFile(join(dir, 'runtime', `${name}.json`)))?.value;
    const ownRuntime = runtime && (!member.lifecycleRunId || runtime.lifecycleRunId === member.lifecycleRunId);
    const beating = ownRuntime && fresh(timeOf(runtime.lastHeartbeatAt));
    if (beating || fresh(timeOf(member.joinedAt))) out.add(name);
  }

  const groupsDir = join(dir, 'completion-groups');
  for (const file of await readdir(groupsDir).catch(() => [])) {
    const group = file.endsWith('.json') ? await jsonFile(join(groupsDir, file)) : undefined;
    if (!fresh(group?.mtimeMs) || group.value?.sessionId !== sessionId) continue;
    for (const [name, status] of slotsOf(group.value)) {
      if (UNSETTLED.has(status)) out.add(name);
    }
    const { deliveries } = group.value;
    for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
      const unseen = delivery?.wake?.state !== 'observed';
      if (unseen && typeof delivery?.id === 'string') out.add(`wake:${cut(delivery.id, 200)}`);
    }
  }
  return [...out];
}

/**
 * Every run teams has a record of in the session, by name and start: the members it lists as running, and the runs that
 * reported. A record with no usable name or start is left out.
 */
function recordsOf(members, reports) {
  const listed = members
    .filter(member => member?.agentType === 'teammate')
    .map(member => ({ name: member.name, at: timeOf(member.joinedAt), runId: member.lifecycleRunId, member }));
  const reported = (Array.isArray(reports) ? reports : [])
    .map(report => ({ name: report?.agentName, at: timeOf(report?.startedAt) ?? timeOf(report?.createdAt), runId: report?.result?.runId, report }));
  return [...listed, ...reported].filter(record => nameOf(record.name) && record.at !== undefined);
}

async function tail(path, size) {
  const handle = await open(path, 'r');
  try {
    const length = Math.min(size, SESSION_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    // A first line cut short is not a whole record.
    return size > length ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await handle.close();
  }
}

/** A usage figure from a session file: a positive count, or none. */
const counted = value => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * The tokens a response's context held, as Pi counts them (`calculateContextTokens`): its total, or else its parts.
 * A response cut short or failed measured nothing, so it gives none.
 */
function contextTokens(message) {
  const usage = message.usage;
  const cutShort = message.stopReason === 'aborted' || message.stopReason === 'error';
  if (!usage || cutShort) return undefined;

  const parts = counted(usage.input) + counted(usage.output) + counted(usage.cacheRead) + counted(usage.cacheWrite);
  const tokens = counted(usage.totalTokens) || parts;
  return tokens > 0 ? Math.round(tokens) : undefined;
}

/**
 * An agent's session lines as an agent's steps, its words and tool calls, never its thinking or a tool's details; and
 * the tokens its context held at its last whole response, as Pi's own footer counts them.
 */
function sessionOf(text, most) {
  let at;
  let tokens;
  const feed = new JobActivity({ now: () => at });
  for (const line of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = entry?.type === 'message' ? entry.message : undefined;
    at = timeOf(entry?.timestamp);
    if (message?.role === 'assistant') {
      tokens = contextTokens(message) ?? tokens;
      feed.accept({ type: 'message_end', message: { role: 'assistant', content: message.content } });
    }
    if (message?.role === 'toolResult') {
      feed.accept({ type: 'tool_execution_end', toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError === true, result: { content: message.content } });
    }
  }
  const steps = feed.snapshot().slice(-most).map(({ codemode, ...step }) => fields({
    ...step, text: step.text?.slice(0, 600), input: step.input?.slice(0, 400), output: step.output?.slice(0, 400),
  }));
  return fields({ steps, tokens });
}

/** The messages between the run and this run of the agent: those to it in its inbox, and those from it in the run's. */
function messagesOf(name, runId, since, inbox, leadInbox) {
  // teams marks a message with the run it went to or came from. One it did not mark counts by its time.
  const ofThisRun = (message, key) => {
    const marked = message?.metadata?.[key];
    if (runId && marked) return marked === runId;
    return timeOf(message?.timestamp) >= since - SLACK_MS;
  };
  const toIt = (Array.isArray(inbox) ? inbox : [])
    .filter(message => ofThisRun(message, 'recipientRunId'))
    .map(message => message.from === 'team-lead' ? { by: 'run', message } : { by: 'peer', peer: nameOf(message.from), message });
  const fromIt = (Array.isArray(leadInbox) ? leadInbox : [])
    .filter(message => message?.from === name && ofThisRun(message, 'senderRunId'))
    .map(message => ({ by: 'agent', message }));

  return [...toIt, ...fromIt]
    .map(({ message, ...who }) => fields({ ...who, text: cut(message.text, 600), at: timeOf(message.timestamp) }))
    .filter(message => message.text)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .slice(-MOST_MESSAGES);
}
