import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buildContext } from '../src/cli/context.mjs';
import { answerDecision, fileDecision, findDecision, markShown, openDecisions, runDecideCommand } from '../src/cli/decisions.mjs';
import { readEvents } from '../src/cli/events.mjs';

const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const iso = time => new Date(time).toISOString();

function home(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-decisions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a decision waits, oldest first, until it is answered', t => {
  const root = home(t);
  const first = fileDecision(root, { from: 'Work mode', question: 'First?', choices: yesNo }, 1000);
  const second = fileDecision(root, { from: 'Work mode', question: 'Second?', choices: yesNo }, 2000);

  assert.deepEqual(openDecisions(root).map(({ id }) => id), [first.id, second.id]);

  answerDecision(root, first.id, 'yes');

  assert.deepEqual(openDecisions(root).map(({ id }) => id), [second.id]);
});

test('the summary is what the asker gave, or the first sentence of the question', t => {
  const root = home(t);
  fileDecision(root, { from: 'Work mode', question: 'A long story. And more of it?', tldr: 'Keep the table?', choices: yesNo });
  fileDecision(root, { from: 'Work mode', question: 'The bank wrote back. Reply today?', choices: yesNo });

  assert.deepEqual(openDecisions(root).map(({ tldr }) => tldr), ['Keep the table?', 'The bank wrote back.']);
});

test('one key is one open decision: it stays shown and takes the newest words', t => {
  const root = home(t);
  const { id } = fileDecision(root, { key: 'land', from: 'Work mode', question: 'One can land?', choices: yesNo });
  markShown(root, id);

  const again = fileDecision(root, { key: 'land', from: 'Work mode', question: 'Two can land?', choices: yesNo });

  assert.equal(again.id, id);
  assert.deepEqual(openDecisions(root).map(({ question, shown }) => [question, shown]), [['Two can land?', true]]);
});

test('a question needs words and two to six distinct choices', t => {
  const root = home(t);

  assert.throws(() => fileDecision(root, { question: ' ', choices: yesNo }), /needs a question/);
  assert.throws(() => fileDecision(root, { question: 'Ok?', choices: yesNo.slice(1) }), /2 to 6/);
  assert.throws(() => fileDecision(root, { question: 'Ok?', choices: [yesNo[0], yesNo[0]] }), /2 to 6/);
  assert.deepEqual(openDecisions(root), []);
});

test('long words are cut to what the screen can use', t => {
  const root = home(t);
  fileDecision(root, { from: 'Work mode', question: 'x'.repeat(5000), choices: [{ value: 'a', label: 'y'.repeat(500) }, yesNo[1]] });

  const [{ question, tldr, choices }] = openDecisions(root);
  assert.equal(question.length, 1000);
  assert.equal(tldr.length, 100);
  assert.equal(choices[0].label.length, 80);
});

test('a routine is told how to ask, and work has its own command instead', async t => {
  const root = realpathSync(home(t));
  const schedule = { id: 'mail', title: 'Mail', prompt: 'Read mail.', cwd: root, harness: 'pi', model: null, context: [] };
  const check = { memory: null, log: [], decide: 'hobkin decide routine mail' };

  assert.match(await buildContext(schedule, null, [], check), /hobkin decide routine mail/);
  assert.doesNotMatch(await buildContext(schedule, null, [], check, { lane: 'do' }), /hobkin decide routine mail/);
});

test('a choice has to belong to the decision', t => {
  const root = home(t);
  const { id } = fileDecision(root, { from: 'Work mode', question: 'Ok?', choices: yesNo });

  assert.equal(findDecision(root, id, 'no').choice.label, 'No');
  assert.throws(() => findDecision(root, id, 'perhaps'), /not one of its choices/);
});

test('hobkin decide files from another process and says who to tell', async t => {
  const root = home(t);
  const input = () => Readable.from([JSON.stringify({ question: 'Delete it?', choices: yesNo })]);

  await runDecideCommand(root, ['routine', 'mail'], input());
  await runDecideCommand(root, ['work', 'api', 'abc'], input());

  assert.deepEqual(openDecisions(root).map(({ from, answerTo }) => [from, answerTo]), [
    ['Routine mail', { kind: 'routine', id: 'mail' }],
    ['Work mode, api', { kind: 'work', slug: 'api', item: 'abc' }],
  ]);
  await assert.rejects(runDecideCommand(root, [], input()), /Say who is asking/);
});

const DAY_MS = 86400000;
const asked = (fields = {}) => Readable.from([JSON.stringify({ question: 'Keep the old invoices?', choices: yesNo, ...fields })]);

test('a question carries what the asker recommends and why only the user can answer', t => {
  const root = home(t);
  fileDecision(root, { from: 'Routine mail', question: 'Ok?', choices: yesNo, recommended: 'no', why: 'It is your money.', changed: 'The bank wrote back.' });

  const [{ recommended, why, changed }] = openDecisions(root);
  assert.deepEqual({ recommended, why, changed }, { recommended: 'no', why: 'It is your money.', changed: 'The bank wrote back.' });
  assert.throws(() => fileDecision(root, { question: 'Ok?', choices: yesNo, recommended: 'perhaps' }), /one of its choices/);
});

test('a missing key comes from the question, so the same words asked twice are one open decision', async t => {
  const root = home(t);

  await runDecideCommand(root, ['routine', 'mail'], asked());
  await runDecideCommand(root, ['routine', 'mail'], asked({ question: '  keep the OLD invoices? ' }));

  assert.equal(openDecisions(root).length, 1);
});

test('one key from two askers is two questions', async t => {
  const root = home(t);

  await runDecideCommand(root, ['routine', 'mail'], asked({ key: 'invoices' }));
  await runDecideCommand(root, ['routine', 'bank'], asked({ key: 'invoices' }));

  assert.equal(openDecisions(root).length, 2);
});

test('a routine that asks what was answered in the last 30 days files nothing and gets that answer with its date', async t => {
  const root = home(t);
  const at = Date.parse('2026-10-20T10:00:00Z');
  const { id } = await runDecideCommand(root, ['routine', 'mail'], asked({ key: 'invoices' }), at);
  answerDecision(root, id, 'no', at);

  const again = await runDecideCommand(root, ['routine', 'mail'], asked({ key: 'invoices', question: 'Those invoices, keep them?' }), at + 29 * DAY_MS);

  assert.deepEqual(openDecisions(root), []);
  assert.equal(again.answer, 'no');
  assert.equal(again.label, 'No');
  assert.equal(again.answeredAt, '2026-10-20T10:00:00.000Z');
  assert.match(again.message, /2026-10-20.*No/);
});

test('another session always files, because two sessions in different projects can ask the same words about different things', async t => {
  const root = home(t);
  const at = Date.parse('2026-10-20T10:00:00Z');
  const { id } = await runDecideCommand(root, [], asked({ key: 'cleanup' }), at, 'Claude Code');
  answerDecision(root, id, 'yes', at);

  const again = await runDecideCommand(root, [], asked({ key: 'cleanup' }), at + DAY_MS, 'Pi in finboard');

  assert.equal(again.answer, undefined);
  assert.equal(openDecisions(root).length, 1);
});

test('an answer in the user\'s own words comes back to a routine as their words', async t => {
  const root = home(t);
  const at = Date.parse('2026-10-20T10:00:00Z');
  const { id } = await runDecideCommand(root, ['routine', 'mail'], asked({ key: 'invoices' }), at);
  answerDecision(root, id, 'typed', at, { typed: 'keep the 2024 ones only' });

  const again = await runDecideCommand(root, ['routine', 'mail'], asked({ key: 'invoices' }), at + DAY_MS);

  assert.equal(again.label, 'keep the 2024 ones only');
});

test('an answer given again from memory goes on the record, with who asked and none of the words', async t => {
  const root = home(t);
  const at = Date.parse('2026-10-20T10:00:00Z');
  const { id } = await runDecideCommand(root, ['routine', 'mail'], asked({ key: 'invoices' }), at);
  answerDecision(root, id, 'no', at);

  await runDecideCommand(root, ['routine', 'mail'], asked({ key: 'invoices' }), at + DAY_MS);

  const recalled = readEvents(root).filter(({ type }) => type === 'decision_recalled');
  assert.deepEqual(recalled, [{ at: iso(at + DAY_MS), type: 'decision_recalled', routine: 'mail' }]);
});

test('an answer older than 30 days is no answer, and the question is filed', async t => {
  const root = home(t);
  const at = Date.parse('2026-10-20T10:00:00Z');
  const { id } = await runDecideCommand(root, ['routine', 'mail'], asked(), at);
  answerDecision(root, id, 'no', at);

  const again = await runDecideCommand(root, ['routine', 'mail'], asked(), at + 31 * DAY_MS);

  assert.equal(again.answer, undefined);
  assert.equal(openDecisions(root).length, 1);
});

test('changed files an answered question again and says what is new', async t => {
  const root = home(t);
  const at = Date.parse('2026-10-20T10:00:00Z');
  const { id } = await runDecideCommand(root, ['routine', 'mail'], asked(), at);
  answerDecision(root, id, 'no', at);

  await runDecideCommand(root, ['routine', 'mail'], asked({ changed: 'The accountant asked for them.' }), at + DAY_MS);

  assert.deepEqual(openDecisions(root).map(({ changed }) => changed), ['The accountant asked for them.']);
});

test('a work run always files, because its one use of decide is deleting what git cannot restore', async t => {
  const root = home(t);
  const at = Date.parse('2026-10-20T10:00:00Z');
  const { id } = await runDecideCommand(root, ['work', 'api', 'abc'], asked(), at);
  answerDecision(root, id, 'no', at);

  const again = await runDecideCommand(root, ['work', 'api', 'abc'], asked(), at + DAY_MS);

  assert.equal(again.answer, undefined);
  assert.equal(openDecisions(root).length, 1);
});
