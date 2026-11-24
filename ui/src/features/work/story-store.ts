import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { advanceStory, startStory, type Story } from './review-story.ts'

/**
 * The story under way (_specs/064-review-story), if one is: the review ids in the order fixed when it started, and
 * which is open. It lives on globalThis, as the review order does, so a hot update of this file keeps the story on screen.
 */
export interface StoryState {
  story: Story | null
  /** The review a verdict landed on, whose closing is the story going on, not the story ending. */
  landedId: string | null
  /** Starts a story on these reviews and returns the first, or null when there are none. */
  start: (ids: readonly string[]) => string | null
  /** Moves to the next review that is not gone and returns it. The story ends, and this is null, after the last. */
  next: (gone: (id: string) => boolean) => string | null
  stop: () => void
  /** A verdict landed on this review: its closing is not the reviewer leaving. */
  landed: (id: string) => void
  /** The reviewer left this review: the story ends if it is the one open, unless a verdict landed on it. */
  left: (id: string) => void
}

const holder = globalThis as { __hobkinReviewStory?: UseBoundStore<StoreApi<StoryState>> }
export const useStory = (holder.__hobkinReviewStory ??= create<StoryState>()(() => ({ story: null, landedId: null }) as StoryState))

// The actions are this copy of the file's, given to the kept store each time it loads, so a hot update brings its own.
useStory.setState({
  start: (ids) => {
    const story = startStory(ids)
    useStory.setState({ story, landedId: null })
    return story ? story.ids[0]! : null
  },
  next: (gone) => {
    const { story } = useStory.getState()
    const following = story ? advanceStory(story, gone) : null
    useStory.setState({ story: following, landedId: null })
    return following ? following.ids[following.at]! : null
  },
  stop: () => {
    if (useStory.getState().story) useStory.setState({ story: null, landedId: null })
  },
})
