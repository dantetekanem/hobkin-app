import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { sampleStatus } from '@/app/sample.ts'
import { useStill } from '@/app/still.ts'
import { Hob, useHobReactions } from '@/avatar/Hob.tsx'
import { PET_FOOT_Y } from '@/avatar/pets.ts'
import { hopCue } from '@/features/sound/cues.ts'
import { play } from '@/features/sound/index.ts'
import { runCommand, useHasHost, useHost } from '@/lib/host/index.ts'
import { canUseModel } from '@/lib/host/state.ts'
import { turnStartedAt } from './doing.ts'
import { shownMood } from './mood.ts'
import { useNow } from './use-now.ts'

export interface ChatAvatarProps {
  /** The area the eyes follow the pointer in. */
  followWithin: RefObject<HTMLDivElement | null>
  /** The message input holds text. */
  typing: boolean
}

const SIZE = 104
/** The pet's feet end at y 197.5 of a view box that ends at 228. The art's empty edge below them hangs past the row, so the feet sit on the input's bottom line. */
const BASE_INSET = ((228 - PET_FOOT_Y) / 256) * SIZE

/** hobkin's face beside the input. Its mood is hobkin's, with the user's pokes layered over it, as in the terminal app. */
export function ChatAvatar({ followWithin, typing }: ChatAvatarProps) {
  const live = useHasHost()
  const reaction = useHost((state) => state.snapshot.mood)
  const busy = useHost((state) => state.link === 'open' && state.snapshot.busy === true)
  const searching = useHost((state) => state.snapshot.searching === true)
  const tooling = useHost((state) => state.snapshot.tooling === true)
  const running = useHost((state) => (state.snapshot.runs ?? []).some((run) => run.state === 'running' && run.kind === 'background'))
  const waiting = useHost((state) => (state.snapshot.decisions?.length ?? 0) > 0)
  const startedAt = useHost((state) => turnStartedAt(state.snapshot))
  // With no model to answer there is nothing to react to.
  const signedOut = useHost((state) => state.link === 'open' && (state.models !== null || state.signIn.status !== 'unknown') && !canUseModel(state))
  const asked = useHost((state) => state.question !== null)
  // A reaction ends by the clock, so the face looks again each second while one is showing or a turn runs.
  const now = useNow(busy || Boolean(reaction && !reaction.lasting && reaction.until > Date.now()))

  const shown = shownMood({ reaction, busy, running, typing, asked, waiting, searching, tooling, busyMs: busy && startedAt ? now - startedAt : 0, now })
  // Before anyone has signed in there is nothing to react to: the face just says hello.
  const app = !live ? { mood: sampleStatus.mood, lasting: false } : signedOut ? { mood: 'hello' as const, lasting: false } : shown
  const { mood, handlers } = useHobReactions(app.mood, {
    lasting: app.lasting,
    onWake: () => void runCommand('avatar.wake').catch(() => {}),
  })

  // A key in the input wakes a sleeping face too, as it does in the terminal. A click on a sleeping face only wakes it.
  const asleep = app.lasting
  const wake = handlers.onClick
  const wasTyping = useRef(typing)
  useLayoutEffect(() => {
    if (typing && !wasTyping.current && asleep) wake()
    wasTyping.current = typing
  })

  // hobkin chirps as it starts to hop. The ref outlives a hot update, so an update does not chirp again.
  const still = useStill()
  const heardMood = useRef(mood)
  useEffect(() => {
    const cue = hopCue(heardMood.current, mood, still)
    heardMood.current = mood
    if (cue) play(cue.name)
  }, [mood, still])

  return (
    // Out of the keyboard's way: poking the face is play, and typing wakes it.
    // `data-hob-home` marks where hobkin's face lives, for pages that hand the face over to it, such as the first-run setup.
    <button type="button" aria-label="hobkin" data-hob-home tabIndex={-1} className="shrink-0 cursor-default rounded-full outline-offset-2" style={{ marginBottom: -BASE_INSET }} {...handlers}>
      <Hob mood={mood} size={SIZE} followWithin={followWithin} />
    </button>
  )
}
