import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordEvent } from './events.mjs';

/** How long a question from a routine or work mode stays on screen before it joins the Decisions tab. */
export const QUESTION_WAIT_MS = 30000;

const LONGEST_TLDR = 100;
const LONGEST_QUESTION = 1000;
const LONGEST_LABEL = 80;
const LONGEST_REASON = 300;
const FEWEST_CHOICES = 2;
const MOST_CHOICES = 6;
const DAY_MS = 86400000;
const REMEMBERED_MS = 30 * DAY_MS;

const logPath = root => join(root, 'decisions.jsonl');

const firstSentence = text => /^.*?[.?!](?=\s|$)/.exec(text)?.[0] ?? text;
const shortChoice = ({ value, label }) => ({ value, label: String(label).slice(0, LONGEST_LABEL) });
const shortReason = text => text?.trim().slice(0, LONGEST_REASON) || null;
const tldrFrom = ({ tldr, question }) => (tldr?.trim() || firstSentence(question.trim())).slice(0, LONGEST_TLDR);

function append(root, event) {
  appendFileSync(logPath(root), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function assertDecision({ question, choices, recommended }) {
  if (typeof question !== 'string' || !question.trim()) throw Error('A decision needs a question.');
  const values = new Set((choices ?? []).map(choice => choice?.value));
  const complete = (choices ?? []).every(choice => choice?.value && choice?.label);
  const fits = choices?.length >= FEWEST_CHOICES && choices.length <= MOST_CHOICES;
  if (!complete || !fits || values.size !== choices.length) throw Error(`A decision needs ${FEWEST_CHOICES} to ${MOST_CHOICES} distinct choices, each with a value and a label.`);
  if (recommended && !values.has(recommended)) throw Error('`recommended` has to be the value of one of its choices.');
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

/** The last card, which is how a restart knows what was already shown. */
export function lastCard(root) {
  const card = readAll(root).findLast(({ answerTo }) => answerTo?.kind === 'pending');
  return card ? { at: card.at, total: card.answerTo.total, trouble: card.answerTo.trouble } : null;
}

/** Nothing waits for the answer: the asker carries on, and the answer reaches it later. A `key` keeps one open question from becoming several. */
export function fileDecision(root, { key = null, from, question, tldr, choices, answerTo = null, recommended = null, why = null, changed = null }, now = Date.now()) {
  assertDecision({ question, choices, recommended });
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
    recommended,
    why: shortReason(why),
    changed: shortReason(changed),
    at: known?.at ?? new Date(now).toISOString(),
    shown: known?.shown ?? false,
  });
  if (!known) recordEvent(root, 'decision_filed', { id, source: answerTo?.kind }, now);
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

const keyOf = question => createHash('sha256').update(question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex').slice(0, 16);

/** The same question twice is the worst call hobkin can make, so what was answered lately is answered. */
function recentAnswer(root, key, now) {
  const isRemembered = ({ answeredAt }) => answeredAt && now - Date.parse(answeredAt) < REMEMBERED_MS;
  const answered = readAll(root).filter(decision => decision.key === key && isRemembered(decision));
  return answered.toSorted((first, second) => first.answeredAt.localeCompare(second.answeredAt)).at(-1) ?? null;
}

function earlierAnswer({ answer, answeredAt, choices }) {
  const label = choices.find(choice => choice.value === answer)?.label ?? answer;
  return {
    ok: true,
    answer,
    label,
    answeredAt,
    message: `The user answered this on ${answeredAt.slice(0, 10)}: ${label}. Nothing was filed, so carry on with that answer. If something changed, file it again with \`changed\` saying what.`,
  };
}

/** `hobkin decide`, for a run in another process. The question comes as JSON on stdin, and the run carries on as soon as this returns. A routine gets back what was already answered. Work runs never do, because their one use of this is deleting what git cannot restore. */
export async function runDecideCommand(root, args, input, now = Date.now()) {
  let text = '';
  for await (const chunk of input) text += chunk;
  const { key, changed, ...asked } = JSON.parse(text);
  const asker = whereTo(args);
  assertDecision(asked);
  const scopedKey = [...args, key || keyOf(asked.question)].join(':');
  const earlier = asker.answerTo.kind === 'routine' && !changed?.trim() ? recentAnswer(root, scopedKey, now) : null;
  if (earlier) {
    recordEvent(root, 'decision_recalled', { routine: asker.answerTo.id }, now);
    return earlierAnswer(earlier);
  }
  const { id } = fileDecision(root, { ...asked, ...asker, key: scopedKey, changed }, now);
  return { ok: true, id, message: 'Filed in Decisions. Carry on: the answer reaches you later.' };
}
