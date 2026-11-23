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

  save() {
    const now = this.now();
    // An ended schedule shows for an hour and leaves the store a day after it ended.
    this.schedules = this.schedules.filter(schedule => isLive(schedule) || now - Date.parse(schedule.endedAt) < KEPT_AFTER_END_MS);
    if (!this.schedules.length && !this.pending.length && !existsSync(join(this.root, STORE))) return;
    atomicJson(join(this.root, STORE), { version: 1, schedules: this.schedules, wakes: this.pending });
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
    const answer = action === 'cancel' ? this.cancel(id, 'agent')
      : action === 'run' ? this.runNow(id)
        : this.pause(id, action === 'pause', 'agent');
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
    if (schedule.state === 'running') this.replace({ ...schedule, resumeTo: paused ? 'paused' : 'waiting' });
    else if (paused) this.replace({ ...schedule, state: 'paused', pausedBy: by });
    else {
      const { pausedBy: _, ...rest } = schedule;
      this.replace({ ...rest, state: 'waiting', nextAt: iso(Math.max(Date.parse(schedule.nextAt), this.now())) });
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
      ...(isLive(schedule) ? { wakesLeft: MOST_WAKES - schedule.wakes, until: schedule.until } : { endedWhy: schedule.endedWhy }),
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
    if (this.startDue() || changed) this.save();
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
    this.replace({ ...rest, state: 'running', resumeTo: schedule.state === 'paused' ? 'paused' : 'waiting', startedAt: iso(fired) });
    const ran = (async () => {
      try {
        return await this.shell({ command: schedule.command, cwd: schedule.cwd, signal: controller.signal, env: withoutTokens(this.env) });
      } catch (error) {
        return { code: null, killed: false, stdout: '', stderr: '', error: String(error?.message ?? error) };
      }
    })();
    entry.done = ran.then(result => {
        this.timers.clearTimeout(entry.timer);
        this.running.delete(schedule.id);
        const current = this.find(schedule.id);
        // One cancelled or ended meanwhile keeps its end, and hobkin closing leaves it to the next open.
        if (current?.state !== 'running' || this.closed) return;
        this.settle(current, { fired, result, timedOut: entry.timedOut }, current.resumeTo);
        this.save();
      });
  }

  /** A firing's result: the schedule as it is after, its wake queued, and its end with the reason kept. */
  settle(schedule, run, resumeTo) {
    const before = { ...schedule };
    delete before.resumeTo;
    const { schedule: after, wake } = afterRun(before, run, this.now());
    if (!isLive(after)) {
      this.replace(after);
      // Its last run woke its agent with the end in it, or the end is told on its own.
      if (wake) this.queue(after, wake);
      else this.tellOfEnd(after, 'hobkin');
      return;
    }
    const next = { ...after, state: resumeTo === 'paused' && after.state === 'waiting' ? 'paused' : after.state };
    delete next.startedAt;
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

  /** hobkin closes: commands running now are stopped, and the next open counts them as interrupted. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.running.values()) entry.controller.abort();
    await Promise.all([...this.running.values()].map(entry => entry.done));
  }
}
