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

function sinceNote({ decided, added, gone }) {
  const parts = [
    ...(decided.length ? ['Since your instructions were written, the user decided:', ...decided.map(line)] : []),
    ...(added.length ? ['Memory now also holds:', ...added.map(line)] : []),
    ...(gone.length ? ['Memory no longer holds:', ...gone.map(line)] : []),
  ];
  return `${OPENING}\n${parts.join('\n')}\n${CLOSING}\n\n`;
}

/** A message without the note it opened with, for showing the user's own words. */
export const withoutSinceNote = text => text.replace(NOTE, '');

/**
 * `memory` and `decided` read the two lists as they are now. The keeper hands out the lists as last written into the
 * prompt, and `news` says what the agent has not been told since.
 */
export function keptPrompt({ memory, decided }) {
  // As the prompt holds them, and what the agent knows: that, plus the notes it has taken.
  let written = null;
  let told = null;
  const read = () => ({ memory: [...memory()], decided: [...decided()] });
  const write = () => {
    if (!written) written = told = read();
    return written;
  };
  return {
    memory: () => [...write().memory],
    decided: () => [...write().decided],
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
      };
      if (!fresh.decided.length && !fresh.added.length && !fresh.gone.length) return null;
      return { text: sinceNote(fresh), told: () => { told = now; } };
    },
    /** The prompt is written again on its next read, from the lists as they are then. */
    renew() {
      written = null;
      told = null;
    },
  };
}
