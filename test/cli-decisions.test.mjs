import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { openCheck } from '../src/cli/checks.mjs';
import { buildContext } from '../src/cli/context.mjs';
import {
  answerDecision, answeredByUser, decisionRow, fileDecision, findDecision, markShown, openDecisions, runDecideCommand, tickDecisionDefaults,
} from '../src/cli/decisions.mjs';
import { readEvents } from '../src/cli/events.mjs';
import { inboxToTell } from '../src/cli/inbox.mjs';
import { readStandingRules, saveStandingRule } from '../src/cli/standing-rules.mjs';

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

const laterOrMerge = [{ value: 'later', label: 'Later' }, { value: 'merge', label: 'Merge it' }];
const card = (fields = {}) => Readable.from([JSON.stringify({ question: 'Merge the typo fix?', choices: laterOrMerge, recommended: 'merge', ...fields })]);
const FILED = Date.parse('2026-11-26T09:00:00Z');
const LATER = '2026-11-26T17:00:00.000Z';

test('a card keeps how sure the asker is, whether it can be undone, its deadline, its kind and what it would learn', async t => {
  const root = home(t);
  const fields = { sure: 'medium', reversible: true, deadline: LATER, kind: 'merge-small-fix', learn: true, rule: 'From now on, small fixes merge without asking.' };

  await runDecideCommand(root, ['routine', 'site'], card(fields), FILED);

  const [filed] = openDecisions(root);
  assert.deepEqual({ sure: filed.sure, reversible: filed.reversible, deadline: filed.deadline, kind: filed.kind, learn: filed.learn, rule: filed.rule }, fields);
  assert.equal(filed.recommended, 'merge', 'recommended stays the pick');
  const { kind, ...rest } = fields;
  const row = decisionRow(filed);
  assert.deepEqual([row.kind, row.class], ['routine', kind], 'the row\'s kind says who asked, so the card\'s class goes by class');
  assert.deepEqual(Object.entries(row).filter(([name]) => name in rest), Object.entries(rest));
});

test('a card without those fields is filed as before, and the row leaves them out', async t => {
  const root = home(t);

  await runDecideCommand(root, ['routine', 'site'], card(), FILED);

  const [filed] = openDecisions(root);
  for (const name of ['sure', 'reversible', 'deadline', 'kind', 'learn', 'rule']) assert.equal(filed[name], null, name);
  assert.deepEqual(Object.keys(decisionRow(filed)), ['id', 'from', 'kind', 'at', 'question', 'choices', 'recommended', 'why']);
});

test('a card filed again under its key says only what it says now, so one that drops its deadline does not take its pick', async t => {
  const root = home(t);
  await runDecideCommand(root, ['routine', 'site'], card({ key: 'fix', sure: 'high', reversible: true, deadline: LATER, kind: 'merge-small-fix' }), FILED);

  await runDecideCommand(root, ['routine', 'site'], card({ key: 'fix', question: 'Merge the fix? It now drops a table.' }), FILED + 1000);

  const [filed] = openDecisions(root);
  assert.deepEqual([filed.sure, filed.reversible, filed.deadline, filed.kind], [null, null, null, null]);
  assert.deepEqual(await tickDecisionDefaults(root, Date.parse(LATER) + 1000), []);
  assert.equal(openDecisions(root).length, 1);
});

test('card fields are checked, and a card that fails is not filed', async t => {
  const root = home(t);
  const refused = [
    [{ sure: 'very' }, /`sure` is high, medium or low/],
    [{ reversible: 'yes' }, /`reversible` is true or false/],
    [{ deadline: 'tomorrow' }, /`deadline` is a time still to come/],
    [{ deadline: '2026-11-25T09:00:00Z' }, /`deadline` is a time still to come/],
    [{ kind: 'Merge small fix!' }, /`kind` is a short class/],
    [{ learn: true, kind: 'merge-small-fix' }, /`learn` needs `rule`/],
    [{ learn: true, rule: 'From now on, merge.' }, /`learn` needs `kind`/],
    [{ learn: true, kind: 'merge-small-fix', rule: 'From now on, merge.', recommended: undefined }, /`learn` needs `recommended`/],
    [{ rule: 'x'.repeat(301) }, /`rule` is one sentence/],
  ];

  for (const [fields, why] of refused) await assert.rejects(runDecideCommand(root, ['routine', 'site'], card(fields), FILED), why);
  assert.deepEqual(openDecisions(root), []);
});

test('the filed event names the topic as a hash, never its words, so a question asked again can be counted', async t => {
  const root = home(t);
  await runDecideCommand(root, ['routine', 'site'], card({ kind: 'merge-small-fix' }), FILED);
  await runDecideCommand(root, ['routine', 'bank'], card({ kind: 'merge-small-fix', question: 'Merge the readme fix?' }), FILED);

  const filed = readEvents(root).filter(({ type }) => type === 'decision_filed');
  assert.equal(filed.length, 2);
  assert.match(filed[0].topic, /^[0-9a-f]{12}$/);
  assert.equal(filed[0].topic, filed[1].topic, 'one kind is one topic');
  assert.doesNotMatch(JSON.stringify(filed), /merge-small-fix|typo/);
});

const learnCard = (fields = {}) => card({ kind: 'merge-small-fix', learn: true, rule: 'From now on, small fixes merge without asking.', ...fields });

test('a learn card shows its rule as one more choice, and that choice takes the pick and keeps the rule', async t => {
  const root = home(t);
  const { id } = await runDecideCommand(root, ['routine', 'site'], learnCard({ key: 'typo' }), FILED);

  const [filed] = openDecisions(root);
  assert.deepEqual(filed.choices, [...laterOrMerge, { value: 'always', label: 'Always: From now on, small fixes merge without asking.' }]);
  assert.equal(filed.recommended, 'merge', 'the pick stays the asker\'s own');
  answerDecision(root, id, 'always', FILED + 60000);

  const asked = await runDecideCommand(root, ['routine', 'site'], learnCard({ key: 'typo' }), FILED + DAY_MS);
  assert.deepEqual([asked.answer, asked.label], ['merge', 'Merge it'], 'the asker hears the pick');
  const [rule] = readStandingRules(root);
  assert.deepEqual([rule.kind, rule.match, rule.then, rule.said, rule.by], ['answer', { kind: 'merge-small-fix', asker: 'routine:site' }, { answer: 'merge', label: 'Merge it' }, 'From now on, small fixes merge without asking.', 'user']);

  const again = await runDecideCommand(root, ['routine', 'site'], card({ kind: 'merge-small-fix', question: 'Merge the readme fix?' }), FILED + 40 * DAY_MS);

  assert.deepEqual(openDecisions(root), [], 'nothing was filed, even past the 30 days of the key recall');
  assert.deepEqual([again.ok, again.answer, again.label, again.rule.id, again.rule.said], [true, 'merge', 'Merge it', rule.id, rule.said]);
  assert.match(again.message, /2026-11-26.*From now on, small fixes merge without asking\./);
  const recalled = readEvents(root).filter(({ type }) => type === 'decision_recalled');
  assert.deepEqual(recalled.map(({ routine, by }) => [routine, by]), [['site', undefined], ['site', 'rule']]);
});

test('a learn card gives up to five choices of its own, none of them always, and only where a rule could answer it again', async t => {
  const root = home(t);
  const five = ['a', 'b', 'c', 'd', 'merge'].map(value => ({ value, label: value }));
  const refused = [
    [['routine', 'site'], learnCard({ choices: [...five, { value: 'f', label: 'f' }] }), /up to 5 choices/],
    [['routine', 'site'], learnCard({ choices: [{ value: 'always', label: 'Always' }, laterOrMerge[1]] }), /none of them `always`/],
    [['work', 'api', 'abc'], learnCard(), /a rule could answer again/],
    [['routine', 'site'], learnCard({ reversible: false }), /a rule could answer again/],
    [['routine', 'site'], learnCard({ kind: 'email-reply' }), /a rule could answer again/],
  ];

  for (const [args, input, why] of refused) await assert.rejects(runDecideCommand(root, args, input, FILED), why);
  assert.deepEqual(openDecisions(root), []);
  await runDecideCommand(root, ['routine', 'site'], learnCard({ choices: five }), FILED);
  assert.equal(openDecisions(root)[0].choices.length, 6);
});

test('a rule answers only its own routine, and never a card that cannot be undone or whose kind is guarded', async t => {
  const root = home(t);
  const { id } = await runDecideCommand(root, ['routine', 'site'], learnCard(), FILED);
  answerDecision(root, id, 'always', FILED);
  saveStandingRule(root, { kind: 'answer', match: { kind: 'email-reply', asker: 'routine:site' }, then: { answer: 'merge', label: 'Merge it' }, said: 'From now on, replies go.' }, FILED);

  await runDecideCommand(root, ['routine', 'backup'], card({ kind: 'merge-small-fix', question: 'Skip the backup?' }), FILED);
  await runDecideCommand(root, ['routine', 'site'], card({ kind: 'merge-small-fix', question: 'Merge the schema fix?', reversible: false }), FILED);
  await runDecideCommand(root, ['routine', 'site'], card({ kind: 'email-reply', question: 'Reply to the landlord?' }), FILED);

  assert.deepEqual(openDecisions(root).map(({ from, kind }) => [from, kind]), [['Routine backup', 'merge-small-fix'], ['Routine site', 'merge-small-fix'], ['Routine site', 'email-reply']]);
  assert.equal(readEvents(root).some(({ type }) => type === 'decision_recalled'), false);
});

test('a learn card answered with its pick, another way, or in the user\'s own words keeps no rule, nor a card whose own choice is always', async t => {
  const root = home(t);
  const pick = await runDecideCommand(root, ['routine', 'news'], learnCard(), FILED);
  const first = await runDecideCommand(root, ['routine', 'site'], learnCard(), FILED);
  const second = await runDecideCommand(root, ['routine', 'docs'], learnCard(), FILED);
  const own = await runDecideCommand(root, ['routine', 'mail'], card({ kind: 'mail-sort', choices: [{ value: 'once', label: 'Once' }, { value: 'always', label: 'Every time' }], recommended: 'once' }), FILED);

  answerDecision(root, own.id, 'always', FILED);
  answerDecision(root, pick.id, 'merge', FILED);
  answerDecision(root, first.id, 'later', FILED);
  answerDecision(root, second.id, 'typed', FILED, { typed: 'merge this one only' });

  assert.deepEqual(readStandingRules(root), []);
});

test('a rule answers only a routine, only when its answer is a choice, and changed still asks', async t => {
  const root = home(t);
  saveStandingRule(root, { kind: 'answer', match: { kind: 'merge-small-fix', asker: 'routine:site' }, then: { answer: 'merge', label: 'Merge it' }, said: 'From now on, small fixes merge without asking.' }, FILED);

  await runDecideCommand(root, ['work', 'api', 'abc'], card({ kind: 'merge-small-fix' }), FILED);
  await runDecideCommand(root, [], card({ kind: 'merge-small-fix', key: 'other' }), FILED, 'Claude Code');
  await runDecideCommand(root, ['routine', 'site'], card({ kind: 'merge-small-fix', key: 'close', choices: [{ value: 'later', label: 'Later' }, { value: 'close', label: 'Close it' }], recommended: 'close' }), FILED);
  await runDecideCommand(root, ['routine', 'site'], card({ kind: 'merge-small-fix', changed: 'It touches the login now.' }), FILED);

  assert.deepEqual(openDecisions(root).map(({ from }) => from), ['Work mode, api', 'Claude Code', 'Routine site', 'Routine site']);
});

test('a reversible card past its deadline takes its pick, the asker hears nobody answered, and it is no answer of the user\'s', async t => {
  const root = home(t);
  const { id } = await runDecideCommand(root, ['routine', 'site'], card({ reversible: true, deadline: LATER }), FILED);
  const deadline = Date.parse(LATER);

  assert.deepEqual(await tickDecisionDefaults(root, deadline - 1), []);
  assert.deepEqual(await tickDecisionDefaults(root, deadline), [id]);

  assert.deepEqual(openDecisions(root), []);
  assert.deepEqual(answeredByUser(root), []);
  assert.match(openCheck(root, 'site').memory.text, /The user was asked: Merge the typo fix\? Nobody answered by its deadline, so it took the recommended choice: Merge it/);
  const defaulted = readEvents(root).filter(({ type }) => type === 'decision_defaulted');
  assert.deepEqual(defaulted, [{ at: LATER, type: 'decision_defaulted', id, source: 'routine', ms: deadline - FILED }]);
  assert.equal(readEvents(root).some(({ type }) => type === 'decision_answered'), false);
  assert.deepEqual(await tickDecisionDefaults(root, deadline + 60000), [], 'once');
});

test('a pick taken at its deadline is no answer to recall: the same question asked again is filed', async t => {
  const root = home(t);
  await runDecideCommand(root, ['routine', 'site'], card({ key: 'fix', reversible: true, deadline: LATER }), FILED);
  await tickDecisionDefaults(root, Date.parse(LATER));

  const again = await runDecideCommand(root, ['routine', 'site'], card({ key: 'fix' }), Date.parse(LATER) + DAY_MS);

  assert.ok(again.id, 'filed');
  assert.equal(again.answer, undefined);
  assert.equal(openDecisions(root).length, 1);
  assert.equal(readEvents(root).some(({ type }) => type === 'decision_recalled'), false);
});

test('a learn card that takes its pick at its deadline keeps no rule', async t => {
  const root = home(t);
  const { id } = await runDecideCommand(root, ['routine', 'site'], learnCard({ reversible: true, deadline: LATER }), FILED);

  assert.deepEqual(await tickDecisionDefaults(root, Date.parse(LATER)), [id]);

  assert.deepEqual(readStandingRules(root), [], 'only the user\'s yes keeps a rule');
});

test('another session\'s card and a card of a guarded kind wait for the user, whatever they say of undoing', async t => {
  const root = home(t);
  await runDecideCommand(root, [], card({ reversible: true, deadline: LATER }), FILED, 'Claude Code');
  await runDecideCommand(root, ['routine', 'mail'], card({ kind: 'email-reply', reversible: true, deadline: LATER }), FILED);

  assert.deepEqual(await tickDecisionDefaults(root, Date.parse(LATER) + 60000), []);
  assert.equal(openDecisions(root).length, 2);
  assert.deepEqual(inboxToTell(root, Date.parse(LATER) + 60000), []);
});

test('a card that cannot be undone, has no pick, says nothing of undoing or whose deadline is ahead keeps waiting', async t => {
  const root = home(t);
  await runDecideCommand(root, ['routine', 'a'], card({ reversible: false, deadline: LATER }), FILED);
  await runDecideCommand(root, ['routine', 'b'], card({ reversible: true, deadline: LATER, recommended: undefined }), FILED);
  await runDecideCommand(root, ['routine', 'c'], card({ deadline: LATER }), FILED);
  await runDecideCommand(root, ['routine', 'd'], card({ reversible: true, deadline: '2026-11-27T09:00:00Z' }), FILED);

  assert.deepEqual(await tickDecisionDefaults(root, Date.parse(LATER) + 60000), []);
  assert.equal(openDecisions(root).length, 4);
});

test('a card whose asker cannot hear the default stays open for the next tick, and the others still default', async t => {
  const root = home(t);
  const work = await runDecideCommand(root, ['work', 'gone', 'abc'], card({ reversible: true, deadline: LATER }), FILED);
  const routine = await runDecideCommand(root, ['routine', 'site'], card({ reversible: true, deadline: LATER }), FILED);

  assert.deepEqual(await tickDecisionDefaults(root, Date.parse(LATER)), [routine.id]);
  assert.deepEqual(openDecisions(root).map(({ id }) => id), [work.id]);
});
