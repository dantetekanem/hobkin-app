import assert from 'node:assert/strict'
import { test } from 'node:test'
import { settlePlays, type Play } from '../src/avatar/mood-play.ts'

/** A stand-in for one of the page's animations, which writes down what the face does with it. */
function animation(said: string[], name: string | undefined, playState: string, currentTime = 0.4): Play {
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
  const cannotEnd: Play = {
    ...animation(said, 'hob-forever', 'running'),
    finish() {
      throw new DOMException('An animation with no end cannot finish.', 'InvalidStateError')
    },
  }
  const onMount = [
    animation(said, 'hob-bob', 'running', 0),
    animation(said, 'hob-typelook', 'running', 0),
    animation(said, 'hob-part-in', 'running', 0),
    cannotEnd,
    animation(said, 'hob-crab-greet', 'running', 0),
    animation(said, undefined, 'running', 0),
  ]

  settlePlays(onMount, false)

  assert.deepEqual(said, ['hob-bob over', 'hob-typelook over', 'hob-part-in over'], 'a transition and the greeting are left as they are')
})

test('a face whose mood changes plays its motion from the start, also a play it ran before or is still running', () => {
  const said: string[] = []
  const afterChange = [
    // The sprout sways in both moods: the same keyframes on the same box are kept, so the play it ran starts again.
    animation(said, 'hob-part-sway', 'finished', 3200),
    animation(said, 'hob-ear-flick', 'running', 1200),
    // New keyframes start at their beginning on their own.
    animation(said, 'hob-bob', 'running', 0),
    animation(said, 'hob-crab-bump', 'finished', 1450),
    animation(said, undefined, 'running', 120),
  ]

  settlePlays(afterChange, true)

  assert.deepEqual(said, ['hob-part-sway from the start', 'hob-ear-flick from the start'])
})
