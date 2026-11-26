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

// The moments of a turn, in the order they come. Those before the prompt are told by whoever started the turn, as
// wall-clock times; the rest are seen here.
const BEFORE_PROMPT = ['host', 'handed', 'admitted', 'resolved', 'spawned', 'ready'];
const STAGES = [...BEFORE_PROMPT, 'prompted', 'started', 'requested', 'thinking', 'tool', 'text', 'ended'];
const FIRST_OF = { thinking_delta: 'thinking', toolcall_delta: 'tool', text_delta: 'text' };
// Where a turn's clock starts: the user's Enter in the window, the message reaching hobkin, a parent agent's tool
// call, hobkin starting the run itself, or, with nothing known, the prompt.
const ORIGINS = ['window', 'host', 'tool', 'run', 'prompt'];
const KINDS = ['main', 'durable', 'helper', 'work', 'routine', 'session', 'other'];
const ENGINES = ['pi', 'claude'];
const STEP_FIELDS = ['at', 'first', 'text', 'end', 'input', 'cacheRead', 'output'];
const MOST_STEPS = 24;
// The window, hobkin and its agents read one machine's clock, so a moment is only a little "ahead" by rounding.
const CLOCK_SLACK_MS = 1000;
const LONGEST_WAIT_MS = 7200000;
const SEND_SLACK_MS = 5000;
const OLDEST_SEND_MS = 600000;

const named = (value, longest) => typeof value === 'string' && value.length > 0 && value.length <= longest && !/[\x00-\x1f\x7f]/.test(value);
const labelsOf = turn => ({
  ...(KINDS.includes(turn?.kind) ? { kind: turn.kind } : {}),
  ...(ENGINES.includes(turn?.engine) ? { engine: turn.engine } : {}),
  ...(named(turn?.model, 200) ? { model: turn.model } : {}),
  ...(named(turn?.effort, 32) ? { effort: turn.effort } : {}),
});

/** Where a turn the user sent began: at their Enter when the window said when that was, else when the words got here. */
export function turnFrom(sentAt, received = Date.now()) {
  const believed = validNumber(sentAt) && sentAt <= received + SEND_SLACK_MS && received - sentAt <= OLDEST_SEND_MS;
  return believed
    ? { since: Math.min(sentAt, received), origin: 'window', marks: { host: received } }
    : { since: received, origin: 'host', marks: {} };
}

/** What a turn's facts say about who ran it and when each stage came, with anything that cannot be right left out. */
export function safeTurnFacts(facts) {
  const stages = {};
  for (const stage of STAGES) if (validNumber(facts?.stages?.[stage])) stages[stage] = facts.stages[stage];
  return {
    ...(ORIGINS.includes(facts?.origin) ? { origin: facts.origin } : {}),
    ...labelsOf(facts),
    ...(Object.keys(stages).length ? { stages } : {}),
  };
}

/** One row per model response: when it was asked for, its first output, its first text and its end, and its tokens. */
export function safeSteps(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row && typeof row === 'object').slice(0, MOST_STEPS)
    .map(row => Object.fromEntries(STEP_FIELDS.map(field => [field, validNumber(row[field]) ? row[field] : null])));
}

/** One dispatch, one exact Pi session. Callbacks must supply their captured owner, never the current session.
 * Observer latency starts here, not at the provider wire. SDK durationMs is a separate response duration.
 * Only final message_end usage is counted; agent_end/turn_end replay the same messages.
 * `turn` says who runs this and when it began (`since`, with the moments already passed in `marks`, all wall-clock),
 * so `stages` can count from the user's Enter and not only from the prompt.
 */
export function createTurnMetrics({ runId, sessionId, now = () => performance.now(), wall = Date.now, turn } = {}) {
  if (!validId(runId) || !validId(sessionId)) throw new TypeError('Invalid metric identities');
  const started = now();
  const promptedAt = wall();
  const began = validNumber(turn?.since) && turn.since <= promptedAt + CLOCK_SLACK_MS && promptedAt - turn.since <= LONGEST_WAIT_MS;
  const since = began ? Math.min(turn.since, promptedAt) : promptedAt;
  const origin = !began ? 'prompt' : ORIGINS.includes(turn.origin) && turn.origin !== 'prompt' ? turn.origin : 'run';
  const prompted = promptedAt - since;
  const before = {};
  for (const stage of began ? BEFORE_PROMPT : []) {
    const moment = turn.marks?.[stage];
    if (validNumber(moment) && moment >= since && moment <= promptedAt + CLOCK_SLACK_MS) before[stage] = Math.min(moment, promptedAt) - since;
  }
  const labels = labelsOf(turn);
  const reached = {};
  const steps = [];
  let open = null;
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
  // Stages read the wall clock, the one the moments before the prompt were told in. A turn whose own clock never ran
  // (one found abandoned at startup) has no stage after its prompt.
  const sinceBegan = () => {
    const value = wall() - since;
    return validNumber(started) && validNumber(value) ? value : null;
  };
  const reach = (stage, at) => {
    if (at !== null && !Object.hasOwn(reached, stage)) reached[stage] = at;
  };
  const newStep = () => {
    if (steps.length >= MOST_STEPS) return null;
    const step = Object.fromEntries(STEP_FIELDS.map(field => [field, null]));
    steps.push(step);
    return step;
  };

  function observe(event, identity) {
    if (!owns(identity) || final) return;
    if (event?.type === 'agent_start') { reach('started', sinceBegan()); return; }
    if (event?.message?.role !== 'assistant') return;
    const requestKey = responseKey(event.message, true);
    if (event.type === 'message_start' || event.type === 'message_update') {
      if (requestKey && (pending.has(requestKey) || pending.size < 1024)) pending.add(requestKey);
      else incomplete = true;
    }
    if (event.type === 'message_start') {
      const at = sinceBegan();
      reach('requested', at);
      open = newStep();
      if (open) open.at = at;
      return;
    }
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (!DELTAS.has(update?.type) || typeof update.delta !== 'string' || !update.delta.length) return;
      if (firstObservedOutputMs === null) firstObservedOutputMs = elapsed();
      const stage = FIRST_OF[update.type];
      // Only the first of each kind, in the turn or in this response, reads the clock.
      if (Object.hasOwn(reached, stage) && (!open || (open.first !== null && (stage !== 'text' || open.text !== null)))) return;
      const at = sinceBegan();
      reach(stage, at);
      if (open) {
        open.first ??= at;
        if (stage === 'text') open.text ??= at;
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
    // A response that never streamed has no start, so its step holds only its end.
    const step = open ?? newStep();
    open = null;
    if (step) {
      step.end = sinceBegan();
      for (const field of ['input', 'cacheRead', 'output']) step[field] = validNumber(values[field]) ? values[field] : null;
    }
    for (const field of FIELDS) {
      const value = values[field];
      const total = totals[field];
      if (validNumber(value) && validNumber(total.sum + value)) { total.sum += value; total.known++; }
    }
  }

  function facts() {
    const ended = sinceBegan();
    const facts = { schemaVersion: 1, runId, sessionId, responses: seen.size,
      incomplete: incomplete || pending.size > 0, firstObservedOutputMs, dispatchElapsedMs: elapsed(), origin, ...labels,
      stages: Object.freeze({ ...before, prompted, ...reached, ...(ended === null ? {} : { ended }) }) };
    for (const field of FIELDS) {
      const { sum, known } = totals[field];
      facts[field] = Object.freeze({ value: known ? sum : null,
        state: !known ? 'unavailable' : known === seen.size && !facts.incomplete ? 'complete' : 'partial' });
    }
    return Object.freeze(facts);
  }

  function snapshot(identity) {
    if (!owns(identity)) return null;
    return final ?? facts();
  }

  /** The responses so far, one step each. They go in the event and not in the facts, which every run keeps for good. */
  function stepsOf(identity) {
    return owns(identity) ? steps.map(step => ({ ...step })) : null;
  }

  function finish(identity) {
    if (!owns(identity)) return null;
    if (final) return final;
    incomplete ||= pending.size > 0;
    final = facts();
    return final;
  }

  // At most one best-effort append attempt per instance: recordEvent swallows storage errors.
  // This is not durable/crash/restart exactly-once; readers dedupe by runId + sessionId.
  function record(root, identity) {
    const facts = finish(identity);
    if (facts && !recorded) {
      recorded = true;
      recordEvent(root, 'run_performance', { ...facts, steps: stepsOf(identity) });
    }
    return facts;
  }
  return Object.freeze({ observe, snapshot, steps: stepsOf, finish, record });
}
