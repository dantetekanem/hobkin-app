// A pulse says how a working run is doing: since when, when a token last moved, what it does, which way tokens flow and how many.
// This file only observes. Nothing here reads a clock, so every step takes the time it happened.

/** The key of the main turn's pulse. */
export const MAIN_PULSE_KEY = '#main';

const CHARACTERS_PER_TOKEN = 4;
const WIRE_INTERVAL_MS = 1000;

const estimateTokens = text => (typeof text === 'string' ? Math.ceil(text.length / CHARACTERS_PER_TOKEN) : 0);

const reportedCount = value => (Number.isFinite(value) && value > 0 ? value : 0);

const publicPulse = ({ startedAt, lastTokenAt, phase, direction, tokens }) =>
  ({ startedAt, lastTokenAt, phase, direction, tokens });

/**
 * Keeps one pulse for each working run, by key. The count never goes down.
 * Steps for a key with no run are ignored.
 */
export function createPulses() {
  const runs = new Map();

  const markTokenActivity = (run, now, direction) => {
    run.direction = direction;
    run.lastTokenAt = now;
  };

  const withRun = (key, step) => {
    const run = runs.get(key);
    if (run) step(run);
  };

  return {
    /** A run begins; the count starts at the prompt's characters over four, rounded up. */
    begin(key, now, promptText) {
      runs.set(key, {
        startedAt: now,
        lastTokenAt: now,
        phase: 'working',
        direction: 'up',
        promptTokens: estimateTokens(promptText),
        finishedTokens: 0,
        messageTokens: 0,
      });
    },

    /** A request goes to the model: arrow up, token activity now. */
    requestSent(key, now) {
      withRun(key, run => markTokenActivity(run, now, 'up'));
    },

    /** A message starts: a message left unended is kept as counted, and the phase is working. */
    messageStarted(key) {
      withRun(key, run => {
        run.finishedTokens += run.messageTokens;
        run.messageTokens = 0;
        run.phase = 'working';
      });
    },

    /** Thinking, text or a tool call arrives. A delta adds its estimate and moves the arrow down. */
    arrive(key, now, { phase, delta } = {}) {
      withRun(key, run => {
        const added = estimateTokens(delta);
        if (added > 0) {
          run.messageTokens += added;
          markTokenActivity(run, now, 'down');
        }
        if (phase) run.phase = phase;
      });
    },

    /** A message ends. It counts as the larger of its estimate and the output count the provider reports. */
    messageEnded(key, now, reportedOutput) {
      withRun(key, run => {
        const counted = Math.max(run.messageTokens, reportedCount(reportedOutput));
        if (counted > 0) markTokenActivity(run, now, 'down');
        run.finishedTokens += counted;
        run.messageTokens = 0;
        run.phase = 'working';
      });
    },

    /** A tool starts: the phase is working. It is not token activity. */
    toolStarted(key) {
      withRun(key, run => { run.phase = 'working'; });
    },

    /** A run ends: its pulse is gone. */
    end(key) {
      runs.delete(key);
    },

    /** The pulse of a run, or undefined. */
    get(key) {
      const run = runs.get(key);
      if (!run) return undefined;
      return publicPulse({ ...run, tokens: run.promptTokens + run.finishedTokens + run.messageTokens });
    },

    /** Every pulse, as a plain object by key. */
    all() {
      return Object.fromEntries([...runs.keys()].map(key => [key, this.get(key)]));
    },
  };
}

const assistantEvent = event => event?.message?.role === 'assistant';

const phaseOfAssistantEvent = type => {
  if (typeof type !== 'string') return undefined;
  if (type.startsWith('thinking_')) return 'thinking';
  if (type.startsWith('text_') || type.startsWith('toolcall_') || type === 'done') return 'working';
  return undefined;
};

/**
 * Feeds the pulses from one raw Pi session event of a run, at the time it was seen.
 * The prompt's text comes from the event when it has one, else from `promptText`.
 */
export function feedPiEvent(pulses, key, event, now, promptText) {
  switch (event?.type) {
    case 'agent_start':
      pulses.begin(key, now, typeof event.prompt === 'string' ? event.prompt : promptText);
      break;
    case 'turn_start':
      pulses.requestSent(key, now);
      break;
    case 'message_start':
      if (assistantEvent(event)) pulses.messageStarted(key);
      break;
    case 'message_update': {
      if (!assistantEvent(event)) break;
      const { type, delta } = event.assistantMessageEvent ?? {};
      pulses.arrive(key, now, { phase: phaseOfAssistantEvent(type), delta });
      break;
    }
    case 'message_end':
      if (assistantEvent(event)) pulses.messageEnded(key, now, event.message.usage?.output);
      break;
    case 'tool_execution_start':
      pulses.toolStarted(key);
      break;
    case 'agent_end':
      pulses.end(key);
      break;
  }
}

const samePulse = (a, b) =>
  a.startedAt === b.startedAt && a.lastTokenAt === b.lastTokenAt && a.phase === b.phase
  && a.direction === b.direction && a.tokens === b.tokens;

/**
 * Decides what goes on the wire. A run's published pulse changes at most once a second:
 * a newer state inside that second waits for a later call. A run that began shows at once
 * and a run that ended is gone at once.
 */
export function createPulseWire() {
  const published = new Map();

  return {
    /** The pulses to publish now, as a plain object by key. */
    publish(pulses, now) {
      const live = pulses.all();
      for (const key of published.keys()) {
        if (!(key in live)) published.delete(key);
      }
      for (const [key, pulse] of Object.entries(live)) {
        const shown = published.get(key);
        const due = !shown || now - shown.at >= WIRE_INTERVAL_MS;
        if (!due || (shown && samePulse(shown.pulse, pulse))) continue;
        published.set(key, { at: now, pulse });
      }
      return Object.fromEntries([...published].map(([key, { pulse }]) => [key, { ...pulse }]));
    },
  };
}
