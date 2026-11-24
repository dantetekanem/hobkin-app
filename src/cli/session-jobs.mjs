import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { readDirections } from './directions.mjs';
import { MESSAGE_MAX, TITLE_MAX } from './hobkins.mjs';
import { MAX_MESSAGE_BYTES } from './runtime.mjs';
import { markPosted, recordSessionEnd } from './session-log.mjs';
import { tierNames } from './tiers.mjs';
import { resumeNote, WAITING } from './run-waits.mjs';
import { SCHEDULES_GONE } from './agent-schedules.mjs';
import { readMemory } from './memory.mjs';
import { keepsMemories, runIndex } from './memories.mjs';

const NAME = /^hobkin-[a-z0-9-]{1,20}-[0-9a-f]{4}$/;

/**
 * The sessions `hobkin session` asked for, each taken once. Only the name, title, folder, `--wake`, `--keep` and the
 * tier come from the request: the brief and the report are where that command keeps them, and a request that does not
 * hold up is dropped. A kept session is a durable hobkin, which takes none of the `capacity` places jobs share, so it is
 * taken whatever is left of them.
 */
export function takeSessionRequests(root, capacity = Infinity) {
  const folder = join(root, 'runtime', 'session-requests');
  if (!existsSync(folder)) return [];
  const handoffs = join(root, 'runtime', 'handoffs');
  let places = capacity;
  return readdirSync(folder).filter(file => file.endsWith('.json')).flatMap(file => {
    let request = null;
    try {
      request = JSON.parse(readFileSync(join(folder, file), 'utf8'));
    } catch {
      // A request that cannot be read is dropped with the rest of what does not hold up.
    }
    const keep = request?.keep === true;
    if (!keep && places-- <= 0) return [];
    rmSync(join(folder, file), { force: true });
    const { name, title, cwd, wake, tier } = request ?? {};
    const brief = join(handoffs, `${name}.md`);
    if (!NAME.test(name ?? '') || file !== `${name}.json` || typeof title !== 'string' || !isAbsolute(cwd ?? '')
      || !existsSync(cwd) || !statSync(cwd).isDirectory() || !existsSync(brief)) return [];
    return [{ name, title: title.slice(0, 200) || name, cwd, brief, report: join(handoffs, `${name}.report.md`), wake: wake === true, ...(keep ? { keep } : {}), ...(tierNames.includes(tier) ? { tier } : {}) }];
  });
}

/**
 * A kept session (`hobkin session --keep`) starts as a durable hobkin, through the start the window uses, on the tier
 * its work was given. Its brief is its first message, or a line that points at the brief when it is longer than a
 * message may be, as a job's is. One that cannot start, as when there are already as many hobkins as may be, ends as a
 * session that started and failed does: its report says why, and Chat and the main agent hear of it.
 */
export async function startKeptSession({ root, hobkins, tier }, session) {
  const { title, cwd, brief, report } = session;
  try {
    const whole = readFileSync(brief, 'utf8');
    const fits = whole.length <= MESSAGE_MAX && Buffer.byteLength(whole) <= MAX_MESSAGE_BYTES;
    return await hobkins.start({ text: fits ? whole : `Read ${brief} and follow it.`, cwd, engine: { kind: 'tier', tier }, title: title.slice(0, TITLE_MAX) });
  } catch (error) {
    mkdirSync(join(root, 'runtime', 'handoffs'), { recursive: true, mode: 0o700 });
    writeFileSync(report, `It could not start as a durable hobkin. ${error.message}`, { mode: 0o600 });
    recordSessionEnd(session);
    return null;
  }
}

/** What a session's end leaves: its last reply as the report when it wrote none, and its end in the session log. */
export function endSessionJob(root, session, run) {
  if (!existsSync(session.report) && run?.result?.text) writeFileSync(session.report, run.result.text, { mode: 0o600 });
  const userStop = run?.userStop && run.status === 'interrupted'
    ? { runId: run.id, reason: run.userStop.reason } : undefined;
  recordSessionEnd({ ...session, userStop });
  // The run posts its own notice and report, so the session log's would say it twice.
  markPosted(root, [session]);
}

/**
 * One start of a session's run, the first or one after a wait: its Pi on the run's own session file, with its messages
 * and activity. `prompt` is read as the start is admitted. A run that ends waiting has not ended, so its end is left to
 * the start that finishes it or to the user's Stop, and a start after a wait that was not admitted, because the run had
 * already ended, leaves the end to whoever ended it.
 */
function runSessionJob({ root, runner }, request, session, { prompt, waits, resume = false }) {
  const inbox = Promise.withResolvers();
  inbox.promise.catch(() => {});
  runner.inboxes.set(request.id, inbox);
  let admitted = false;
  const { work } = runner.startTracked(request, async signal => {
    mkdirSync(join(root, 'jobs'), { recursive: true, mode: 0o700 });
    return runner.runHarness({
      id: request.harnessId,
      harness: 'pi',
      cwd: request.cwd,
      model: request.model,
      effort: request.effort,
      prompt: prompt(),
      sessionFile: join(root, 'jobs', `${request.harnessId}.jsonl`),
      waits,
      // Its agent keeps schedules for itself, and waits on them as on a wait (056-agent-schedules).
      schedules: true,
      // It reads hobkin's shared memories and suggests one (057-shared-memory).
      ...(keepsMemories(root) ? { memories: 'run' } : {}),
      signal,
    }, { onEvent: event => runner.onActivity(request.id, event), onReady: send => inbox.resolve(send) });
  }, () => { admitted = true; }, { resume });

  return work.then(run => {
    if (run?.status === WAITING || (resume && !admitted)) return;
    endSessionJob(root, session, run);
  });
}

/**
 * Runs a session as one of the runner's background jobs, the way Work runs: it shows as a running run with its live
 * activity and agents, `message_check` reaches it by its schedule, and `kill` stops it. When it ends, the session log
 * hears of it, so `--wake` gives the main agent its turn with the report. The run keeps the tier it was given beside
 * the model and effort that tier meant then, so a later change of the tier does not rewrite what ran. Its request carries
 * the user's directions, as a check's and a work run's do, read when it starts. Its agent can wait with `hobkin_wait`
 * and carry on at a time (053-run-waits), so its record keeps what its end needs (`session`).
 */
export function startSessionJob({ root, runner, model, effort, tier }, session) {
  const { name, title, cwd, brief, report, wake } = session;
  const request = {
    id: `session:${name}`,
    kind: 'background',
    scheduleId: `session.${name}`,
    title,
    harness: 'pi',
    model,
    effort,
    ...(tier ? { tier } : {}),
    cwd,
    harnessId: randomUUID(),
    session: { name, title, cwd, brief, report, wake },
  };
  // The right-now list and the index of shared memories, as a routine's request carries them, when there are any (057-shared-memory).
  const prompt = () => {
    let memory = [];
    try {
      memory = readMemory(root);
    } catch {
      // A list that cannot be read costs the run that list, never its start.
    }
    const memories = runIndex(root, 'hobkin_recall');
    return JSON.stringify({ task: `Read ${brief} and follow it.`, directions: readDirections(root),
      ...(memory.length ? { memory } : {}), ...(memories ? { memories } : {}) });
  };
  return runSessionJob({ root, runner }, request, session, { prompt, waits: 0 });
}

/**
 * Starts again a session's run that waited and whose time has come (053-run-waits): the same run, harness and session
 * file, on the model and effort it last had, told its note and how long it has been. Its record keeps what the
 * session's end needs (`session`). A run its schedules woke is told what they found instead (`woken`, read as the
 * start is admitted), and one that waited on schedules that all ended without a word is told so (056-agent-schedules).
 */
export function resumeSessionJob({ root, runner, now }, run, woken) {
  const { id, kind, scheduleId, title, model, effort, tier, cwd, harnessId, session, wait } = run;
  const request = { id, kind, scheduleId, title, harness: 'pi', model, effort, ...(tier ? { tier } : {}), cwd, harnessId, session };
  return runSessionJob({ root, runner }, request, session, {
    prompt: () => woken?.() ?? (wait.schedules ? SCHEDULES_GONE : resumeNote(wait, now)),
    waits: wait.waits,
    resume: true,
  });
}
