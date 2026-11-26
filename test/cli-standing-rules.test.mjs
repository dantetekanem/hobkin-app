import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { openCheck } from '../src/cli/checks.mjs';
import { openDecisions, runDecideCommand } from '../src/cli/decisions.mjs';
import { main } from '../src/cli/main.mjs';
import { findAnswerRule, forgetStandingRule, readStandingRules, saveStandingRule } from '../src/cli/standing-rules.mjs';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const merge = { kind: 'answer', match: { kind: 'merge-small-fix', asker: 'routine:site' }, then: { answer: 'merge', label: 'Merge it' }, said: 'From now on, small fixes merge without asking.' };

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-rules-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function workspace(t) {
  const root = home(t);
  atomicJson(join(root, 'config.json'), initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' }));
  return root;
}

async function run(args) {
  let text = '';
  const code = await main(args, { write: chunk => { text += chunk; } });
  return { code, json: JSON.parse(text) };
}

test('a standing rule is saved in runtime/standing-rules.json in the format every reader shares', t => {
  const root = home(t);

  const saved = saveStandingRule(root, merge, NOW);

  const file = JSON.parse(readFileSync(join(root, 'runtime', 'standing-rules.json'), 'utf8'));
  assert.deepEqual(file, { version: 1, rules: [{ id: saved.id, ...merge, savedAt: '2026-11-26T12:00:00.000Z', by: 'user' }] });
  assert.match(saved.id, /^[0-9a-f]{8}$/);
  assert.deepEqual(readStandingRules(root), file.rules);
});

test('a rule with the same kind and match takes the place of the older one', t => {
  const root = home(t);
  saveStandingRule(root, merge, NOW);
  saveStandingRule(root, { kind: 'outward', match: { kind: 'merge-small-fix' }, then: { allow: true }, said: 'Sending is fine.' }, NOW);

  saveStandingRule(root, { ...merge, then: { answer: 'later', label: 'Later' }, said: 'From now on, small fixes wait.' }, NOW + 1000);

  assert.deepEqual(readStandingRules(root).map(({ kind, then }) => [kind, then]), [['outward', { allow: true }], ['answer', { answer: 'later', label: 'Later' }]]);
});

test('a rule needs a kind, a match, what follows and the sentence that said it back', t => {
  const root = home(t);

  assert.throws(() => saveStandingRule(root, { ...merge, kind: 'maybe' }), /answer or outward/);
  assert.throws(() => saveStandingRule(root, { ...merge, match: {} }), /match/);
  assert.throws(() => saveStandingRule(root, { ...merge, then: null }), /then/);
  assert.throws(() => saveStandingRule(root, { ...merge, said: ' ' }), /said/);
  assert.throws(() => saveStandingRule(root, { ...merge, then: { label: 'Merge it' } }), /gives its `answer`/);
  assert.throws(() => saveStandingRule(root, { ...merge, match: { kind: 'merge-small-fix' } }), /its `asker`/);
  assert.deepEqual(readStandingRules(root), []);
});

test('an outward rule in the one-word shape the guard reads is kept and read back', t => {
  const root = home(t);

  saveStandingRule(root, { kind: 'outward', match: 'send', then: 'allow', said: 'From now on, replies to the landlord can go without asking.' }, NOW);

  assert.deepEqual(readStandingRules(root).map(({ match, then }) => [match, then]), [['send', 'allow']]);
});

test('a rule answers a card of its kind from its asker only when that card offers its answer', t => {
  const root = home(t);
  const { id } = saveStandingRule(root, merge, NOW);
  const card = choices => ({ kind: 'merge-small-fix', asker: 'routine:site', choices: choices.map(value => ({ value, label: value })) });

  assert.equal(findAnswerRule(root, card(['later', 'merge']))?.id, id);
  assert.equal(findAnswerRule(root, { ...card(['later', 'merge']), reversible: true })?.id, id);
  assert.equal(findAnswerRule(root, card(['later', 'close'])), null);
  assert.equal(findAnswerRule(root, { ...card(['merge']), kind: 'merge-big-change' }), null);
  assert.equal(findAnswerRule(root, { choices: card(['merge']).choices, asker: 'routine:site' }), null, 'a card with no kind matches no rule');
  assert.equal(findAnswerRule(root, { ...card(['merge']), asker: 'routine:backup' }), null, 'another routine means something else by the kind');
});

test('no rule answers a card that cannot be undone, or one whose kind is guarded', t => {
  const root = home(t);
  saveStandingRule(root, merge, NOW);
  saveStandingRule(root, { ...merge, match: { kind: 'email-reply', asker: 'routine:site' } }, NOW);
  const card = kind => ({ kind, asker: 'routine:site', choices: [{ value: 'merge', label: 'Merge it' }] });

  assert.equal(findAnswerRule(root, { ...card('merge-small-fix'), reversible: false }), null);
  assert.equal(findAnswerRule(root, card('email-reply')), null);
});

test('forgetting a rule removes it and keeps the rest', t => {
  const root = home(t);
  const { id } = saveStandingRule(root, merge, NOW);
  saveStandingRule(root, { ...merge, match: { kind: 'routine-time', asker: 'routine:site' } }, NOW);

  assert.equal(forgetStandingRule(root, id)?.id, id);
  assert.equal(forgetStandingRule(root, id), null);
  assert.deepEqual(readStandingRules(root).map(({ match }) => match.kind), ['routine-time']);
});

test('an entry that is not a whole rule is not read, and saving or forgetting leaves it as it was', t => {
  const root = home(t);
  const { id } = saveStandingRule(root, merge, NOW);
  const file = join(root, 'runtime', 'standing-rules.json');
  atomicJson(file, { version: 1, rules: [{ id: 'x' }, ...readStandingRules(root)] });

  assert.deepEqual(readStandingRules(root).map(rule => rule.id), [id]);
  forgetStandingRule(root, id);
  saveStandingRule(root, { ...merge, match: { kind: 'routine-time', asker: 'routine:site' } }, NOW);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).rules[0], { id: 'x' });
});

test('hobkin decisions rules lists the rules, and forget removes one by its id', async t => {
  const root = workspace(t);
  const { id } = saveStandingRule(root, merge, NOW);

  const listed = await run(['decisions', 'rules', '--home', root]);
  assert.equal(listed.code, 0);
  assert.deepEqual(listed.json.rules.map(rule => [rule.id, rule.said]), [[id, merge.said]]);

  const forgot = await run(['decisions', 'rules', 'forget', id, '--home', root]);
  assert.equal(forgot.json.ok, true);
  assert.deepEqual(readStandingRules(root), []);
  await assert.rejects(main(['decisions', 'rules', 'drop', '--home', root], { write() {} }), /hobkin decisions rules forget <id>/);
});

test('hobkin decisions always answers with the pick and keeps it as a rule, said back in plain words', async t => {
  const root = workspace(t);
  const asked = JSON.stringify({ question: 'Merge the typo fix?', kind: 'merge-small-fix', choices: [{ value: 'later', label: 'Later' }, { value: 'merge', label: 'Merge it' }], recommended: 'merge' });
  const { id } = await runDecideCommand(root, ['routine', 'site'], Readable.from([asked]), NOW);

  const answered = await run(['decisions', 'always', id, '--home', root]);

  assert.equal(answered.json.ok, true);
  assert.deepEqual(openDecisions(root), []);
  assert.match(openCheck(root, 'site').memory.text, /They answered: Merge it/);
  const [rule] = readStandingRules(root);
  assert.deepEqual([rule.kind, rule.match, rule.then], ['answer', { kind: 'merge-small-fix', asker: 'routine:site' }, { answer: 'merge', label: 'Merge it' }]);
  assert.equal(rule.said, 'From now on, questions of the kind merge-small-fix take "Merge it" without asking.');
});

test('always needs a card a rule could answer again: with a kind, from a routine or a session, undoable and not guarded', async t => {
  const root = workspace(t);
  const ask = (args, fields = {}) => runDecideCommand(root, args, Readable.from([JSON.stringify({
    question: 'Merge the typo fix?', choices: [{ value: 'later', label: 'Later' }, { value: 'merge', label: 'Merge it' }], recommended: 'merge', ...fields,
  })]), NOW);
  const always = id => main(['decisions', 'always', id, '--home', root], { write() {} });

  await assert.rejects(always((await ask(['routine', 'site'])).id), /no kind/);
  await assert.rejects(always((await ask(['work', 'api', 'abc'], { kind: 'merge-small-fix' })).id), /no rule could answer it again/);
  await assert.rejects(always((await ask(['routine', 'site'], { key: 'schema', kind: 'merge-small-fix', reversible: false })).id), /no rule could answer it again/);
  await assert.rejects(always((await ask(['routine', 'site'], { key: 'mail', kind: 'email-reply' })).id), /no rule could answer it again/);
  await assert.rejects(main(['decisions', 'always', '--home', root], { write() {} }), /hobkin decisions always <id>/);
  assert.equal(openDecisions(root).length, 4);
  assert.deepEqual(readStandingRules(root), []);
});
