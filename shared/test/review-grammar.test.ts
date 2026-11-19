import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkGrammar, GRAMMAR_CHECKER, GRAMMAR_EDITOR, type GrammarAsk } from '../review/grammar.ts'

/** A model that answers each pass as told, and writes down what each pass was asked. */
function model(answers: { editor?: unknown; checker?: unknown }) {
  const asked: { system: string; prompt: string }[] = []
  const ask: GrammarAsk = async ({ system, prompt }) => {
    asked.push({ system, prompt })
    const answer = system === GRAMMAR_EDITOR ? answers.editor : answers.checker
    if (answer instanceof Error) throw answer
    return answer === undefined ? null : typeof answer === 'string' ? answer : JSON.stringify(answer)
  }
  return { ask, asked }
}

test('a correction that is only grammar is made, and one that could change the meaning is only suggested', async () => {
  const texts = { body: 'this dont handle the retry', comments: ['rename it to totals', 'looks fine'] }
  const { ask, asked } = model({
    editor: { body: "This doesn't handle the retry.", comments: ['Rename it to total.', 'looks fine'] },
    checker: { judgments: [{ id: 'body', grammar_only: true }, { id: 'comment-0', grammar_only: false }] },
  })
  const checked = await checkGrammar(texts, ask)
  assert.deepEqual(checked, {
    kind: 'checked',
    texts: { body: "This doesn't handle the retry.", comments: ['rename it to totals', 'looks fine'] },
    fixed: 1,
    suggested: [{ original: 'rename it to totals', suggestion: 'Rename it to total.' }],
  })
  assert.deepEqual(asked.map((call) => call.system), [GRAMMAR_EDITOR, GRAMMAR_CHECKER])
  // The second pass sees each change beside what it was, and nothing that did not change.
  assert.ok(asked[1]!.prompt.includes('this dont handle the retry') && !asked[1]!.prompt.includes('looks fine'))
})

test('words with nothing to fix ask the second pass nothing', async () => {
  const { ask, asked } = model({ editor: { comments: ['Looks fine.'] } })
  assert.deepEqual(await checkGrammar({ comments: ['Looks fine.'] }, ask), { kind: 'checked', texts: { comments: ['Looks fine.'] }, fixed: 0, suggested: [] })
  assert.equal(asked.length, 1)
})

test('a malformed answer, a failing model or no model leaves every word as written and says why', async () => {
  const texts = { body: 'this dont handle the retry', comments: ['rename it'] }
  const malformed = [
    { editor: { body: 'This does not.', comments: [] } },
    { editor: { comments: ['Rename it.'] } },
    { editor: { body: 'Fixed.', comments: ['Rename it.'] }, checker: { judgments: [{ id: 'body', grammar_only: true }] } },
    { editor: 'not json at all' },
  ]
  for (const answers of malformed) {
    const checked = await checkGrammar(texts, model(answers).ask)
    assert.equal(checked.kind, 'unchecked', JSON.stringify(answers))
  }
  const failing = await checkGrammar(texts, model({ editor: new Error('the model is down') }).ask)
  assert.deepEqual(failing, { kind: 'unchecked', why: 'the check failed: the model is down' })
  assert.deepEqual(await checkGrammar(texts, model({}).ask), { kind: 'unchecked', why: 'no quick model is set' })
  // Nothing written is nothing to check.
  assert.deepEqual(await checkGrammar({ comments: [] }, model({}).ask), { kind: 'checked', texts: { comments: [] }, fixed: 0, suggested: [] })
})
