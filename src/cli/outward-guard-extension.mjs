import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from './events.mjs';
import { askCovers, outwardKind, outwardVerdict } from './outward.mjs';

/**
 * The guard for outward actions, first stage (075-chief-of-staff S17): it watches and blocks nothing. Each tool call that
 * acts outward in the user's name (`outward.mjs`) is recorded as one `outward_attempt` with its kind, the verdict a guard
 * would give, and the kind of run. It never records the call's arguments, recipients or text. The home is the one that
 * keeps the run's conversation, or else the one the run names in `HOBKIN_HOME`. With neither it records nothing, so a Pi
 * outside hobkin, or a test, never writes into the user's real home. Nothing loads it
 * yet: it is meant for every run's Pi (`namingExtensions` in `harnesses.mjs`) and the main chat (`mainSdkResources` in
 * `pi-extensions.mjs`).
 */
export const outwardGuardExtension = fileURLToPath(import.meta.url);

/** The variable that names the kind of run, when hobkin gives it one. */
export const RUN_KIND_ENV = 'HOBKIN_RUN_KIND';
const RUN_KINDS = ['main', 'routine', 'session', 'work', 'durable'];

/**
 * The kind of run: the one its variable names, or the one the place of its conversation says. The main chat keeps its
 * conversation in `sessions/main…`, a durable hobkin in `hobkins/`, and only a session job has `hobkin_done`
 * (`done-extension.mjs`). Routines and Work runs both keep theirs in `jobs/`, so without the variable they are `unknown`.
 */
function runKindOf(pi, file, env) {
  if (RUN_KINDS.includes(env[RUN_KIND_ENV])) return env[RUN_KIND_ENV];
  const folder = basename(dirname(file));
  if (folder === 'sessions' && basename(file).startsWith('main')) return 'main';
  if (folder === 'hobkins') return 'durable';
  if (pi.getAllTools().some(tool => tool.name === 'hobkin_done')) return 'session';
  return 'unknown';
}

// Each hobkin conversation is kept one folder below its home, so a run records into the home it belongs to.
const KEPT_IN = new Set(['sessions', 'jobs', 'hobkins']);

function homeOf(file, env) {
  const folder = dirname(file);
  if (KEPT_IN.has(basename(folder))) return dirname(folder);
  return env.HOBKIN_HOME || null;
}

// The user's standing rules, version 1 of `runtime/standing-rules.json`. A missing or broken file holds none.
function standingRules(root) {
  try {
    const saved = JSON.parse(readFileSync(join(root, 'runtime', 'standing-rules.json'), 'utf8'));
    return saved?.version === 1 && Array.isArray(saved.rules) ? saved.rules : [];
  } catch {
    return [];
  }
}

export default function outwardGuard(pi, { root, env = process.env } = {}) {
  // The latest words given to this Pi. Only the main chat's are the user's own: every other run starts from a stored prompt.
  let said = '';
  pi.on('input', event => {
    if (event?.source !== 'extension') said = typeof event?.text === 'string' ? event.text : '';
  });
  pi.on('tool_call', (event, ctx) => {
    try {
      const kind = outwardKind(event?.toolName, event?.input);
      if (!kind) return;
      const file = ctx?.sessionManager?.getSessionFile?.() ?? '';
      const run = runKindOf(pi, file, env);
      const askCovered = run === 'main' && askCovers(kind, said);
      const home = root ?? homeOf(file, env);
      if (!home) return;

      const verdict = outwardVerdict({ kind, rules: standingRules(home), askCovered });
      recordEvent(home, 'outward_attempt', { kind, verdict, run });
    } catch {
      // Watching never stops a call.
    }
  });
}
