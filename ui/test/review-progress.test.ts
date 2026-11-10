import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { goToStep, progressOf, startStory } from '../src/features/review/story/story.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review

test('restores the step and the seen marks', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)

  // A first opening starts on the first step, which is then seen.
  let story = startStory(sample, memory.getState().of(sample).progress)
  assert.deepEqual([story.step, story.seen], [0, [sample.story[0]!.id]])

  // Walk three steps ahead, then jump to the last and back to the fourth.
  for (const index of [1, 2, 3, sample.story.length - 1, 3]) {
    story = goToStep(sample, story, index).state
    memory.getState().saveProgress(sample, progressOf(sample, story))
  }
  const seen = [0, 1, 2, 3, sample.story.length - 1].map((index) => sample.story[index]!.id)
  assert.deepEqual(story.seen, seen)

  // Closing and reopening the review, or the app, is a new store over the same storage.
  const reopened = startStory(sample, createReviewMemory(storage).getState().of(sample).progress)
  assert.equal(reopened.step, 3, 'the same step')
  assert.deepEqual(reopened.seen, seen, 'the same seen marks')
  assert.deepEqual(reopened.revealed, story.revealed, 'and what had drawn in is still there')
  assert.equal(reopened.detour, null)
})

test('progress saved for steps that are no longer in the story falls back without failing', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)

  memory.getState().saveProgress(sample, { step: 'gone', seen: ['gone', sample.story[2]!.id, sample.story[2]!.id, 7 as never], revealed: ['ghost', sample.nodes[0]!.id] })
  const story = startStory(sample, createReviewMemory(storage).getState().of(sample).progress)

  assert.equal(story.step, 0)
  assert.deepEqual(story.seen, [sample.story[2]!.id, sample.story[0]!.id])
  assert.deepEqual(story.revealed, [sample.nodes[0]!.id])
})
