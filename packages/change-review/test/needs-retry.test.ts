import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readReviewAnswer } from '../src/model.ts'
import { DEFAULT_RATING_TRIES, rateNeeds, type NeedsFacts } from '../src/needs.ts'
import type { Answered, NeedScore } from '../src/types.ts'

const score = (value: number): NeedScore => ({ score: value, evidence: `rests on test/a.test.js, score ${value}` })
const five = { coverage: score(8), proof: score(9), safety: score(9), visibility: score(6), rollback: score(9) }
const facts = (more: Partial<NeedsFacts> = {}): NeedsFacts => ({ unproven: [], proven: 1, testsChanged: 1, high: [], undoNone: [], dataOrLoad: [], monitoring: true, onlyModels: false, brokenModels: [], uncheckedModels: [], ...more })
const answered = (scores: Answered['scores'] = five): Answered => ({ kind: 'bug-fix', scores })

/** A fake Reviewer that answers each narrow call from a list, and keeps what it was asked. */
function reviewer(...answers: (string | null | { failed: string })[]) {
  const prompts: string[] = []
  const ask = async ({ prompt }: { system: string; prompt: string }) => {
    prompts.push(prompt)
    const next = answers[prompts.length - 1] ?? null
    return typeof next === 'object' && next ? next : { text: next }
  }
  return { ask, prompts }
}
const ratings = (scores: Answered['scores']) => JSON.stringify({ needs: { scores } })
const asked = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)) as { missing: string[]; given: Record<string, unknown>; try: number; of: number }
const base = { facts: facts(), head: 'abc123', review: 'The review says things.', problems: [] as string[] }

test('an answer with all five ratings is kept with no second call', async () => {
  const { ask, prompts } = reviewer()
  const done = await rateNeeds({ ...base, answered: answered(), tries: 3, ask })
  assert.equal(prompts.length, 0)
  assert.equal(done.notRated, undefined)
  assert.deepEqual(Object.keys(done.needs!.scores), ['coverage', 'proof', 'safety', 'visibility', 'rollback'])
})

test('an answer without all five scores is asked again, narrowly, up to the tries, then not rated with why', async () => {
  // One missing: asked once, for that one only, and the others are left as they were.
  const { visibility: _gone, ...four } = five
  const one = reviewer(ratings({ visibility: score(5), coverage: score(1) }))
  const fixed = await rateNeeds({ ...base, answered: answered(four), tries: 3, ask: one.ask })
  assert.equal(one.prompts.length, 1)
  assert.deepEqual(asked(one.prompts[0]!).missing, ['visibility'])
  assert.deepEqual(Object.keys(asked(one.prompts[0]!).given), ['coverage', 'proof', 'safety', 'rollback'])
  assert.equal(fixed.notRated, undefined)
  assert.deepEqual(fixed.needs!.scores, { ...four, visibility: score(5) }, 'a score the model gave is never replaced by a later answer')

  // Two missing, one given on the first try: the second try asks only for the one still missing.
  const { coverage: _c, proof: _p, ...three } = five
  const some = reviewer(ratings({ coverage: score(7) }), ratings({ proof: score(6) }))
  const twice = await rateNeeds({ ...base, answered: answered(three), tries: 3, ask: some.ask })
  assert.deepEqual(some.prompts.map((prompt) => asked(prompt).missing), [['coverage', 'proof'], ['proof']])
  assert.deepEqual(twice.needs!.scores.proof, score(6))
  assert.equal(twice.notRated, undefined)

  // None ever given: after the tries, not rated, with how many and why; the scores that were given stay, nothing is guessed.
  const never = reviewer('nothing', { failed: 'timeout' }, ratings({ coverage: { score: 12, evidence: 'too sure' } as NeedScore }))
  const problems: string[] = []
  const lost = await rateNeeds({ ...base, problems, answered: answered({ safety: score(9), rollback: score(9), visibility: score(6) }), tries: 3, ask: never.ask })
  assert.equal(never.prompts.length, 3)
  assert.deepEqual(lost.notRated, { tries: 3, missing: ['coverage', 'proof'], why: 'after 3 tries the answer still lacked coverage and proof: coverage: not a whole number from 1 to 10' })
  assert.deepEqual(Object.keys(lost.needs!.scores), ['safety', 'visibility', 'rollback'])
  assert.ok(problems.some((problem) => problem.includes('timeout')), problems.join('\n'))

  // No answer at all: the kind is asked for too, and never invented.
  const bare = reviewer(null, null)
  const nothing = await rateNeeds({ ...base, tries: 2, ask: bare.ask })
  assert.deepEqual(asked(bare.prompts[0]!).missing, ['kind', 'coverage', 'proof', 'safety', 'visibility', 'rollback'])
  assert.deepEqual([nothing.needs, nothing.notRated?.tries, nothing.notRated?.missing.length], [undefined, 2, 6])
})

test('a malformed score is treated as missing, and a malformed one in the first answer is asked for again', async () => {
  const sloppy = { ...five, coverage: { score: 9.5, evidence: 'x' }, proof: { score: 9, evidence: '' } }
  const first = readReviewAnswer(JSON.stringify({ needs: { kind: 'bug-fix', scores: sloppy } }), { nodes: [], units: [], claims: [] }).needs
  const again = reviewer(ratings({ coverage: score(7), proof: score(7) }))
  const done = await rateNeeds({ ...base, answered: first, tries: 3, ask: again.ask })
  assert.deepEqual(asked(again.prompts[0]!).missing, ['coverage', 'proof'])
  assert.deepEqual([done.needs!.scores.coverage, done.needs!.scores.proof], [score(7), score(7)])
})

test('with no monitoring known visibility is 3 by rule, says so, is not asked for, and the rate exists', async () => {
  const { visibility: _v, ...four } = five
  const none = reviewer()
  const done = await rateNeeds({ ...base, facts: facts({ monitoring: false }), answered: answered(four), tries: 3, ask: none.ask })
  assert.equal(none.prompts.length, 0)
  assert.deepEqual(done.needs!.scores.visibility, { score: 3, evidence: 'no monitoring is known for this project, so a regression would not show', byRule: true })
  assert.equal(done.needs!.monitoring, 'unknown')
  assert.equal(done.notRated, undefined)
  // A visibility the Reviewer gives anyway is a guess and is replaced by the rule, said in the problems.
  const guessed = await rateNeeds({ ...base, facts: facts({ monitoring: false }), answered: answered(), tries: 3, ask: none.ask })
  assert.equal(guessed.needs!.scores.visibility!.score, 3)
  assert.equal(guessed.needs!.scores.visibility!.byRule, true)
  // Another score still missing is asked for, and never visibility.
  const { coverage: _c, ...rest } = four
  const asking = reviewer(ratings({ coverage: score(6), visibility: score(9) }))
  const mixed = await rateNeeds({ ...base, facts: facts({ monitoring: false }), answered: answered(rest), tries: 3, ask: asking.ask })
  assert.deepEqual(asked(asking.prompts[0]!).missing, ['coverage'])
  assert.equal(mixed.needs!.scores.visibility!.score, 3)
})

test('the tries are a parameter: the default is 3, none asks nothing, and no model says why', async () => {
  assert.equal(DEFAULT_RATING_TRIES, 3)
  const { coverage: _c, ...four } = five
  const fresh = (count: number) => reviewer(...Array<string>(count).fill('nothing'))
  for (const tries of [1, 5]) {
    const model = fresh(tries)
    const done = await rateNeeds({ ...base, answered: answered(four), tries, ask: model.ask })
    assert.deepEqual([model.prompts.length, done.notRated?.tries], [tries, tries])
  }
  const zero = fresh(1)
  const held = await rateNeeds({ ...base, answered: answered(four), tries: 0, ask: zero.ask })
  assert.deepEqual([zero.prompts.length, held.notRated?.tries], [0, 0])
  const alone = await rateNeeds({ ...base, answered: answered(four), tries: 3 })
  assert.deepEqual(alone.notRated, { tries: 0, missing: ['coverage'], why: 'there is no model to ask: the answer lacked coverage' })
})
