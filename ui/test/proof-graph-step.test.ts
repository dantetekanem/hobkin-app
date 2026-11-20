import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stateGraph } from '../src/features/proofs/graph/model.ts'
import { stateFacts, stepWindow } from '../src/features/proofs/graph/step.ts'
import { bareRun, brokenRun, holdingRun, traceOnlyRun } from './proof-graph-fixture.ts'

const facts = (run = brokenRun(), id: string, step?: number) => stateFacts(run, stateGraph(run), { id, ...(step == null ? {} : { step }) })
const row = (result: ReturnType<typeof facts>, name: string) => result.rows.find((entry) => entry.name === name)!

test('a step of the counterexample says where it is, what led to it, and where that lives in the code', () => {
  const result = facts(brokenRun(), 's5', 4)
  assert.equal(result.title, 'State 5 of 6')
  assert.equal(result.action, 'Fix(i1)')
  assert.equal(result.code, 'src/cli/work/runner.mjs:203')
  assert.equal(result.story, 'While a branch waits, an agent may push again. Here head[i1] goes from 1 to 2.')
  assert.deepEqual(result.columns, ['i1', 'i2'])
})

test('the variables table marks what changed and says what it was', () => {
  const head = row(facts(brokenRun(), 's5', 4), 'head')
  assert.deepEqual(head.cells[0], { text: '2', was: '1', changed: true, breaks: false, quiet: false })
  // i2 never moves in the counterexample, so its column steps back.
  assert.deepEqual(head.cells[1], { text: '0', changed: false, breaks: false, quiet: true })
})

test('at the state that breaks the rule, the variables the rule requires are red', () => {
  const result = facts(brokenRun(), 's6', 5)
  assert.equal(row(result, 'reviewed').cells[0]!.breaks, true)
  assert.equal(row(result, 'head').cells[0]!.breaks, true)
  // state changed here, but it is what the rule's condition reads, not what it requires.
  assert.deepEqual(row(result, 'state').cells[0], { text: '"merged"', was: '"branch"', changed: true, breaks: false, quiet: false })
  assert.equal(row(result, 'head').cells[1]!.breaks, false)
})

test('the rule is evaluated at the step: true before, false with its values where it breaks', () => {
  const before = facts(brokenRun(), 's4', 3).verdict
  assert.equal(before.tone, 'plain')
  assert.equal(before.title, 'Still true here')
  assert.equal(before.formula, 'state[i1] = "merged" ⇒ reviewed[i1] = head[i1]')
  const broken = facts(brokenRun(), 's6', 5).verdict
  assert.equal(broken.tone, 'bad')
  assert.equal(broken.title, 'This is where it breaks')
  assert.equal(broken.formula, 'state[i1] = "merged" ⇒ reviewed[i1] = head[i1]   is   1 = 2   FALSE')
  assert.match(broken.words, /^Whatever merged by itself/)
})

test('the first state tells how every run starts', () => {
  const result = facts(brokenRun(), 's1', 0)
  assert.equal(result.title, 'State 1 of 6')
  assert.equal(result.action, 'Init')
  assert.equal(result.story, 'Every item starts queued, with no pushes and no review.')
  assert.equal(row(result, 'state').cells[0]!.changed, false)
})

test('a state off the path is compared with the state on the path it leaves from', () => {
  const result = facts(brokenRun(), 'c')
  assert.equal(result.title, 'Another state')
  assert.equal(result.action, 'Fix')
  assert.equal(result.story, 'From state 3. While a branch waits, an agent may push again. Here head[i1] goes from 1 to 2.')
  assert.equal(row(result, 'head').cells[0]!.was, '1')
  assert.equal(result.verdict.title, 'Holds here')
})

test('in a model that holds, every state says the rules held', () => {
  const run = holdingRun()
  const result = stateFacts(run, stateGraph(run), { id: 's3' })
  assert.equal(result.verdict.tone, 'ok')
  assert.equal(result.verdict.title, 'Every rule holds here')
  assert.equal(result.verdict.formula, 'TypeOK ∧ MergedAtReviewedHead')
})

test('the trace alone is enough for the table and the verdict', () => {
  const run = traceOnlyRun()
  const graph = stateGraph(run)
  const result = stateFacts(run, graph, { id: graph.path[5]!, step: 5 })
  assert.equal(result.title, 'State 6 of 6')
  assert.equal(result.verdict.tone, 'bad')
})

test('a move TLC names without arguments still finds its words and code, and says which item it moved', () => {
  const run = bareRun()
  const graph = stateGraph(run)
  const result = stateFacts(run, graph, { id: graph.path[4]!, step: 4 })
  assert.equal(result.action, 'Fix · i1')
  assert.equal(result.code, 'src/cli/work/runner.mjs:203')
  assert.match(result.story, /^While a branch waits/)
})

test('the step bar shows six steps at most, and slides only when the current one would leave them', () => {
  assert.deepEqual(stepWindow(4, 0, 0), { from: 0, to: 4 })
  assert.deepEqual(stepWindow(20, 5, 0), { from: 0, to: 6 })
  assert.deepEqual(stepWindow(20, 6, 0), { from: 1, to: 7 })
  assert.deepEqual(stepWindow(20, 19, 0), { from: 14, to: 20 })
  // Walking back inside the window leaves it where it is, and past its start moves it one step.
  assert.deepEqual(stepWindow(20, 16, 14), { from: 14, to: 20 })
  assert.deepEqual(stepWindow(20, 13, 14), { from: 13, to: 19 })
})

test('a variable named only inside a string of the rule is not one the rule requires', () => {
  const run = brokenRun()
  const rule = run.definitions.find((definition) => definition.name === 'MergedAtReviewedHead')!
  rule.lines = ['MergedAtReviewedHead ≜', '  ∀ i ∈ Items : state[i] = "merged" ⇒ reviewed[i] = head[i] ∧ "rate" # "none"']

  const result = stateFacts(run, stateGraph(run), { id: 's6', step: 5 })

  assert.equal(row(result, 'rate').cells[0]!.breaks, false)
  assert.equal(row(result, 'head').cells[0]!.breaks, true)
})
