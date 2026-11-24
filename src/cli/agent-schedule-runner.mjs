import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from './config.mjs';
import { executeShell } from './shell.mjs';
import { TURN_TOKEN } from './hobkin-tell.mjs';
import {
  afterRun, askedSchedule, ended, expiredWhy, isDue, isExpired, isLive, KEPT_AFTER_END_MS, MOST_AT_ONCE, MOST_WAKES,
  sameOwner, scheduleForAgent, scheduleView, SHOWN_AFTER_END_MS,
} from './agent-schedules.mjs';

/**
 * The schedules agents keep for themselves (`agent-schedules.mjs`), kept in the home and fired on the runtime's tick.
 * Only the running hobkin writes the store, whole and safely, after every change. A command runs with `executeShell` in
 * its owner's folder, three at once at most and never two of one schedule, and is ended at its timeout through its
 * signal. A wake is kept with the schedules until whoever delivers it says it is delivered, so one a restart cut off is
 * delivered after. Nothing here knows how an agent is woken: the application takes the wakes and delivers them.
 */

export const STORE = join('runtime', 'agent-schedules.json');
/** The environment a scheduled command never gets: hobkin's own tokens. */
export const SCHEDULE_TOKEN = 'HOBKIN_SCHEDULE_TOKEN';
const HIDDEN = [TURN_TOKEN, SCHEDULE_TOKEN];
// Closing waits this long for running commands to stop. A child that escaped its process group can hold a pipe for
// good, and hobkin's close must not wait on it.
const CLOSE_WAIT_MS = 5000;
const NO_SUCH = 'There is no schedule with that id.';
const NOT_YOURS = 'There is no schedule of yours with that id. List yours with action list.';
const ENDED = 'That schedule has already ended.';

const copy = value => JSON.parse(JSON.stringify(value));
const iso = time => new Date(time).toISOString();

/** The store as the home holds it. A missing or unreadable one is empty, so a home that never scheduled reads as none. */
export function readAgentSchedules(root) {
  const file = join(root, STORE);
  if (!existsSync(file)) return { schedules: [], wakes: [] };
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    return {
      schedules: Array.isArray(stored?.schedules) ? stored.schedules : [],
      wakes: Array.isArray(stored?.wakes) ? stored.wakes : [],
    };
  } catch {
    return { schedules: [], wakes: [] };
  }
}

const withoutTokens = env => Object.fromEntries(Object.entries(env).filter(([name]) => !HIDDEN.includes(name)));

export class AgentScheduleRunner {
  // Each command running now, by its schedule's id: how to stop it and whether hobkin ended it at its timeout.
  running = new Map();
  closed = false;
  // Why the store could not be written last, or null once a write went through. What is kept in memory goes on, and
  // the next write catches up.
  lastError = null;

  /**
   * `shell` runs a command as `executeShell` does, `timers` holds the timeout, and `env` is the environment a command
   * starts from, hobkin's tokens taken out. `onChange` hears of every change, for the snapshot.
   */
  constructor({ root, now = Date.now, shell = executeShell, timers = globalThis, env = process.env, onChange = () => {} }) {
    Object.assign(this, { root, now, shell, timers, env, onChange });
    this.schedules = [];
    this.pending = [];
  }

  /**
   * Reads the store and applies what a restart means: a run that was cut off counts as interrupted and fires again
   * once, as an overdue schedule does, one whose lifetime passed while hobkin was closed ends quietly, and the wakes not
   * delivered stay to be delivered.
   */
  open() {
    const { schedules, wakes } = readAgentSchedules(this.root);
    const now = this.now();
    let changed = false;
    this.schedules = schedules.map(schedule => {
      let next = schedule;
      if (next.state === 'running') {
        next = afterRun({ ...next, state: 'waiting' }, { fired: now, result: { interrupted: true } }, now).schedule;
        if (next.resumeTo === 'paused') next.state = 'paused';
        delete next.resumeTo;
        changed = true;
      }
      if (isExpired(next, now)) {
        next = ended(next, 'expired', expiredWhy(next, true), now);
        changed = true;
      }
      return next;
    });
    this.pending = wakes;
    if (changed) this.save();
    return this;
  }

  /** Writes the store whole. A write that fails, as on a full disk, never throws: its error is kept and the next write tries again. */
  save() {
    const now = this.now();
    // An ended schedule shows for an hour and leaves the store a day after it ended.
    this.schedules = this.schedules.filter(schedule => isLive(schedule) || now - Date.parse(schedule.endedAt) < KEPT_AFTER_END_MS);
    try {
      if (this.schedules.length || this.pending.length || existsSync(join(this.root, STORE))) {
        atomicJson(join(this.root, STORE), { version: 1, schedules: this.schedules, wakes: this.pending });
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = String(error?.message ?? error);
    }
    try {
      this.onChange();
    } catch {
      // The snapshot catches up on its next rebuild.
    }
  }

  find(id) { return this.schedules.find(schedule => schedule.id === id); }

  replace(next) {
    this.schedules = this.schedules.map(schedule => (schedule.id === next.id ? next : schedule));
  }

  /** The live schedules of one owner, or of every owner. */
  live(owner) {
    return this.schedules.filter(schedule => isLive(schedule) && (!owner || sameOwner(schedule.owner, owner))).length;
  }

  /** When the last of an owner's live schedules ends at the latest, or null when it has none. */
  liveUntil(owner) {
    const ends = this.schedules.filter(schedule => isLive(schedule) && sameOwner(schedule.owner, owner)).map(schedule => Date.parse(schedule.until));
    return ends.length ? Math.max(...ends) : null;
  }

  /** The wakes waiting for one owner, oldest first. */
  wakesFor(owner) { return this.wakes().filter(wake => sameOwner(wake.owner, owner)); }

  /** Makes one for `owner`, its command run in `cwd`. Answers it as the agent reads it, or throws the refusal. */
  make(owner, cwd, asked) {
    if (this.closed) throw Error('hobkin is closing, so it keeps no new schedule now.');
    let id;
    do id = randomUUID().slice(0, 8); while (this.find(id));
    const { schedule, refused } = askedSchedule(asked, { now: this.now(), owner, cwd, live: this.schedules, id });
    if (refused) throw Error(refused);
    this.schedules.push(schedule);
    this.save();
    return scheduleForAgent(schedule);
  }

  /** The owner's own schedules as it reads them: the live ones, then those that ended in the last hour. */
  list(owner) {
    const now = this.now();
    return this.schedules
      .filter(schedule => sameOwner(schedule.owner, owner) && (isLive(schedule) || now - Date.parse(schedule.endedAt) < SHOWN_AFTER_END_MS))
      .map(scheduleForAgent);
  }

  /**
   * What `hobkin_schedules` does for its agent: lists, cancels, pauses, resumes or runs one now, only ever one of the
   * agent's own. Throws the refusal.
   */
  manage(owner, { action, id } = {}) {
    if (action === 'list') return { schedules: this.list(owner) };
    if (!['cancel', 'pause', 'resume', 'run'].includes(action)) throw Error('action is one of list, cancel, pause, resume or run.');
    const schedule = typeof id === 'string' ? this.find(id) : undefined;
    if (!schedule || !sameOwner(schedule.owner, owner)) throw Error(NOT_YOURS);
    const actions = {
      cancel: () => this.cancel(id, 'agent'),
      pause: () => this.pause(id, true, 'agent'),
      resume: () => this.pause(id, false, 'agent'),
      run: () => this.runNow(id),
    };
    const answer = actions[action]();
    if (!answer.ok) throw Error(answer.reason);
    return { schedule: scheduleForAgent(this.find(id)) };
  }

  /** Ends a live schedule: from the window (`user`) or by its own agent. A command it was running is stopped. */
  cancel(id, by = 'user') {
    const schedule = this.find(id);
    if (!schedule) return { ok: false, reason: NO_SUCH };
    if (!isLive(schedule)) return { ok: false, reason: ENDED };
    this.end(schedule, 'cancelled', by === 'user' ? 'the user cancelled it from the window' : 'the agent cancelled it', by);
    this.running.get(id)?.controller.abort();
    this.save();
    return { ok: true };
  }

  /** Holds a live schedule, or lets a held one go on. A running one is held once its run ends. */
  pause(id, paused, by = 'user') {
    const schedule = this.find(id);
    if (!schedule) return { ok: false, reason: NO_SUCH };
    if (!isLive(schedule)) return { ok: false, reason: ENDED };
    if (schedule.state === 'running') {
      this.replace({ ...schedule, resumeTo: paused ? 'paused' : 'waiting' });
    } else if (paused) {
      this.replace({ ...schedule, state: 'paused', pausedBy: by });
    } else {
      // A time that passed while it was held comes at once.
      const { pausedBy: _, ...rest } = schedule;
      const nextAt = iso(Math.max(Date.parse(schedule.nextAt), this.now()));
      this.replace({ ...rest, state: 'waiting', nextAt });
    }
    this.save();
    return { ok: true };
  }

  /** Runs a live schedule once now, a held one included, which stays held. */
  runNow(id) {
    const schedule = this.find(id);
    if (!schedule) return { ok: false, reason: NO_SUCH };
    if (!isLive(schedule)) return { ok: false, reason: ENDED };
    if (schedule.state === 'running') return { ok: false, reason: 'It is running now.' };
    if (this.closed) return { ok: false, reason: 'hobkin is closing.' };
    this.replace({ ...schedule, runNow: true });
    this.startDue();
    this.save();
    return { ok: true };
  }

  /** Every live schedule of an owner that ended ends with it, quietly: nobody is left to tell. */
  endOwner(owner, why) {
    const theirs = this.schedules.filter(schedule => isLive(schedule) && sameOwner(schedule.owner, owner));
    for (const schedule of theirs) {
      this.end(schedule, 'cancelled', why, 'owner');
      this.running.get(schedule.id)?.controller.abort();
    }
    const before = this.pending.length;
    this.pending = this.pending.filter(wake => !sameOwner(wake.owner, owner));
    if (theirs.length || before !== this.pending.length) this.save();
  }

  /**
   * Ends a schedule. One that ends by itself, or that the user cancelled, without its last run waking a run that owns
   * it, starts that run once more with a wake that says so, so it can write its report.
   */
  end(schedule, state, why, by) {
    const next = ended(schedule, state, why, this.now(), by);
    delete next.resumeTo;
    this.replace(next);
    this.tellOfEnd(next, by);
  }

  tellOfEnd(schedule, by) {
    if (schedule.owner.kind === 'run' && by !== 'agent' && by !== 'owner') this.queue(schedule, { kind: 'ended' });
  }

  /** A wake for the schedule's agent, kept until it is delivered. */
  queue(schedule, details) {
    this.pending.push({
      id: randomUUID(),
      scheduleId: schedule.id,
      owner: copy(schedule.owner),
      at: iso(this.now()),
      name: schedule.name,
      note: schedule.note,
      ...(schedule.command === undefined ? {} : { command: schedule.command }),
      ...details,
      ...(isLive(schedule)
        ? { wakesLeft: MOST_WAKES - schedule.wakes, until: schedule.until }
        : { endedWhy: schedule.endedWhy }),
    });
  }

  /** The wakes not delivered yet, oldest first. */
  wakes() { return copy(this.pending); }

  /** Delivered, so they leave the store. */
  delivered(ids) {
    const gone = new Set(ids);
    const before = this.pending.length;
    this.pending = this.pending.filter(wake => !gone.has(wake.id));
    if (before !== this.pending.length) this.save();
  }

  /**
   * One second of the runtime's tick: schedules whose owner ended end with it (`alive` says, when given), those whose
   * lifetime passed end, and those due fire. A command runs on in the background, so this never waits for one.
   */
  tick({ alive } = {}) {
    if (this.closed) return;
    const now = this.now();
    let changed = false;
    for (const schedule of this.schedules.filter(isLive)) {
      if (alive && alive(schedule.owner) === false) {
        this.endOwner(schedule.owner, 'its agent ended');
        changed = true;
      } else if (isExpired(schedule, now)) {
        this.end(schedule, 'expired', expiredWhy(schedule), 'hobkin');
        changed = true;
      }
    }
    // A wake whose agent has gone has nobody to reach.
    const kept = alive ? this.pending.filter(wake => alive(wake.owner) !== false) : this.pending;
    if (kept.length !== this.pending.length) {
      this.pending = kept;
      changed = true;
    }
    // A store that could not be written is written again on each tick until it can be.
    if (this.startDue() || changed || this.lastError) this.save();
  }

  /** Fires what is due, earliest first. A plain wake fires at once, and a command only while fewer than three run. */
  startDue() {
    const now = this.now();
    const due = this.schedules.filter(schedule => isDue(schedule, now) && !this.running.has(schedule.id))
      .toSorted((a, b) => Date.parse(a.nextAt) - Date.parse(b.nextAt));
    let fired = 0;
    for (const schedule of due) {
      if (schedule.command === undefined) {
        this.settle(schedule, { fired: now }, schedule.state);
        fired++;
      } else if (this.running.size < MOST_AT_ONCE) {
        this.start(schedule);
        fired++;
      }
    }
    return fired > 0;
  }

  /** Runs a schedule's command in the background, ended through its signal at its timeout, and settles it after. */
  start(schedule) {
    const fired = this.now();
    const controller = new AbortController();
    const entry = { controller, timedOut: false };
    entry.timer = this.timers.setTimeout(() => {
      entry.timedOut = true;
      controller.abort();
    }, schedule.timeoutMs);
    this.running.set(schedule.id, entry);

    const { runNow: _, ...rest } = schedule;
    const resumeTo = schedule.state === 'paused' ? 'paused' : 'waiting';
    this.replace({ ...rest, state: 'running', resumeTo, startedAt: iso(fired) });

    entry.done = this.runCommand(schedule, controller.signal).then(result => this.finish(schedule.id, entry, { fired, result }));
  }

  /** A command's run ended: the schedule settles with its result. Nothing here may reject, since nothing waits on it. */
  finish(id, entry, { fired, result }) {
    try {
      this.timers.clearTimeout(entry.timer);
      this.running.delete(id);
      const current = this.find(id);
      // One cancelled or ended meanwhile keeps its end, and hobkin closing leaves it to the next open.
      if (current?.state !== 'running' || this.closed) return;
      this.settle(current, { fired, result, timedOut: entry.timedOut }, current.resumeTo);
      this.save();
    } catch (error) {
      this.lastError = String(error?.message ?? error);
    }
  }

  /** The shell's result, or one that says the command could not start. The shell is called at once, before any wait. */
  async runCommand(schedule, signal) {
    try {
      return await this.shell({ command: schedule.command, cwd: schedule.cwd, signal, env: withoutTokens(this.env) });
    } catch (error) {
      return { code: null, killed: false, stdout: '', stderr: '', error: String(error?.message ?? error) };
    }
  }

  /** A firing's result: the schedule as it is after, its wake queued, and its end with the reason kept. */
  settle(schedule, run, resumeTo) {
    const { resumeTo: _, ...firing } = schedule;
    const { schedule: after, wake } = afterRun(firing, run, this.now());
    if (!isLive(after)) {
      this.replace(after);
      // Its last run woke its agent with the end in it, or the end is told on its own.
      if (wake) this.queue(after, wake);
      else this.tellOfEnd(after, 'hobkin');
      return;
    }

    const { startedAt: __, ...settled } = after;
    // One held while it ran, or run now while held, stays held.
    const held = resumeTo === 'paused' && settled.state === 'waiting';
    const next = { ...settled, state: held ? 'paused' : settled.state };
    this.replace(next);
    if (wake) this.queue(next, wake);
  }

  /** Every schedule as the window reads it: the live ones and those that ended in the last hour. `titleOf` names owners. */
  view(titleOf = () => undefined) {
    const now = this.now();
    return this.schedules
      .filter(schedule => isLive(schedule) || now - Date.parse(schedule.endedAt) < SHOWN_AFTER_END_MS)
      .map(schedule => scheduleView(schedule, titleOf(schedule.owner)));
  }

  /** Resolves once no command runs. */
  async idle() {
    while (this.running.size) await Promise.all([...this.running.values()].map(entry => entry.done));
  }

  /**
   * hobkin closes: commands running now are stopped, and the next open counts them as interrupted. It waits for them
   * at most `CLOSE_WAIT_MS`.
   */
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.running.values()) entry.controller.abort();
    const stopped = Promise.all([...this.running.values()].map(entry => entry.done));
    let timer;
    const limit = new Promise(resolve => {
      timer = this.timers.setTimeout(resolve, CLOSE_WAIT_MS);
      timer?.unref?.();
    });
    await Promise.race([stopped, limit]);
    this.timers.clearTimeout(timer);
  }
}
