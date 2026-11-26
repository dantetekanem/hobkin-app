import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, feedbackEnabled, setFeedback } from '../config.mjs';
import { enrollment, readCredentials } from '../remote/credentials.mjs';
import { sha256Hex } from '../remote/sign.mjs';
import { FEEDBACK_PATH, transportFor } from '../remote/transport.mjs';
import { chatDraft } from './draft.mjs';

const USAGE = 'Usage: hobkin feedback [list | on | off | delete <id>]';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GIVE_UP_MS = 7 * 86400000;
const FIRST_RETRY_MS = 60000;
const LONGEST_RETRY_MS = 3600000;
const KEPT_CRASH_DRAFTS = 3;
const SHOWN_CHARACTERS = 120;

export const outboxFolder = root => join(root, 'feedback', 'outbox');
export const sentFolder = root => join(root, 'feedback', 'sent');
const fileIn = (folder, id) => join(folder, `${id}.json`);
const iso = ms => new Date(ms).toISOString();
const bytesOf = record => Buffer.from(record.body, 'utf8');
const save = (folder, record) => atomicJson(fileIn(folder, record.id), record);

// A file that is not one of these, or was renamed from its report's id, is left alone.
const isReportFile = (record, name) => record?.version === 1
  && ID.test(record.id)
  && name === `${record.id}.json`
  && typeof record.body === 'string';

function readRecords(folder) {
  if (!lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(folder).filter(name => name.endsWith('.json')).flatMap(name => {
    try {
      const record = JSON.parse(readFileSync(join(folder, name), 'utf8'));
      return isReportFile(record, name) ? [record] : [];
    } catch {
      return [];
    }
  });
}

/** The one shape of a report on this machine: its exact bytes, and the yes they were given, if any. */
const outboxRecord = ({ id, kind, body, createdAt, approvedSha256 = null, approvedAt = null, nextAttemptAt = null }) => ({
  version: 1,
  id,
  kind,
  createdAt,
  body,
  approvedSha256,
  approvedAt,
  attempts: 0,
  nextAttemptAt,
  error: null,
});

/** A yes counts only while the bytes are the ones it was given, so an edit leaves the report void and it never goes. */
function stateOf(record) {
  if (record.receipt) return 'sent';
  if (record.error) return 'refused';
  if (!record.approvedSha256) return 'draft';
  return record.approvedSha256 === sha256Hex(bytesOf(record)) ? 'waiting' : 'void';
}

const SAID = {
  sent: ({ id, receipt }) => `Sent. The server keeps it as ${receipt.id}, and hobkin feedback delete ${id} takes it back.`,
  waiting: () => 'Saved. The server did not take it yet, so hobkin tries again later. hobkin feedback list shows it.',
  refused: ({ id, reason }) => `The server refused it: ${reason}. hobkin feedback delete ${id} removes the copy here.`,
  void: () => 'The draft changed after you saw it, so nothing was sent.',
  off: () => 'Feedback is off, so nothing was sent. hobkin feedback on turns it back on.',
  not_enrolled: () => "This machine is not enrolled with hobkin's server, so nothing was sent.",
};
const outcome = (state, facts) => ({
  ok: state === 'sent',
  state,
  id: facts.id,
  ...(facts.receipt ? { receipt: facts.receipt } : {}),
  message: SAID[state](facts),
});

const receiptOf = (json, id) => ({
  id: json?.id ?? null,
  client_report_id: json?.client_report_id ?? id,
  status: json?.status ?? 'received',
  received_at: json?.received_at ?? null,
  expires_at: json?.expires_at ?? null,
});

function markSent(root, record, json, now) {
  const receipt = receiptOf(json, record.id);
  save(sentFolder(root), { ...record, nextAttemptAt: null, sentAt: iso(now()), receipt });
  rmSync(fileIn(outboxFolder(root), record.id), { force: true });
  return outcome('sent', { id: record.id, receipt });
}

function markWaiting(root, record, answer, now) {
  const attempts = record.attempts + 1;
  const backoff = Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** (attempts - 1));
  save(outboxFolder(root), {
    ...record,
    attempts,
    nextAttemptAt: iso(now() + Math.max(answer.retryAfterMs ?? 0, backoff)),
    lastError: { status: answer.status, code: answer.code },
  });
  return outcome('waiting', { id: record.id });
}

function markRefused(root, record, answer) {
  save(outboxFolder(root), {
    ...record,
    nextAttemptAt: null,
    error: { status: answer.status, code: answer.code },
  });
  return outcome('refused', { id: record.id, reason: answer.message });
}

async function deliver(root, record, transport, now) {
  const answer = await transport.request({
    method: 'POST',
    path: FEEDBACK_PATH,
    body: bytesOf(record),
    idempotencyKey: record.id,
  });
  if (answer.ok) return markSent(root, record, answer.json, now);
  return answer.retryable ? markWaiting(root, record, answer, now) : markRefused(root, record, answer);
}

/** A Chat draft, made only where it could go: with feedback on and this machine enrolled. Nothing is written yet. */
export function draftFromChat(root, words, { now = Date.now } = {}) {
  if (!feedbackEnabled(root)) throw Error('Feedback is off, so nothing can be sent. hobkin feedback on turns it back on.');
  if (!readCredentials(root)) throw Error("This machine is not enrolled with hobkin's server, so feedback cannot be sent.");
  return chatDraft(words, { now: now() });
}

function reportFor(body, id) {
  try {
    const report = JSON.parse(body);
    return report.id === id && ID.test(id) ? report : null;
  } catch {
    return null;
  }
}

/**
 * The user said yes to these exact bytes and this SHA-256. Anything else is refused, and nothing is saved before the
 * yes. The report waits in the outbox while it goes, and while it is in flight a pass leaves it alone.
 */
export async function sendApproved(root, { id, body, sha256 }, options = {}) {
  const now = options.now ?? Date.now;
  if (!feedbackEnabled(root)) return outcome('off', { id });

  const shownBytes = typeof body === 'string' && sha256Hex(Buffer.from(body, 'utf8')) === sha256;
  const report = shownBytes ? reportFor(body, id) : null;
  if (!report) return outcome('void', { id });

  const transport = transportFor(root, options);
  if (!transport) return outcome('not_enrolled', { id });

  const approvedAt = now();
  const kept = readRecords(outboxFolder(root)).find(record => record.id === id);
  const record = outboxRecord({
    id,
    kind: report.kind,
    body,
    createdAt: kept?.createdAt ?? iso(approvedAt),
    approvedSha256: sha256,
    approvedAt: iso(approvedAt),
    nextAttemptAt: iso(approvedAt + FIRST_RETRY_MS),
  });
  save(outboxFolder(root), record);
  return deliver(root, record, transport, now);
}

const isDue = (record, now) => !record.nextAttemptAt || Date.parse(record.nextAttemptAt) <= now;

/** What the user said yes to and the server has not taken yet, each when it is due. Off stops all of it, even mid-pass. */
export async function deliverFeedback(root, options = {}) {
  const now = options.now ?? Date.now;
  if (!feedbackEnabled(root)) return [];
  const due = readRecords(outboxFolder(root)).filter(record => stateOf(record) === 'waiting' && isDue(record, now()));
  const transport = due.length ? transportFor(root, options) : null;
  if (!transport) return [];
  const results = [];
  for (const record of due) {
    if (!feedbackEnabled(root)) break;

    const expired = now() - Date.parse(record.approvedAt) > GIVE_UP_MS;
    if (expired) results.push(markRefused(root, record, { status: 0, code: 'expired', message: 'it waited seven days without reaching the server' }));
    else results.push(await deliver(root, record, transport, now));
  }
  return results;
}

function summary(record) {
  const state = stateOf(record);
  let message = '';
  try {
    message = String(JSON.parse(record.body).message ?? '');
  } catch {
    // A report that no longer parses still lists, so it can be deleted.
  }
  return {
    id: record.id,
    kind: record.kind,
    state,
    at: record.createdAt,
    message: message.length > SHOWN_CHARACTERS ? `${message.slice(0, SHOWN_CHARACTERS - 1)}…` : message,
    ...(record.attempts ? { attempts: record.attempts } : {}),
    ...(state === 'waiting' ? { nextAttemptAt: record.nextAttemptAt } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.receipt ? { serverId: record.receipt.id, sentAt: record.sentAt, expiresAt: record.receipt.expires_at } : {}),
  };
}

/** Every report on this machine, newest first: drafts, what waits, what was refused and what was sent, with its receipt. */
export function listFeedback(root) {
  const sent = readRecords(sentFolder(root));
  const sentIds = new Set(sent.map(({ id }) => id));
  const reports = [...readRecords(outboxFolder(root)).filter(({ id }) => !sentIds.has(id)), ...sent]
    .map(summary)
    .toSorted((left, right) => String(right.at).localeCompare(String(left.at)));
  return { feedback: feedbackEnabled(root) ? 'on' : 'off', enrolled: enrollment(root).enrolled, reports };
}

/** Off the server first, with a signed request, then off this machine. A server that cannot be reached keeps both copies. */
export async function deleteFeedback(root, id, options = {}) {
  const local = readRecords(outboxFolder(root)).find(record => record.id === id);
  const sent = readRecords(sentFolder(root)).find(record => record.id === id || record.receipt?.id === id);
  if (!local && !sent) throw Error(`No feedback has the ID ${String(id).slice(0, 64)}. Run hobkin feedback list to see them.`);
  if (!sent) {
    rmSync(fileIn(outboxFolder(root), local.id), { force: true });
    return { deleted: local.id, from: ['this machine'], message: 'Deleted. It never reached the server.' };
  }
  if (!ID.test(sent.receipt?.id ?? '')) throw Error('The server gave no receipt ID for it, so its copy there cannot be deleted from here.');
  const transport = transportFor(root, options);
  if (!transport) throw Error("This machine is not enrolled any more, so the server's copy cannot be deleted from here.");
  const answer = await transport.request({ method: 'DELETE', path: `${FEEDBACK_PATH}/${sent.receipt.id}` });
  const serverHadNone = answer.status === 404;
  if (!answer.ok && !serverHadNone) throw Error(`The server could not delete it: ${answer.message}. Nothing was removed here, so try again later.`);

  rmSync(fileIn(sentFolder(root), sent.id), { force: true });
  rmSync(fileIn(outboxFolder(root), sent.id), { force: true });
  if (serverHadNone) {
    return { deleted: sent.id, from: ['this machine'], message: 'Deleted from this machine. The server had no copy for this installation.' };
  }
  return { deleted: sent.id, from: ['the server', 'this machine'], message: 'Deleted from the server and from this machine.' };
}

const newestCrashDrafts = root => readRecords(outboxFolder(root))
  .filter(record => record.kind === 'crash' && stateOf(record) === 'draft')
  .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));

/** A crash draft waits for the user's yes at the next start. Only the newest few stay, so a crash loop cannot pile them up. */
export function saveCrashDraft(root, draft, now) {
  save(outboxFolder(root), outboxRecord({ id: draft.id, kind: 'crash', body: draft.body, createdAt: iso(now) }));
  for (const old of newestCrashDrafts(root).slice(KEPT_CRASH_DRAFTS)) rmSync(fileIn(outboxFolder(root), old.id), { force: true });
}

/** The newest crash draft, as the exact bytes to show, when it could be sent at all. */
export function crashToOffer(root) {
  if (!feedbackEnabled(root) || !enrollment(root).enrolled) return null;
  const [newest] = newestCrashDrafts(root);
  return newest ? { id: newest.id, kind: 'crash', body: newest.body, sha256: sha256Hex(bytesOf(newest)) } : null;
}

export const discardDraft = (root, id) => rmSync(fileIn(outboxFolder(root), id), { force: true });

const SETTING_SAID = {
  on: 'Feedback is on. A report still goes only after you say yes to exactly what it sends.',
  off: 'Feedback is off. Nothing goes to the server, not even what waits in the outbox. hobkin feedback on turns it back on.',
};

export async function runFeedbackCommand(root, [action = 'list', target, ...extra] = [], options = {}) {
  if (extra.length) throw Error(USAGE);
  if (action === 'list' && target === undefined) return listFeedback(root);
  if ((action === 'on' || action === 'off') && target === undefined) {
    setFeedback(root, action === 'on');
    return { feedback: action, message: SETTING_SAID[action] };
  }
  if (action === 'delete' && target) return deleteFeedback(root, target, options);
  throw Error(USAGE);
}
