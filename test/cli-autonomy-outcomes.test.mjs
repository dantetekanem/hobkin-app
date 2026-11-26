import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { carryOutAnswer } from '../src/cli/answer.mjs';
import { PROMOTION_STREAK, noteOutcome, readAutonomy } from '../src/cli/autonomy.mjs';
import { markAlways, openDecisions } from '../src/cli/decisions.mjs';
import { readStandingRules } from '../src/cli/standing-rules.mjs';

const NOW = Date.parse('2026-11-26T20:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-autonomy-outcomes-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const cleanRuns = (root, taskClass, count) => {
  for (let run = 0; run < count; run += 1) noteOutcome(root, taskClass, { clean: true }, NOW + run);
};
const promotionCards = root => openDecisions(root).filter(({ answerTo }) => answerTo?.kind === 'autonomy');

test('a clean run that makes a class due files its promotion question once, as a card no rule can settle', t => {
  const root = home(t);

  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK + 2);

  const cards = promotionCards(root);
  assert.equal(cards.length, 1, 'one question, however many clean runs follow it');
  const [card] = cards;
  assert.deepEqual(card.answerTo, { kind: 'autonomy', taskClass: 'code-fix:api' });
  assert.equal(card.kind, 'autonomy');
  assert.equal(card.learn, null);
  assert.equal(card.recommended, 'yes');
  assert.deepEqual(card.choices.map(({ value }) => value), ['yes', 'no']);
  assert.throws(() => markAlways(root, [card.id]), /no rule could answer it again/);
  assert.equal(readAutonomy(root)['code-fix:api'].level, 'recommend', 'asking changes nothing');
});

test('a class with its question open gets no second one, even once its level has moved', t => {
  const root = home(t);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);

  noteOutcome(root, 'code-fix:api', { clean: false, override: true }, NOW);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);

  assert.equal(readAutonomy(root)['code-fix:api'].level, 'draft');
  assert.equal(promotionCards(root).length, 1);
});

test('only a clean run asks, and only for its own class', t => {
  const root = home(t);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK - 1);

  noteOutcome(root, 'code-fix:api', { clean: true, checksPassed: false }, NOW);
  cleanRuns(root, 'code-fix:web', PROMOTION_STREAK);

  assert.deepEqual(promotionCards(root).map(({ answerTo }) => answerTo.taskClass), ['code-fix:web']);
});

test('the user\'s yes moves the class one level and their no keeps it there, and neither keeps a standing rule', async t => {
  const root = home(t);
  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);
  const [asked] = promotionCards(root);

  const yes = await carryOutAnswer(root, asked.id, { value: 'yes' }, NOW);

  assert.equal(readAutonomy(root)['code-fix:api'].level, 'deadline');
  assert.match(yes.message, /code-fix:api now acts at a deadline unless you object/);
  assert.deepEqual(promotionCards(root), []);

  cleanRuns(root, 'code-fix:api', PROMOTION_STREAK);
  const [again] = promotionCards(root);
  assert.notEqual(again.id, asked.id);
  const no = await carryOutAnswer(root, again.id, { value: 'no' }, NOW);

  const row = readAutonomy(root)['code-fix:api'];
  assert.deepEqual([row.level, row.cleanStreak], ['deadline', 0]);
  assert.match(no.message, /code-fix:api still acts at a deadline unless you object/);
  assert.deepEqual(readStandingRules(root), []);
});

test('an outcome the ledger cannot take never stops the work it records', t => {
  const root = home(t);

  assert.equal(noteOutcome(root, 'Not A Class', { clean: true }, NOW), null);
});
