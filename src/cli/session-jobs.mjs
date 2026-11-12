import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { markPosted, recordSessionEnd } from './session-log.mjs';
import { tierNames } from './tiers.mjs';

const NAME = /^hobkin-[a-z0-9-]{1,20}-[0-9a-f]{4}$/;

/**
 * The sessions `hobkin session` asked for, each taken once. Only the name, title, folder, `--wake` and the tier come
 * from the request: the brief and the report are where that command keeps them, and a request that does not hold up
 * is dropped.
 */
export function takeSessionRequests(root, capacity = Infinity) {
  const folder = join(root, 'runtime', 'session-requests');
  if (!existsSync(folder)) return [];
  const handoffs = join(root, 'runtime', 'handoffs');
  return readdirSync(folder).filter(file => file.endsWith('.json')).slice(0, capacity).flatMap(file => {
    let request = null;
    try {
      request = JSON.parse(readFileSync(join(folder, file), 'utf8'));
    } catch {
      // A request that cannot be read is dropped with the rest of what does not hold up.
    }
    rmSync(join(folder, file), { force: true });
    const { name, title, cwd, wake, tier } = request ?? {};
    const brief = join(handoffs, `${name}.md`);
    if (!NAME.test(name ?? '') || file !== `${name}.json` || typeof title !== 'string' || !isAbsolute(cwd ?? '')
      || !existsSync(cwd) || !statSync(cwd).isDirectory() || !existsSync(brief)) return [];
    return [{ name, title: title.slice(0, 200) || name, cwd, brief, report: join(handoffs, `${name}.report.md`), wake: wake === true, ...(tierNames.includes(tier) ? { tier } : {}) }];
  });
}

/**
 * Runs a session as one of the runner's background jobs, the way Work runs: it shows as a running run with its live
 * activity and agents, `message_check` reaches it by its schedule, and `kill` stops it. When it ends, the session log
 * hears of it, so `--wake` gives the main agent its turn with the report. The run keeps the tier it was given beside
 * the model and effort that tier meant then, so a later change of the tier does not rewrite what ran.
 */
export function startSessionJob({ root, runner, model, effort, tier }, session) {
  const harnessId = randomUUID();
  const id = `session:${session.name}`;
  const inbox = Promise.withResolvers();
  inbox.promise.catch(() => {});
  runner.inboxes.set(id, inbox);
  const request = { id, kind: 'background', scheduleId: `session.${session.name}`, title: session.title, harness: 'pi', model, effort, ...(tier ? { tier } : {}), cwd: session.cwd, harnessId };
  const { work } = runner.startTracked(request, async signal => {
    mkdirSync(join(root, 'jobs'), { recursive: true, mode: 0o700 });
    return runner.runHarness({
      id: harnessId, harness: 'pi', cwd: session.cwd, model, effort,
      prompt: `Read ${session.brief} and follow it.`,
      sessionFile: join(root, 'jobs', `${harnessId}.jsonl`),
      signal,
    }, { onEvent: event => runner.onActivity(id, event), onReady: send => inbox.resolve(send) });
  });
  return work.then(run => {
    // Its last reply is the report when it wrote none.
    if (!existsSync(session.report) && run?.result?.text) writeFileSync(session.report, run.result.text, { mode: 0o600 });
    const userStop = run?.userStop && run.status === 'interrupted'
      ? { runId: run.id, reason: run.userStop.reason } : undefined;
    recordSessionEnd({ ...session, userStop });
    // The run posts its own notice and report, so the session log's would say it twice.
    markPosted(root, [session]);
  });
}
