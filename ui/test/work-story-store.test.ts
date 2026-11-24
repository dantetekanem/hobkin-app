import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useStory } from '../src/features/work/story-store.ts'

test('leaving the open review without a verdict ends the story, and a verdict that landed on it keeps the story going', () => {
  const story = useStory.getState()
  assert.equal(story.start(['r1', 'r2', 'r3']), 'r1')

  useStory.getState().landed('r1')
  useStory.getState().left('r1')
  assert.notEqual(useStory.getState().story, null, 'the verdict closed it: the story goes on')
  assert.equal(useStory.getState().next(() => false), 'r2')

  useStory.getState().left('r9')
  assert.notEqual(useStory.getState().story, null, 'leaving another review is not leaving the story')
  useStory.getState().left('r2')
  assert.equal(useStory.getState().story, null, 'left with no verdict: the story ends')

  useStory.getState().left('')
  assert.equal(useStory.getState().story, null, 'with no story, leaving does nothing')
})
