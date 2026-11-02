import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** How long a question from a routine or work mode stays on screen before it joins the Decisions tab. */
export const QUESTION_WAIT_MS = 30000;

const LONGEST_TLDR = 100;
const LONGEST_QUESTION = 1000;
const LONGEST_LABEL = 80;
const FEWEST_CHOICES = 2;
const MOST_CHOICES = 6;

const logPath = root => join(root, 'decisions.jsonl');

const firstSentence = text => /^.*?[.?!](?=\s|$)/.exec(text)?.[0] ?? text;
const shortChoice = ({ value, label }) => ({ value, label: String(label).slice(0, LONGEST_LABEL) });
const tldrFrom = ({ tldr, question }) => (tldr?.trim() || firstSentence(question.trim())).slice(0, LONGEST_TLDR);

function append(root, event) {
  appendFileSync(logPath(root), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function assertDecision({ question, choices }) {
  if (typeof question !== 'string' || !question.trim()) throw Error('A decision needs a question.');
  const values = new Set((choices ?? []).map(choice => choice?.value));
  const complete = (choices ?? []).every(choice => choice?.value && choice?.label);
  const fits = choices?.length >= FEWEST_CHOICES && choices.length <= MOST_CHOICES;
  if (!complete || !fits || values.size !== choices.length) throw Error(`A decision needs ${FEWEST_CHOICES} to ${MOST_CHOICES} distinct choices, each with a value and a label.`);
}

function readAll(root) {
  if (!existsSync(logPath(root))) return [];
  const byId = new Map();
  for (const line of readFileSync(logPath(root), 'utf8').split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      byId.set(event.id, { ...byId.get(event.id), ...event });
    } catch {
      // A line cut short by a crash costs that line and nothing else.
    }
  }
  return [...byId.values()];
}

/** What still waits for the user, oldest first. */
export const openDecisions = root => readAll(root).filter(({ answer }) => answer === undefined);

/** Nothing waits for the answer: the asker carries on, and the answer reaches it later. A `key` keeps one open question from becoming several. */
export function fileDecision(root, { key = null, from, question, tldr, choices, answerTo = null }, now = Date.now()) {
  assertDecision({ question, choices });
  const known = key && openDecisions(root).find(decision => decision.key === key);
  const id = known?.id ?? randomUUID();
  append(root, {
    id,
    key,
    from,
    question: question.trim().slice(0, LONGEST_QUESTION),
    tldr: tldrFrom({ tldr, question }),
    choices: choices.map(shortChoice),
    answerTo,
    at: known?.at ?? new Date(now).toISOString(),
    shown: known?.shown ?? false,
  });
  return { id };
}

/** It has had its moment on screen, so from here it only waits in the tab. */
export const markShown = (root, id) => append(root, { id, shown: true });

export function answerDecision(root, id, answer, now = Date.now()) {
  append(root, { id, answer, answeredAt: new Date(now).toISOString() });
}

/** One decision, or a clear refusal: an answer from a stale screen must not reach the wrong question. */
export function findDecision(root, id, value) {
  const decision = openDecisions(root).find(entry => entry.id === id);
  if (!decision) throw Error('That decision was already answered.');
  const choice = decision.choices.find(entry => entry.value === value);
  if (!choice) throw Error('That is not one of its choices.');
  return { decision, choice };
}

const whereTo = ([kind, ...names]) => {
  if (kind === 'routine' && names[0]) return { from: `Routine ${names[0]}`, answerTo: { kind, id: names[0] } };
  if (kind === 'work' && names[0] && names[1]) return { from: `Work mode, ${names[0]}`, answerTo: { kind, slug: names[0], item: names[1] } };
  throw Error('Say who is asking: routine <id>, or work <project> <item>.');
};

/** `hobkin decide`, for a run in another process. The question comes as JSON on stdin, and the run carries on as soon as this returns. */
export async function runDecideCommand(root, args, input) {
  let text = '';
  for await (const chunk of input) text += chunk;
  const { question, tldr, choices, key } = JSON.parse(text);
  const { id } = fileDecision(root, { key, question, tldr, choices, ...whereTo(args) });
  return { ok: true, id, message: 'Filed in Decisions. Carry on: the answer reaches you later.' };
}
