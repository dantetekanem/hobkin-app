/**
 * The memory and the decisions in the main agent's system prompt, kept as they were when that prompt was last written.
 * The provider caches a conversation by its start, and the system prompt is its start, so a prompt that changes sends
 * the whole conversation uncached again. A decision or a new memory item used to change it on the next turn. Now both
 * stay as written until the prompt is written again (`renew`: the conversation is compacted, or its model changes), and
 * what is new in between goes to the agent as a short note with its next message.
 */

const OPENING = '<hobkin-since>';
const CLOSING = '</hobkin-since>';
const NOTE = /^<hobkin-since>\n[\s\S]*?\n<\/hobkin-since>\n\n/;

// A line is the user's own words, so the tag that ends the note is broken wherever a line holds it.
const line = text => `- ${String(text).replaceAll('</', '<\\/')}`;

// A note names this many memories that changed at most, and how many more: the agent recalls the rest.
const MOST_NOTED = 20;
const noted = lines => [...lines.slice(0, MOST_NOTED).map(line), ...(lines.length > MOST_NOTED ? [`- and ${lines.length - MOST_NOTED} more`] : [])];

function sinceNote({ decided, added, gone, remembered = [], forgotten = [] }) {
  const parts = [
    ...(decided.length ? ['Since your instructions were written, the user decided:', ...decided.map(line)] : []),
    ...(added.length ? ['Memory now also holds:', ...added.map(line)] : []),
    ...(gone.length ? ['Memory no longer holds:', ...gone.map(line)] : []),
    ...(remembered.length ? ['Memories added or changed since:', ...noted(remembered)] : []),
    ...(forgotten.length ? ['Memories gone from your index:', ...noted(forgotten)] : []),
  ];
  return `${OPENING}\n${parts.join('\n')}\n${CLOSING}\n\n`;
}

/** A message without the note it opened with, for showing the user's own words. */
export const withoutSinceNote = text => text.replace(NOTE, '');

const NO_MEMORIES = Object.freeze({ index: '', entries: [] });
/** hobkin's memories as a reader gives them (`memorySnapshot` in `memories.mjs`), or none: a failure there never costs a turn. */
function memoriesOf(read) {
  try {
    const value = read?.();
    return typeof value?.index === 'string' && Array.isArray(value.entries) ? value : NO_MEMORIES;
  } catch {
    return NO_MEMORIES;
  }
}

/** What changed in hobkin's memories between two snapshots, as the note's lines: by name and description, and by name for one gone. */
function memoryNews(before, after) {
  const was = new Map(before.entries.map(entry => [entry.name, entry.version]));
  const is = new Set(after.entries.map(entry => entry.name));
  return {
    remembered: after.entries.filter(entry => was.get(entry.name) !== entry.version).map(entry => `${entry.name}: ${entry.description}`),
    forgotten: before.entries.filter(entry => !is.has(entry.name)).map(entry => entry.name),
  };
}

/**
 * `memory` and `decided` read the two lists as they are now, and `memories`, when given, hobkin's memories as an index
 * and its entries (057-shared-memory). The keeper hands out each as last written into the prompt, and `news` says what
 * the agent has not been told since.
 */
export function keptPrompt({ memory = () => [], decided = () => [], memories }) {
  // As the prompt holds them, and what the agent knows: that, plus the notes it has taken.
  let written = null;
  let told = null;
  const read = () => ({ memory: [...memory()], decided: [...decided()], memories: memoriesOf(memories) });
  const write = () => {
    if (!written) written = told = read();
    return written;
  };
  return {
    memory: () => [...write().memory],
    decided: () => [...write().decided],
    memories: () => write().memories.index,
    /** The note for the next message, with `told` to call once the message was taken, or null when nothing is new. */
    news() {
      // Before the prompt is written there is nothing to be news against: it is about to hold everything.
      if (!told) return null;
      let now;
      try {
        now = read();
      } catch {
        return null;
      }
      const fresh = {
        decided: now.decided.filter(entry => !told.decided.includes(entry)),
        added: now.memory.filter(item => !told.memory.includes(item)),
        gone: told.memory.filter(item => !now.memory.includes(item)),
        ...memoryNews(told.memories, now.memories),
      };
      if (!Object.values(fresh).some(lines => lines.length)) return null;
      return { text: sinceNote(fresh), told: () => { told = now; } };
    },
    /** The prompt is written again on its next read, from the lists as they are then. */
    renew() {
      written = null;
      told = null;
    },
  };
}
