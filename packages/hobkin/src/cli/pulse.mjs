// A pulse says how a working run is doing: since when, when a token last moved, what it does, which way tokens flow and how many.
// This file only observes. Nothing here reads a clock, so every step takes the time it happened.
//
// A run thinks from the moment the model is asked until its words or a tool call arrive, whether or not the provider
// streams the thinking: many keep it out of sight, and the run would read as working all the while (the user,
// 2026-11-27: "the agent doesnt show Thinking", "just working", "I need thinking"). It works while it writes, calls a
// tool or runs one, and before its first request.

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
        prompted: false,
        finishedTokens: 0,
        messageTokens: 0,
        // What was counted when the reply under way was asked for (`replyEnded`).
        replyFrom: 0,
      });
    },

    /**
     * The run's first user message is its prompt. The count starts from the larger of its estimate and the one the run
     * began with, so a prompt given at the start counts once. Later messages are not counted.
     */
    prompted(key, text) {
      withRun(key, run => {
        if (run.prompted) return;
        run.prompted = true;
        run.promptTokens = Math.max(run.promptTokens, estimateTokens(text));
      });
    },

    /** A request goes to the model: arrow up, token activity now, and it thinks until its words or a tool call arrive. */
    requestSent(key, now) {
      withRun(key, run => {
        markTokenActivity(run, now, 'up');
        run.replyFrom = run.finishedTokens + run.messageTokens;
        run.phase = 'thinking';
      });
    },

    /** A message starts: a message left unended is kept as counted. The phase stays, as an opened message is not yet its words. */
    messageStarted(key) {
      withRun(key, run => {
        run.finishedTokens += run.messageTokens;
        run.messageTokens = 0;
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

    /**
     * A reply ends. Its messages may have counted it in parts, as Claude Code's are, so it counts as the larger of what
     * they counted since its request and the output count the provider reports for the whole reply.
     */
    replyEnded(key, now, reportedOutput) {
      withRun(key, run => {
        const counted = run.finishedTokens + run.messageTokens - run.replyFrom;
        const missing = reportedCount(reportedOutput) - counted;
        if (missing <= 0) return;
        run.finishedTokens += missing;
        markTokenActivity(run, now, 'down');
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
const userEvent = event => event?.message?.role === 'user';
// Pi's wire form of an update leaves the message out, and only the assistant's message has updates.
const assistantUpdate = event => event.message === undefined || assistantEvent(event);

const wordsOf = ({ content }) => (typeof content === 'string' ? content
  : (Array.isArray(content) ? content : []).filter(part => part?.type === 'text').map(part => part.text).join(''));

const phaseOfAssistantEvent = type => {
  if (typeof type !== 'string') return undefined;
  if (type.startsWith('thinking_')) return 'thinking';
  if (type.startsWith('text_') || type.startsWith('toolcall_') || type === 'done') return 'working';
  return undefined;
};

/**
 * Feeds the pulses from one raw Pi session event of a run, at the time it was seen.
 * The prompt's text comes from the event when it has one, else from `promptText`, and the run's first user message
 * takes its place when that is longer. Pi starts again by itself after an agent end that says it will retry, so the run
 * keeps its pulse through that.
 */
export function feedPiEvent(pulses, key, event, now, promptText) {
  switch (event?.type) {
    case 'agent_start':
      if (!pulses.get(key)) pulses.begin(key, now, typeof event.prompt === 'string' ? event.prompt : promptText);
      break;
    case 'turn_start':
      pulses.requestSent(key, now);
      break;
    case 'message_start':
      if (assistantEvent(event)) pulses.messageStarted(key);
      break;
    case 'message_update': {
      if (!assistantUpdate(event)) break;
      const { type, delta } = event.assistantMessageEvent ?? {};
      pulses.arrive(key, now, { phase: phaseOfAssistantEvent(type), delta });
      break;
    }
    case 'message_end':
      if (assistantEvent(event)) pulses.messageEnded(key, now, event.message.usage?.output);
      else if (userEvent(event)) pulses.prompted(key, wordsOf(event.message));
      break;
    case 'turn_end':
      if (assistantEvent(event)) pulses.replyEnded(key, now, event.message.usage?.output);
      break;
    case 'tool_execution_start':
      pulses.toolStarted(key);
      break;
    case 'agent_end':
      if (event.willRetry !== true) pulses.end(key);
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
  let heldUntil;

  return {
    /** The pulses to publish now, as a plain object by key. */
    publish(pulses, now) {
      const live = pulses.all();
      for (const key of published.keys()) {
        if (!(key in live)) published.delete(key);
      }
      heldUntil = undefined;
      for (const [key, pulse] of Object.entries(live)) {
        const shown = published.get(key);
        if (shown && samePulse(shown.pulse, pulse)) continue;
        const dueAt = shown ? shown.at + WIRE_INTERVAL_MS : now;
        if (now < dueAt) {
          heldUntil = Math.min(heldUntil ?? dueAt, dueAt);
          continue;
        }
        published.set(key, { at: now, pulse });
      }
      return Object.fromEntries([...published].map(([key, { pulse }]) => [key, { ...pulse }]));
    },

    /**
     * When the earliest change the last publish held back may go out, or undefined when it held none back. With no
     * later event, a change held back would otherwise never be published.
     */
    heldUntil() {
      return heldUntil;
    },
  };
}
