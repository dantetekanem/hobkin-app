import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicJson } from './config.mjs';
import { isGuardedKind } from './outward.mjs';
import { readJson } from './work/store.mjs';

/**
 * What the user said once that settles later cases of its kind (075). An `answer` rule answers a card of its kind from the same asker, such
 * as `routine:<id>`, the way the user did, and an `outward` rule lets an action leave this machine. Each was said back to the user in `said`
 * before it was kept, and only the user makes one. `runtime/standing-rules.json` is read by more than this file, so its shape stays
 * `{ version: 1, rules: [{ id, kind, match, then, said, savedAt, by }] }`.
 */
const RULE_KINDS = ['answer', 'outward'];
const LONGEST_SAID = 300;
const USAGE = 'Say `hobkin decisions rules` to list the standing rules, or `hobkin decisions rules forget <id>` to remove one.';

const rulesPath = root => join(root, 'runtime', 'standing-rules.json');
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isWord = value => typeof value === 'string' && Boolean(value.trim());
// The outward guard also takes a match or a then given as one word, such as `"match": "send", "then": "allow"` (outward.mjs).
const isMatch = match => (isObject(match) ? Object.keys(match).length > 0 : isWord(match));
const canonical = value => JSON.stringify(isObject(value) ? Object.entries(value).toSorted() : value);
const sameMatch = (left, right) => canonical(left) === canonical(right);

function assertRule({ kind, match, then, said }) {
  if (!RULE_KINDS.includes(kind)) throw Error('A standing rule\'s `kind` is answer or outward.');
  if (!isMatch(match)) throw Error('A standing rule needs a `match` that says which cases it settles.');
  if (!isObject(then) && !isWord(then)) throw Error('A standing rule needs a `then` that says what follows.');
  if (kind === 'answer' && (!isWord(match?.kind) || !isWord(match?.asker) || !isWord(then?.answer))) {
    throw Error('An answer rule matches a card `kind` and its `asker`, and `then` gives its `answer`.');
  }
  if (typeof said !== 'string' || !said.trim() || said.length > LONGEST_SAID) {
    throw Error(`A standing rule needs \`said\`, the sentence the user heard, up to ${LONGEST_SAID} characters.`);
  }
}

const isWhole = rule => {
  try {
    assertRule(rule);
    return typeof rule.id === 'string' && typeof rule.savedAt === 'string';
  } catch {
    return false;
  }
};

function savedRules(root) {
  const rules = readJson(rulesPath(root), null)?.rules;
  return Array.isArray(rules) ? rules : [];
}

/** Every whole rule, oldest first. A missing file, or one that does not parse, is no rules. */
export const readStandingRules = root => savedRules(root).filter(isWhole);

const writeRules = (root, rules) => atomicJson(rulesPath(root), { version: 1, rules });

function newId(rules) {
  let id;
  do {
    id = randomUUID().slice(0, 8);
  } while (rules.some(rule => rule.id === id));
  return id;
}

/**
 * Keeps the rule the user agreed to. One with the same kind and match takes the place of the older one, so two never disagree. An entry this
 * file cannot read is another writer's, so it stays as it was.
 */
export function saveStandingRule(root, { kind, match, then, said }, now = Date.now()) {
  assertRule({ kind, match, then, said });
  const replaced = rule => isWhole(rule) && rule.kind === kind && sameMatch(rule.match, match);
  const kept = savedRules(root).filter(rule => !replaced(rule));
  const rule = {
    id: newId(kept),
    kind,
    match,
    then,
    said: said.trim(),
    savedAt: new Date(now).toISOString(),
    by: 'user',
  };
  writeRules(root, [...kept, rule]);
  return rule;
}

/** Removes one rule by its id, and gives it back, or null when no rule has that id. */
export function forgetStandingRule(root, id) {
  const rules = savedRules(root);
  const rule = rules.find(entry => isWhole(entry) && entry.id === id) ?? null;
  if (rule) writeRules(root, rules.filter(entry => entry !== rule));
  return rule;
}

/**
 * The newest `answer` rule that settles this card: every field of its match is the card's, its kind and its asker among them, and its answer
 * is one of the card's choices. A card that cannot be undone, or whose kind is guarded (`outward.mjs`), is never answered by a rule.
 */
export function findAnswerRule(root, card) {
  if (card.reversible === false || isGuardedKind(card.kind)) return null;

  const values = new Set((card.choices ?? []).map(({ value }) => value));
  const matchesCard = match => Object.entries(match).every(([field, value]) => card[field] !== undefined && card[field] === value);
  const settles = ({ kind, match, then }) => kind === 'answer' && matchesCard(match) && values.has(then.answer);
  return readStandingRules(root).findLast(settles) ?? null;
}

/** `hobkin decisions rules`: what the user settled for good, and `forget <id>` to undo one. */
export function runRulesCommand(root, [action, id] = []) {
  if (!action) return { rules: readStandingRules(root) };
  if (action !== 'forget' || !id) throw Error(USAGE);
  const rule = forgetStandingRule(root, id);
  return rule
    ? { ok: true, id, message: `Forgotten: ${rule.said} hobkin asks about this again.` }
    : { ok: true, message: 'No standing rule has that id, so nothing changed.' };
}
