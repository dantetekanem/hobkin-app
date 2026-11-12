import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrange } from '../src/features/review/graph/arrange.ts'
import { pullAssessment, pullReview } from '../src/features/review/sample/pull.ts'
import { isBlindNote, plainSentences, proofWords, testsOf, testsWords, tldrOf, watchWords } from '../src/features/review/story/words.ts'

const pull = pullReview('pr:hobkin-sample/storefront/482')
const shape = arrange(pull)
const nodeOf = new Map([...shape.hidden, ...shape.nodes].map((node) => [node.id, node]))
const units = pullAssessment().units!.units
const idOf = (title: string) => pull.nodes.find((node) => node.title === title)!.id

test("a unit's card says how its tests went, however they are folded", () => {
  const helper = testsOf([idOf('link_user_tags')], shape.covers, nodeOf)!
  assert.deepEqual([helper.total, helper.ran, helper.failed, helper.notRun, helper.proves], [5, 5, 0, 0, 3])
  assert.equal(testsWords(helper), '5 of 5 tests ran; 3 prove the change.')

  const fetch = testsOf([idOf('fetch_errors')], shape.covers, nodeOf)!
  assert.deepEqual(fetch.failing, ['tries once more when the monitor times out'])
  assert.equal(testsWords(fetch), '6 of 6 tests ran, 1 failed.')
  assert.equal(testsWords(testsOf([idOf('report')], shape.covers, nodeOf)!), '6 of 7 tests ran, 1 not run.')
  // Nothing covers the README.
  assert.equal(testsOf([idOf('README.md')], shape.covers, nodeOf), null)
})

test('what to watch is said for a unit that needs a look, and only for one', () => {
  const high = units.find((unit) => unit.level === 'high')!
  const watch = high.watch === 'not assessed' ? null : high.watch
  const lines = watchWords(high)
  // Each signal, each gap nothing watches, and the way back.
  assert.equal(lines.length, watch!.signals.length + watch!.gaps.length + 1)
  assert.ok(lines[0]!.includes(watch!.signals[0]!.name) && lines[0]!.includes(watch!.signals[0]!.at))
  for (const unit of units.filter((entry) => entry.level === 'safe')) assert.deepEqual(watchWords(unit), [])
  // A fact says what it means and the evidence for it.
  assert.ok(proofWords(high.facts).includes(high.facts.proof.evidence))
})

test("a step's TL;DR is one short paragraph of plain words, never the engine's", () => {
  const engine = "show in app/controllers/comments_controller.rb (lines 2 to 13) was changed, with 4 changed lines. Effect: behaviour (executable lines changed (from patterns)). It now loads the comment's post first. Stop 1. Reached from ErrorsController#show (controller), ErrorsController#show."
  // The engine's own sentences go: what it found by pattern, the stop it is on.
  assert.deepEqual(plainSentences(engine), ["show in app/controllers/comments_controller.rb (lines 2 to 13) was changed, with 4 changed lines.", "It now loads the comment's post first."])
  assert.deepEqual(plainSentences('Floor rule 3: no test executes the changed lines.'), ['No test executes the changed lines.'])

  // The step's own words come first, two or three sentences, about 300 characters at most.
  const unit = { title: 'show loads the post first', what: 'It loads the post before the comment. Then it renders both.' }
  assert.equal(tldrOf({ text: 'One. Two. Three. Four.' }, unit), 'One. Two. Three.')
  const long = `${'A sentence that goes on and on about what changed. '.repeat(10)}`.trim()
  assert.ok(tldrOf({ text: long }, unit).length <= 300)
  assert.ok(tldrOf({ text: 'x'.repeat(500) }, unit).endsWith('…') && tldrOf({ text: 'x'.repeat(500) }, unit).length <= 300)
  // Without words of its own, or only a count of lines, the unit's first sentence says it.
  assert.equal(tldrOf({ text: '' }, unit), 'It loads the post before the comment.')
  assert.equal(tldrOf({ text: '4 lines added and 1 line removed.' }, unit), 'It loads the post before the comment.')
  assert.equal(tldrOf({ text: 'Effect: behaviour (from patterns).' }, null), '')
})

test("the blind check's notes are told apart from the reviewer's questions", () => {
  const blind = { text: 'The blind check could not decide from the story alone: "who calls show". Can you settle it?', why: 'The blind check reads only the story and the units, and this was not in them.' }
  assert.equal(isBlindNote(blind), true)
  assert.equal(isBlindNote({ text: 'Should a tag in a code block link?', why: 'No test covers it.' }), false)
})
