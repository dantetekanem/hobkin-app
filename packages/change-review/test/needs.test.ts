import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readReviewAnswer, reviewRequest } from '../src/model.ts'
import { capNeeds, type NeedsFacts } from '../src/needs.ts'
import type { Answered, NeedScore, ReviewNode, Triage } from '../src/types.ts'

const known = { nodes: [{ id: 'n1' }], units: [{ id: 'u1' }], claims: [] }
const score = (value: number, evidence = `rests on test/a.test.js, score ${value}`): NeedScore => ({ score: value, evidence })
const five = { coverage: score(8), proof: score(9), safety: score(9), visibility: score(6), rollback: score(9) }

test("the Reviewer's answer carries the five ratings with their evidence, the kind and what is missing; one that is malformed is dropped with why and the review still finishes", () => {
  const whole = readReviewAnswer(JSON.stringify({ events: [], needs: { kind: 'bug-fix', missing: 'A request test of the cap.', scores: { ...five, coverage: { ...score(8), facts: ['n1', 'test/a.test.js'] } } } }), known)
  assert.deepEqual(whole.needs, { kind: 'bug-fix', missing: 'A request test of the cap.', scores: { ...five, coverage: { ...score(8), facts: ['n1', 'test/a.test.js'] } } })
  assert.deepEqual(whole.problems, [])

  // A score that is no whole number from 1 to 10, or has no line of evidence, is dropped; the others hold.
  const some = readReviewAnswer(
    JSON.stringify({ needs: { kind: 'feature', scores: { ...five, proof: { score: 9.5, evidence: 'x' }, safety: { score: 11, evidence: 'too sure of it' }, rollback: { score: 7, evidence: '' }, visibility: { score: 6, evidence: 'line one\nline two' } } } }),
    known,
  )
  assert.deepEqual(Object.keys(some.needs!.scores), ['coverage'])
  assert.deepEqual(some.problems, [
    'needs.scores.proof: not a whole number from 1 to 10; dropped',
    'needs.scores.safety: not a whole number from 1 to 10; dropped',
    'needs.scores.visibility: its evidence is not one line of at most 400 characters; dropped',
    'needs.scores.rollback: its evidence is not one line of at most 400 characters; dropped',
  ])

  // An unknown kind, a needs that is no object, or one with no score that holds leaves the review not rated, never guessed.
  for (const [needs, problem] of [
    [{ kind: 'refactor', scores: five }, 'needs.kind: not one of performance, bug-fix, state-machine, package-update, small-change, feature, unclear; dropped'],
    ['all good', 'needs: not an object; dropped'],
    [{ kind: 'feature', scores: { coverage: { score: 0, evidence: 'none' } } }, 'needs: no score holds; dropped'],
  ] as const) {
    const read = readReviewAnswer(JSON.stringify({ events: [], needs }), known)
    assert.equal(read.needs, undefined)
    assert.ok(read.problems.includes(problem), read.problems.join('\n'))
  }
  assert.equal(readReviewAnswer(JSON.stringify({ events: [] }), known).needs, undefined, 'an answer without needs is not rated')
})

const facts = (more: Partial<NeedsFacts> = {}): NeedsFacts => ({ unproven: [], proven: 1, testsChanged: 1, high: [], undoNone: [], dataOrLoad: [], monitoring: true, onlyModels: false, brokenModels: [], uncheckedModels: [], ...more })
const answered = (scores = five): Answered => ({ kind: 'bug-fix', scores })

test('the ratings are capped by the facts', () => {
  const bitten = capNeeds(answered({ coverage: score(9), proof: score(9), safety: score(9), visibility: score(8), rollback: score(9) }), facts({ unproven: ['formatScore'], proven: 0, testsChanged: 0, high: ['rebuild_all'], undoNone: ['DropColumn#change'] }), 'abc123')!
  assert.deepEqual(
    Object.fromEntries(Object.entries(bitten.scores).map(([name, kept]) => [name, [kept!.score, kept!.capped?.from]])),
    { coverage: [3, 9], proof: [4, 9], safety: [5, 9], visibility: [8, undefined], rollback: [4, 9] },
  )
  assert.equal(bitten.scores.coverage!.evidence, 'rests on test/a.test.js, score 9 Capped at 3: no test that ran proves a changed definition (formatScore).')
  assert.equal(bitten.scores.rollback!.capped!.why, 'nothing undoes DropColumn#change')
  assert.deepEqual([bitten.head, bitten.by, bitten.monitoring], ['abc123', 'change-review', 'given'])

  // A cap that does not bite leaves the Reviewer's number and words; one proven definition is enough for coverage.
  const kept = capNeeds(answered(), facts({ unproven: ['helper'], proven: 1 }), 'abc123')!
  assert.deepEqual(kept.scores.coverage, five.coverage)

  // A TLA+ model of the change that breaks leaves proof at 3, as hobkin's own scores do.
  assert.equal(capNeeds(answered(), facts({ brokenModels: ['Review.tla'] }), 'abc123')!.scores.proof!.score, 3)
  // A change of only models is proven by its model check, not by tests: the test caps do not apply, the check's do.
  const models = capNeeds(answered(), facts({ onlyModels: true, proven: 0, testsChanged: 0, unproven: [] }), 'abc123')!
  assert.deepEqual([models.scores.coverage!.score, models.scores.proof!.score], [8, 9])
  assert.equal(capNeeds(answered(), facts({ onlyModels: true, proven: 0, testsChanged: 0, brokenModels: ['Review.tla'] }), 'abc123')!.scores.proof!.score, 3)
  const unchecked = capNeeds(answered(), facts({ onlyModels: true, proven: 0, testsChanged: 0, uncheckedModels: ['Review.tla'] }), 'abc123')!.scores.proof!
  assert.deepEqual([unchecked.score, unchecked.capped?.why], [4, 'the model check of Review.tla was not run at this commit'])
})

const triage: Pick<Triage, 'range' | 'mode' | 'description_source' | 'totals' | 'claims' | 'directives'> = { range: 'a..b', mode: 'unflagged-change', description_source: 'none', totals: { files: 1, added: 1, deleted: 0 }, claims: [], directives: [] }
const node = { id: 'n1', kind: 'function', symbol: 'total', path: 'src/total.js', lines: [1, 3], change: 'modified', changed_lines: [2], entries: [], facts: { effect: { value: 'data', evidence: 'writes' }, proof: { value: 'none', evidence: 'none' }, exposure: { value: 'everyone', evidence: '' }, undo: { value: 'rollback', evidence: '' } }, extras: {}, conditions: [], hosts_condition: false, runs: [], sensitive: [], level: null, critical: false, findings: [], watch: null, questions: [] } as unknown as ReviewNode

test('a pull request is rated the same way, with monitoring unknown when none is given', () => {
  const data = (monitoring?: readonly string[]) => {
    const { prompt } = reviewRequest({ triage, nodes: [node], units: [], code: {}, ...(monitoring ? { monitoring } : {}) })
    return JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)) as { monitoring: unknown }
  }
  assert.equal(data().monitoring, 'unknown')
  assert.deepEqual(data(['Errors go to Sentry, with an alert to the user.', 'Way back: kamal rollback.']).monitoring, ['Errors go to Sentry, with an alert to the user.', 'Way back: kamal rollback.'])

  // With no monitoring known there is no visibility score: one given anyway is a guess, and is not kept.
  const problems: string[] = []
  const unknown = capNeeds(answered(), facts({ monitoring: false, dataOrLoad: ['total'] }), 'abc123', problems)!
  assert.deepEqual([unknown.monitoring, unknown.scores.visibility, Object.keys(unknown.scores)], ['unknown', undefined, ['coverage', 'proof', 'safety', 'rollback']])
  assert.deepEqual(problems, ['needs.scores.visibility: a visibility rating was given with no monitoring known, and was not kept'])
  // A review whose only rating was that guess is not rated.
  assert.equal(capNeeds({ kind: 'feature', scores: { visibility: score(9) } }, facts({ monitoring: false }), 'abc123', []), undefined)
})

test("a cap's words join the evidence as one clean line, whatever the names it gives look like", () => {
  const capped = capNeeds(answered(), facts({ high: [''], undoNone: ['', 'DropColumn\n  #change', '  '] }), 'abc123')!
  assert.equal(capped.scores.rollback!.capped!.why, 'nothing undoes DropColumn #change')
  assert.equal(capped.scores.safety!.capped!.why, 'a part is rated high')
  for (const kept of Object.values(capped.scores)) {
    assert.doesNotMatch(kept!.evidence, /\s{2}|[\r\n]|\(\)|: and/, kept!.evidence)
    assert.ok(kept!.evidence.length <= 400)
  }
})
