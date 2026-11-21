import { stripVTControlCharacters } from 'node:util';

const clean = value => typeof value === 'string'
  ? stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '') : '';
const inputText = value => clean(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
// Only public content blocks, never result details or internal event records.
export const outputText = value => {
  const content = Array.isArray(value) ? value : value?.content ?? value;
  if (typeof content === 'string') return clean(content);
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text' && part.display !== false)
    .map(part => clean(part.text)).join('\n');
};
/** A run's feed keeps its newest steps, and what it lets go stays in the run's saved session (`run-steps.mjs`). */
export const MOST_STEPS = 200;
/** How much of a tool's output a run's feed keeps: all of a shorter one, else its start and its end, each half of this. */
export const MOST_OUTPUT = 8192;
const LEFT_OUT = '\n…\n';

// A cut never splits a character made of two UTF-16 units.
const isHighSurrogate = code => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = code => code >= 0xdc00 && code <= 0xdfff;
const startOf = (text, length) => text.slice(0, isHighSurrogate(text.charCodeAt(length - 1)) ? length - 1 : length);
const endOf = (text, length) => {
  const from = text.length - length;
  return text.slice(isLowSurrogate(text.charCodeAt(from)) ? from + 1 : from);
};

/** A tool's output as a feed keeps it: whole when it fits in `most`, else its first and last halves, with how long the whole is. */
export function keptOutput(text, most = Infinity) {
  if (text.length <= most) return { output: text };

  const half = Math.floor(most / 2);
  return {
    output: `${startOf(text, half)}${LEFT_OUT}${endOf(text, half)}`,
    outputLength: text.length,
  };
}

const CODEMODE_STATUSES = new Set(['running', 'ok', 'error', 'cancelled']);
const boundedText = (value, limit) => typeof value === 'string' ? clean(value).slice(0, limit) : undefined;
const boundedNumber = value => Number.isFinite(value) && value >= 0 ? value : undefined;
const codemodeDetails = details => {
  if (!details || !Array.isArray(details.calls)) return undefined;
  const calls = [];
  for (const call of details.calls.slice(0, 100)) {
    if (!call || typeof call !== 'object' || !CODEMODE_STATUSES.has(call.status)) return undefined;
    const id = boundedText(call.id, 200);
    const name = boundedText(call.name, 120);
    const args = boundedText(call.args, 500);
    if (!id || !name || args === undefined) return undefined;
    const safe = { id, name, args, status: call.status };
    const durationMs = boundedNumber(call.durationMs);
    const cost = boundedNumber(call.cost);
    const error = boundedText(call.error, 1000);
    if (durationMs !== undefined) safe.durationMs = durationMs;
    if (cost !== undefined) safe.cost = cost;
    if (error !== undefined) safe.error = error;
    calls.push(safe);
  }
  const metadata = { calls };
  const fullOutputPath = boundedText(details.fullOutputPath, 1000);
  if (fullOutputPath !== undefined) metadata.fullOutputPath = fullOutputPath;
  return metadata;
};
const TERMINAL_CHILD = new Set(['completed', 'failed', 'cancelled']);

/**
 * Disposable display groups, never execution targets or custody. Only admitted roots are tracked. A helper's row says
 * who it is and how it stands, never its words or calls: nothing draws them.
 */
export class OwnedActivity {
  groups = new Map();

  track(id, kind) { this.groups.set(id, { kind, settled: false, children: new Map() }); }
  settle(id) {
    const group = this.groups.get(id);
    if (group) group.settled = true;
  }

  project(snapshot = []) {
    for (const row of snapshot) {
      const group = this.groups.get(row.rootId);
      if (!group || (!group.children.has(row.id) && group.children.size >= 32)) continue;
      const { id, parentId, rootId, depth, name, status } = row;
      group.children.set(id, { id, parentId, rootId, depth, name, state: status });
    }
    for (const [id, group] of this.groups) {
      if (group.settled && !group.children.size) this.groups.delete(id);
    }
    const terminal = [...this.groups].filter(([, group]) => group.settled
      && [...group.children.values()].every(row => TERMINAL_CHILD.has(row.state)));
    for (const [id] of terminal.slice(0, Math.max(0, terminal.length - 20))) this.groups.delete(id);
    return Object.fromEntries([...this.groups].filter(([, group]) => group.children.size)
      .map(([id, group]) => [id, [...group.children.values()].map(row => ({ ...row }))]));
  }
}

/** Allowlisted, disposable display data; never retains harness records. */
export class JobActivity {
  entries = [];
  message = 0;
  hidden = false;
  /** The last snapshot handed out, and each entry's copy until that entry changes (`snapshot`). */
  shown = null;
  copies = new WeakMap();
  /** What changed since `shown`: the entries written to, and whether entries were dropped, which builds the next list whole. */
  touched = new Set();
  whole = true;
  /** Each entry by its id, so the entry an event writes to is found without walking the feed. */
  byId = new Map();

  /**
   * `most` keeps only the latest entries, for a feed with no end such as the main chat's. `mostOutput` bounds each tool's output
   * (`keptOutput`). `now` is the clock each entry is stamped with when it is first seen (`at`, milliseconds since the epoch), so the
   * window can say when it happened.
   */
  constructor({ most = Infinity, mostOutput = Infinity, now = Date.now } = {}) {
    this.most = most;
    this.mostOutput = mostOutput;
    this.now = now;
  }

  /** The next snapshot is a new list, with a new copy of `entry` when one is given. Every change to the feed says so here. */
  changed(entry) {
    if (entry) {
      this.copies.delete(entry);
      this.touched.add(entry);
    } else this.whole = true;
  }

  /** A new entry, stamped with when it was first seen. A clock that gives no time leaves the stamp out. */
  add(entry) {
    const at = this.now();
    if (Number.isFinite(at)) entry.at = at;
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.changed(entry);
    return entry;
  }

  accept(event) {
    try {
      this.reduce(event);
      if (this.entries.length > this.most) {
        const dropped = this.entries.splice(0, this.entries.length - this.most);
        for (const { id } of dropped) this.byId.delete(id);
        this.changed();
      }
    } catch {
      /* Display data must not fail execution. */
    }
  }

  text(index, value, append = false) {
    if (!Number.isInteger(index) || index < 0 || typeof value !== 'string') return;
    const id = `message:${this.message}:${index}`;
    let entry = this.byId.get(id);
    if (!entry) entry = this.add({ id, kind: 'assistant', text: '' });
    // The kept text is already clean, and two clean texts make a clean one, so only the new part is cleaned.
    const text = append ? entry.text + clean(value) : clean(value);
    if (text === entry.text) return;
    entry.text = text;
    this.changed(entry);
  }

  tool(id, name, state, input, output) {
    if (typeof id !== 'string' || !id) return;
    const key = `tool:${id}`;
    let entry = this.byId.get(key);
    if (!entry) {
      if (typeof name !== 'string' || !name) return;
      entry = this.add({ id: key, kind: 'tool', name: clean(name), state });
    }
    entry.state = state;
    if (input !== undefined) entry.input = inputText(input);
    if (output !== undefined) {
      const { output: kept, outputLength } = keptOutput(outputText(output), this.mostOutput);
      entry.output = kept;
      if (outputLength === undefined) delete entry.outputLength;
      else entry.outputLength = outputLength;
    }
    if (name === 'codemode') {
      const metadata = codemodeDetails(output?.details);
      if (metadata) entry.codemode = metadata;
      else delete entry.codemode;
    } else delete entry.codemode;
    this.changed(entry);
  }

  reduce(event) {
    if (!event || typeof event !== 'object') return;

    if (event.display === false) {
      if (event.type === 'message_start') {
        this.message++;
        this.hidden = true;
      } else if (event.type === 'message_update') {
        this.hidden = true;
      }
      return;
    }

    if (event.type === 'message_start') {
      this.message++;
      this.hidden = !this.visibleMessage(event.message);
    } else if (event.type === 'message_update') {
      const part = event.assistantMessageEvent;
      if (event.message?.display === false
        || part?.display === false
        || part?.content?.display === false) {
        this.hidden = true;
      }
      if (!this.hidden) {
        if (part?.type === 'text_delta') this.text(part.contentIndex, part.delta, true);
        if (part?.type === 'text_end') this.text(part.contentIndex, part.content);
      }
    } else if (event.type === 'message_end') {
      if (!this.hidden
        && this.visibleMessage(event.message)) {
        const content = typeof event.message.content === 'string' ? [{ type: 'text', text: event.message.content }] : event.message.content;
        if (!Array.isArray(content)) return;
        const ids = new Set(content.flatMap((part, index) =>
          part?.type === 'text' && part.display !== false ? [`message:${this.message}:${index}`] : []));
        const kept = this.entries.filter(entry =>
          !entry.id.startsWith(`message:${this.message}:`) || ids.has(entry.id));
        if (kept.length !== this.entries.length) {
          this.entries = kept;
          this.byId = new Map(kept.map(entry => [entry.id, entry]));
          this.changed();
        }
        content.forEach((part, index) => {
          if (part?.display === false) return;
          if (part?.type === 'text') this.text(index, part.text);
          if (part?.type === 'toolCall') this.tool(part.id, part.name, 'running', part.arguments);
        });
      }
      this.message++;
      this.hidden = false;
    } else if (['tool_execution_start', 'tool_execution_update'].includes(event.type)) {
      this.tool(event.toolCallId, event.toolName, 'running', event.args, event.partialResult);
    } else if (event.type === 'tool_execution_end') {
      this.tool(event.toolCallId, event.toolName, event.isError ? 'failed' : 'completed', undefined, event.result);
    }
  }

  visibleMessage(message) {
    return message?.display !== false && (message?.role === 'assistant'
      || (message?.role === 'custom' && message.display === true));
  }

  /**
   * A copy of the entries. While nothing changes it is the same list, and an entry that did not change keeps the same
   * copy, so a reader that compares by identity skips them. A list or copy handed out is never changed afterwards.
   */
  snapshot() {
    const unchanged = this.shown && !this.whole && !this.touched.size;
    if (unchanged) return this.shown;

    this.shown = !this.shown || this.whole ? this.entries.map(entry => this.copyOf(entry)) : this.patched(this.shown);
    this.touched.clear();
    this.whole = false;
    return this.shown;
  }

  /**
   * `last` with a new copy of each entry written to since, where it stands, and the new entries after it. Entries only move when some are
   * dropped, which builds the list whole, so everything else keeps its place. A touched entry is looked for from the end, where writing happens.
   */
  patched(last) {
    const next = last.slice();
    for (const entry of this.touched) {
      const index = this.entries.lastIndexOf(entry);
      if (index !== -1 && index < next.length) next[index] = this.copyOf(entry);
    }
    for (let index = next.length; index < this.entries.length; index++) {
      next.push(this.copyOf(this.entries[index]));
    }
    return next;
  }

  copyOf(entry) {
    let copy = this.copies.get(entry);
    if (!copy) {
      copy = {
        ...entry,
        ...(entry.codemode ? { codemode: {
          ...entry.codemode,
          calls: entry.codemode.calls.map(call => ({ ...call })),
        } } : {}),
      };
      this.copies.set(entry, copy);
    }
    return copy;
  }
}
