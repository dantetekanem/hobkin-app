import { randomUUID, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hobkinCommand } from './work/chat.mjs';
import { loadSchedules, scheduleDate, scheduleTimes } from './schedules.mjs';
import { runHarness as defaultRunHarness } from './harnesses.mjs';
import { buildContext } from './context.mjs';
import { readMemory } from './memory.mjs';
import { checkHold, keepOnceFile, openCheck, scheduleDefinition } from './checks.mjs';

function partsAt(formatter, time) {
  return Object.fromEntries(formatter.formatToParts(time)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

function utc(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0);
}

function calendarFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function matchesDate(schedule, date) {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return schedule.cadence === 'daily'
    || (schedule.cadence === 'once' && schedule.date === `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`)
    || (schedule.cadence === 'weekly' && [schedule.weekday].flat().includes(weekday))
    || (schedule.cadence === 'monthly' && schedule.day === date.day);
}

function occurrenceAt(schedule, formatter, date, at) {
  const [hour, minute] = at.split(':').map(Number);
  const target = utc({ ...date, hour, minute });
  const matches = [];
  // Sample both sides of a timezone transition, then verify candidate wall times exactly.
  for (let offset = -36; offset <= 36; offset += 6) {
    const probe = target + offset * 3600000;
    const candidate = target - (utc(partsAt(formatter, probe)) - probe);
    const local = partsAt(formatter, candidate);
    if (local.year === date.year && local.month === date.month && local.day === date.day
      && local.hour === hour && local.minute === minute) matches.push(candidate);
  }
  const due = Math.min(...matches);
  if (!Number.isFinite(due)) return null;
  const localDate = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  const id = `${schedule.id}:${localDate}${Array.isArray(schedule.at) || schedule.window ? `:${at}` : ''}`;
  return { id, scheduledAt: new Date(due).toISOString(), localDate };
}

/** Only the latest due time today is eligible; older missed checks are never replayed. A once file keeps its date eligible however late. */
export function dueOccurrence(schedule, now = new Date(), { notBefore = null } = {}) {
  if (!schedule.enabled) return null;
  const instant = new Date(now).getTime();
  if (!Number.isFinite(instant)) throw Error('Invalid scheduler time');
  const formatter = calendarFormatter(schedule.timezone);
  const once = schedule.cadence === 'once';
  const today = once ? scheduleDate(schedule.date) : partsAt(formatter, instant);
  if (!matchesDate(schedule, today)) return null;
  const localTime = `${String(today.hour).padStart(2, '0')}:${String(today.minute).padStart(2, '0')}`;
  if (!once && schedule.window && localTime > schedule.window.end) return null;
  for (const at of scheduleTimes(schedule).reverse()) {
    const occurrence = occurrenceAt(schedule, formatter, today, at);
    if (!occurrence || Date.parse(occurrence.scheduledAt) > instant) continue;
    return notBefore != null && Date.parse(occurrence.scheduledAt) <= Date.parse(notBefore) ? null : occurrence;
  }
  return null;
}

export function nextOccurrence(schedule, now = new Date(), { runs = [], notBefore = null } = {}) {
  if (!schedule.enabled) return null;
  const admitted = occurrence => runs.some(run => run.id === occurrence.id
    || (run.scheduleId === schedule.id && run.scheduledAt === occurrence.scheduledAt));
  const due = dueOccurrence(schedule, now, { notBefore });
  if (due && !admitted(due)) return due;
  const boundary = Math.max(new Date(now).getTime(), notBefore == null ? 0 : Date.parse(notBefore));
  const formatter = calendarFormatter(schedule.timezone);
  const today = partsAt(formatter, boundary);
  const midnight = Date.UTC(today.year, today.month - 1, today.day);
  const once = schedule.cadence === 'once';
  // Two months cover the longest gap between valid monthly dates (for example, the 31st).
  for (let offset = 0; offset <= (once ? 0 : 62); offset++) {
    const day = new Date(midnight + offset * 86400000);
    const date = once ? scheduleDate(schedule.date)
      : { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() };
    if (!matchesDate(schedule, date)) continue;
    for (const at of scheduleTimes(schedule)) {
      const occurrence = occurrenceAt(schedule, formatter, date, at);
      if (occurrence && Date.parse(occurrence.scheduledAt) > boundary && !admitted(occurrence)) return occurrence;
    }
  }
  return null;
}

/** A once file is finished when its latest time has run and no later one is left. */
const isFinishedOnce = (schedule, runs, now, notBefore) => {
  if (schedule.cadence !== 'once' || !schedule.enabled) return false;
  if (runs.some(run => run.status === 'running') || nextOccurrence(schedule, now, { runs, notBefore })) return false;

  const latest = dueOccurrence(schedule, now, { notBefore });
  return Boolean(latest) && runs.some(run => run.scheduledAt === latest.scheduledAt);
};

/** The run that started a hold names it: a retry that fails leaves it standing, and only a working run or a schedule edit ends it. */
const holdStart = (schedule, runs) => {
  const finished = runs.filter(run => run.finishedAt).toSorted((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  let start = finished.length - 1;
  // No wait has run out at time zero, so this asks only whether the streak stands.
  while (checkHold(schedule, finished.slice(0, start), 0)) start--;
  return finished[start];
};

export class HobkinRunner {
  constructor({ runtime, root, config, now = () => new Date(), runHarness = defaultRunHarness, compatibilityDue = null, compatibility = null, onActivity = () => {}, onTick = () => {} }) {
    if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 4) throw Error('concurrency must be 1–4');
    if (!Number.isFinite(new Date(config.initializedAt).getTime())) throw Error('Invalid scheduler configuration bounds');
    Object.assign(this, { runtime, root, config, now, runHarness, compatibilityDue, compatibility, onTick });
    this.onActivity = (id, event) => {
      try {
        onActivity(id, event);
      } catch {
        // Activity previews are best-effort and cannot fail scheduled work.
      }
    };
    this.loaded = { schedules: [], errors: [], counts: { daily: 0, weekly: 0, monthly: 0, once: 0 } };
    this.jobs = new Map();
    this.inboxes = new Map();
    this.legacySessions = new Set();
    this.stopped = false;
    this.lastError = null;
  }

  start({ intervalMs = 1000 } = {}) {
    if (!Number.isInteger(intervalMs) || intervalMs < 100) throw Error('intervalMs must be at least 100');
    if (this.stopped) throw Error('Runner has stopped');
    if (!this.timer) {
      const tick = () => {
        void this.tick().catch(error => { this.lastError = error.message; });
      };
      this.timer = setInterval(tick, intervalMs);
      this.timer.unref();
      tick();
    }
    return this;
  }

  tick() {
    if (this.stopped) return Promise.resolve();
    if (!this.ticking) this.ticking = this.serialize(() => this.performTick()).finally(() => { this.ticking = null; });
    return this.ticking;
  }

  async performTick() {
    const now = new Date(this.now());
    this.loaded = loadSchedules(this.root);
    this.lastError = null;
    const state = await this.runtime.state();
    let capacity = this.config.concurrency - this.scheduledJobCount(state);
    for (const schedule of this.loaded.schedules) {
      if (this.stopped || capacity <= 0) break;
      if (schedule.cadence === 'compatibility') {
        try {
          if (await this.startCompatibility(schedule, state, now)) capacity--;
        } catch (error) {
          this.loaded.errors.push({ path: schedule.path, message: error.message });
        }
        continue;
      }
      const occurrence = this.compatibilityDue
        ? this.compatibilityDue(schedule, now, { notBefore: this.config.initializedAt, defaultDue: dueOccurrence })
        : dueOccurrence(schedule, now, { notBefore: this.config.initializedAt });
      if (!occurrence || state.runs[occurrence.id] || this.jobs.has(occurrence.id)) continue;
      // Keep completed admissions when a setting changes between one time and a list.
      if (Object.values(state.runs).some(run => run.scheduleId === schedule.id && run.scheduledAt === occurrence.scheduledAt)) continue;
      if (Object.values(state.runs).some(run => run.scheduleId === schedule.id && run.status === 'running')) continue;
      if (checkHold(schedule, Object.values(state.runs), now.getTime())) continue;
      try {
        await this.startNative(schedule, occurrence, state);
        capacity--;
      } catch (error) {
        this.loaded.errors.push({ path: schedule.path, message: error.message });
      }
    }
    await this.retireFinishedOnce(now);
    this.lastTick = now.toISOString();
    await this.onTick();
  }

  /** This comes after dispatch, so a time that was missed gets its run before the file leaves. */
  async retireFinishedOnce(now) {
    if (!this.loaded.counts.once) return;

    const runs = Object.values((await this.runtime.state()).runs);
    for (const schedule of this.loaded.schedules) {
      const own = runs.filter(run => run.scheduleId === schedule.id);
      if (!isFinishedOnce(schedule, own, now, this.config.initializedAt)) continue;
      try {
        keepOnceFile(this.root, schedule);
      } catch (error) {
        this.loaded.errors.push({ path: schedule.path, message: error.message });
      }
    }
  }

  /** Work runs have their own pool, so they never take a place from ordinary checks. */
  scheduledJobCount(state) {
    const running = Object.values(state.runs)
      .filter(run => run.kind === 'background' && run.status === 'running' && !run.work);
    const tracked = [...this.jobs.keys()].filter(id => !id.startsWith('work:'));
    return Math.max(tracked.length, running.length);
  }

  serialize(operation) {
    const work = (this.admission ?? Promise.resolve()).then(operation);
    this.admission = work.catch(() => {});
    return work;
  }

  trigger(scheduleId, requestId, signal) {
    return this.serialize(async () => {
      signal?.throwIfAborted();
      if (this.stopped) throw Error('Runner has stopped');
      this.loaded = loadSchedules(this.root);
      const native = this.loaded.schedules.filter(item => item.cadence !== 'compatibility');
      if (!scheduleId) return {
        schedules: native.slice(0, 20).map(({ id, title, enabled }) => ({ id, title, enabled })),
        more: native.length > 20,
      };
      const schedule = native.find(item => item.id === scheduleId);
      if (!schedule) throw Error('Unknown exact native routine ID; list candidates first.');
      const id = `once:${createHash('sha256').update(requestId).digest('hex')}`;
      const state = await this.runtime.state();
      if (state.runs[id]) {
        if (state.runs[id].scheduleId !== scheduleId) throw Error('Request ID already belongs to another routine.');
        return { id, status: state.runs[id].status, replay: true };
      }
      const running = Object.values(state.runs).filter(run => run.kind === 'background' && run.status === 'running');
      if (running.some(run => run.scheduleId === scheduleId)) throw Error('Routine is already running.');
      if (this.scheduledJobCount(state) >= this.config.concurrency) throw Error('Background capacity is full.');
      const accepted = Promise.withResolvers();
      const occurrence = { id, requestedAt: new Date(this.now()).toISOString(), trigger: 'manual' };
      const { work } = await this.startNative(schedule, occurrence, state, signal, accepted.resolve);
      return Promise.race([accepted.promise, work.then(() => {
        throw Error(this.lastError ?? 'Dispatch failed before admission.');
      })]).then(() => ({ id, status: 'running' }));
    });
  }

  async startNative(schedule, occurrence, state, signal, onAdmitted) {
    if (schedule.harness !== 'pi') throw Error('Execution requires an explicit Pi binding.');
    const previous = Object.values(state.runs)
      .filter(run => run.scheduleId === schedule.id && run.status !== 'running')
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
    const decide = hobkinCommand(this.root, `decide routine ${schedule.id}`);
    const action = hobkinCommand(this.root, `action routine ${schedule.id}`);
    const prompt = await buildContext(schedule, previous, readMemory(this.root), { ...openCheck(this.root, schedule.id), decide, action });
    const id = randomUUID();
    const directory = join(this.root, 'jobs');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // Revalidate the complete folder after asynchronous preflight; stale definitions grant no authority.
    const fresh = loadSchedules(this.root);
    const current = fresh.schedules.find(item => item.id === schedule.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(schedule)) {
      throw Error('Routine changed during preflight; not dispatched');
    }
    signal?.throwIfAborted();
    if (this.stopped) throw Error('Runner has stopped');
    const inbox = Promise.withResolvers();
    inbox.promise.catch(() => {});
    this.inboxes.set(occurrence.id, inbox);
    return this.startTracked({
      ...occurrence,
      kind: 'background',
      scheduleId: schedule.id,
      title: schedule.title,
      harness: 'pi',
      model: schedule.model,
      effort: schedule.effort,
      cwd: schedule.cwd,
      harnessId: id,
      definition: scheduleDefinition(schedule),
    }, async signal => {
      const admitted = loadSchedules(this.root).schedules.find(item => item.id === schedule.id);
      if (!admitted || JSON.stringify(admitted) !== JSON.stringify(schedule)) {
        throw Error('Routine changed before provider dispatch');
      }
      if (occurrence.trigger !== 'manual' && schedule.window && dueOccurrence(schedule, this.now())?.id !== occurrence.id) {
        return {
          status: 'incomplete',
          noModel: true,
          error: 'Routine window elapsed before dispatch; no provider started.',
        };
      }
      return this.runHarness({
        id,
        harness: 'pi',
        cwd: schedule.cwd,
        model: schedule.model,
        effort: schedule.effort,
        prompt,
        sessionFile: join(directory, `${id}.jsonl`),
        signal,
      }, {
        onEvent: event => this.onActivity(occurrence.id, event),
        onReady: send => inbox.resolve(send),
      });
    }, onAdmitted);
  }

  /** Dispatches work that `kill` and `stop` can reach. */
  startTracked(request, effect, onAdmitted) {
    const tracked = this.runtime.dispatch(request, effect, onAdmitted)
      .catch(error => { this.lastError = error.message; })
      .finally(() => {
        this.jobs.delete(request.id);
        this.inboxes.get(request.id)?.reject(Error('That check has finished.'));
        this.inboxes.delete(request.id);
      });
    this.jobs.set(request.id, tracked);
    return { work: tracked };
  }

  async startCompatibility(schedule, state, now) {
    if (!this.compatibility) throw Error('A migrated routine needs its pinned compatibility engine and delivery handlers.');
    const sessionId = schedule.legacy.session.sessionId;
    if (this.legacySessions.has(sessionId)
      || Object.values(state.runs).some(run => run.harnessId === sessionId && run.status === 'running')) {
      return false;
    }
    if (this.compatibility.handlers.ready && !this.compatibility.handlers.ready(sessionId)) return false;
    const prepared = await this.compatibility.prepare(schedule, state, now, { notBefore: this.config.initializedAt });
    if (!prepared || state.runs[prepared.occurrence.id] || this.jobs.has(prepared.occurrence.id) || this.stopped) return false;
    const current = () => {
      const value = loadSchedules(this.root).schedules.find(item => item.id === schedule.id);
      if (!value || JSON.stringify(value) !== JSON.stringify(schedule)) throw Error('Compatibility routine changed before execution.');
    };
    current();
    const reservation = this.compatibility.handlers.reserve?.(schedule.legacy);
    if (this.compatibility.handlers.reserve && !reservation) return false;
    this.legacySessions.add(sessionId);
    const work = this.runtime.dispatch({
      ...prepared.occurrence,
      kind: 'background',
      scheduleId: schedule.id,
      title: schedule.title,
      harness: 'pi',
      harnessId: sessionId,
      sessionId,
      cwd: schedule.cwd,
      legacy: true,
    }, signal => {
      current();
      return this.compatibility.execute(schedule.legacy, prepared, signal, reservation, {
        onEvent: event => this.onActivity(prepared.occurrence.id, event),
      });
    });
    const tracked = work
      .catch(error => { this.lastError = error.message; })
      .finally(() => {
        this.jobs.delete(prepared.occurrence.id);
        this.legacySessions.delete(sessionId);
        reservation?.release();
      });
    this.jobs.set(prepared.occurrence.id, tracked);
    return true;
  }

  async snapshot() {
    const state = await this.runtime.state();
    const runs = Object.values(state.runs);
    const reports = runs
      .filter(run => run.kind === 'background' && run.result?.text && (run.status !== 'no_change' || run.trigger === 'manual'))
      .map(run => ({
        id: run.id,
        title: run.title,
        status: run.status,
        text: run.result.text,
        scheduledAt: run.scheduledAt,
        finishedAt: run.finishedAt,
      }));
    const now = new Date(this.now());
    const stillToCome = schedule => {
      const own = runs.filter(run => run.scheduleId === schedule.id);
      return !isFinishedOnce(schedule, own, now, this.config.initializedAt);
    };
    const schedules = this.loaded.schedules.filter(stillToCome).map(schedule => {
      const related = runs.filter(run => run.scheduleId === schedule.id);
      let nextRun = { state: 'paused', at: null };
      if (schedule.enabled) {
        if (this.loaded.errors.some(error => error.path === schedule.path)) {
          nextRun = { state: 'blocked', at: null };
        } else if (related.some(run => run.status === 'running')) {
          // A recurring check's next slot still counts as upcoming work while this run finishes.
          const next = schedule.cadence === 'compatibility' ? null
            : nextOccurrence(schedule, now, { runs: related, notBefore: this.config.initializedAt });
          nextRun = { state: 'running', at: next?.scheduledAt ?? null };
        } else if (schedule.cadence === 'compatibility') {
          const last = related.toSorted((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
          const task = last?.result?.compatibilityTask ?? schedule.legacy.legacy;
          const at = task.nextRun ?? task.dueAt;
          if (related.some(run => run.status === 'interrupted')) {
            nextRun = { state: 'blocked', at: null, reason: 'interrupted_attempt' };
          } else if (related.some(run => !run.result?.compatibilityTask)) {
            nextRun = { state: 'blocked', at: null, reason: 'missing_final_receipt' };
          } else if (task.expiresAt && Date.parse(task.expiresAt) <= now.getTime()) {
            nextRun = { state: 'expired', at: null };
          } else if (['completed', 'failed', 'cancelled'].includes(task.status)) {
            nextRun = { state: task.status, at: null };
          } else if (!task.enabled) {
            nextRun = { state: 'paused', at: null };
          } else if (task.status === 'pending' && Date.parse(at) > Date.parse(this.config.initializedAt)) {
            nextRun = { state: 'scheduled', at };
          } else {
            nextRun = { state: 'pending', at: null, reason: 'awaiting_scheduler' };
          }
        } else {
          const hold = checkHold(schedule, related, now.getTime());
          const next = nextOccurrence(schedule, hold?.until ?? now, { runs: related, notBefore: this.config.initializedAt });
          if (hold) {
            const resumesAt = next && Date.parse(next.scheduledAt) > Date.parse(hold.until) ? next.scheduledAt : hold.until;
            nextRun = { state: 'held', at: resumesAt, reason: hold.reason, holdId: holdStart(schedule, related).id };
          } else if (next) {
            nextRun = { state: 'scheduled', at: next.scheduledAt };
          } else if (schedule.cadence !== 'once') {
            nextRun = { state: 'blocked', at: null, reason: 'no_occurrence_in_forecast' };
          } else {
            nextRun = { state: 'expired', at: null };
          }
        }
      }
      return { ...structuredClone(schedule), nextRun };
    });
    const counts = { ...this.loaded.counts, once: schedules.filter(schedule => schedule.cadence === 'once').length };
    return { ...structuredClone(this.loaded), counts, schedules, runs, reports, lastTick: this.lastTick ?? state.lastTick, error: this.lastError };
  }

  /** Stops one running scheduled job this runner owns; its schedule file stays unchanged. */
  async kill(runId) {
    if (!this.jobs.has(runId)) return false;
    const run = (await this.runtime.state()).runs[runId];
    if (run?.status !== 'running') return false;
    // A cancelled compatibility attempt finishes interrupted, so it still requires explicit reconciliation.
    await this.runtime.cancel(runId);
    return true;
  }

  /** A check shows as running before Pi is ready for it, so a message sent that early waits. With no schedule named, lists what is running. */
  async messageCheck({ scheduleId, message }) {
    const runs = Object.values((await this.runtime.state()).runs);
    const reachable = runs.filter(run => run.status === 'running' && this.inboxes.has(run.id));
    if (!scheduleId) return { running: reachable.map(run => ({ scheduleId: run.scheduleId, title: run.title })) };

    const run = reachable.find(item => item.scheduleId === scheduleId);
    if (!run) throw Error('That check is not running.');
    if (!message) throw Error('Say what to tell the check.');

    const send = await this.inboxes.get(run.id).promise;
    await send(message);
    return { scheduleId, status: 'delivered' };
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    await this.admission;
    await Promise.all([...this.jobs.keys()].map(id => this.runtime.cancel(id)));
    await Promise.all([...this.jobs.values()]);
  }
}
