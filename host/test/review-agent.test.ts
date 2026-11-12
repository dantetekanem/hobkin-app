import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { askSession, checkerTier, MODEL_DEADLINE_MS, reviewTier, type PiSession } from '../src/review/agent.ts'
import { temporaryDirectory } from './support.ts'

const home = (t: Parameters<typeof temporaryDirectory>[0], config: unknown) => {
  const root = temporaryDirectory(t)
  writeFileSync(join(root, 'config.json'), JSON.stringify(config))
  return root
}

test('a review is built on the mid tier with high thinking, whatever effort the tier names', (t) => {
  const root = home(t, { tiers: { mid: { model: 'anthropic/claude-sonnet-5-5', effort: 'low' }, high: { model: 'anthropic/claude-opus-5-5', effort: 'xhigh' } } })
  assert.deepEqual(reviewTier(root), { tier: 'mid', model: 'anthropic/claude-sonnet-5-5', effort: 'high' })
})

test('without a mid tier the review takes the closest tier that is set: high, then fast, then max, then the main chat', (t) => {
  assert.deepEqual(reviewTier(home(t, { tiers: { fast: { model: 'p/fast' }, high: { model: 'p/high' }, max: { model: 'p/max' } } })), { tier: 'high', model: 'p/high', effort: 'high' })
  assert.deepEqual(reviewTier(home(t, { tiers: { fast: { model: 'p/fast' }, max: { model: 'p/max' } } })), { tier: 'fast', model: 'p/fast', effort: 'high' })
  assert.deepEqual(reviewTier(home(t, { tiers: { max: { model: 'p/max' } } })), { tier: 'max', model: 'p/max', effort: 'high' })
  assert.deepEqual(reviewTier(home(t, { main: { model: 'p/main', effort: 'medium' } })), { tier: 'main', model: 'p/main', effort: 'high' })
  assert.equal(reviewTier(home(t, {})), null)
})

test('the blind check runs on the cheapest tier that is set, at its own thinking or low', (t) => {
  assert.deepEqual(checkerTier(home(t, { tiers: { fast: { model: 'p/fast', effort: 'minimal' }, mid: { model: 'p/mid' } } })), { tier: 'fast', model: 'p/fast', effort: 'minimal' })
  assert.deepEqual(checkerTier(home(t, { tiers: { mid: { model: 'p/mid' }, high: { model: 'p/high' } } })), { tier: 'mid', model: 'p/mid', effort: 'low' })
  assert.deepEqual(checkerTier(home(t, { main: { model: 'p/main', effort: 'xhigh' } })), { tier: 'main', model: 'p/main', effort: 'low' })
  assert.equal(checkerTier(home(t, {})), null)
})

/** A Pi session that answers when told to, or as soon as it is stopped, as Pi's does, and writes down what it was asked. */
function session() {
  const calls: string[] = []
  let answer = () => {}
  const fake: PiSession = {
    messages: [],
    prompt: async (text) => {
      calls.push(`prompt: ${text}`)
      await new Promise<void>((resolve) => (answer = resolve))
      fake.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Three units.' }] })
    },
    abort: async () => {
      calls.push('abort')
      answer()
    },
    dispose: () => void calls.push('dispose'),
  }
  return { fake, calls, answer: () => answer() }
}

test('a model call answers with what the model wrote; one stopped first is never asked, and one stopped on the way is stopped', async () => {
  const asked = session()
  const reply = askSession(asked.fake, 'Rate it.', new AbortController().signal)
  asked.answer()
  assert.equal(await reply, 'Three units.')
  assert.deepEqual(asked.calls, ['prompt: Rate it.', 'dispose'])

  // Stopped before it starts, as when the host closed while the run was on its way to the model.
  const early = session()
  await assert.rejects(askSession(early.fake, 'Rate it.', AbortSignal.abort()), /^Error: The review was stopped before its model answered\.$/)
  assert.deepEqual(early.calls, ['dispose'])

  // Stopped on the way: the session stops too, and what it wrote by then is not taken for an answer.
  const late = session()
  const stop = new AbortController()
  const stopped = askSession(late.fake, 'Rate it.', stop.signal)
  stop.abort()
  await assert.rejects(stopped, /stopped before its model answered/)
  assert.deepEqual(late.calls, ['prompt: Rate it.', 'abort', 'dispose'])
})

test('a model call still going at its deadline is stopped, and says so', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const slow = session()
  const reply = askSession(slow.fake, 'Rate it.', new AbortController().signal)
  t.mock.timers.tick(MODEL_DEADLINE_MS - 1)
  assert.deepEqual(slow.calls, ['prompt: Rate it.'], 'not before its deadline')
  t.mock.timers.tick(1)
  await assert.rejects(reply, /^Error: The model gave no answer within 10 minutes, so it was stopped\.$/)
  assert.deepEqual(slow.calls, ['prompt: Rate it.', 'abort', 'dispose'])
})
