import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { YoloState } from '#shared/protocol/work.ts'
import { SAMPLE_YOLO } from '../src/features/settings/yolo.ts'
import {
  changeArgs,
  clearArgs,
  GROUPS,
  IDLE,
  numberFrom,
  refused,
  rowSay,
  RULES,
  ruleOf,
  rulesIn,
  rulesSentence,
  sampleRulesAfter,
  saved,
  saving,
  shownValue,
  toggleKind,
  withSampleRules,
  wordsFrom,
  type RuleDef,
} from '../src/features/work/yolo-rules.ts'

const sample = withSampleRules(SAMPLE_YOLO)
const rule = (name: string) => ruleOf(name) as RuleDef & { kind: 'number' }

test('the closed block says the rules in force in one sentence built from the values sent', () => {
  const rules = sample.rules!
  assert.equal(
    rulesSentence(rules),
    'Merges changes rated 8 or more, except features and unclear changes, up to 300 lines and in 2 areas or fewer, on projects where tests pass, a way back is known, no model breaks and the last deploy did not regress. Pull requests: off.',
  )
  const looser = { ...rules, lowestRate: 7.5, kinds: ['bug-fix', 'feature'], mostLines: null, mostAreas: 1, testsPass: false, wayBackKnown: false, noModelBreaks: false, holdAfterRegression: false, mergePulls: true }
  assert.equal(rulesSentence(looser), 'Merges changes rated 7.5 or more, only bug fixes and features, of any size and in 1 area or fewer, on any project. Pull requests: on.')
  assert.equal(rulesSentence({ ...rules, kinds: ['performance', 'bug-fix', 'state-machine', 'package-update', 'small-change', 'feature', 'unclear'] }).includes('of any kind'), true)
  // A value the runtime did not send is not guessed.
  assert.equal(rulesSentence({ lowestRate: 9 }), 'Merges changes rated 9 or more.')
})

test('each rule is named once and the three groups hold 7, 15 and 4', () => {
  assert.deepEqual(GROUPS.map(({ group }) => RULES.filter((one) => one.group === group).length), [7, 15, 4])
  assert.equal(new Set(RULES.map(({ name }) => name)).size, RULES.length)
})

test('a row shows the value it is saving, then the host\'s own, and a refusal puts the host\'s value back with its words in place of the line', () => {
  const r = rule('lowestRate')
  assert.equal(shownValue(8, IDLE), 8)
  assert.equal(shownValue(8, saving(9)), 9)
  assert.equal(shownValue(8, saved(9)), 9)
  assert.deepEqual([rowSay(r, saving(9)).status, rowSay(r, saved(9)).status, rowSay(r, IDLE).status], ['Saving', 'Saved', ''])
  const no = refused('The lowest rate is 1 to 10.')
  assert.equal(shownValue(8, no), 8)
  assert.deepEqual([rowSay(r, no).words, rowSay(r, no).refused], ['The lowest rate is 1 to 10.', true])
  assert.deepEqual([rowSay(r, IDLE).words, rowSay(r, IDLE).refused], [r.line, false])
})

test('a number is read as typed, none where the setting allows it, and the range is the runtime\'s to check', () => {
  assert.deepEqual(numberFrom(rule('lowestRate'), ' 8,5 '), { value: 8.5 })
  assert.deepEqual(numberFrom(rule('lowestRate'), '40'), { value: 40 })
  assert.deepEqual(numberFrom(rule('mostLines'), 'none'), { value: null })
  assert.deepEqual(numberFrom(rule('mostLines'), ''), { value: null })
  assert.deepEqual(numberFrom(rule('lowestRate'), ''), { refused: 'Give a number.' })
  assert.deepEqual(numberFrom(rule('mostAreas'), 'x'), { refused: 'Give a number or none.' })
})

test('a set of kinds and a list of words change as the user edits them', () => {
  assert.deepEqual(toggleKind(['bug-fix'], 'feature'), ['bug-fix', 'feature'])
  assert.deepEqual(toggleKind(['bug-fix', 'feature'], 'bug-fix'), ['feature'])
  assert.deepEqual(wordsFrom('auth, schema  token\nmigrat,'), ['auth', 'schema', 'token', 'migrat'])
})

test('a change is sent for every project or, with a slug, for one, and a project hands a setting back with clear', () => {
  assert.deepEqual(changeArgs(null, 'mostLines', 500), { rules: { mostLines: 500 } })
  assert.deepEqual(changeArgs('api', 'mostLines', null), { slug: 'api', rules: { mostLines: null } })
  assert.deepEqual(clearArgs('api', 'mostLines'), { slug: 'api', clear: ['mostLines'] })
})

test('with no host a project\'s own setting differs, and clearing it returns the project to the rest', () => {
  const own = (state: YoloState) => state.projects.find(({ slug }) => slug === 'billing-api')!
  assert.deepEqual(own(sample).overrides, ['mostLines'])
  assert.equal(own(sample).rules!.mostLines, 600)
  assert.equal(rulesIn(sample, 'billing-api')!.mostLines, 600)
  assert.equal(rulesIn(sample, null)!.mostLines, 300)

  const everyone = sampleRulesAfter(sample, { rules: { mostLines: 500, lowestRate: 9 } })
  assert.equal(everyone.rules!.lowestRate, 9)
  assert.equal(own(everyone).rules!.lowestRate, 9)
  assert.equal(own(everyone).rules!.mostLines, 600, 'its own setting stays')
  assert.equal(everyone.projects.find(({ slug }) => slug === 'search-api')!.rules!.mostLines, 500)

  const solo = sampleRulesAfter(sample, { slug: 'search-api', rules: { mostAreas: null } })
  assert.deepEqual(solo.projects.find(({ slug }) => slug === 'search-api')!.overrides, ['mostAreas'])
  assert.equal(solo.rules!.mostAreas, 2)

  const back = sampleRulesAfter(sample, { slug: 'billing-api', clear: ['mostLines'] })
  assert.deepEqual(own(back).overrides, [])
  assert.equal(own(back).rules!.mostLines, 300)
})
