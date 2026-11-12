import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Lines the client app posts in Chat by itself, such as a review that became ready. Each says its news once, in
// the app's own words. Nothing asks a model and the main agent does not hear them: they are for the user to read.
const LOG = 'client-notices.jsonl';
const LONGEST_LINE = 600;
const LONGEST_NAME = 200;
const KEY = /^[\w.:@+/-]{1,200}$/;
const TONES = new Set(['critical', 'blocked', 'useful', 'quiet']);

const folderOf = root => join(root, 'runtime');
const plain = (value, longest) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, longest);

function append(root, event) {
  mkdirSync(folderOf(root), { recursive: true, mode: 0o700 });
  appendFileSync(join(folderOf(root), LOG), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function readLog(root) {
  const file = join(folderOf(root), LOG);
  if (!existsSync(file)) return [];
  const notices = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      notices.set(event.key, { ...notices.get(event.key), ...event });
    } catch {
      // A line cut short by a crash costs that line and nothing else.
    }
  }
  return [...notices.values()];
}

/**
 * Saves a line for Chat. `key` names what it is about, so the same news posted again adds nothing. `review`, when
 * given, names the review the line is about, so the app can open it from there. Answers whether it was new.
 */
export function postClientNotice(root, { key, line, tone = 'useful', review }, now = Date.now()) {
  if (typeof key !== 'string' || !KEY.test(key)) throw Error('A client notice needs a key of letters, digits and . : @ + / - only.');
  const content = plain(line, LONGEST_LINE);
  if (!content) throw Error('A client notice needs its line.');
  if (readLog(root).some(entry => entry.key === key)) return false;
  const about = plain(review, LONGEST_NAME);
  append(root, { key, line: content, tone: TONES.has(tone) ? tone : 'useful', ...(about ? { review: about } : {}), at: new Date(now).toISOString() });
  return true;
}

/** What Chat has yet to say. */
export const clientNoticesToPost = root => readLog(root).filter(({ posted, line }) => !posted && line);

/** A notice line in hobkin's own place in Chat, with the review it names, if any. */
export const clientNotice = ({ key, line, tone, review, at }) => ({ id: `notice:client:${key}`, role: 'notice', content: line, tone, ...(review ? { review } : {}), at });

/** Marked only once the view holding the line is saved, so a crash in between posts it again rather than never. Its id stops a second copy. */
export const markClientNoticesPosted = (root, notices) => notices.forEach(({ key }) => append(root, { key, posted: true }));
