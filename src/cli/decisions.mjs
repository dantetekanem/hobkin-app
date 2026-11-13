import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents, recordEvent } from './events.mjs';

/** How long a question from a routine or work mode stays on screen before it joins the Action Items tab. */
export const QUESTION_WAIT_MS = 30000;

const LONGEST_TLDR = 100;
const LONGEST_QUESTION = 1000;
const LONGEST_LABEL = 80;
const LONGEST_REASON = 300;
const LONGEST_FROM = 80;
const FEWEST_CHOICES = 2;
const MOST_CHOICES = 6;
const DAY_MS = 86400000;
const REMEMBERED_MS = 30 * DAY_MS;
const MOST_LINKS = 6;
const LONGEST_URL = 2048;

const logPath = root => join(root, 'decisions.jsonl');

const firstSentence = text => /^.*?[.?!](?=\s|$)/.exec(text)?.[0] ?? text;
const shortChoice = ({ value, label }) => ({ value, label: String(label).slice(0, LONGEST_LABEL) });
const shortReason = text => text?.trim().slice(0, LONGEST_REASON) || null;
const tldrFrom = ({ tldr, question }) => (tldr?.trim() || firstSentence(question.trim())).slice(0, LONGEST_TLDR);
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g;
// The main agent reads a link as it was filed, so one that could carry a terminal sequence is refused rather than cleaned.
const webAddress = url => {
  if (typeof url !== 'string' || url.length > LONGEST_URL || url.search(CONTROLS) !== -1) return false;
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
const shortLink = ({ label, url }) => {
  const { href, hostname } = new URL(url);
  return { label: String(label ?? '').replace(CONTROLS, ' ').trim().slice(0, LONGEST_LABEL) || hostname, url: href };
};

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

/** When hobkin last filed a decision of this kind, answered or not. A quiet between them that lives here survives a restart. */
export function lastFiledAt(root, kind) {
  const times = readAll(root).filter(({ answerTo }) => answerTo?.kind === kind).map(({ at }) => Date.parse(at)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : -Infinity;
}

/**
 * What the user answered since `since`. hobkin closes a question itself once it no longer holds, and that is no answer of theirs. Only the
 * user's own answer goes on record as `decision_answered`, which is also how the day's wins count them, and events go back six months.
 */
export function answeredByUser(root, since = 0) {
  const answeredIds = new Set(readEvents(root, { since })
    .filter(({ type }) => type === 'decision_answered')
    .map(({ id }) => id));

  return readAll(root).filter(({ id, answer }) => answer !== undefined && answeredIds.has(id));
}

function fileRecord(root, { key = null, from, question, tldr, choices, answerTo = null, recommended = null, why = null, changed = null, links = [], reports = [], shown = false }, now) {
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
    ...(links.length || known?.links ? { links: links.map(shortLink) } : {}),
    ...(reports.length || known?.reports ? { reports: [...new Set([...(known?.reports ?? []), ...reports])] } : {}),
    at: known?.at ?? new Date(now).toISOString(),
    shown: known?.shown ?? shown,
  });
  if (!known) recordEvent(root, 'decision_filed', { id, source: answerTo?.kind }, now);
  return { id };
}

/**
 * Nothing waits for the answer: the asker carries on, and the answer reaches it later. A `key` keeps one open question from becoming several.
 * A question has no links and always gets its moment on screen, whatever the asker sends.
 */
export const fileDecision = (root, { links, shown, ...decision }, now = Date.now()) => fileRecord(root, decision, now);

/** It has had its moment on screen, so from here it only waits in the tab. */
export const markShown = (root, id) => append(root, { id, shown: true });

/** An answer in the user's own words is `typed`, and `typed` keeps the words. */
export function answerDecision(root, id, answer, now = Date.now(), { typed } = {}) {
  append(root, { id, answer, ...(typed ? { typed } : {}), answeredAt: new Date(now).toISOString() });
}

/** The newest answer under a key, from the user or from evidence, however old. */
export const latestAnswer = (root, key) => readAll(root)
  .filter(decision => decision.key === key && decision.answeredAt)
  .toSorted((first, second) => first.answeredAt.localeCompare(second.answeredAt))
  .at(-1) ?? null;

/** Report calls explicitly represented by actions, open or settled. Unknown answers do not settle a call. */
export const actionReportIds = root => new Set(readAll(root)
  .filter(item => isActionItem(item) && (item.answer === undefined || ['done', 'drop'].includes(item.answer)))
  .flatMap(item => item.reports ?? []));

function assertReports(reports) {
  if (!Array.isArray(reports) || reports.length > 32 || reports.some(id => typeof id !== 'string' || !id.trim() || id.length > 256 || /[\x00-\x1f\x7f]/.test(id))) {
    throw Error('`reports` is up to 32 nonempty report IDs.');
  }
}

function linkReports(root, id, reports, evidence, now) {
  assertReports(reports);
  if (!reports.length || typeof evidence !== 'string' || !evidence.trim()) throw Error('Linking reports needs IDs and evidence that their call is this action.');
  const item = readAll(root).find(item => item.id === id && isActionItem(item));
  if (!item) throw Error('No action item has that ID.');
  append(root, {
    id,
    reports: [...new Set([...(item.reports ?? []), ...reports])],
    linkedAt: new Date(now).toISOString(),
    linkEvidence: shortReason(evidence),
  });
  return { ok: true, id, message: 'Linked report calls; the action and its answer are unchanged.' };
}

/** What the user can do with something a routine found for them to do. With hobkin, it stays open until one of the other two. */
export const ACTION_CHOICES = [
  { value: 'done', label: 'Done' },
  { value: 'hobkin', label: 'Do it with hobkin' },
  { value: 'drop', label: 'Not doing it' },
];
const ACTION_KINDS = ['action', 'routines'];
export const isActionItem = ({ answerTo }) => ACTION_KINDS.includes(answerTo?.kind);

function assertLinks(links) {
  const fits = Array.isArray(links) && links.length <= MOST_LINKS;
  if (!fits || links.some(link => !webAddress(link?.url))) throw Error(`Links are up to ${MOST_LINKS} web addresses, each with a url and a label.`);
}

/** A decision with something to do in it. It never takes the screen: it waits in Action Items, and the card counts it. */
export function fileActionItem(root, { title, detail, choices = ACTION_CHOICES, links = [], ...item }, now = Date.now()) {
  if (typeof title !== 'string' || !title.trim()) throw Error('An action item needs a title.');
  if ([detail, item.why].some(text => text != null && typeof text !== 'string')) throw Error('`detail` and `why` are text.');
  assertLinks(links);
  return fileRecord(root, { ...item, tldr: title, question: detail?.trim() ? detail : title, choices, links, shown: true }, now);
}

/** Evidence settles it the way the user's word does, and what showed it is kept with the answer. */
export function settleDecision(root, id, evidence, now = Date.now()) {
  append(root, { id, answer: 'done', evidence: shortReason(evidence), answeredAt: new Date(now).toISOString() });
}

/** The main agent is helping with it, so it stays open and says since when. */
export const handDecision = (root, id, now = Date.now()) => append(root, { id, handedAt: new Date(now).toISOString() });

/** One open decision, or a clear refusal: an answer from a stale screen must not reach the wrong question. */
export function findOpenDecision(root, id) {
  const decision = openDecisions(root).find(entry => entry.id === id);
  if (!decision) throw Error('That decision was already answered.');
  return decision;
}

export function findDecision(root, id, value) {
  const decision = findOpenDecision(root, id);
  const choice = decision.choices.find(entry => entry.value === value);
  if (!choice) throw Error(`That is not one of its choices: ${decision.choices.map(entry => entry.value).join(', ')}.`);
  return { decision, choice };
}

/** A decision as the main agent reads it, to tell the user about and to answer: who asked, what, and each choice by its value. */
export const decisionRow = ({ id, from, answerTo, at, question, choices = [], recommended = null, why = null }) => ({
  id,
  from: from ?? 'hobkin',
  kind: answerTo?.kind ?? null,
  at: at ?? null,
  question,
  choices: choices.map(({ value, label }) => ({ value, label })),
  recommended: recommended ?? null,
  why: why ?? null,
});

const whereTo = ([kind, ...names], from) => {
  const session = from?.trim().slice(0, LONGEST_FROM);
  if (session && !kind) return { from: session, answerTo: { kind: 'outside' } };
  if (kind === 'routine' && names[0]) return { from: `Routine ${names[0]}`, answerTo: { kind, id: names[0] } };
  if (kind === 'work' && names[0] && names[1]) return { from: `Work mode, ${names[0]}`, answerTo: { kind, slug: names[0], item: names[1] } };
  throw Error('Say who is asking: routine <id>, work <project> <item>, or --from <name>.');
};

const keyOf = question => createHash('sha256').update(question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex').slice(0, 16);

const putOffKey = question => `chat:${keyOf(question)}`;

/**
 * A question the main agent asked that the user put off, or left until its time on screen ran out. It waits in Action Items with its words and
 * choices, and never takes the screen again. Their answer there goes to the main agent in Chat. The same words put off twice are one item.
 */
export const filePutOff = (root, { question, choices }, now = Date.now()) =>
  fileRecord(root, { key: putOffKey(question), from: 'hobkin', question, choices, answerTo: { kind: 'chat' }, shown: true }, now);

/** Asked again and answered when it was, the one waiting in Action Items is answered too, so it does not wait there as well. */
export function answerPutOff(root, question, { value, typed }, now = Date.now()) {
  const waiting = openDecisions(root).find(decision => decision.key === putOffKey(question));
  if (waiting) answerDecision(root, waiting.id, typed ? 'typed' : value, now, { typed });
}

/** The same question twice is the worst call hobkin can make, so what was answered lately is answered. */
function recentAnswer(root, key, now) {
  const isRemembered = ({ answeredAt }) => answeredAt && now - Date.parse(answeredAt) < REMEMBERED_MS;
  const answered = readAll(root).filter(decision => decision.key === key && isRemembered(decision));
  return answered.toSorted((first, second) => first.answeredAt.localeCompare(second.answeredAt)).at(-1) ?? null;
}

function earlierAnswer({ answer, typed, answeredAt, choices }) {
  const label = typed ?? choices.find(choice => choice.value === answer)?.label ?? answer;
  return {
    ok: true,
    answer,
    label,
    answeredAt,
    message: `The user answered this on ${answeredAt.slice(0, 10)}: ${label}. Nothing was filed, so carry on with that answer. If something changed, file it again with \`changed\` saying what.`,
  };
}

/**
 * `hobkin decide`, for a run in another process. The question comes as JSON on stdin, and the run carries on as soon as this returns. A routine gets back what was
 * already answered. Work runs never do, because their one use of this is deleting what git cannot restore. Another session names itself with `--from`, and its
 * answer goes to hobkin's main agent, because that session may be gone by then. Nor do other sessions get an earlier answer: two of them, in different projects,
 * can ask the same words about different things.
 */
export async function runDecideCommand(root, args, input, now = Date.now(), from = null) {
  let text = '';
  for await (const chunk of input) text += chunk;
  const { key, changed, ...asked } = JSON.parse(text);
  const asker = whereTo(args, from);
  assertDecision(asked);
  const outside = asker.answerTo.kind === 'outside';
  // Another session's key stays apart from hobkin's own, so it can never reach one of hobkin's questions.
  const scope = outside ? ['outside'] : args;
  const scopedKey = [...scope, key || keyOf(asked.question)].join(':');
  const earlier = asker.answerTo.kind === 'routine' && !changed?.trim() ? recentAnswer(root, scopedKey, now) : null;
  if (earlier) {
    recordEvent(root, 'decision_recalled', { routine: asker.answerTo.id }, now);
    return earlierAnswer(earlier);
  }
  const { id } = fileDecision(root, { ...asked, ...asker, key: scopedKey, changed }, now);
  const message = outside
    ? 'Filed in hobkin\'s Action Items. The user answers it there, and hobkin\'s main agent hears the answer, not this session, so carry on without it.'
    : 'Filed in Action Items. Carry on: the answer reaches you later.';
  return { ok: true, id, message };
}

const filedBy = ([kind, id]) => {
  if (kind === 'routine' && id) return { from: `Routine ${id}`, answerTo: { kind: 'action', id } };
  throw Error('Say which routine is filing it, routine <id>, or which item is done, done <item id>.');
};

function assertEvidence(done) {
  if (typeof done !== 'string' || !done.trim()) throw Error('`done` says what shows it is done.');
}

/** The main agent closes an item it was handed once the work is done, by the ID it was given. */
function settleById(root, id, done, now) {
  assertEvidence(done);
  const item = openDecisions(root).find(decision => decision.id === id && isActionItem(decision));
  if (!item) return { ok: true, message: 'No open action item has that ID, so nothing changed.' };
  settleDecision(root, id, done, now);
  recordEvent(root, 'action_settled', { id, by: 'main' }, now);
  return { ok: true, id, message: 'Closed in Action Items, with what showed it done.' };
}

const dayOf = ({ answeredAt }) => answeredAt.slice(0, 10);

function readItem(text) {
  try {
    const item = JSON.parse(text);
    if (item && typeof item === 'object' && !Array.isArray(item)) return item;
  } catch {
    // Said below, the same way for every shape that is not one item.
  }
  throw Error('hobkin action reads one JSON object on stdin.');
}

/** Time passing is not evidence that a completed action needs doing again. */
function standingAnswer(earlier, changed) {
  if (earlier?.answer === 'drop') {
    return { ok: true, answer: 'drop', message: `The user said on ${dayOf(earlier)} that they are not doing this. Nothing was filed, and it will not be filed again.` };
  }
  if (earlier?.answer !== 'done' || changed?.trim()) return null;
  return { ok: true, answer: 'done', message: `This was done on ${dayOf(earlier)}. Nothing was filed. If you see it is not done, file it again with \`changed\` saying what shows that.` };
}

/**
 * `hobkin action`, for a routine in another process. The item comes as JSON on stdin and the routine carries on as soon as this returns. A `key` keeps one item
 * from becoming several, and `done` with what shows it closes the open one. `done <item id>` is the main agent closing one it was handed.
 */
export async function runActionCommand(root, args, input, now = Date.now()) {
  let text = '';
  for await (const chunk of input) text += chunk;
  const { key, caseKey, done, changed, title, detail, why, links, reports = [], evidence } = readItem(text);
  if (caseKey !== undefined && (typeof caseKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,255}$/.test(caseKey))) {
    throw Error('`caseKey` is a stable nonempty case-step identity, up to 256 plain characters.');
  }
  assertReports(reports);
  if (args[0] === 'link' && args[1]) return linkReports(root, args[1], reports, evidence, now);
  if (args[0] === 'done' && args[1]) return settleById(root, args[1], done, now);
  const asker = filedBy(args);
  if (!key && !caseKey && typeof title !== 'string') throw Error('An action item needs a title, or the key it was filed with.');
  const scopedKey = caseKey ? `action:case:${caseKey}` : ['action', ...args, key || keyOf(title)].join(':');
  const open = openDecisions(root).find(decision => decision.key === scopedKey);
  if (done !== undefined) {
    assertEvidence(done);
    if (!open) return { ok: true, message: 'Nothing is open under that key, so nothing changed.' };
    settleDecision(root, open.id, done, now);
    recordEvent(root, 'action_settled', { id: open.id, routine: asker.answerTo.id }, now);
    return { ok: true, id: open.id, message: 'Closed in Action Items, with what showed it done.' };
  }
  const earlier = open ? null : latestAnswer(root, scopedKey);
  const standing = standingAnswer(earlier, changed);
  if (standing) {
    if (reports.length) linkReports(root, earlier.id, reports, 'Same explicit action identity; its recorded answer still stands.', now);
    recordEvent(root, 'decision_recalled', { routine: asker.answerTo.id }, now);
    return { ...standing, id: earlier.id };
  }
  const { id } = fileActionItem(root, { title, detail, why, links, reports, ...asker, key: scopedKey, changed }, now);
  return { ok: true, id, message: open ? 'Updated in Action Items.' : 'Filed in Action Items. Carry on: the user does it from there, and the answer reaches you later.' };
}
