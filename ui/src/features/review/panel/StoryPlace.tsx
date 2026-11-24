import { storyPlace } from '@/features/work/review-story.ts'
import { useStory } from '@/features/work/story-store.ts'

/**
 * Where the review stands in the story the user started from the list (spec 064): "3 of 14" and Stop, in the panel's
 * top line, as quiet as the stack strip. Nothing is drawn, and no room kept, when no story runs. The story runs until it
 * ends, so the line holds the same room from the first review to the last.
 */
export function StoryPlace({ onStop }: { onStop: () => void }) {
  const story = useStory((state) => state.story)
  if (!story) return null
  return (
    <span className="mr-0.5 flex shrink-0 items-center gap-0.5">
      <span title="The reviews you chose to go through one by one" className="inline-flex h-6 items-center rounded-full bg-background px-2 font-heading text-[12px] font-medium whitespace-nowrap text-muted-foreground tabular-nums">
        {storyPlace(story)}
      </span>
      <button
        type="button"
        data-stop
        onClick={() => {
          useStory.getState().stop()
          onStop()
        }}
        className="inline-flex h-6 items-center rounded-full px-2 font-heading text-[12px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-[160ms] ease-[var(--ease-out)] hover:bg-secondary hover:text-foreground active:scale-[0.94]"
      >
        Stop
      </button>
    </span>
  )
}
