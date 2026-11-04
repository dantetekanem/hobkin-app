import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, setTelemetryUpload, telemetryUploadEnabled } from '../config.mjs';
import { eventsFolder } from '../events.mjs';
import { deliverFeedback } from '../feedback/outbox.mjs';
import { enrollment } from '../remote/credentials.mjs';
import { TELEMETRY_PATH, transportFor } from '../remote/transport.mjs';
import { HOBKIN_VERSION } from '../version.mjs';
import { TRANSPORT_TYPES, transportEvent, transportId } from './events.mjs';

export const UPLOAD_USAGE = 'Usage: hobkin telemetry [--days n] | hobkin telemetry upload [on | off | status]';
const LOOK_MS = 60000;
const MAX_EVENTS = 100;
const MAX_BYTES = 262144;
const READ_BYTES = 1048576;
// An hour inside the server's seven days, so a batch cannot age out while it waits for another try.
const OLDEST_MS = 7 * 86400000 - 3600000;
const AHEAD_MS = 300000;
const FIRST_RETRY_MS = 60000;
const LONGEST_RETRY_MS = 3600000;
const MONTH_FILE = /^\d{4}-\d{2}\.jsonl$/;

const stateFile = root => join(root, 'telemetry', 'state.json');
const iso = ms => new Date(ms).toISOString();
const monthOf = ms => `${iso(ms).slice(0, 7)}.jsonl`;
const uploading = root => telemetryUploadEnabled(root) && enrollment(root).enrolled;

function readState(root) {
  try {
    const state = JSON.parse(readFileSync(stateFile(root), 'utf8'));
    return state?.version === 1 ? state : { version: 1 };
  } catch {
    return { version: 1 };
  }
}

const writeState = (root, state) => atomicJson(stateFile(root), state);

function monthFiles(root) {
  const folder = eventsFolder(root);
  return lstatSync(folder, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(folder).filter(name => MONTH_FILE.test(name)).sort() : [];
}

function readFrom(file, start) {
  let fd;
  try {
    fd = openSync(file, 'r');
  } catch {
    return Buffer.alloc(0);
  }
  try {
    const buffer = Buffer.alloc(Math.max(0, Math.min(READ_BYTES, fstatSync(fd).size - start)));
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, start));
  } finally {
    closeSync(fd);
  }
}

/** The end of the local event stream as it is now, which is where upload begins, so nothing recorded before ever goes. */
function streamEnd(root, now) {
  const file = monthFiles(root).at(-1) ?? monthOf(now);
  const size = lstatSync(join(eventsFolder(root), file), { throwIfNoEntry: false })?.size ?? 0;
  return { file, offset: size };
}

/** Every complete line the stream gained after the cursor, with where it ends. A line still being written waits. */
function linesAfter(root, cursor) {
  const lines = [];
  for (const file of monthFiles(root).filter(name => name >= cursor.file)) {
    const from = file === cursor.file ? cursor.offset : 0;
    const bytes = readFrom(join(eventsFolder(root), file), from);
    let start = 0;
    for (let newline = bytes.indexOf(10); newline !== -1; newline = bytes.indexOf(10, start)) {
      lines.push({
        file,
        start: from + start,
        end: from + newline + 1,
        text: bytes.subarray(start, newline).toString('utf8'),
      });
      start = newline + 1;
    }
  }
  return lines;
}

function transportOf(line, state, now) {
  let local;
  try {
    local = JSON.parse(line.text);
  } catch {
    return null;
  }

  const idFor = (namespace, value) => transportId(state.salt, namespace, value);
  const event = transportEvent(local, { eventId: idFor('event', `${line.file}:${line.start}`), idFor });
  const at = event ? Date.parse(event.occurred_at) : NaN;
  const takenByTheServer = at >= now - OLDEST_MS && at <= now + AHEAD_MS;
  return takenByTheServer ? event : null;
}

const batchBody = (id, events) => JSON.stringify({ schema_version: 1, batch_id: id, app_version: HOBKIN_VERSION, events });

/**
 * The next batch from what the stream gained: at most 100 events and 256 KiB, each a new transport event. The cursor
 * moves past lines the catalog has no event for, and past this batch's lines only once the server takes them.
 */
function nextBatch(root, state, now) {
  const id = randomUUID();
  const events = [];
  let cursor = state.cursor;

  for (const line of linesAfter(root, state.cursor)) {
    const event = transportOf(line, state, now);
    const full = event && (events.length === MAX_EVENTS || Buffer.byteLength(batchBody(id, [...events, event])) > MAX_BYTES);
    if (full) break;

    if (event && !events.some(({ event_id }) => event_id === event.event_id)) events.push(event);
    cursor = { file: line.file, offset: line.end };
  }

  const batch = events.length ? {
    id,
    body: batchBody(id, events),
    events: events.length,
    cursor,
    createdAt: iso(now),
    attempts: 0,
    nextAttemptAt: null,
  } : null;
  return { batch, cursor };
}

/** Off, or without credentials, hobkin forgets where it was and what waited, so nothing from then ever goes. */
function forget(root) {
  if (!existsSync(stateFile(root))) return;
  const { toldAt, cursor, batch, salt } = readState(root);
  if (cursor || batch || salt) writeState(root, { version: 1, ...(toldAt ? { toldAt } : {}) });
}

function begin(root, state, now) {
  writeState(root, {
    ...state,
    salt: state.salt ?? randomBytes(32).toString('hex'),
    cursor: streamEnd(root, now),
  });
}

function settle(root, batch, answer, now) {
  const latest = readState(root);
  // Turned off meanwhile: what waited is gone, and stays gone.
  if (latest.batch?.id !== batch.id) return { sent: 0 };

  if (answer.ok) {
    writeState(root, { ...latest, cursor: batch.cursor, batch: null, lastSentAt: iso(now), lastError: null });
    return { sent: batch.events };
  }

  const lastError = { status: answer.status, code: answer.code, at: iso(now) };
  const worthAnotherTry = answer.retryable && now - Date.parse(batch.createdAt) < OLDEST_MS;
  if (worthAnotherTry) {
    const attempts = batch.attempts + 1;
    const backoff = Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** (attempts - 1));
    const nextAttemptAt = iso(now + Math.max(answer.retryAfterMs ?? 0, backoff));
    writeState(root, { ...latest, batch: { ...batch, attempts, nextAttemptAt }, lastError });
  } else {
    // A refused batch never becomes acceptable as the same bytes, so its events are dropped and the stream moves on.
    writeState(root, { ...latest, cursor: batch.cursor, batch: null, lastError });
  }
  return { sent: 0 };
}

/**
 * One pass of usage upload. The batch still waiting goes again with its exact bytes and batch id, or the next one is
 * made from what the local stream gained and saved before it goes. Raw lines, the rollup and local ids never leave.
 */
export async function sendTelemetry(root, options = {}) {
  const now = options.now ?? Date.now;
  if (!uploading(root)) {
    forget(root);
    return { sent: 0 };
  }
  const state = readState(root);
  if (!state.cursor || !state.salt) {
    begin(root, state, now());
    return { sent: 0 };
  }

  let { batch } = state;
  if (!batch) {
    const next = nextBatch(root, state, now());
    batch = next.batch;
    if (batch) writeState(root, { ...state, batch });
    else if (next.cursor !== state.cursor) writeState(root, { ...state, cursor: next.cursor });
  }
  const notDueYet = batch?.nextAttemptAt && Date.parse(batch.nextAttemptAt) > now();
  if (!batch || notDueYet) return { sent: 0 };

  const transport = transportFor(root, options);
  if (!transport) return { sent: 0 };
  const answer = await transport.request({
    method: 'POST',
    path: TELEMETRY_PATH,
    body: Buffer.from(batch.body, 'utf8'),
    idempotencyKey: batch.id,
  });
  return settle(root, batch, answer, now());
}

function statusLine(on, enrolled, sendsTo) {
  if (!on) return 'Upload is off. No usage events leave this machine. hobkin telemetry upload on turns it back on.';
  if (!enrolled) return "Upload is on, but this machine is not enrolled with hobkin's server, so nothing is sent.";
  return `hobkin sends usage events to ${sendsTo}: which parts were used and how runs, questions and decisions ended, with fresh random ids, never what you type, your reports, your names or your paths. hobkin telemetry upload off stops it.`;
}

/** What goes, where, and how to stop it, for a person and for an agent. It holds no credential. */
export function uploadStatus(root) {
  const on = telemetryUploadEnabled(root);
  const { enrolled, sendsTo, problem } = enrollment(root);
  const { batch, lastSentAt = null, lastError = null } = readState(root);
  return {
    upload: on ? 'on' : 'off',
    enrolled,
    ...(sendsTo ? { sendsTo } : {}),
    ...(problem ? { problem } : {}),
    events: TRANSPORT_TYPES,
    waiting: batch ? {
      events: batch.events,
      attempts: batch.attempts,
      nextAttemptAt: batch.nextAttemptAt,
    } : null,
    lastSentAt,
    lastError,
    message: statusLine(on, enrolled, sendsTo),
  };
}

const SETTING_SAID = {
  on: "Upload is on. Usage events go to hobkin's server from now on, once this machine is enrolled. hobkin telemetry upload status says what goes.",
  off: 'Upload is off. No usage events leave this machine, and what was waiting was dropped. hobkin telemetry upload on turns it back on.',
};

export function runUploadCommand(root, [action = 'status', ...extra] = []) {
  if (extra.length) throw Error(UPLOAD_USAGE);
  if (action === 'status') return uploadStatus(root);
  if (action !== 'on' && action !== 'off') throw Error(UPLOAD_USAGE);
  setTelemetryUpload(root, action === 'on');
  if (action === 'off') forget(root);
  return { upload: action, message: SETTING_SAID[action] };
}

/** Said once in Chat, the first time a data folder uploads: what goes, to where, and how to stop it. */
export function uploadNotice(root, now) {
  try {
    const { enrolled, sendsTo } = enrollment(root);
    const state = readState(root);
    if (!telemetryUploadEnabled(root) || !enrolled || state.toldAt) return null;
    const at = iso(now);
    writeState(root, { ...state, toldAt: at });
    const content = `hobkin now sends usage events to ${sendsTo}: which parts were used and how runs ended, never what you type, your reports or your paths. hobkin telemetry upload off stops it, and status says what goes.`;
    return { id: `notice:telemetry-upload:${at}`, role: 'notice', content, tone: 'useful', at };
  } catch {
    return null;
  }
}

/**
 * Everything bound for hobkin's server leaves from here: usage events, and feedback the user said yes to. A tick never
 * waits for the server. One pass runs at a time, at most once a minute, and what fails waits for a later pass.
 */
export class RemoteSender {
  nextLookAt = -Infinity;
  busy = null;

  constructor({ root, fetch, now = Date.now, sleep }) {
    this.root = root;
    this.now = now;
    this.options = { fetch, now, sleep };
    try {
      const state = readState(root);
      if (uploading(root) && !state.cursor) begin(root, state, now());
    } catch {
      // Upload begins on the first pass instead.
    }
  }

  tick() {
    if (this.busy || this.now() < this.nextLookAt) return;
    this.nextLookAt = this.now() + LOOK_MS;
    void this.pass();
  }

  /** A pass asked for while one runs gets that one, so two never send the same batch at once. */
  pass() {
    this.busy ??= Promise.allSettled([sendTelemetry(this.root, this.options), deliverFeedback(this.root, this.options)])
      .finally(() => { this.busy = null; });
    return this.busy;
  }
}
