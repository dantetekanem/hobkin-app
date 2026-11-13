import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AssessmentStatus, ChangeAssessment, Units } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewStatus } from '../../shared/review/status.ts'
import type { Review } from '../../shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewLoader, type ReviewCommands } from '../src/features/review/loader.ts'
import { changeDescription, riskBadge, unitInFocus } from '../src/features/review/reading/model.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const units = JSON.parse(readFileSync(new URL('../../packages/change-review/skills/change-review/examples/units.json', import.meta.url), 'utf8')) as Units
const story = readFileSync(new URL('../../packages/change-review/skills/change-review/examples/story.md', import.meta.url), 'utf8')
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
const summary = { level: 'high', critical: true, needsYou: 3, worthALook: 2, safe: 3, storyBy: 'model', at: '2026-11-12T10:00:00Z' } as const
const finished = (): ChangeAssessment => ({ head: sample.change.head, summary, story, units, triage: null, blind: null, progress: null, nodes: [] })
const effects = { panelKey: () => false, toggleSteps: () => {}, talk: () => {}, verdict: () => {} }
const press = (session: ReturnType<typeof createSession>, key: string) => pressKey(session.getState(), { key, shift: false, alt: false }, effects)
/** A story as the change review writes its opening, with the sentence on what the change does. */
const opening = (does: string) => `# Rounding\n\n## Opening\n\n**Claims:** inferred, no description.\n\n**Does:** ${does}\n\n**Size:** 4 files, 45 lines added, 10 removed.\n`

test("the sidebar tells what the change does in one paragraph that never changes with the step: the change review's own sentence, else the review's summary", () => {
  const does = 'Rounds each line\'s tax behind `:per_line_tax_rounding`, and changes `round_money` for every caller.'
  assert.equal(changeDescription(sample, { story: opening(does), summary }), does)
  // Written from the facts alone, the sentence only names the kind of change: the review's summary says more.
  const generated = opening('A code change with no condition in front of it, touching code, told below as 3 units.')
  assert.equal(changeDescription(sample, { story: generated, summary: { ...summary, storyBy: 'host' } }), sample.summary)
  assert.equal(changeDescription(sample, { story: generated, summary }), sample.summary, 'a model that wrote no sentence leaves the generated one')
  // A pull request, or a change whose review is still running, has the review's summary.
  assert.equal(changeDescription(sample, null), sample.summary)
  // A summary that only repeats the title adds nothing, so there is none.
  assert.equal(changeDescription({ ...sample, summary: ` ${sample.change.title} ` }, null), null)
})

test('the review gives one answer for the whole change: risky or safe to deploy, why, and whether it is critical', () => {
  assert.deepEqual(riskBadge(finished(), { state: 'ready', head: 'h', summary }), { kind: 'rated', deploy: 'risky', label: 'Risky to deploy', why: '3 parts can break. It needs a fix, not only a look.', since: null, critical: true, again: false })
  const mid = { ...summary, level: 'mid', critical: false, needsYou: 0 } as const
  assert.deepEqual(riskBadge(null, { state: 'ready', head: 'h', summary: mid }), { kind: 'rated', deploy: 'safe', label: 'Safe to deploy', why: 'Nothing found that breaks. 2 parts were not shown working by a test that ran.', since: null, critical: false, again: false }, 'what no test showed is no risk, and the status carries the answer before the story is fetched')
  const after = riskBadge(null, { state: 'ready', head: 'abc1234def', summary: { ...mid, before: { head: 'abc1234def', deploy: 'risky', at: '2026-11-12T09:00:00.000Z' } } }) as { since: string | null }
  assert.equal(after.since, 'Reviewed again at the same commit, abc1234: no code changed since the last review. The answer went from risky to deploy to safe to deploy.')
  assert.equal((riskBadge({ summary: { ...mid, level: 'safe', worthALook: 0 } }, null) as { label: string }).label, 'Safe to deploy')
  // Reviewed again at the same commit: the last rating stays, marked as being redone.
  assert.equal((riskBadge(finished(), { state: 'running', head: 'h', percent: 30 }) as { again: boolean }).again, true)
  // Not rated yet: how far along it is, or why it stopped.
  assert.deepEqual(riskBadge(null, { state: 'running', head: 'h', percent: 40.4, now: 'running the tests' }), { kind: 'rating', percent: 40, now: 'running the tests', queued: false })
  assert.deepEqual(riskBadge(null, { state: 'queued', head: 'h' }), { kind: 'rating', percent: null, now: null, queued: true })
  assert.deepEqual(riskBadge(null, { state: 'failed', head: 'h', error: 'The tests did not start.' }), { kind: 'failed', error: 'The tests did not start.' })
  // A pull request has no change review, so no badge.
  assert.equal(riskBadge(null, null), null)
  assert.equal(riskBadge(undefined, { state: 'idle', head: 'h' }), null)
})

test('the story is no page and no tab: a review is walked in the graph, T is not a key, and G shows the whole graph', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  assert.deepEqual(session.getState().focus, sample.story[0]!.focus)
  assert.equal(press(session, 'ArrowRight'), true)
  assert.equal(session.getState().story.step, 1)
  assert.equal(press(session, 't'), false, 'the key is left alone')
  assert.equal(press(session, 'T'), false)
  session.getState().goTo(3)
  assert.equal(press(session, 'Enter'), true)
  assert.ok(session.getState().code, 'Enter opens the code of the focus')
  assert.equal(press(session, 'g'), true)
  assert.deepEqual(session.getState().focus, [])
})

test('the code panel explains the unit of the node it shows, or else the most worrying unit in focus', () => {
  const told = { [idOf('send')]: 'u1', [idOf('connectMain')]: 'u4' }
  const nodes = sample.nodes.filter((node) => told[node.id]).map((node) => ({ ...node, unit: told[node.id] }))
  assert.equal(unitInFocus(units.units, nodes, null)?.id, 'u1', 'high before mid')
  assert.equal(unitInFocus(units.units, nodes, idOf('connectMain'))?.id, 'u4', 'the node the reviewer is on')
  assert.equal(unitInFocus(units.units, [sample.nodes[0]!], null), undefined)
  assert.equal(unitInFocus(null, nodes, null), undefined, 'a review with no change review has none')
})

test('a review whose change review is still running shows its progress, and opens only once that is ready: never half made', async () => {
  const review = { ...sample, id: 'change:project:item' } as Review
  const ready = finished()
  let now: AssessmentStatus = { state: 'running', head: review.change.head, percent: 40, now: 'mapping the change' }
  const calls: string[] = []
  const status = (): ReviewStatus => ({ ...IDLE_STATUS(review.id), state: 'ready', assessment: now })
  const command = (async (name: string) => {
    calls.push(name)
    if (name === 'review.get') return { review, notes: { entries: [], draft: null }, status: status(), assessment: now.state === 'ready' ? ready : null } satisfies OpenedReview
    if (name === 'review.notes') return { ok: true }
    return status()
  }) as ReviewCommands
  const loader = createReviewLoader({ id: review.id, scope: 'host:/fixture', command, memory: createReviewMemory() })
  const gets = () => calls.filter((name) => name === 'review.get').length

  await loader.load()
  assert.deepEqual([loader.getState().status, loader.getState().review], ['preparing', null], 'its map is drawn, and it is not a review yet')
  assert.equal(loader.getState().preparation?.assessment?.percent, 40)

  now = { ...now, percent: 80, now: 'running the tests' }
  await loader.load()
  assert.deepEqual([loader.getState().preparation?.assessment?.percent, loader.getState().preparation?.assessment?.now], [80, 'running the tests'])
  assert.equal(gets(), 0, 'progress needs nothing but the status')

  now = { state: 'ready', head: review.change.head, summary }
  await loader.load()
  assert.equal(loader.getState().status, 'ready')
  assert.equal(loader.getState().assessment?.story, story)
  await loader.check()
  await loader.check()
  assert.equal(gets(), 1, 'the finished review is fetched once, when it is ready, and not again')
  loader.dispose()
})

test('a change review run again at the same commit reaches the open review once it finishes: its story, levels and units, fetched once more', async () => {
  const review = { ...sample, id: 'change:project:item' } as Review
  const head = review.change.head
  const rated = idOf('send')
  const first = finished()
  const again: ChangeAssessment = { ...finished(), summary: { ...summary, level: 'mid', critical: false, at: '2026-11-12T11:30:00Z' }, story: '# Run again\n', units: { ...units, units: units.units.slice(3) } }
  // The host's review comes with the levels of the change review it has, as it lays them on the graph.
  let shown = first
  let now: AssessmentStatus = { state: 'ready', head, summary: first.summary }
  const calls: string[] = []
  const command = (async (name: string) => {
    calls.push(name)
    const status: ReviewStatus = { ...IDLE_STATUS(review.id), state: 'ready', head, assessment: now }
    if (name === 'review.get') {
      const leveled = { ...review, nodes: review.nodes.map((node) => (node.id === rated ? { ...node, level: shown.summary.level } : node)) }
      return { review: leveled, notes: { entries: [], draft: null }, status, assessment: shown } satisfies OpenedReview
    }
    if (name === 'review.notes') return { ok: true }
    return status
  }) as ReviewCommands
  const loader = createReviewLoader({ id: review.id, scope: 'host:/fixture', command, memory: createReviewMemory() })
  const gets = () => calls.filter((name) => name === 'review.get').length
  const open = () => {
    const { review: on, assessment } = loader.getState()
    return { story: assessment?.story, level: on?.nodes.find((node) => node.id === rated)?.level, units: assessment?.units?.units.length }
  }

  await loader.load()
  assert.deepEqual(open(), { story, level: 'high', units: 8 })

  // Review again, from the card, the story page or Rebuild: the same commit is reviewed once more. The first one stays
  // on screen meanwhile, and its progress needs nothing but the status.
  now = { state: 'running', head, percent: 30, now: 'running the tests' }
  await loader.check()
  assert.deepEqual([open().story, gets()], [story, 1])

  // It finishes at the same commit, with a newer summary: the open review follows it.
  shown = again
  now = { state: 'ready', head, summary: again.summary }
  await loader.check()
  assert.deepEqual(open(), { story: '# Run again\n', level: 'mid', units: 5 })
  assert.equal(loader.getState().assessment?.summary.at, again.summary.at)
  await loader.check()
  await loader.check()
  assert.equal(gets(), 2, 'it is fetched once more when it finishes, and not again')
  loader.dispose()
})
