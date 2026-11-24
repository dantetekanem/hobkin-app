import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileDecision } from './decisions.mjs';
import { scheduleDate } from './schedules.mjs';
import { addMemory, MOST_DESCRIPTION, memoryNameFrom, RUN_MARKER, secretKind, secretRefusal } from './memories.mjs';

const LOG = 'inbox.jsonl';
const LONGEST_TEXT = 1000;
const LONGEST_NAME = 80;
// Well under what a message can carry, and the rest go with the next one.
const MOST_IN_A_NOTE = 10;
const UNNAMED = 'another session';
const REMIND_USAGE = 'Usage: hobkin remind <text> --on YYYY-MM-DD [--from <name>]';
const REMEMBER_USAGE = 'Usage: hobkin remember <text> [--from <name>]';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const REMINDER_CHOICES = [
  { value: 'done', label: 'Done' },
  { value: 'tomorrow', label: 'Remind me tomorrow' },
];
const SAID_IN_CHAT = ['reminder', 'memory'];
// The list each kind takes in the main agent's note, and what it hears of one.
const NOTE_LISTS = {
  reminder: { name: 'reminders', heard: ({ text, on, from }) => ({ text, on, from }) },
  // `saved` names the memory hobkin already made of it (057-shared-memory); one without was not saved and waits to be filed.
  memory: { name: 'remember', heard: ({ text, from, at, memory }) => ({ text, from, at, ...(memory ? { saved: memory } : {}) }) },
  answer: { name: 'answered', heard: ({ question, answer, from, at }) => ({ question, answer, from, at }) },
  // A memory a run suggested (057-shared-memory), which the main agent files with hobkin_remember, passing its id, or not.
  suggestion: { name: 'suggested', heard: ({ id, memory, from, at }) => ({ id, ...memory, from, at }) },
};

const folderOf = root => join(root, 'runtime');
const pad = number => String(number).padStart(2, '0');
const iso = now => new Date(now).toISOString();
const wordsOf = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const nameOf = from => from?.trim().slice(0, LONGEST_NAME) || UNNAMED;

function append(root, event) {
  mkdirSync(folderOf(root), { recursive: true, mode: 0o700 });
  appendFileSync(join(folderOf(root), LOG), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function readLog(root) {
  const file = join(folderOf(root), LOG);
  if (!existsSync(file)) return [];
  const entries = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      entries.set(event.id, { ...entries.get(event.id), ...event });
    } catch {
      // A line cut short by a crash costs that line and nothing else.
    }
  }
  return [...entries.values()];
}

/** A reminder is for a day on this machine's calendar. */
function localDay(now, offset = 0) {
  const at = new Date(now);
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function dayName(on) {
  const [, month, day] = on.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

const isDue = (entry, now) => entry.kind !== 'reminder' || entry.on <= localDay(now);

function plainText(words, usage) {
  const text = words.join(' ').trim();
  if (!text) throw Error(usage);
  if (text.length > LONGEST_TEXT) throw Error(`Keep it under ${LONGEST_TEXT} characters: the one thing to keep, in a sentence or two.`);
  return text;
}

function realDay(on) {
  if (!on) throw Error(`Say which day with --on. ${REMIND_USAGE}`);
  try {
    scheduleDate(on);
  } catch {
    throw Error(`--on ${on} is not a real date. Give it as YYYY-MM-DD, such as 2026-11-03.`);
  }
  return on;
}

/** The same words handed over again before hobkin takes them up are the same thing, so a retry or a second session adds nothing. */
function stillWaiting(root, kind, text, waits) {
  const words = wordsOf(text);
  return readLog(root).find(entry => entry.kind === kind && waits(entry) && wordsOf(entry.text) === words);
}

/** `hobkin remind`, from another session. hobkin brings it up on that day, or at once for a day gone by. */
export function remind(root, { words, on, from }, now = Date.now()) {
  const text = plainText(words, REMIND_USAGE);
  const day = realDay(on);
  const known = stillWaiting(root, 'reminder', text, entry => entry.on === day && !entry.posted);
  if (known) return { ok: true, id: known.id, on: day, message: `Already saved for ${day}.` };

  const id = randomUUID();
  append(root, {
    id,
    kind: 'reminder',
    text,
    on: day,
    from: nameOf(from),
    at: iso(now),
  });

  const due = day <= localDay(now);
  const when = due ? 'now if it is open, or as soon as it opens' : `on ${day}, or as soon as it opens after that`;
  return {
    ok: true,
    id,
    on: day,
    message: `Saved. hobkin brings it up ${when}: a line in Chat, a question in Decisions, and its main agent hears it.`,
  };
}

/** A memory's one-line description from the words someone handed over: the first line, cut at a word within the bound. */
function describedBy(text) {
  const line = text.split('\n')[0].replace(/\s+/g, ' ').trim();
  if (line.length <= MOST_DESCRIPTION) return line;
  const cut = line.slice(0, MOST_DESCRIPTION);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : MOST_DESCRIPTION).replace(/[\s,;:.-]+$/, '');
}

// A session's name that would read as the user's own words or as hobkin's, which no other session may take.
const READS_AS_SOMEONE = new Set(['you', 'your', 'yourself', 'user', 'theuser', 'me', 'myself', 'i', 'mine', 'owner', 'hobkin', 'mainhobkin',
  'themainhobkin', 'hobkinmain', 'main', 'mainchat', 'themainchat', 'assistant', 'theassistant', 'system']);

/**
 * `hobkin remember`, from another of the user's sessions: hobkin saves it at once as a memory every agent reads, from
 * that session, and its main agent hears of it once with the user's next message (057-shared-memory). One another
 * memory already says nearly the same, or that cannot be saved, waits for the main agent to file, as before. Typed
 * inside a run hobkin started (`HOBKIN_RUN` in `env`), it is only a suggestion from that run.
 */
export function remember(root, { words, from }, now = Date.now(), { env = process.env } = {}) {
  const text = plainText(words, REMEMBER_USAGE);
  const secret = secretKind(text);
  if (secret) throw Error(secretRefusal(secret));
  const run = typeof env?.[RUN_MARKER] === 'string' ? env[RUN_MARKER].replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, LONGEST_NAME) : '';
  if (run) {
    const suggested = suggestMemory(root, { memory: { kind: 'user', description: describedBy(text), text, said: text }, from: run }, now);
    return { ok: true, id: suggested.id, message: suggested.message };
  }
  const known = stillWaiting(root, 'memory', text, entry => !entry.heard);
  if (known) return { ok: true, id: known.id, message: 'Already saved, and hobkin\'s main agent has not heard it yet.' };

  const sender = nameOf(from);
  if (READS_AS_SOMEONE.has(sender.toLowerCase().replace(/[^a-z]/g, ''))) {
    throw Error(`Nothing was saved: --from names the session that hands this over, such as Claude Code, and "${sender}" reads as the user or as hobkin.`);
  }
  let saved = null;
  try {
    const name = memoryNameFrom(root, text);
    const { change } = addMemory(root, { name, kind: 'user', description: describedBy(text), text },
      { by: { kind: 'outside', title: sender }, source: { kind: 'remember', said: text, from: sender }, now, seesPrivate: false, unconfirmed: true });
    saved = { memory: name, change };
  } catch {
    // Refused as a near double or past the most, or not written: the main agent files it instead.
  }
  const id = randomUUID();
  append(root, {
    id,
    kind: 'memory',
    text,
    from: sender,
    at: iso(now),
    ...(saved ?? {}),
  });
  if (saved) {
    return {
      ok: true,
      id,
      memory: saved.memory,
      message: `Saved as the memory "${saved.memory}". Every agent hobkin runs reads it from now on, and hobkin's main agent hears of it with the user's next message there.`,
    };
  }
  return {
    ok: true,
    id,
    message: 'Saved. hobkin\'s main agent hears it with the user\'s next message there, and files it in its memories, its list or its directions.',
  };
}

/** The session that asked may be long gone, so the user's answer goes to hobkin's main agent, which acts on it there. */
export function handAnswer(root, { from, question, answer }, now = Date.now()) {
  append(root, {
    id: randomUUID(),
    kind: 'answer',
    from,
    question,
    answer,
    at: iso(now),
  });
}

const reminderLine = ({ on, from, text }) => `Reminder for ${dayName(on)}, from ${from}: ${text}`;

/** What Chat has yet to say: each reminder whose day has come and each fact. An answer gets no line, because the user just gave it. */
export function inboxToPost(root, now) {
  return readLog(root).filter(entry => SAID_IN_CHAT.includes(entry.kind) && !entry.posted && isDue(entry, now));
}

/** A reminder stands out as a system line. A fact gets a quiet one, because the main agent says what it did with it. */
export function inboxNotice(entry, now) {
  if (entry.kind === 'memory') {
    // One saved as a memory at once offers Undo and See (057-shared-memory).
    return {
      id: `notice:remember:${entry.id}`,
      role: 'notice',
      tone: 'quiet',
      content: `${entry.memory ? 'Remembered' : 'Noted'} from another session${entry.from === UNNAMED ? '' : ` (${entry.from})`}: ${entry.text}`,
      ...(entry.memory && entry.change ? { memory: { change: entry.change, name: entry.memory, did: 'added' } } : {}),
      at: iso(now),
    };
  }
  return {
    id: `notice:reminder:${entry.id}:${entry.on}`,
    role: 'system',
    content: reminderLine(entry),
    at: iso(now),
  };
}

/** Marked only once the view holding the line is saved, so a crash in between posts it again rather than never. Its id stops a second copy. */
export const markInboxPosted = (root, entries) => entries.forEach(({ id }) => append(root, { id, posted: true }));

const reminderQuestion = reminder => ({
  key: `reminder:${reminder.id}`,
  from: reminder.from,
  question: reminderLine(reminder),
  tldr: `Reminder: ${reminder.text}`,
  choices: REMINDER_CHOICES,
  answerTo: { kind: 'reminder', id: reminder.id },
});

/** A reminder whose day has come asks once in Decisions, where Done ends it and Remind me tomorrow brings it back. Nothing waits for the answer. */
export function askReminders(root, now) {
  const due = readLog(root).filter(entry => entry.kind === 'reminder' && !entry.asked && isDue(entry, now));
  for (const reminder of due) {
    fileDecision(root, reminderQuestion(reminder), now);
    append(root, { id: reminder.id, asked: true });
  }
  return due.length;
}

/** The user's next day brings all of it back: the line in Chat, the main agent and the question. */
export function remindTomorrow(root, id, now = Date.now()) {
  const on = localDay(now, 1);
  append(root, { id, on, asked: false, posted: false, heard: false });
  return { ok: true, message: `It comes up again tomorrow, ${on}.` };
}

/** What the main agent has yet to hear, oldest first. */
export function inboxToTell(root, now) {
  const unheard = readLog(root).filter(entry => Object.hasOwn(NOTE_LISTS, entry.kind) && !entry.heard && isDue(entry, now));
  return unheard.slice(0, MOST_IN_A_NOTE);
}

export function inboxNews(entries) {
  const news = {};
  for (const entry of entries) {
    const { name, heard } = NOTE_LISTS[entry.kind];
    news[name] ??= [];
    news[name].push(heard(entry));
  }
  return news;
}

export const markInboxHeard = (root, entries) => entries.forEach(({ id }) => append(root, { id, heard: true }));

/**
 * A memory an agent the user does not talk to suggests (057-shared-memory): a routine, a Work run or a session run,
 * named by its title. The main agent hears it with the user's next message and files it or not. `memory` is checked
 * by the caller. The same description from the same run, not heard yet, is the same suggestion.
 */
export function suggestMemory(root, { memory, from, runId }, now = Date.now()) {
  const known = readLog(root).find(entry => entry.kind === 'suggestion' && !entry.heard && entry.runId === runId
    && wordsOf(entry.memory?.description ?? '') === wordsOf(memory.description));
  if (known) return { ok: true, id: known.id, message: 'Already suggested, and the main hobkin has not heard it yet.' };
  const id = randomUUID();
  append(root, { id, kind: 'suggestion', memory, from: nameOf(from), ...(runId ? { runId } : {}), at: iso(now) });
  return { ok: true, id, message: 'Suggested. The main hobkin hears it with the user\'s next message there, and files it or not.' };
}

/** Whether the main agent has heard of the memory `hobkin remember` saved by this name, so it may keep it. */
export const rememberHeard = (root, name) => readLog(root).some(entry => entry.kind === 'memory' && entry.memory === name && entry.heard === true);

/** A suggestion by its id, for the main agent filing it, or null. */
export function suggestionOf(root, id) {
  if (typeof id !== 'string' || !id) return null;
  return readLog(root).find(entry => entry.id === id && entry.kind === 'suggestion') ?? null;
}
