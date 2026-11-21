import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const reportText = value => String(value ?? '')
  .replace(/<!--\s*hobkin-(?:publication|question):[\s\S]*?(?:-->|$)/gi, '')
  .trim();

export const runOutcomeText = run => run.result?.text || run.result?.error || run.error || '';

// Background reports open with a triage line (prompts/background.md).
const nothingNewLine = /^(?:\*\*)?nothing new\.?(?:\*\*)?$/i;
const talkBackLine = /^(?:\*\*)?(critical|useful|blocked)(?:\*\*)?:(?:\*\*)?\s+(.+)$/i;
const nextLine = /^(?:\*\*)?next(?:\*\*)?:(?:\*\*)?\s+(.+)$/i;
const LONGEST_NEXT = 300;
const withoutBold = text => text.replace(/\*\*$/, '').trim();

export const reportTriage = run => {
  if (run.status !== 'completed') return null;
  const [firstLine, ...rest] = String(run.result?.text ?? '').trim().split('\n').map(line => line.trim());
  if (nothingNewLine.test(firstLine)) return { level: 'nothing' };

  const match = firstLine.match(talkBackLine);
  if (!match) return null;
  const next = rest.find(Boolean)?.match(nextLine)?.[1];
  return {
    level: match[1].toLowerCase(),
    message: withoutBold(match[2]).slice(0, 1024),
    ...(next ? { next: withoutBold(next).slice(0, LONGEST_NEXT) } : {}),
  };
};

/** A run nobody asked for that found nothing new. Its receipt and log line stay, but no report is kept or shown. */
export const isQuietRun = run => run.trigger !== 'manual' && reportTriage(run)?.level === 'nothing';

// `Useful:` marks an ordinary report for hobkin and tells a reader nothing, so a report shown on screen starts at its point. The saved text keeps the word.
const usefulWord = /^\s*useful:[ \t]+/i;
export const readerText = text => String(text ?? '').replace(usefulWord, '');

const reportPath = (root, id) => join(root, 'reports', `${createHash('sha256').update(String(id)).digest('hex')}.md`);
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

export function readReport(root, id, fallback) {
  reportDirectory(root);
  const file = reportPath(root, id);
  const stat = statOrMissing(file);
  if (!stat) return fallback;
  if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 16777216) throw Error('Saved report must be a private bounded regular file.');
  return readFileSync(file, 'utf8');
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
