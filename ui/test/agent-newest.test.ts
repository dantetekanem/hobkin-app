import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drawMore, drawToCome, earlierRow, earlierWords, NEWEST_STEPS, newestOf, withEarlier } from '../src/features/agent-activity/newest.ts'
import { readFrom } from '../src/features/agent-activity/reading-place.ts'

const steps = (count: number) => Array.from({ length: count }, (_, index) => `step ${index}`)

test('a short conversation draws every step, with none before them', () => {
  assert.deepEqual(newestOf(steps(12), NEWEST_STEPS), { shown: steps(12), earlier: 0 })
  assert.deepEqual(newestOf(steps(40), NEWEST_STEPS), { shown: steps(40), earlier: 0 })
})

test('a long conversation starts at its newest forty and says how many came before', () => {
  const { shown, earlier } = newestOf(steps(130), NEWEST_STEPS)
  assert.equal(NEWEST_STEPS, 40)
  assert.equal(shown.length, 40)
  assert.equal(shown[0], 'step 90')
  assert.equal(shown.at(-1), 'step 129')
  assert.equal(earlier, 90)
})

test('each press draws forty more, and never past the first step', () => {
  let drawn = NEWEST_STEPS
  drawn = drawMore(drawn, 130)
  assert.deepEqual(newestOf(steps(130), drawn).earlier, 50)
  drawn = drawMore(drawn, 130)
  assert.deepEqual(newestOf(steps(130), drawn).earlier, 10)
  drawn = drawMore(drawn, 130)
  assert.equal(drawn, 130)
  assert.deepEqual(newestOf(steps(130), drawn), { shown: steps(130), earlier: 0 })
  assert.equal(drawMore(drawn, 130), 130)
})

test('a new step keeps the newest forty drawn: the oldest drawn one moves above them', () => {
  const before = newestOf(steps(60), NEWEST_STEPS)
  const after = newestOf(steps(61), NEWEST_STEPS)
  assert.equal(after.shown.length, 40)
  assert.equal(after.shown.at(-1), 'step 60')
  assert.equal(after.shown[0], 'step 21')
  assert.equal(after.earlier, before.earlier + 1)
})

test('the same steps drawn whole come back as the same list, so nothing draws again for them', () => {
  const short = steps(10)
  assert.equal(newestOf(short, NEWEST_STEPS).shown, short)
})

test('the row above the steps draws the held ones first, then reads older ones from the saved session, and goes when there are none', () => {
  const saved = (more: boolean | null, loading = false, full = true) => ({ more, loading, mayHaveOlder: full })
  // Steps the window holds and has not drawn come first, whatever the saved session holds.
  assert.deepEqual(earlierRow(50, saved(true)), { kind: 'held', count: 50 })
  // Every held step drawn: older ones may be in the saved session while the feed is full, until the host says.
  assert.deepEqual(earlierRow(0, saved(null)), { kind: 'saved', loading: false })
  assert.deepEqual(earlierRow(0, saved(true)), { kind: 'saved', loading: false })
  assert.deepEqual(earlierRow(0, saved(true, true)), { kind: 'saved', loading: true })
  assert.equal(earlierRow(0, saved(null, false, false)), null)
  assert.equal(earlierRow(0, saved(false)), null)
})

test('what the row says, while it draws, reads and waits', () => {
  assert.equal(earlierWords({ kind: 'held', count: 90 }), '90 earlier steps · Show 40 more')
  assert.equal(earlierWords({ kind: 'held', count: 12 }), '12 earlier steps · Show them')
  assert.equal(earlierWords({ kind: 'held', count: 1 }), '1 earlier step · Show it')
  assert.equal(earlierWords({ kind: 'held', count: 1200 }), '1,200 earlier steps · Show 40 more')
  assert.equal(earlierWords({ kind: 'saved', loading: false }), 'Earlier steps · Show 40 more')
  assert.equal(earlierWords({ kind: 'saved', loading: true }), 'Reading earlier steps…')
})

test('a press that reads older steps draws forty of them once they come', () => {
  const held = steps(200)
  const drawn = drawToCome(200)
  // Until the page comes, every held step is drawn and none waits.
  assert.deepEqual(newestOf(held, drawn), { shown: held, earlier: 0 })
  // A page of 100 older steps arrives in front: forty of them are drawn, and sixty wait for the next press.
  const withPage = [...steps(100).map((step) => `older ${step}`), ...held]
  const { shown, earlier } = newestOf(withPage, drawn)
  assert.equal(shown.length, 240)
  assert.equal(shown[0], 'older step 60')
  assert.equal(earlier, 60)
})

test('the page holds the step the view reads from while earlier steps come in above it', () => {
  const steps = [
    { key: 'a', top: 0, height: 40 },
    { key: 'b', top: 52, height: 120 },
    { key: 'c', top: 184, height: 40 },
  ]
  assert.equal(readFrom(steps, 0)?.key, 'a')
  // Scrolled into the middle of the second step, the view reads from it.
  assert.equal(readFrom(steps, 100)?.key, 'b')
  assert.equal(readFrom(steps, 500), null)
})

test("on a hobkin's page the row that reads older steps stands where they go: before the live turn's first step", () => {
  const rows = ['asked 1', 'answer 1', 'asked 2', 'run-2:step a', 'run-2:step b', 'thinking']
  const older = (row: string) => row.startsWith('run-2:')
  assert.deepEqual(withEarlier(rows, older, 'earlier'), ['asked 1', 'answer 1', 'asked 2', 'earlier', 'run-2:step a', 'run-2:step b', 'thinking'])
  // A turn with no step yet has no place for older ones.
  assert.deepEqual(withEarlier(['asked 1', 'answer 1'], older, 'earlier'), ['asked 1', 'answer 1'])
})
