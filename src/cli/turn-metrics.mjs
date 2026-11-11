import { recordEvent } from './events.mjs';

const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'estimatedUsd', 'responseDurationMs'];
const DELTAS = new Set(['text_delta', 'thinking_delta', 'toolcall_delta']);
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,200}$/.test(value);
const boundedString = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const responseKey = (message, request = false) => {
  if (!boundedString(message.provider) || !boundedString(message.model)) return null;
  const id = boundedString(message.responseId) ? ['id', message.responseId] : null;
  const timestamp = validNumber(message.timestamp) ? ['timestamp', message.timestamp] : null;
  const identity = request ? timestamp ?? id : id ?? timestamp;
  return identity ? JSON.stringify([message.provider, message.model, ...identity]) : null;
};

/** One dispatch, one exact Pi session. Callbacks must supply their captured owner, never the current session.
 * Observer latency starts here, not at the provider wire. SDK durationMs is a separate response duration.
 * Only final message_end usage is counted; agent_end/turn_end replay the same messages.
 */
export function createTurnMetrics({ runId, sessionId, now = () => performance.now() }) {
  if (!validId(runId) || !validId(sessionId)) throw new TypeError('Invalid metric identities');
  const started = now();
  const seen = new Map();
  const pending = new Set();
  const totals = Object.fromEntries(FIELDS.map(key => [key, { sum: 0, known: 0 }]));
  let firstObservedOutputMs = null;
  let incomplete = false;
  let final = null;
  let recorded = false;
  const owns = identity => identity?.runId === runId && identity?.sessionId === sessionId;
  const elapsed = () => {
    const value = now() - started;
    return validNumber(started) && validNumber(value) ? value : null;
  };

  function observe(event, identity) {
    if (!owns(identity) || final || event?.message?.role !== 'assistant') return;
    const requestKey = responseKey(event.message, true);
    if (event.type === 'message_start' || event.type === 'message_update') {
      if (requestKey && (pending.has(requestKey) || pending.size < 1024)) pending.add(requestKey);
      else incomplete = true;
    }
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (firstObservedOutputMs === null && DELTAS.has(update?.type) && typeof update.delta === 'string' && update.delta.length) {
        firstObservedOutputMs = elapsed();
      }
      return;
    }
    if (event.type !== 'message_end') return;
    const message = event.message;
    // Provider IDs are scoped to model/provider; timestamp is the SDK's request-start fallback.
    // Missing/oversize identity and overflow stay explicitly incomplete rather than guessing.
    const key = responseKey(message);
    if (!key) { incomplete = true; return; }
    pending.delete(requestKey);
    const values = { input: message.usage?.input, output: message.usage?.output,
      cacheRead: message.usage?.cacheRead, cacheWrite: message.usage?.cacheWrite,
      estimatedUsd: message.usage?.cost?.total, responseDurationMs: message.durationMs };
    const signature = JSON.stringify(FIELDS.map(field => validNumber(values[field]) ? values[field] : null));
    if (seen.has(key)) { incomplete ||= seen.get(key) !== signature; return; }
    if (seen.size >= 1024) { incomplete = true; return; }
    seen.set(key, signature);
    for (const field of FIELDS) {
      const value = values[field];
      const total = totals[field];
      if (validNumber(value) && validNumber(total.sum + value)) { total.sum += value; total.known++; }
    }
  }

  function finish(identity) {
    if (!owns(identity)) return null;
    if (final) return final;
    incomplete ||= pending.size > 0;
    const facts = { schemaVersion: 1, runId, sessionId, responses: seen.size, incomplete,
      firstObservedOutputMs, dispatchElapsedMs: elapsed() };
    for (const field of FIELDS) {
      const { sum, known } = totals[field];
      facts[field] = Object.freeze({ value: known ? sum : null,
        state: !known ? 'unavailable' : known === seen.size && !incomplete ? 'complete' : 'partial' });
    }
    final = Object.freeze(facts);
    return final;
  }

  // At most one best-effort append attempt per instance: recordEvent swallows storage errors.
  // This is not durable/crash/restart exactly-once; readers dedupe by runId + sessionId.
  function record(root, identity) {
    const facts = finish(identity);
    if (facts && !recorded) {
      recorded = true;
      recordEvent(root, 'run_performance', facts);
    }
    return facts;
  }
  return Object.freeze({ observe, finish, record });
}
