import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { noteOutcome } from './autonomy.mjs';
import { readReport, runReport, saveReport } from './reports.mjs';

const LOG = 'sessions.jsonl';
const MOST_READ_BYTES = 1048576;
const LONGEST_LINE = 280;
const LINES_SAID = 2;
// Well under what a message can carry, and the rest go with the next one.
const MOST_IN_A_NOTE = 10;

const folderOf = root => join(root, 'runtime', 'handoffs');
const reportId = name => `session:${name}`;

function append(folder, event) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  appendFileSync(join(folder, LOG), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

/**
 * The title has to outlive the command that started the session, and the job that runs it only knows the name. So does the task class its
 * brief named, which its end counts in (`autonomy.mjs`).
 */
export const recordSessionStart = (root, { name, title, report, wake, taskClass }, now = Date.now()) => append(folderOf(root), {
  name, title, report, ...(wake ? { wake } : {}), ...(taskClass ? { taskClass } : {}), startedAt: new Date(now).toISOString(),
});

/** Written when a session's job ends (`session-jobs.mjs`). A session's report sits beside this log. */
export const recordSessionEnd = ({ name, report, userStop, outcome }, now = Date.now()) => append(dirname(report), {
  name, report, ...(userStop ? { userStop } : {}), ...(outcome ? { outcome } : {}), endedAt: new Date(now).toISOString(),
});

/**
 * What a job's report says when hobkin closed or died while the job lived (072-jobs-live-until-done): that it was cut
 * off and not started again, then what its agent last said, if anything.
 */
export function cutOffReport(said) {
  const cutOff = 'This job was cut off when hobkin closed or restarted, before its agent said it was done. Nothing started it again.';
  const last = said?.trim();
  return last ? `${cutOff}\n\nWhat it said last:\n\n${last}` : cutOff;
}

/**
 * What a session's end leaves: its failed run report or last reply when it wrote none, and its end in the session log. The run
 * posts its own notice and report, so the session log's would say it twice. A session whose brief named a task class counts in it:
 * clean once it completed, and an override when the user stopped it. One cut off when hobkin closed or restarted counts nothing,
 * since the work was not judged.
 */
export function endSessionJob(root, session, run) {
  const report = run?.result?.status === 'failed' ? runReport(run.result) : run?.result?.text;
  if (!existsSync(session.report) && report) writeFileSync(session.report, report, { mode: 0o600 });
  const userStop = run?.userStop && run.status === 'interrupted'
    ? { runId: run.id, reason: run.userStop.reason } : undefined;
  recordSessionEnd({ ...session, userStop, outcome: run?.status });
  const { taskClass } = readLog(root).find(({ name }) => name === session.name) ?? {};
  const outcome = judged(run, userStop);
  if (taskClass && outcome) noteOutcome(root, taskClass, outcome);
  markPosted(root, [session]);
}

/** The outcome a session's end counts in its task class, or null when nobody judged the work. */
function judged(run, userStop) {
  if (userStop) return { clean: false, override: true };
  if (run?.status === 'interrupted') return null;
  return { clean: run?.status === 'completed' };
}

function readLog(root) {
  const file = join(folderOf(root), LOG);
  const sessions = new Map();
  if (!existsSync(file)) return [];
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      sessions.set(event.name, { ...sessions.get(event.name), ...event });
    } catch {
      // A line cut short by a crash costs that line and nothing else.
    }
  }
  return [...sessions.values()];
}

const endedSessions = root => readLog(root).filter(({ endedAt }) => endedAt);

// A report is the agent's own file, so only the start of it is read, and one that cannot be read counts as none.
function reportBody({ report }) {
  try {
    const bytes = Buffer.alloc(MOST_READ_BYTES);
    const descriptor = openSync(report, 'r');
    try {
      const read = readSync(descriptor, bytes, 0, MOST_READ_BYTES, 0);
      return bytes.subarray(0, read).toString('utf8');
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return '';
  }
}

/** What happened, from the first line or two of the report, with its Markdown left out. An empty string means the session wrote none. */
function firstLines(body) {
  const lines = body.split('\n').map(line => line.replace(/^[#>*\s-]+/, '').replaceAll('**', '').trim()).filter(Boolean);
  return lines.slice(0, LINES_SAID).join(' ').slice(0, LONGEST_LINE);
}

const withWhatItSaid = session => {
  const body = reportBody(session);
  return { ...session, body, said: firstLines(body) };
};

/** What Chat has yet to hear. Each report is kept with the others now, so it stays readable whatever becomes of the session's folder. */
export function sessionsToPost(root) {
  const sessions = endedSessions(root).filter(({ posted }) => !posted).map(withWhatItSaid);
  for (const { name, body, said } of sessions) {
    if (said) saveReport(root, reportId(name), body);
  }
  return sessions;
}

export const sessionNotice = ({ name, title, said, endedAt }) => ({
  id: `notice:session:${name}`,
  role: 'notice',
  content: said ? `${title ?? name}: ${said}` : `${title ?? name} stopped without a report.`,
  tone: said ? 'useful' : 'critical',
  at: endedAt,
});

/** Marked only once the view holding the notice is saved, so a crash in between posts it again rather than never. Its id stops a second copy. */
export const markPosted = (root, sessions) => sessions.forEach(({ name }) => append(folderOf(root), { name, posted: true }));

const reportOf = ({ name, title, endedAt, outcome = 'completed' }, body) => ({
  id: reportId(name),
  title: title ?? name,
  // Read as work done, which is what the Reports tab sorts by.
  scheduleId: 'work.session',
  at: endedAt,
  body,
  outcome,
});

/** Sessions join Reports like any other run. Only one that wrote a report has anything to open. */
export function sessionReports(root, deleted) {
  const reported = endedSessions(root).map(session => ({ session, body: readReport(root, reportId(session.name), null) }));
  return reported
    .filter(({ session, body }) => body !== null && !deleted.has(reportId(session.name)))
    .map(({ session, body }) => reportOf(session, body));
}

const toldToMainAgent = ({ name, title, said, report, endedAt, userStop }) => ({
  name,
  title: title ?? name,
  endedAt,
  said: userStop
    ? `The user stopped run ${userStop.runId} (${title ?? name}). ${userStop.reason} Do not retry or restart this stopped work unless the user explicitly asks. Partial results are retained.`
    : said || 'It stopped without a report.',
  ...(userStop ? { stopRunId: userStop.runId } : {}),
  report: said ? report : null,
});

/** What the main agent has yet to hear. `said` is what it can repeat, and `report` the file to open for the rest. */
export function sessionsToTell(root) {
  const unheard = endedSessions(root).filter(({ heard }) => !heard).slice(0, MOST_IN_A_NOTE);
  return unheard.map(withWhatItSaid).map(toldToMainAgent);
}

export const markHeard = (root, sessions) => sessions.forEach(({ name }) => append(folderOf(root), { name, heard: true }));

/** Sessions started with `--wake` that have ended, whose starter has not had its turn about them yet. */
export function sessionsToWake(root) {
  const due = endedSessions(root).filter(({ wake, woken }) => wake && !woken).slice(0, MOST_IN_A_NOTE);
  return due.map(withWhatItSaid).map(toldToMainAgent);
}

export const markWoken = (root, sessions) => sessions.forEach(({ name }) => append(folderOf(root), { name, woken: true }));
