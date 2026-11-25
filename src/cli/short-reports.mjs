import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, loadConfig } from './config.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { fixedParts } from './report-editor.mjs';
import { deletedReportIds, readerText, readShortReport, saveShortReport } from './reports.mjs';
import { tierBinding } from './tiers.mjs';

/**
 * Short reports (051-short-reports). While the user's switch is on, each new report gets a short version: about 100
 * words that read in under 30 seconds, with the point first. hobkin writes it in the background on its fast tier, after
 * the report is saved, and keeps it beside the report. The report itself is saved and shown as before, and anything
 * that goes wrong leaves it with no short version.
 */

// A report this short is already its own short version.
const SHORT_WORDS = 100;
// An answer longer than this is not a short version.
const MOST_WORDS = 130;
const MOST_PROMPT_BYTES = 65536;
// A short version nobody waits for still should not hold a model for long.
const TIME_LIMIT_MS = 180000;

// One label before the point, such as `TL;DR:` or `**Useful:**`, which a short version is told not to write.
const LEAD_IN = /^(?:\*\*|__)?[\p{L}][\p{L}'’;]*(?: [\p{L}'’;]+){0,3}(?:\*\*|__)?\s*:(?:\*\*|__)?\s+/u;
const FENCED = /^```[^\n]*\n([\s\S]*?)\n?```$/;

const wordCount = text => text.split(/\s+/).filter(Boolean).length;
const longerThan = (text, words) => {
  let count = 0;
  for (const _ of text.matchAll(/\S+/g)) if (++count > words) return true;
  return false;
};

/** The switch as it stands, read each time from config.json. A home that never set it, or a config that cannot be read, has it off. */
export function readShortReports(root) {
  try {
    const { enabled, since } = loadConfig(root).shortReports ?? {};
    if (enabled === true && typeof since === 'string' && Number.isFinite(Date.parse(since))) return { on: true, since };
  } catch {
    // Unreadable just now: off, and the next pass reads it again.
  }
  return { on: false, since: null };
}

/** The user's word on short reports. Turning it on counts from now, and turning it on again keeps the time it was first turned on. */
export function setShortReports(root, on, now = Date.now()) {
  if (typeof on !== 'boolean') throw Error('Short reports are on or off.');
  const before = readShortReports(root);
  const shortReports = on ? { enabled: true, since: before.on ? before.since : new Date(now).toISOString() } : { enabled: false };
  atomicJson(join(resolveDataRoot(root), 'config.json'), { ...loadConfig(root), shortReports });
  return { on };
}

/**
 * The model's answer as a short version, or null when it is not one: empty, over 130 words, or carrying a number, link
 * or piece of code the report does not have. A short version may leave facts out, never bring one in.
 */
export function checkedShort(body, answer) {
  let text = String(answer ?? '').trim();
  const fenced = text.match(FENCED);
  if (fenced) text = fenced[1].trim();
  text = text.replace(LEAD_IN, '').trim();
  if (!text || wordCount(text) > MOST_WORDS) return null;
  return fixedParts(text).every(part => body.includes(part)) ? text : null;
}

/** The fast tier as hobkin runs it now: its own model, or the checks model it follows. Null when there is no Pi model to ask. */
export function fastBinding(root) {
  const config = loadConfig(root);
  const { model, effort, follows } = tierBinding(config, 'fast');
  if (!model || (follows === 'background' && (config.background.harness ?? 'pi') !== 'pi')) return null;
  return { harness: 'pi', model, effort };
}

/** One job with no tools, as the report editor runs, that answers with the short version. Null for anything but a usable one. */
export async function makeShortReport(body, { root, binding, runHarness, signal, timeLimitMs = TIME_LIMIT_MS }) {
  if (signal?.aborted) return null;
  try {
    const jobs = join(root, 'jobs');
    mkdirSync(jobs, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const limit = AbortSignal.timeout(timeLimitMs);
    // A long report is read from its start, where its point is.
    const prompt = Buffer.byteLength(body) > MOST_PROMPT_BYTES ? Buffer.from(body).subarray(0, MOST_PROMPT_BYTES).toString('utf8') : body;
    const answer = await runHarness({
      ...binding,
      id,
      harness: 'pi',
      purpose: 'short-report',
      cwd: root,
      prompt,
      sessionFile: join(jobs, `${id}.jsonl`),
      signal: signal ? AbortSignal.any([signal, limit]) : limit,
    });
    return answer?.status === 'completed' ? checkedShort(body, answer.text) : null;
  } catch {
    return null;
  }
}

/**
 * The short versions hobkin's list carries, and the queue that makes the missing ones, one at a time. Only a report
 * that finished after the switch was turned on, and says more than 100 words, is asked for, and each at most once in
 * this process, so a model that fails costs one try per report.
 */
export class ShortReports {
  constructor({ root, runHarness, onMade = () => {} }) {
    this.root = root;
    this.runHarness = runHarness;
    this.onMade = onMade;
    this.shorts = new Map();
    this.considered = new Set();
    this.queue = [];
    this.running = null;
    this.closed = false;
    this.controller = new AbortController();
  }

  /** The reports, each with its short version when it has one. Those a new report still needs are asked for in the background. */
  carry(reports) {
    const listed = reports.map(report => {
      const short = this.shortOf(report.id);
      return short ? { ...report, short } : report;
    });
    this.want(listed);
    return listed;
  }

  /** Resolves once nothing waits to be made. */
  async idle() {
    while (this.running) await this.running;
  }

  close() {
    this.closed = true;
    this.queue = [];
    this.controller.abort();
  }

  shortOf(id) {
    if (!this.shorts.has(id)) this.shorts.set(id, readShortReport(this.root, id));
    return this.shorts.get(id);
  }

  want(reports) {
    if (this.closed) return;
    const fresh = reports.filter(({ id, at, short }) => !short && typeof at === 'string' && !this.considered.has(id));
    if (!fresh.length) return;
    const { on, since } = readShortReports(this.root);
    if (!on) return;
    const from = Date.parse(since);
    for (const { id, at, body } of fresh) {
      this.considered.add(id);
      if (Date.parse(at) >= from && typeof body === 'string' && longerThan(readerText(body), SHORT_WORDS)) this.queue.push({ id, body });
    }
    this.start();
  }

  start() {
    if (this.running || this.closed || !this.queue.length) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      this.start();
    });
  }

  async drain() {
    while (this.queue.length && !this.closed) {
      const { id, body } = this.queue.shift();
      let binding = null;
      try {
        binding = fastBinding(this.root);
      } catch {
        // A config that cannot be read asks nothing.
      }
      if (!binding) continue;
      const short = await makeShortReport(body, { root: this.root, binding, runHarness: this.runHarness, signal: this.controller.signal });
      if (!short || this.closed) continue;
      try {
        // A report deleted while its short version was being written keeps none.
        if (deletedReportIds(this.root).has(id)) continue;
        saveShortReport(this.root, id, short);
      } catch {
        continue;
      }
      this.shorts.set(id, short);
      try {
        this.onMade(id);
      } catch {
        // The next refresh shows it all the same.
      }
    }
  }
}
