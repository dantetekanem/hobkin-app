import { readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicJson } from './config.mjs';

/**
 * What the user sent that the main agent never read, kept when hobkin closes or crashes, so it can go back into the window's input
 * when hobkin opens again (014-continuity A11). hobkin never sends these words to the model by itself.
 */
const fileOf = root => join(root, 'runtime', 'unread.json');
// Far more than ever waits in one turn, so a file nobody takes stays small.
const MOST_KEPT = 20;

const wordsOf = ({ content }) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : '');

/** Each kept message as `{ id, text }`, oldest first. A file that cannot be read keeps nothing. */
export function readUnread(root) {
  try {
    const kept = JSON.parse(readFileSync(fileOf(root), 'utf8'));
    return Array.isArray(kept) ? kept.filter(entry => typeof entry?.id === 'string' && typeof entry.text === 'string') : [];
  } catch {
    return [];
  }
}

/** Keeps each message not kept already, in the order given. */
export function keepUnread(root, texts) {
  const kept = readUnread(root);
  const fresh = [...new Set(texts)].filter(text => typeof text === 'string' && text.trim() && !kept.some(entry => entry.text === text));
  if (!fresh.length) return kept;
  const next = [...kept, ...fresh.map(text => ({ id: randomUUID(), text }))].slice(-MOST_KEPT);
  atomicJson(fileOf(root), next);
  return next;
}

export function forgetUnread(root) {
  rmSync(fileOf(root), { force: true });
}

/** The words of every user message in a main session file. Pi writes a message there as it takes it in, so these are what the model read. */
export function wordsInSession(file) {
  const words = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"role":"user"')) continue;
    try {
      const { type, message } = JSON.parse(line);
      if (type === 'message' && message?.role === 'user') words.add(wordsOf(message));
    } catch {
      // A line a crash cut short is no message Pi can read back.
    }
  }
  return words;
}

/** Steering a crash left running whose words the main session file does not hold. The model never read them. Oldest first. */
export function steeringNeverRead({ main, runs }) {
  const left = Object.values(runs ?? {}).filter(run => run.status === 'running' && run.kind === 'main' && run.title === 'Steering'
    && run.parentRunId && typeof run.prompt === 'string' && run.sessionId === main?.sessionId);
  if (!left.length || !main?.sessionFile) return [];
  const read = wordsInSession(main.sessionFile);
  return left.toSorted((one, other) => String(one.startedAt).localeCompare(String(other.startedAt)))
    .map(run => run.prompt).filter(prompt => !read.has(prompt));
}
