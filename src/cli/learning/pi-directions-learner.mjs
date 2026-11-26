import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { learningEnabled } from '../config.mjs';
import { readDirections } from '../directions.mjs';
import { contextFileIn } from '../resource-catalog.mjs';
import { fastBinding } from '../short-reports.mjs';
import { MOST_RULE_CHARS, MOST_RULES, readPiDirections, recordLook, versionOf } from './pi-directions.mjs';

// The same cap Your directions have. A larger file is not compared.
const MOST_PI_BYTES = 65536;
// Nobody waits for this run, and it still should not hold a model for long.
const TIME_LIMIT_MS = 180000;
const FENCED = /^```[^\n]*\n([\s\S]*?)\n?```$/;

/** The rules a compare run answered with, each on one line, or null for anything but the answer it was asked for. */
export function rulesFrom(text) {
  let answer = String(text ?? '').trim();
  const fenced = answer.match(FENCED);
  if (fenced) answer = fenced[1].trim();
  let rules;
  try {
    rules = JSON.parse(answer)?.rules;
  } catch {
    return null;
  }
  if (!Array.isArray(rules) || rules.length > MOST_RULES) return null;
  const lines = rules.map(rule => (typeof rule === 'string' ? rule.replace(/[\p{Cc}\s]+/gu, ' ').trim() : ''));
  if (lines.some(line => !line || line.length > MOST_RULE_CHARS)) return null;
  return [...new Set(lines)];
}

const comparing = ({ directions, pi }) => `<your-directions>\n${directions}\n</your-directions>\n\n<pi-agents-md>\n${pi}\n</pi-agents-md>`;

/**
 * Learns from Pi's AGENTS.md in the Pi folder it is given (the client's `_specs/038-resources`, A23). Each tick looks at
 * the file Pi would take from that folder, and reads it only once it changed. A version hobkin has not looked at gets
 * one run on the fast tier with no tools and nothing of Pi's, which answers with the rules Your directions lack. A run
 * that fails or answers out of form files nothing, and the same version is tried again on the next start.
 */
export class PiDirectionsLearner {
  constructor({ root, agentDir, runHarness, now = Date.now, onChange = () => {} }) {
    Object.assign(this, { root, agentDir, runHarness, now, onChange });
    this.seen = null;
    this.running = null;
    this.controller = new AbortController();
  }

  /** Cheap enough for every tick, and never throws: a look that goes wrong waits for the next tick. */
  tick() {
    try {
      // The folder is always named, so a home started for development or a test never reads ~/.pi/agent.
      if (this.running || this.controller.signal.aborted || !isAbsolute(this.agentDir ?? '') || !learningEnabled(this.root)) return false;
      const file = contextFileIn(this.agentDir);
      if (!file) return false;
      const { size, mtimeMs, ino } = statSync(file);
      const seen = `${file}:${size}:${mtimeMs}:${ino}`;
      if (seen === this.seen) return false;
      this.seen = seen;
      if (size > MOST_PI_BYTES) return false;
      const pi = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const version = versionOf(pi);
      if (version === readPiDirections(this.root).looked) return false;
      this.running = this.compare(pi, version).finally(() => { this.running = null; });
      return true;
    } catch {
      return false;
    }
  }

  async compare(pi, version) {
    try {
      const binding = fastBinding(this.root);
      if (!binding) return;
      const jobs = join(this.root, 'jobs');
      mkdirSync(jobs, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      const response = await this.runHarness({
        ...binding,
        id,
        harness: 'pi',
        purpose: 'pi-directions',
        cwd: this.root,
        prompt: comparing({ directions: readDirections(this.root), pi }),
        sessionFile: join(jobs, `${id}.jsonl`),
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(TIME_LIMIT_MS)]),
      });
      const rules = response?.status === 'completed' ? rulesFrom(response.text) : null;
      if (!rules || this.controller.signal.aborted) return;
      recordLook(this.root, version, rules, this.now());
      this.onChange();
    } catch {
      // Nothing is filed, and the next start looks again.
    }
  }

  /** Resolves once no compare is running. */
  async idle() {
    while (this.running) await this.running;
  }

  close() {
    this.controller.abort();
  }
}
