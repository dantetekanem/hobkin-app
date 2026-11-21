import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { OlderSteps, type AskOlder } from '../src/features/agent-activity/older-pages.ts'

const step = (index: number): ActivityEntry => ({ id: `tool:s${index}`, kind: 'tool', name: 'bash', state: 'completed', at: 1000 + index })
const ids = (steps: readonly ActivityEntry[]) => steps.map(({ id }) => id)

/** A run's saved session of `made` steps, answered as the host answers: up to 200 right before a step, newest last. */
function savedRun(made: number) {
  const run = { made }
  const asked: (string | undefined)[] = []
  const ask: AskOlder = {
    before: async ({ before }) => {
      asked.push(before)
      const steps = Array.from({ length: run.made }, (_, index) => step(index))
      const end = before ? steps.findIndex(({ id }) => id === before) : steps.length
      const start = Math.max(0, end - 200)
      return { steps: steps.slice(start, end), more: start > 0, found: end !== -1 }
    },
    output: async ({ id }) => ({ id, output: `the whole of ${id}`, length: 17 + id.length }),
  }
  /** The feed hobkin keeps: the newest 200 steps. */
  const feed = () => Array.from({ length: Math.min(200, run.made) }, (_, index) => step(run.made - Math.min(200, run.made) + index))
  return { run, asked, ask, feed }
}

test("earlier steps come in pages, oldest first, that end right before the feed's oldest step", async () => {
  const { asked, ask, feed } = savedRun(500)
  const older = new OlderSteps(ask)
  assert.deepEqual(older.pagesOf('r1'), { steps: [], more: null, loading: false }, 'nothing asked yet')

  await older.loadMore('r1', feed())
  assert.deepEqual([older.pagesOf('r1').steps.length, older.pagesOf('r1').more], [200, true])
  await older.loadMore('r1', feed())
  const { steps, more } = older.pagesOf('r1')
  assert.deepEqual(asked, ['tool:s300', 'tool:s100'])
  assert.equal(more, false)
  assert.deepEqual(ids([...steps, ...feed()]), ids(Array.from({ length: 500 }, (_, index) => step(index))))
})

test('when the feed lets go of its oldest steps, the pages still join it with no gap and no repeat', async () => {
  const { run, ask, feed } = savedRun(500)
  const older = new OlderSteps(ask)
  await older.loadMore('r1', feed())
  run.made = 550
  await older.follow('r1', feed())
  assert.deepEqual(ids([...older.pagesOf('r1').steps, ...feed()]), ids(Array.from({ length: 450 }, (_, index) => step(index + 100))))
  await older.follow('r1', feed())
  assert.equal(older.pagesOf('r1').steps.length, 250, 'a feed that did not move asks nothing')
})

test('a host from before has no earlier steps and no whole outputs, and says so with no error', async () => {
  const older = new OlderSteps({
    before: async () => { throw Object.assign(Error('This needs hobkin to restart once: the running host is older than this window.'), { code: 'unknown-command' }) },
    output: async () => { throw Object.assign(Error('This needs hobkin to restart once.'), { code: 'unknown-command' }) },
  })
  await older.loadMore('r1', [step(0)])
  assert.deepEqual(older.pagesOf('r1'), { steps: [], more: false, loading: false })
  assert.equal(await older.wholeOutput('r1', 'tool:s0'), null)
})

test("a tool's whole output is read when asked, and a job no longer watched lets go of its pages", async () => {
  const { ask, feed } = savedRun(500)
  const older = new OlderSteps(ask)
  assert.equal(await older.wholeOutput('r1', 'tool:s7'), 'the whole of tool:s7')
  await older.loadMore('r1', feed())
  await older.loadMore('r2', feed())

  older.keepOnly(['r2'])
  assert.deepEqual(Object.keys(older.store.getState()), ['r2'])
  assert.deepEqual(older.pagesOf('r1'), { steps: [], more: null, loading: false })
})
