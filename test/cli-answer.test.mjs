import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carryOutAnswer, runDecisionsCommand } from '../src/cli/answer.mjs';
import { openCheck } from '../src/cli/checks.mjs';
import { readDecided } from '../src/cli/decided.mjs';
import { answeredByUser, fileDecision, openDecisions } from '../src/cli/decisions.mjs';
import { readEvents } from '../src/cli/events.mjs';
import { parseArguments } from '../src/cli/main.mjs';
import { chooseProject, fileItem, readItems, readMode, updateItem } from '../src/cli/work/store.mjs';

const keepOrArchive = [{ value: 'no', label: 'Keep it' }, { value: 'yes', label: 'Archive it' }];
const NOW = Date.parse('2026-11-05T12:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-answer-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const askMail = (root, extra = {}) => fileDecision(root, {
  from: 'Routine mail',
  question: 'Archive the old invoices?',
  choices: keepOrArchive,
  answerTo: { kind: 'routine', id: 'mail' },
  ...extra,
}, NOW - 60000).id;

test('an answer from Chat does what the same choice on screen does, and goes on record as the user\'s own', async t => {
  const root = home(t);
  const id = askMail(root);

  const result = await carryOutAnswer(root, id, { value: 'yes' }, NOW);

  assert.equal(result.message, 'Answered: Archive it.');
  assert.deepEqual(openDecisions(root), []);
  assert.deepEqual(answeredByUser(root).map(({ answer }) => answer), ['yes']);
  assert.match(openCheck(root, 'mail').memory.text, /The user was asked: Archive the old invoices\? They answered: Archive it/);
  assert.deepEqual(readEvents(root).filter(({ type }) => type === 'decision_answered').map(({ id: answered, source }) => [answered, source]), [[id, 'routine']]);
});

test('their own words reach the asker as their words, and the record keeps them', async t => {
  const root = home(t);
  const id = askMail(root);

  const result = await carryOutAnswer(root, id, { typed: 'archive only the 2024 ones' }, NOW);

  assert.equal(result.message, 'Answered in their own words.');
  assert.deepEqual(openDecisions(root), []);
  assert.match(openCheck(root, 'mail').memory.text, /They answered in their own words: archive only the 2024 ones/);
  const [answered] = answeredByUser(root);
  assert.deepEqual([answered.answer, answered.typed], ['typed', 'archive only the 2024 ones']);
  assert.match(readDecided(root, NOW).join('\n'), /they wrote "archive only the 2024 ones"/);
});

const finishedBranch = root => {
  chooseProject(root, '/repos/api', 'important');
  const { id } = fileItem(root, 'api', { key: 'fix', kind: 'fix', title: 'Fix login', brief: 'The first change.' });
  updateItem(root, 'api', id, { state: 'branch', branch: 'hobkin/login' });
  return id;
};

test('their own words to an offer hold it for a day, as Later does, while whoever heard them acts', async t => {
  const root = home(t);
  const item = finishedBranch(root);
  const choices = [{ value: 'later', label: 'Later' }, { value: 'merge', label: 'Merge it' }];
  const { id } = fileDecision(root, { key: `offer:api:${item}`, from: 'Work mode', question: 'Merge Fix login?', choices, answerTo: { kind: 'merge', slug: 'api', item, head: 'tip' } }, NOW);

  await carryOutAnswer(root, id, { typed: 'merge it after the call' }, NOW);

  const [held] = readItems(root, 'api');
  assert.equal(held.offerHeldUntil, new Date(NOW + 24 * 3600000).toISOString());
  assert.equal(held.state, 'branch');
});

test('their own words to a pair keep that pair from being brought again until it has moved', async t => {
  const root = home(t);
  const item = finishedBranch(root);
  const rows = [{ slug: 'api', item, step: 'land', head: 'tip' }];
  const choices = [{ value: 'later', label: 'Later' }, { value: 'go', label: 'Do these two' }];
  const { id } = fileDecision(root, { key: 'pair', from: 'Work mode', question: 'Move these two?', choices, answerTo: { kind: 'pair', rows } }, NOW);

  await carryOutAnswer(root, id, { typed: 'only the login one' }, NOW);

  assert.deepEqual(readMode(root).ship.last.rows, rows);
  assert.deepEqual(openDecisions(root), []);
});

test('a choice the question does not have, or a question already answered, changes nothing', async t => {
  const root = home(t);
  const id = askMail(root);

  await assert.rejects(carryOutAnswer(root, id, { value: 'maybe' }, NOW), /not one of its choices: no, yes/);
  assert.equal(openDecisions(root).length, 1);
  await assert.rejects(carryOutAnswer(root, 'missing', { value: 'yes' }, NOW), /already answered/);
  await assert.rejects(carryOutAnswer(root, id, {}, NOW), /choices or their own words/);
});

test('hobkin decisions lists what is open with what answers it, and answers by value or in words', async t => {
  const root = home(t);
  const first = askMail(root, { recommended: 'no', why: 'Archiving cannot be undone.' });
  const second = askMail(root, { question: 'Reply to the bank today?', key: 'bank' });

  const listed = await runDecisionsCommand(root, [], { now: NOW });
  assert.deepEqual(listed.decisions.map(({ id, choices, recommended }) => [id, choices.map(({ value }) => value), recommended]), [
    [first, ['no', 'yes'], 'no'],
    [second, ['no', 'yes'], null],
  ]);

  assert.equal((await runDecisionsCommand(root, ['answer', first, 'no'], { now: NOW })).ok, true);
  assert.equal((await runDecisionsCommand(root, ['answer', second], { typed: 'tomorrow, after the call', now: NOW })).ok, true);
  assert.deepEqual(openDecisions(root), []);
  await assert.rejects(runDecisionsCommand(root, ['answer'], { now: NOW }), /hobkin decisions answer <id> <value>/);
});

test('the command line takes the words in one argument', () => {
  const options = parseArguments(['decisions', 'answer', 'abc', '--typed', 'only the 2024 ones', '--home', '/tmp/h']);

  assert.deepEqual([options.command, options.args, options.typed, options.root], ['decisions', ['answer', 'abc'], 'only the 2024 ones', '/tmp/h']);
});
