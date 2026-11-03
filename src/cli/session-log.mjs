import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readReport, saveReport } from './reports.mjs';

const LOG = 'sessions.jsonl';
const MOST_READ_BYTES = 1048576;
const LONGEST_LINE = 280;
const LINES_SAID = 2;
// The Reports list holds 200, so older sessions have no place in it.
const MOST_REPORTS = 200;
// Well under what a message can carry, and the rest go with the next one.
const MOST_IN_A_NOTE = 10;

const folderOf = root => join(root, 'runtime', 'handoffs');
const reportId = name => `session:${name}`;

function append(folder, event) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  appendFileSync(join(folder, LOG), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

/** The title has to outlive the command that started the session, and its follower only knows the name. */
export const recordSessionStart = (root, { name, title, report, wake }, now = Date.now()) => append(folderOf(root), { name, title, report, ...(wake ? { wake } : {}), startedAt: new Date(now).toISOString() });

/** Written by the follower, which runs in a process of its own and can outlive hobkin. A session's report sits beside this log. */
export const recordSessionEnd = ({ name, report }, now = Date.now()) => append(dirname(report), { name, report, endedAt: new Date(now).toISOString() });

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

const reportOf = ({ name, title, endedAt }, body) => ({
  id: reportId(name),
  title: title ?? name,
  // Read as work done, which is what the Reports tab sorts by.
  scheduleId: 'work.session',
  at: endedAt,
  body,
  outcome: 'completed',
});

/** Sessions join Reports like any other run. Only one that wrote a report has anything to open. */
export function sessionReports(root, deleted) {
  const reported = endedSessions(root).slice(-MOST_REPORTS).map(session => ({ session, body: readReport(root, reportId(session.name), null) }));
  return reported
    .filter(({ session, body }) => body !== null && !deleted.has(reportId(session.name)))
    .map(({ session, body }) => reportOf(session, body));
}

const toldToMainAgent = ({ name, title, said, report, endedAt }) => ({
  name,
  title: title ?? name,
  endedAt,
  said: said || 'It stopped without a report.',
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
