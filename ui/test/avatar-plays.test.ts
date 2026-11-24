import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, useState, type RefObject } from 'react'
import { settlePlays, useMoodPlay, type Play } from '../src/avatar/mood-play.ts'
import { mountCounting } from './render-count.ts'

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

/** A face's box with one animation that has been running a while: it counts the face's plays and rests. */
function countingFace() {
  const counts = { plays: 0, rests: 0 }
  const running: Play = {
    animationName: 'hob-mood',
    playState: 'running',
    get currentTime() {
      return 500
    },
    set currentTime(_from) {
      counts.plays += 1
    },
    finish() {
      counts.rests += 1
    },
  }
  const root = { current: { getAnimations: () => [running] } as unknown as HTMLElement }
  return { counts, root }
}

/** Mounts a face in `first` and returns how to change its mood, as the page would. */
async function mountFace(root: RefObject<HTMLElement | null>, first: string) {
  let changeMood: (mood: string) => void = () => {}
  function Face() {
    const [mood, setMood] = useState(first)
    changeMood = setMood
    useMoodPlay(root, mood)
    return null
  }
  const mounted = await mountCounting(() => createElement(Face))
  return {
    show: (mood: string) => mounted.change(() => changeMood(mood)),
    unmount: () => mounted.unmount(),
  }
}

test('an agent at work flipping between thinking, working and searching plays once, as it starts, and not at each flip', async () => {
  const { counts, root } = countingFace()
  const face = await mountFace(root, 'idle')

  await face.show('thinking')
  const playsOnStarting = counts.plays
  for (const mood of ['working', 'thinking', 'searching', 'working']) await face.show(mood)

  assert.equal(playsOnStarting, 1)
  assert.equal(counts.plays - playsOnStarting, 0, 'no play over the four flips at work')
  assert.equal(counts.rests, 1 + 4, 'it rests as it mounts, and shows each mood at work at rest')
  await face.unmount()
})

test('a face plays once as it starts working and once as it finishes', async () => {
  const { counts, root } = countingFace()
  const face = await mountFace(root, 'idle')

  await face.show('working')
  const playsOnStarting = counts.plays
  await face.show('happy')

  assert.equal(playsOnStarting, 1, 'idle to working')
  assert.equal(counts.plays - playsOnStarting, 1, 'working to happy')
  await face.unmount()
})
