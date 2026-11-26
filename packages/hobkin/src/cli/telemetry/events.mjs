import { createHmac } from 'node:crypto';

// Each local value maps to the fixed word the server's catalog allows. A value with no mapping becomes `unknown` where the
// catalog allows that word, and is left out where it does not. A fact the local event lacks is left out: missing is unknown.
const RUN_STATUS = { completed: 'completed', no_change: 'completed', findings: 'completed', failed: 'failed', interrupted: 'interrupted', cancelled: 'cancelled' };
const STOP_REASON = { stop: 'stop', length: 'length', toolUse: 'tool_use', error: 'error', aborted: 'aborted' };
const LANE = { do: 'execute', look: 'research', discover: 'research' };
const TRIAGE = { critical: 'urgent', blocked: 'act', useful: 'info', nothing: 'quiet' };
const DECISION_SOURCE = {
  routine: 'routine', work: 'work', merge: 'work', land: 'work', pair: 'work', pickup: 'work', subscription: 'work',
  pending: 'system', reminder: 'system', learning: 'system',
};
const HOW = { answered: 'answered', escaped: 'dismissed', expired: 'expired' };
const NOTICE_SOURCE = {
  'work-allowance': 'work', 'work-pause': 'work', 'work-ship': 'work', 'work-review': 'work', 'work-discovery': 'work', card: 'work',
  session: 'main', templates: 'system', wins: 'system', learning: 'system', 'memory-index': 'system', answer: 'system',
  reminder: 'system', remember: 'system', feedback: 'system', 'telemetry-upload': 'system',
};
const TONE = { critical: 'urgent', blocked: 'warning', useful: 'info', quiet: 'quiet', success: 'success' };
const ERROR_FROM = { refresh: 'refresh', main: 'main', runner: 'runner' };
const PAUSE = { hand: 'manual', chosen: 'user', usage: 'limit', day: 'budget', hour: 'budget' };
const LAUNCH_OUTCOME = { trouble: 'failed' };
const TAB = { conversation: 'main', reports: 'reports', schedules: 'routines', work: 'work', decisions: 'decisions' };
const COMPACTION_REASON = { manual: 'manual', threshold: 'threshold', overflow: 'overflow' };
const COMPACTION_STATUS = { completed: 'completed', failed: 'failed', cancelled: 'cancelled' };
const COMPONENT = { cli: 'cli', main: 'main', runner: 'runner', worker: 'worker', ui: 'ui' };
const CATEGORY = { uncaught_exception: 'uncaught_exception', unhandled_rejection: 'unhandled_rejection', out_of_memory: 'out_of_memory', startup: 'startup' };
const MAX_MS = 604800000;
const MAX_TOKENS = 1000000000;
const MAX_COUNT = 1000000;
const MAX_USD = 1000000;

function mapped(table, value, fallback) {
  if (value === undefined || value === null) return undefined;
  return Object.hasOwn(table, value) ? table[value] : fallback;
}
const whole = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : undefined);
const ms = value => whole(value, MAX_MS);
const flag = value => (typeof value === 'boolean' ? value : undefined);
const usd = value => (Number.isFinite(value) && value >= 0 && value <= MAX_USD ? value : undefined);

function runKind({ kind, project, routine }) {
  if (project) return 'work';
  if (routine) return 'routine';
  if (kind === 'main') return 'main';
  return kind === undefined ? undefined : 'unknown';
}

// Templates are named only by recorded provenance, which no local run has yet, so template_id, template_version and customized stay out.
const runFacts = (event, id) => ({
  run_id: id('run', event.id),
  kind: runKind(event),
  lane: mapped(LANE, event.lane, 'unknown'),
});

/** Each catalog event this client sends, in the catalog's order, built from the local event of the same name. */
const FACTS = {
  app_opened: () => ({}),
  app_closed: event => ({ ms: ms(event.ms) }),
  turn_started: (event, id) => ({ run_id: id('run', event.id) }),
  turn_finished: (event, id) => ({
    run_id: id('run', event.id),
    status: mapped(RUN_STATUS, event.status),
    ms: ms(event.ms),
    limited: flag(event.limited),
    stop_reason: mapped(STOP_REASON, event.stopReason, 'unknown'),
  }),
  run_started: runFacts,
  run_finished: (event, id) => ({
    ...runFacts(event, id),
    status: mapped(RUN_STATUS, event.status),
    ms: ms(event.ms),
    usd: usd(event.usd),
    tokens: whole(event.tokens, MAX_TOKENS),
    limited: flag(event.limited),
    triage: mapped(TRIAGE, event.triage, 'unknown'),
    next: flag(event.next),
  }),
  run_tokens: (event, id) => ({
    run_id: id('run', event.id),
    tokens: whole(event.tokens, MAX_TOKENS),
    cached: whole(event.cached, MAX_TOKENS),
  }),
  decision_filed: (event, id) => ({ decision_id: id('decision', event.id), source: mapped(DECISION_SOURCE, event.source, 'unknown') }),
  decision_answered: (event, id) => ({
    decision_id: id('decision', event.id),
    source: mapped(DECISION_SOURCE, event.source, 'unknown'),
    ms: ms(event.ms),
  }),
  decision_recalled: () => ({}),
  report_read: (event, id) => ({ report_id: id('report', event.id), ms: ms(event.ms) }),
  report_messaged: (event, id) => ({ report_id: id('report', event.id) }),
  question_shown: () => ({}),
  question_ended: event => ({ how: mapped(HOW, event.how), ms: ms(event.ms) }),
  notice_posted: event => ({ source: mapped(NOTICE_SOURCE, event.source, 'unknown'), tone: mapped(TONE, event.tone) }),
  error_shown: event => ({ from: mapped(ERROR_FROM, event.from, 'unknown') }),
  work_paused: event => ({ pause: mapped(PAUSE, event.pause, 'unknown') }),
  work_resumed: event => ({ pause: mapped(PAUSE, event.pause, 'unknown') }),
  launch_closed: event => ({ outcome: mapped(LAUNCH_OUTCOME, event.outcome, 'unknown') }),
  harness_filed: event => ({ count: whole(event.count, MAX_COUNT) }),
  done_page: event => ({ ms: ms(event.ms) }),
  done_diff: () => ({}),
  done_merged: () => ({}),
  done_declined: () => ({}),
  done_sent_back: () => ({}),
  tab_opened: event => ({ tab: mapped(TAB, event.tab, 'unknown') }),
  compaction_started: event => ({ reason: mapped(COMPACTION_REASON, event.reason, 'unknown') }),
  compaction_finished: event => ({
    reason: mapped(COMPACTION_REASON, event.reason, 'unknown'),
    status: mapped(COMPACTION_STATUS, event.status),
    ms: ms(event.ms),
  }),
  crash_occurred: event => ({
    component: mapped(COMPONENT, event.component, 'unknown'),
    category: mapped(CATEGORY, event.category, 'unknown'),
    fatal: flag(event.fatal),
  }),
};

export const TRANSPORT_TYPES = Object.keys(FACTS);

/** One stable id for one local thing, as a UUID only this data folder's own salt can link back to it. */
export function transportId(salt, namespace, value) {
  const bytes = createHmac('sha256', Buffer.from(salt, 'hex')).update(`${namespace}\n${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const withoutGaps = facts => Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined));

/**
 * A local event as the transport event the server takes, or null when the catalog has no such event. Only the facts
 * the catalog names go, each as its fixed word or a bounded number. Local ids become transport ids, and names,
 * paths, routine ids, projects and items never leave.
 */
export function transportEvent(local, { eventId, idFor }) {
  const facts = Object.hasOwn(FACTS, local?.type) ? FACTS[local.type] : null;
  const at = Date.parse(local?.at);
  if (!facts || !Number.isFinite(at)) return null;
  const id = (namespace, value) => (typeof value === 'string' && value ? idFor(namespace, value) : undefined);
  return { event_id: eventId, type: local.type, occurred_at: new Date(at).toISOString(), facts: withoutGaps(facts(local, id)) };
}
