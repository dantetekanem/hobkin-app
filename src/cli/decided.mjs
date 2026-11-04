import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { answeredByUser } from './decisions.mjs';
import { readAnswers } from './questions.mjs';
import { writePrivate } from './reports.mjs';
import { cardActionsSince } from './work/card-actions.mjs';

const DAY_MS = 86400000;
const LOOK_BACK_DAYS = 14;
const MOST_LINES = 20;
// About a thousand tokens, as much as a full memory list.
const MOST_BYTES = 4096;
const LONGEST_SHORT = 240;
const LONGEST_FULL = 1000;
// The card that asks how to tackle the pile is a call about calls, and what it led to is told on its own, as it is for the day's wins.
const PILE_CARD = 'pending';
const VIEW_OPENING = "# What the user answered\n\nEvery answer the user gave in hobkin's Decisions and to the main agent's questions, newest first.";

const viewPath = root => join(root, 'runtime', 'answers.md');

// One line whatever was written, so nothing in it can pass for a heading or a line of its own.
function plain(text, longest = LONGEST_SHORT) {
  const flat = String(text ?? '').replace(/[\s\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
  return flat.length > longest ? `${flat.slice(0, longest - 1)}…` : flat;
}

const pad = value => String(value).padStart(2, '0');

// Absolute and by the user's own clock, so the part reads the same on every turn until something new comes in.
function stamp(time) {
  const date = new Date(time);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const stamped = ({ time, line }) => `${stamp(time)}: ${line}`;

// Every log here is oldest first, so of two made in the same moment the later one still leads.
const newestFirst = entries => entries
  .filter(({ time }) => Number.isFinite(time))
  .toReversed()
  .toSorted((left, right) => right.time - left.time);

const chosenLabel = ({ answer, choices = [] }) => choices.find(choice => choice.value === answer)?.label ?? answer;

/** The user's answers in Decisions since `since`. Search gets each question whole, and a turn gets the line Decisions showed it under. */
function decisionEntries(root, since, { forSearch = false } = {}) {
  return answeredByUser(root, since)
    .filter(({ answerTo }) => answerTo?.kind !== PILE_CARD)
    .map(decision => {
      const asker = plain(decision.from || 'hobkin');
      const question = forSearch ? plain(decision.question, LONGEST_FULL) : plain(decision.tldr || decision.question);
      return {
        time: Date.parse(decision.answeredAt),
        line: `In Decisions, ${asker} asked "${question}", and they chose "${plain(chosenLabel(decision))}".`,
      };
    });
}

/** The user's answers to the main agent's own questions since `since`. A turn reads them as the agent's own questions, and search says who asked. */
function chatEntries(root, since, { forSearch = false } = {}) {
  const longest = forSearch ? LONGEST_FULL : LONGEST_SHORT;
  const asker = forSearch ? 'The main agent' : 'You';
  return readAnswers(root)
    .filter(({ at, question }) => Date.parse(at) >= since && question)
    .map(({ at, question, chose, typed }) => {
      const reply = typed ? `wrote "${plain(typed, longest)}"` : `chose "${plain(chose)}"`;
      return {
        time: Date.parse(at),
        line: `${asker} asked "${plain(question, longest)}", and they ${reply}.`,
      };
    });
}

/** What the user did from the screen, by the title and project of the work it was about. What they did ends the line, as some of it holds a colon. */
function cardEntries(root, since) {
  return cardActionsSince(root, since).map(({ at, did, title, project }) => {
    const work = title && `"${plain(title)}"${project ? ` on ${plain(project)}` : ''}`;
    return {
      time: Date.parse(at),
      line: work ? `From the screen, for ${work}, they ${plain(did)}.` : `They ${plain(did)}.`,
    };
  });
}

// Newest first, so what is left out is always the oldest.
function withinBytes(lines) {
  const kept = [];
  let bytes = 0;
  for (const line of lines) {
    bytes += Buffer.byteLength(`- ${line}\n`);
    if (bytes > MOST_BYTES) break;
    kept.push(line);
  }
  return kept;
}

/**
 * What the user decided lately, newest first: their answers in Decisions and to the main agent's own questions, and what they did from the
 * screen, in plain words with titles and no ids. Read on every turn. A record that cannot be read costs that turn this part and nothing else.
 */
export function readDecided(root, now = Date.now()) {
  try {
    const since = now - LOOK_BACK_DAYS * DAY_MS;
    const entries = [...decisionEntries(root, since), ...chatEntries(root, since), ...cardEntries(root, since)];
    const newest = newestFirst(entries).slice(0, MOST_LINES);
    return withinBytes(newest.map(stamped));
  } catch {
    return [];
  }
}

export function decidedSection(lines) {
  const list = lines.length ? lines.map(line => `- ${line}`).join('\n') : `Nothing in the last ${LOOK_BACK_DAYS} days.`;
  return `## What the user decided lately\n\nFrom hobkin's records, newest first, over the last ${LOOK_BACK_DAYS} days.\n\n${list}`;
}

const readView = file => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** Every answer the user gave in Decisions and to the main agent, for memory search. qmd keeps the last text of an empty file, so with none the file goes. */
export function writeAnswersView(root) {
  const file = viewPath(root);
  const entries = [...decisionEntries(root, 0, { forSearch: true }), ...chatEntries(root, 0, { forSearch: true })];
  const lines = newestFirst(entries).map(entry => `- ${stamped(entry)}`);
  if (!lines.length) {
    rmSync(file, { force: true });
    return;
  }

  const text = `${VIEW_OPENING}\n\n${lines.join('\n')}\n`;
  if (readView(file) !== text) writePrivate(file, text);
}
