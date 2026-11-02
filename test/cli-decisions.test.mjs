import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { answerDecision, fileDecision, findDecision, markShown, openDecisions, runDecideCommand } from '../src/cli/decisions.mjs';

const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

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
