import assert from 'node:assert/strict'
import { test } from 'node:test'
import { settlePlays, type Play } from '../src/avatar/mood-play.ts'

interface StandIn {
  /** The keyframes' name of a CSS animation. A transition, or a blink played from script, has none. */
  name?: string
  playState: 'running' | 'finished'
  currentTime: number
}

/** A stand-in for one of the page's animations, which writes down in `said` what the face does with it. */
function animation(said: string[], { name, playState, currentTime }: StandIn): Play {
  let time: CSSNumberish | null = currentTime
  return {
    animationName: name,
    playState,
    get currentTime() {
      return time
    },
    set currentTime(to) {
      time = to
      said.push(`${name} from the start`)
    },
    finish() {
      said.push(`${name} over`)
    },
  }
}

test('a face that mounts in a mood rests: each play of the mood is over at once, and the greeting still plays', () => {
  const said: string[] = []
  const justStarted = (name?: string) => animation(said, { name, playState: 'running', currentTime: 0 })
  const cannotEnd: Play = {
    ...justStarted('hob-forever'),
    finish() {
      throw new DOMException('An animation with no end cannot finish.', 'InvalidStateError')
    },
  }
  const onMount = [
    justStarted('hob-bob'),
    justStarted('hob-typelook'),
    justStarted('hob-part-in'),
    cannotEnd,
    justStarted('hob-crab-greet'),
    // A transition has no keyframes' name.
    justStarted(),
  ]

  settlePlays(onMount, false)

  assert.deepEqual(said, ['hob-bob over', 'hob-typelook over', 'hob-part-in over'], 'a transition and the greeting are left as they are')
})

test('a face whose mood changes plays its motion from the start, also a play it ran before or is still running', () => {
  const said: string[] = []
  const afterChange = [
    // The sprout sways in both moods: the same keyframes on the same box are kept, so the play it ran starts again.
    animation(said, { name: 'hob-part-sway', playState: 'finished', currentTime: 3200 }),
    animation(said, { name: 'hob-ear-flick', playState: 'running', currentTime: 1200 }),
    // New keyframes start at their beginning on their own.
    animation(said, { name: 'hob-bob', playState: 'running', currentTime: 0 }),
    animation(said, { name: 'hob-crab-bump', playState: 'finished', currentTime: 1450 }),
    animation(said, { playState: 'running', currentTime: 120 }),
  ]

  settlePlays(afterChange, true)

  assert.deepEqual(said, ['hob-part-sway from the start', 'hob-ear-flick from the start'])
})
