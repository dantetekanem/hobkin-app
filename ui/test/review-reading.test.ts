import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AssessmentStatus, ChangeAssessment, Units } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewStatus } from '../../shared/review/status.ts'
import type { Review } from '../../shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewLoader, type ReviewCommands } from '../src/features/review/loader.ts'
import { openingMode, readUnitHeading, unitInFocus, unitOfHeading } from '../src/features/review/reading/model.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const units = JSON.parse(readFileSync(new URL('../../packages/change-review/skills/change-review/examples/units.json', import.meta.url), 'utf8')) as Units
const story = readFileSync(new URL('../../packages/change-review/skills/change-review/examples/story.md', import.meta.url), 'utf8')
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
const summary = { level: 'high', critical: true, needsYou: 3, worthALook: 2, safe: 3, storyBy: 'model', at: '2026-11-12T10:00:00Z' } as const
const finished = (): ChangeAssessment => ({ head: sample.change.head, summary, story, units, triage: null, blind: null, progress: null, nodes: [] })
const effects = { panelKey: () => false, toggleSteps: () => {}, talk: () => {}, verdict: () => {} }

test('a finished change opens on its story when it has one or one is on its way, and on the graph when none is coming', () => {
  const ready = finished()
  assert.equal(openingMode(ready, { state: 'ready', head: 'h', summary }), 'story')
  assert.equal(openingMode(null, { state: 'queued', head: 'h' }), 'story', 'it says it is waiting its turn')
  assert.equal(openingMode(null, { state: 'running', head: 'h', percent: 40, now: 'mapping the change' }), 'story', 'its progress shows')
  assert.equal(openingMode(null, { state: 'failed', head: 'h', error: 'It stopped.' }), 'story', 'why it failed shows, with a way to run it again')
  assert.equal(openingMode(null, { state: 'idle', head: 'h' }), 'graph')
  assert.equal(openingMode(undefined, undefined), 'graph', 'a pull request has none')

  // Each unit heading of the story is its unit, by the number the story gave it: high first, then mid, then safe.
  const heading = readUnitHeading('3. legacy_discount is deleted while Cart#discounted_subtotal still calls it (high, critical)')
  assert.deepEqual(heading, { number: 3, title: 'legacy_discount is deleted while Cart#discounted_subtotal still calls it', level: 'high', critical: true })
  assert.equal(unitOfHeading(units.units, heading!)?.id, 'u3')
  assert.equal(unitOfHeading(units.units, readUnitHeading('6. round_line_tax is new and only runs behind the flag (safe)')!)?.id, 'u6')
  assert.equal(readUnitHeading('Needs you'), null)
})

test('T switches between the story and the graph, and in the story the keys that walk the graph are left to the page', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()), { mode: 'story', storyAvailable: true })
  const press = (key: string) => pressKey(session.getState(), { key, shift: false, alt: false }, effects)
  const step = session.getState().story.step
  for (const key of ['ArrowDown', 'ArrowRight', ' ', '3', 'Enter', '/']) assert.equal(press(key), false, `${key} scrolls or presses what it is on`)
  assert.deepEqual([session.getState().mode, session.getState().story.step], ['story', step])

  assert.equal(press('t'), true)
  assert.equal(session.getState().mode, 'graph')
  assert.equal(press('T'), true)
  assert.equal(session.getState().mode, 'story')

  // G is still the whole graph, from the story too.
  session.getState().goTo(3)
  assert.notDeepEqual(session.getState().focus, [])
  assert.equal(press('g'), true)
  assert.deepEqual([session.getState().mode, session.getState().focus], ['graph', []])

  // A review with no story, such as a pull request's, has nothing to switch to.
  const graphOnly = createSession(sample, createReviewMemory(memoryStorage()))
  assert.equal(pressKey(graphOnly.getState(), { key: 't', shift: false, alt: false }, effects), false)
  assert.equal(graphOnly.getState().mode, 'graph')
  // Once one is on its way, it can be read.
  graphOnly.getState().setStoryAvailable(true)
  assert.equal(pressKey(graphOnly.getState(), { key: 't', shift: false, alt: false }, effects), true)
  assert.equal(graphOnly.getState().mode, 'story')
})

test('Show in graph switches to the graph with the nodes that tell the unit in focus, and the panel tells that unit', () => {
  const told = [idOf('send'), idOf('connectMain')]
  const review: Review = { ...sample, nodes: sample.nodes.map((node) => (told.includes(node.id) ? { ...node, unit: 'u1' } : node)) }
  const session = createSession(review, createReviewMemory(memoryStorage()), { mode: 'story', storyAvailable: true })
  const moved = session.getState().move.key

  assert.equal(session.getState().showUnit('u1'), true)
  assert.equal(session.getState().mode, 'graph')
  assert.deepEqual([...session.getState().focus].sort(), [...told].sort())
  for (const id of told) assert.equal(session.getState().levels.nodes[id], 'focus')
  assert.ok(session.getState().move.key > moved, 'the camera goes to them')

  // The panel's "what matters here" is that unit.
  const focused = session.getState().focus.map((id) => session.getState().nodeOf.get(id)!)
  assert.equal(unitInFocus(units.units, focused, null)?.id, 'u1')

  // It is a detour from the story's steps: B goes back to the step.
  assert.equal(pressKey(session.getState(), { key: 'b', shift: false, alt: false }, effects), true)
  assert.deepEqual(session.getState().focus, review.story[session.getState().story.step]!.focus)

  // A unit with no node in the graph moves nothing.
  assert.equal(session.getState().showUnit('u9'), false)
})

test("a running change review's progress comes with the status the screen already asks for, and its story is fetched once it is ready", async () => {
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
  assert.equal(loader.getState().assessment, null)
  assert.equal(loader.getState().preparation?.assessment?.percent, 40)

  now = { ...now, percent: 80, now: 'running the tests' }
  await loader.check()
  assert.deepEqual([loader.getState().preparation?.assessment?.percent, loader.getState().preparation?.assessment?.now], [80, 'running the tests'])
  assert.equal(gets(), 1, 'progress needs nothing but the status')

  now = { state: 'ready', head: review.change.head, summary }
  await loader.check()
  assert.equal(loader.getState().assessment?.story, story)
  await loader.check()
  await loader.check()
  assert.equal(gets(), 2, 'the story is fetched once, when it is ready, and not again')
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
