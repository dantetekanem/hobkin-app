import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { crashedInCodeTool } from './code-tool-crash.mjs';

export const reportText = value => String(value ?? '')
  .replace(/<!--\s*hobkin-(?:publication|question):[\s\S]*?(?:-->|$)/gi, '')
  .trim();

export const reportNoticeId = runId => `notice:report:${createHash('sha256').update(String(runId)).digest('hex')}`;

// Only a completed assistant reply with visible words can carry this private receipt.
export function splitReportCoverage(text, message) {
  const trailer = message.role === 'assistant' && message.stopReason === 'stop'
    && /\n<!-- hobkin-covered: (notice:report:[a-f0-9]{64}(?: notice:report:[a-f0-9]{64})*) -->\s*$/.exec(text);
  if (!trailer || !text.slice(0, trailer.index).trim()) return { text };
  return { text: text.slice(0, trailer.index), coveredReports: trailer[1].split(' ') };
}

export const runOutcomeText = run => run.result?.text || run.result?.error || run.error || '';

const RESTARTED = 'Pi crashed in its code tool, and hobkin restarted it.';

/** A raw error, collapsed under "Error details". Its fence is longer than any run of backticks in it, so it stays whole. */
export function errorDetails(raw) {
  const text = String(raw).trim();
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(([run]) => run.length + 1)));
  return `<details><summary>Error details</summary>\n\n${fence}text\n${text}\n${fence}\n\n</details>`;
}

/** What went wrong, in a few words: what the crash was, or the first sentence of the error before its stack. */
function failureLine(error) {
  if (crashedInCodeTool(error)) return 'Pi crashed in its code tool';
  const line = String(error ?? '').split('\n').map(part => part.trim()).find(part => part && !part.startsWith('at ')) ?? '';
  return line.split(/(?<=\.)\s/)[0].replace(/\.$/, '').slice(0, 200) || 'it gave no reason';
}

/**
 * The report a finished run saves. A failed run's opens with one plain sentence of what happened, then what it wrote
 * before it failed, then its raw error collapsed when there is more of it than that sentence says. A run hobkin
 * restarted after Pi crashed in its code tool (`code-tool-crash.mjs`) says so: first when it failed again, last when it
 * finished, so its own first line still leads.
 */
export function runReport(result) {
  if (result.status === 'failed') {
    const line = failureLine(result.error);
    const opening = result.restarted ? `${RESTARTED} The restarted run failed: ${line}.` : `The run failed: ${line}.`;
    const raw = [result.restarted?.error, result.error].filter(Boolean).join('\n\n').trim();
    return [opening, result.text?.trim(), raw && raw !== line && raw !== `${line}.` && errorDetails(raw)].filter(Boolean).join('\n\n');
  }
  const report = result.text || result.error || 'No result text.';
  const failure = result.text && result.error ? `\n\n---\n\n**Execution failure:** ${result.error}` : '';
  const restarted = result.restarted ? `\n\n---\n\n${RESTARTED}\n\n${errorDetails(result.restarted.error)}` : '';
  return `${report}${failure}${restarted}`;
}

// Background reports open with a triage line (prompts/background.md). The nothing-new line's period may sit inside its bold or after it.
const nothingNewLine = /^(?:\*\*)?nothing new\.?(?:\*\*)?\.?$/i;
const talkBackLine = /^(?:\*\*)?(critical|useful|blocked)(?:\*\*)?:(?:\*\*)?\s+(.+)$/i;
const nextLine = /^(?:\*\*)?next(?:\*\*)?:(?:\*\*)?\s+(.+)$/i;
const LONGEST_NEXT = 300;
const withoutBold = text => text.replace(/\*\*$/, '').trim();

/** The text's lines one at a time, each trimmed, so a reader that needs the first two never cuts up a long report. */
function* trimmedLines(text) {
  for (let start = 0; start <= text.length;) {
    const end = text.indexOf('\n', start);
    const stop = end === -1 ? text.length : end;
    yield text.slice(start, stop).trim();
    start = stop + 1;
  }
}

const firstLineAfter = lines => {
  for (const line of lines) if (line) return line;
  return undefined;
};

export const reportTriage = run => {
  if (run.status !== 'completed') return null;
  const lines = trimmedLines(String(run.result?.text ?? '').trim());
  const firstLine = lines.next().value;
  if (nothingNewLine.test(firstLine)) return { level: 'nothing' };

  const match = firstLine.match(talkBackLine);
  if (!match) return null;
  const next = firstLineAfter(lines)?.match(nextLine)?.[1];
  return {
    level: match[1].toLowerCase(),
    message: withoutBold(match[2]).slice(0, 1024),
    ...(next ? { next: withoutBold(next).slice(0, LONGEST_NEXT) } : {}),
  };
};

// A run that failed, stopped short or was stopped says so, whatever its first line reads.
const wentWrong = new Set(['failed', 'incomplete', 'interrupted']);

/**
 * A report that found nothing new: it opens with the triage's nothing-new line, whatever follows it, and its run did not
 * go wrong. It is no report, whoever started the run: nothing keeps, lists, counts or tells it. The window reads a report
 * the same way (`shared/reports/nothing-new.ts`).
 */
export const saysNothingNew = ({ outcome, body }) => {
  if (wentWrong.has(outcome)) return false;
  const firstLine = trimmedLines(String(body ?? '').trim()).next().value;
  return nothingNewLine.test(firstLine);
};

/** A run that found nothing new. Its receipt, log line and counts stay, but no report is kept or shown. */
export const isQuietRun = run => saysNothingNew({ outcome: run.status, body: run.result?.text });

// `Useful:` marks an ordinary report for hobkin and tells a reader nothing, so a report shown on screen starts at its point. The saved text keeps the word.
const usefulWord = /^\s*useful:[ \t]+/i;
export const readerText = text => String(text ?? '').replace(usefulWord, '');

// A report's file is named by a hash of its run's id, and every rebuild asks for every report's, so each name is worked out once.
const reportPaths = new Map();
const reportPath = (root, id) => {
  const key = `${root}\0${id}`;
  if (!reportPaths.has(key)) {
    if (reportPaths.size >= 8192) reportPaths.clear();
    reportPaths.set(key, join(root, 'reports', `${createHash('sha256').update(String(id)).digest('hex')}.md`));
  }
  return reportPaths.get(key);
};
const statOrMissing = file => {
  try { return lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/** Where a report's text is saved, or null when it has none on disk. */
export const savedReportPath = (root, id) => {
  const saved = reportPath(root, id);
  return statOrMissing(saved) ? saved : null;
};

// Well under Runtime's 64 KiB message limit, leaving the user room to write.
const MAX_REFERENCED_BYTES = 24576;
// The old tag still appears in conversations imported from pi-companion.
const referenceBlock = /^<(?:hobkin|companion)-report>\n(.+)\n[\s\S]*?\n<\/(?:hobkin|companion)-report>\n\n/;

/** Puts a report in front of a message. Escaping its closing tag means report text can never end the block early. */
export function referToReport(root, report, text) {
  const bytes = Buffer.from(String(report.body ?? ''));
  const saved = reportPath(root, report.id);
  const details = {
    id: report.id,
    title: report.title,
    at: report.at ?? null,
    path: statOrMissing(saved) ? saved : null,
    truncated: bytes.length > MAX_REFERENCED_BYTES,
  };
  const body = bytes.subarray(0, MAX_REFERENCED_BYTES).toString('utf8').replaceAll('</hobkin-report', '<\\/hobkin-report');
  return `<hobkin-report>\n${JSON.stringify(details)}\n${body}\n</hobkin-report>\n\n${text}`;
}

/** Recovers what the user typed and the title of the report it was about. */
export function splitReportReference(message) {
  const block = message.match(referenceBlock);
  if (!block) return { text: message, about: null };
  try {
    return { text: message.slice(block[0].length), about: JSON.parse(block[1]).title };
  } catch {
    return { text: message, about: null };
  }
}

function reportDirectory(root) {
  const directory = join(root, 'reports');
  const stat = statOrMissing(directory);
  if (stat && (!stat.isDirectory() || (stat.mode & 0o077))) throw Error('Reports directory must be a private directory.');
  return directory;
}

export function writePrivate(file, body) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return file;
}

export function saveReport(root, id, body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 16777216) throw Error('Report must be bounded Markdown text.');
  mkdirSync(reportDirectory(root), { recursive: true, mode: 0o700 });
  return writePrivate(reportPath(root, id), body);
}

// A report's short version sits beside it (051-short-reports), small enough to read whole.
const shortReportPath = (root, id) => reportPath(root, id).replace(/\.md$/, '.short.md');
const MOST_SHORT_BYTES = 65536;

export function saveShortReport(root, id, text) {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > MOST_SHORT_BYTES) throw Error('A short report must be bounded Markdown text.');
  mkdirSync(reportDirectory(root), { recursive: true, mode: 0o700 });
  return writePrivate(shortReportPath(root, id), text);
}

/** The report's short version, or null when it has none. One that cannot be read, or is not a private bounded file, counts as none. */
export function readShortReport(root, id) {
  try {
    reportDirectory(root);
    const file = shortReportPath(root, id);
    const stat = statOrMissing(file);
    if (!stat || !stat.isFile() || (stat.mode & 0o077) || stat.size > MOST_SHORT_BYTES) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Each refresh lists every report and most never change again, so a body is read again only once its file is another or has changed.
const readBodies = new Map();
const MOST_KEPT_BYTES = 64 * 1024 * 1024;
let keptBytes = 0;

function keepBody(file, stat, body) {
  keptBytes -= readBodies.get(file)?.body.length ?? 0;
  readBodies.delete(file);
  if (body.length > MOST_KEPT_BYTES) return;
  readBodies.set(file, { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, body });
  keptBytes += body.length;
  for (const [oldest, { body: dropped }] of readBodies) {
    if (keptBytes <= MOST_KEPT_BYTES) break;
    readBodies.delete(oldest);
    keptBytes -= dropped.length;
  }
}

export function readReport(root, id, fallback) {
  reportDirectory(root);
  const file = reportPath(root, id);
  const stat = statOrMissing(file);
  if (!stat) return fallback;
  if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 16777216) throw Error('Saved report must be a private bounded regular file.');
  const kept = readBodies.get(file);
  if (kept && kept.ino === stat.ino && kept.size === stat.size && kept.mtimeMs === stat.mtimeMs) return kept.body;
  const body = readFileSync(file, 'utf8');
  keepBody(file, stat, body);
  return body;
}

/** Removes a report hobkin replaced with a newer one of its own, and its short version. The user's deleted list stays as it is. */
export function dropReport(root, id) {
  rmSync(reportPath(root, id), { force: true });
  rmSync(shortReportPath(root, id), { force: true });
}

const deletedPath = root => join(root, 'runtime', 'deleted-reports.json');

/** Deleted report IDs hide reports from every inventory source; run receipts stay to prevent replays. */
export function deletedReportIds(root) {
  const file = deletedPath(root);
  const stat = statOrMissing(file);
  if (!stat) return new Set();
  if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 16777216) throw Error('Deleted reports must be a private bounded regular file.');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (saved?.version !== 1 || !Array.isArray(saved.ids) || saved.ids.some(id => typeof id !== 'string' || !id)) {
    throw Error('Invalid deleted report list.');
  }
  return new Set(saved.ids);
}

export function deleteReports(root, ids) {
  const deleted = deletedReportIds(root);
  for (const id of ids) {
    deleted.add(id);
    rmSync(reportPath(root, id), { force: true });
    rmSync(shortReportPath(root, id), { force: true });
  }
  mkdirSync(join(root, 'runtime'), { recursive: true, mode: 0o700 });
  writePrivate(deletedPath(root), `${JSON.stringify({ version: 1, ids: [...deleted] }, null, 2)}\n`);
  return deleted;
}
