import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Units } from '#shared/review/assessment.ts'
import type { Review, StoryStep } from '#shared/review/types.ts'
import { claimAsk, questionAsk, unitAsk } from '../src/features/review/panel/ask.ts'
import { askExample, headerBadge, noteShown, stepBrief, whatMatters } from '../src/features/review/panel/sidebar.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const units = JSON.parse(readFileSync(new URL('../../packages/change-review/skills/change-review/examples/units.json', import.meta.url), 'utf8')) as Units
const unit = (id: string) => units.units.find((entry) => entry.id === id)!
const summary = { level: 'high', critical: true, needsYou: 3, worthALook: 2, safe: 3, storyBy: 'model', at: '2026-11-12T10:00:00Z' } as const
/** A story as the change review writes its opening, with the sentence on what the change does. */
const opening = (does: string) => `# Rounding\n\n## Opening\n\n**Claims:** inferred, no description.\n\n**Does:** ${does}\n`

/** A review whose steps tell the change review's units, the way the host writes them: one step names its unit, one tells it through its node. */
const steps: StoryStep[] = [
  { id: 'outcome', kind: 'outcome', title: 'Round tax per line', text: 'Tax is rounded on each line. Then the lines are summed. The total is shown.', focus: [], criteria: [] },
  { id: 's1', kind: 'walk', title: 'round_money', text: 'How the money is rounded.', focus: ['n5'], criteria: [], unit: 'u1' },
  { id: 's2', kind: 'walk', title: 'The flag check', text: 'Where the flag is read.', focus: ['n2'], criteria: [] },
  { id: 'closing', kind: 'closing', title: 'Out of scope', text: '', focus: [], criteria: [] },
]
const nodes = [
  { id: 'n5', unit: 'u1' },
  { id: 'n2', unit: 'u4' },
  { id: 'n6', unit: 'u2' },
]

test('the badge beside the title always says where the change review stands: its level, how far along it is, that it failed and why, or that there is none', () => {
  assert.deepEqual(headerBadge({ summary }, { state: 'ready', head: 'h', summary }), {
    kind: 'rated',
    level: 'high',
    label: 'High risk',
    critical: true,
    counts: { high: 3, mid: 2, safe: 3 },
    again: null,
  })
  // The status carries the rating before the story is fetched.
  assert.equal((headerBadge(null, { state: 'ready', head: 'h', summary: { ...summary, level: 'safe', critical: false } }) as { label: string }).label, 'Safe')
  // Rated, and reviewed again at the same commit: the rating stays, and says it is being redone.
  assert.equal((headerBadge({ summary }, { state: 'running', head: 'h', percent: 41.6 }) as { again: string | null }).again, 'Reviewing again… 42%')

  // Under way: how far along it is, and what it is doing.
  assert.deepEqual(headerBadge(null, { state: 'running', head: 'h', percent: 41.6, now: 'running the tests' }), { kind: 'reviewing', label: 'Reviewing… 42%', percent: 42, now: 'Running the tests' })
  assert.deepEqual(headerBadge(null, { state: 'running', head: 'h' }), { kind: 'reviewing', label: 'Reviewing…', percent: null, now: null })
  assert.deepEqual(headerBadge(null, { state: 'queued', head: 'h' }), { kind: 'reviewing', label: 'Reviewing…', percent: null, now: 'Waiting for its turn' })

  // It stopped: the reason, in its own words.
  assert.deepEqual(headerBadge(null, { state: 'failed', head: 'h', error: 'The tests did not start.' }), { kind: 'failed', label: 'Review failed', reason: 'The tests did not start.' })
  assert.deepEqual(headerBadge(null, { state: 'failed', head: 'h' }), { kind: 'failed', label: 'Review failed', reason: 'The change review stopped without saying why.' })

  // None, and none on its way.
  assert.deepEqual(headerBadge(null, null), { kind: 'none', label: 'Not reviewed' })
  assert.deepEqual(headerBadge(undefined, { state: 'idle', head: 'h' }), { kind: 'none', label: 'Not reviewed' })
})

test("the panel's step is the unit it tells: its number, its level, its claim, and what changed in a sentence or two", () => {
  const told = stepBrief(steps, 1, units.units, nodes)!
  assert.deepEqual({ ...told, unit: told.unit?.id }, { index: 1, total: 4, title: unit('u1').title, what: unit('u1').what, level: 'high', critical: true, unit: 'u1' })
  // A full stop inside code ends no sentence: the claim's "what" is one sentence, kept whole.
  assert.match(told.what ?? '', /amount\.round\(2, half: :even\)`\.$/)

  // A step that names no unit tells the unit of its node.
  const byNode = stepBrief(steps, 2, units.units, nodes)!
  assert.deepEqual([byNode.title, byNode.level, byNode.unit?.id], [unit('u4').title, 'mid', 'u4'])
  // Two sentences at most.
  assert.equal(byNode.what, unit('u4').what)

  // Without a change review it is the step itself: its title, and the first two sentences of its text.
  assert.deepEqual(stepBrief(steps, 0, null, nodes), { index: 0, total: 4, title: 'Round tax per line', what: 'Tax is rounded on each line. Then the lines are summed.', level: null, critical: false, unit: null })
  assert.equal(stepBrief(steps, 3, units.units, nodes)?.what, null, 'a step with no words has none')
  assert.equal(stepBrief(steps, 9, units.units, nodes), null)
  // A step the host rated without a unit keeps its own level.
  assert.equal(stepBrief([{ ...steps[2]!, level: 'safe', focus: [] }], 0, units.units, nodes)?.level, 'safe')
})

test("what matters is the change's claim, then its high and mid units, each with the step that tells it, then the questions, and every one can be asked of hobkin", () => {
  const does = "Rounds each line's tax behind `:per_line_tax_rounding`, and changes `round_money` for every caller."
  const matters = whatMatters(sample, { story: opening(does), summary, units }, steps, nodes)

  assert.deepEqual(matters.claim, { key: 'claim', text: does, asks: claimAsk() })
  // High before mid, and along the story within a level. Each goes to the step that tells it: the step that names it,
  // else the step of a node it rates. One no step tells still shows, and goes to its node when it has one.
  assert.deepEqual(
    matters.units.map(({ key, level, critical, step, node }) => [key, level, critical, step, node]),
    [
      ['u1', 'high', true, 1, 'n5'],
      ['u2', 'high', false, null, 'n6'],
      ['u3', 'high', true, null, null],
      ['u4', 'mid', false, 2, 'n2'],
      ['u5', 'mid', false, null, null],
    ],
  )
  assert.deepEqual(matters.units[0], { key: 'u1', text: unit('u1').title, level: 'high', critical: true, step: 1, node: 'n5', asks: unitAsk(unit('u1')) })
  assert.match(unitAsk(unit('u1')), /^About "round_money changes its rounding mode for every caller, flag on or off": why is it high risk, and what should I check first\?$/)

  // The questions of those units, the most worrying first, each asked as the reviewer would ask it.
  assert.deepEqual(
    matters.questions.map(({ text, about }) => [text, about]),
    [
      [unit('u1').questions[0]!.text, unit('u1').title],
      [unit('u2').questions[0]!.text, unit('u2').title],
      [unit('u4').questions[0]!.text, unit('u4').title],
    ],
  )
  assert.equal(matters.questions[0]!.asks, questionAsk(unit('u1'), unit('u1').questions[0]!))
  assert.equal(matters.questions[0]!.why, unit('u1').questions[0]!.why)

  // Before any change review: the review's own summary, and the spec's open questions, asked as they are written.
  const plain = whatMatters(sample, null, sample.story, sample.nodes)
  assert.equal(plain.claim?.text, sample.summary)
  assert.deepEqual(plain.units, [])
  assert.deepEqual(plain.questions.map(({ text, asks, about }) => [text, asks, about]), sample.spec!.openQuestions.map((text) => [text, text, null]))
  // A summary that only repeats the title says nothing more.
  assert.equal(whatMatters({ ...sample, summary: sample.change.title, spec: null }, null, [], []).claim, null)
})

test("the box shows a concrete example of what to ask: the step's own question, else why it has its level, else about its node", () => {
  assert.equal(askExample(stepBrief(steps, 1, units.units, nodes), undefined), unit('u1').questions[0]!.text)
  // u3 has no question: why it has its level.
  const noQuestion = stepBrief([{ ...steps[1]!, unit: 'u3' }], 0, units.units, nodes)
  assert.equal(askExample(noQuestion, undefined), 'Why is this step high risk?')
  assert.equal(askExample(stepBrief(steps, 0, null, nodes), { title: 'doingAfter', kind: 'code' }), 'What does doingAfter do, and what calls it?')
  assert.equal(askExample(stepBrief(steps, 0, null, nodes), { title: 'A test that names a very long behaviour in words', kind: 'test' }), 'What does this test prove, and what does it miss?')
  assert.equal(askExample(null, undefined), 'What does this step change, and how is it tested?')
})

test("a comment or question in the panel opens the notes beside what it is about: its node, the node of its lines, else its step", () => {
  const review = sample
  const step = review.story[3]!
  const node = step.focus[0]!
  const anchored = review.nodes.find((entry) => entry.anchors.length > 0)!
  const anchor = anchored.anchors[0]!
  const note = (target: Parameters<typeof noteShown>[1]['target'], at = step.id) => ({ step: at, target })

  assert.deepEqual(noteShown(review.nodes, note({ kind: 'node', node }), review.story), { node })
  assert.deepEqual(
    noteShown(review.nodes, note({ kind: 'lines', fileId: anchor.fileId, side: anchor.side, startLine: anchor.startLine, endLine: anchor.startLine, hash: 'x' }), review.story),
    { node: anchored.id },
  )
  // A note on a step, or on a wire, opens the notes of its step, by its place in the story on screen.
  assert.deepEqual(noteShown(review.nodes, note({ kind: 'step' }), review.story), { step: 3 })
  assert.deepEqual(noteShown(review.nodes, note({ kind: 'wire', wire: review.edges[0]!.id }), review.story), { step: 3 })
  // A node that is not on screen, such as a test folded into a group, opens on its step.
  assert.deepEqual(noteShown(review.nodes.filter((entry) => entry.id !== node), note({ kind: 'node', node }), review.story), { step: 3 })
  // A step the story on screen folded away has no place of its own: there is nothing to open beside.
  assert.equal(noteShown(review.nodes, note({ kind: 'step' }, 'gone'), review.story), null)
})
