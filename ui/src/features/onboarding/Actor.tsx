import { useAnimate, type Transition } from 'motion/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Hob, useHobReactions } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { usePet } from '@/avatar/use-pet.ts'
import { play as sound } from '@/features/sound/index.ts'
import { ease } from '@/lib/motion.ts'
import { FACE, type Seat } from './face-size.ts'
import { LAYER, type Arrival, type Hop } from './world-geometry.ts'

/**
 * `waiting`: out of sight while the world builds. `arriving`: up from behind the mountains and hopping to the
 * middle. `talking`: on its seat. `leaving`: flying to its place by the message input.
 */
export type Act = 'waiting' | 'arriving' | 'talking' | 'leaving'

interface ActorProps {
  act: Act
  /** Where it hides, peeks and hops on its way in. Taken once, as it starts to arrive. */
  arrival: Arrival
  /** Where it stands while it talks. It moves there on a spring when this changes. */
  seat: Seat
  /** Its place by the message input, to fly to as the setup leaves. Null when the frame has none. */
  home: Seat | null
  mood: Mood
  /** Changes with each beat of the story, and it hops a little when it does. */
  beat: string
  still: boolean
  /** The eyes follow the pointer inside this. */
  followWithin: RefObject<HTMLElement | null>
  /** It stands on its seat and is ready to talk. */
  onArrived: () => void
}

/**
 * The character's three boxes, one inside the other. Each moves one thing, so the moves never fight: the outer one
 * goes sideways, the middle one goes up and down and sets the size, and the inner one squashes and stretches from
 * the foot.
 */
interface Boxes {
  outer: HTMLElement
  middle: HTMLElement
  inner: HTMLElement
}

const across = ({ x }: Pick<Seat, 'x'>) => `translateX(${x - FACE / 2}px)`
const down = ({ y, scale }: Pick<Seat, 'y' | 'scale'>) => `translateY(${y - FACE / 2}px) scale(${scale})`

/** The inner box's shapes through a hop: standing, gathered to jump, stretched on the way up, and squashed as it lands. */
const UPRIGHT = 'scale(1, 1)'
const GATHERED = 'scale(1.14, 0.84)'
const STRETCHED = 'scale(0.9, 1.12)'
const AT_THE_TOP = 'scale(0.96, 1.05)'
const SQUASHED = 'scale(1.18, 0.82)'
const REBOUND = 'scale(0.97, 1.04)'

/** Moving between seats, on a spring that a new seat retargets. */
const SETTLE = { type: 'spring', duration: 0.7, bounce: 0.16 } as const
const AT_ONCE = { duration: 0 } as const
/** The flight at the end: it travels sideways on a spring while it rises a little, then dives into its seat. */
const FLY_X = { type: 'spring', duration: 0.74, bounce: 0 } as const
const FLY_Y: Transition = { duration: 0.74, times: [0, 0.32, 1], ease: ['easeOut', 'easeIn'] }
const FLIGHT_RISE = 64

/** How much of a hop is spent going up. A little under half, so it hangs at the top and comes down with weight. */
const UP_SHARE = 0.46
/** It rises from behind the ridge until its eyes show, then looks around for this long before it hops. Seconds. */
const PEEK = { rise: 0.6, look: 0.7 }
/** Gathering itself before a hop, the breath between two hops, and recovering from a landing. Seconds. */
const GATHER = 0.09
const BETWEEN_HOPS = 0.04
const RECOVER = 0.18

const pause = (seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000))

type Animate = ReturnType<typeof useAnimate>[1]

/** The way in as it plays: every move it started, so all of them can be stopped where they are. */
interface Performance {
  play: (...move: Parameters<Animate>) => ReturnType<Animate>
  stopped: () => boolean
  stop: () => void
}

function startPerformance(animate: Animate): Performance {
  let stopped = false
  const playing = new Set<{ stop: () => void }>()

  return {
    play: (...move) => {
      const control = animate(...move)
      playing.add(control)
      return control
    },
    stopped: () => stopped,
    stop: () => {
      stopped = true
      for (const control of playing) control.stop()
    },
  }
}

/** One hop, from where it stands to where the hop lands. It gathers itself, rises, and lands with its weight. */
async function hop({ play, stopped }: Performance, { outer, middle, inner }: Boxes, from: Seat, { to, lift, time, layer }: Hop): Promise<void> {
  const top = { y: Math.min(from.y, to.y) - lift, scale: (from.scale + to.scale) / 2 }
  const up = time * UP_SHARE
  const fall = time - up

  await play(inner, { transform: [UPRIGHT, GATHERED] }, { duration: GATHER, ease: 'easeOut' })
  if (stopped()) return

  sound('hop')
  void play(outer, { transform: [across(from), across(to)] }, { duration: time, ease: 'linear' })
  void play(inner, { transform: [GATHERED, STRETCHED, AT_THE_TOP] }, { duration: up, ease: 'easeOut' })
  // Up against its weight and down with it. A falling thing speeds up, which is the one honest use of ease-in.
  await play(middle, { transform: [down(from), down(top)] }, { duration: up, ease: 'easeOut' })
  if (stopped()) return

  // At the top it is above every crest between the two ends, so changing what it is in front of shows nothing.
  outer.style.zIndex = String(layer)
  await play(middle, { transform: [down(top), down(to)] }, { duration: fall, ease: 'easeIn' })
  if (stopped()) return

  sound('land')
  await play(inner, { transform: [SQUASHED, REBOUND, UPRIGHT] }, { duration: RECOVER, times: [0, 0.55, 1], ease: 'easeOut' })
}

interface WayInCues {
  /** It is in its hiding place, and may be drawn. */
  onHidden: () => void
  /** It has looked around and starts to hop. */
  onHopping: () => void
}

/**
 * The whole way in: it rises behind a ridge until its eyes show, looks around, and hops to the stage, each hop
 * nearer and bigger. Answers whether it got there, or was stopped on the way.
 */
async function comeIn(performance: Performance, boxes: Boxes, { hidden, hiddenLayer, peek, hops }: Arrival, { onHidden, onHopping }: WayInCues): Promise<boolean> {
  const { play, stopped } = performance
  const { outer, middle } = boxes

  outer.style.zIndex = String(hiddenLayer)
  outer.style.transform = across(hidden)
  middle.style.transform = down(hidden)
  onHidden()

  await play(middle, { transform: [down(hidden), down(peek)] }, { duration: PEEK.rise, ease: ease.out })
  if (stopped()) return false
  await pause(PEEK.look)
  if (stopped()) return false
  onHopping()

  let from = peek
  for (const [index, next] of hops.entries()) {
    await hop(performance, boxes, from, next)
    if (stopped()) return false
    from = next.to

    const last = index === hops.length - 1
    if (!last) await pause(BETWEEN_HOPS)
    if (stopped()) return false
  }
  return true
}

/**
 * The character. It waits out of sight, rises behind a ridge until its eyes show, looks around, and hops to the
 * middle of the window in four or five hops, passing in front of a ridge at the top of each hop. Then it stays on
 * its seat for the whole story, and flies to its place by the message input at the end.
 */
export function Actor({ act, arrival, seat, home, mood, beat, still, followWithin, onArrived }: ActorProps) {
  const [layer, animate] = useAnimate<HTMLDivElement>()
  const riser = useRef<HTMLDivElement | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const [seen, setSeen] = useState(false)
  // Until it lands it has a face of its own: looking for someone, then just hopping.
  const [onTheWay, setOnTheWay] = useState<Mood>('searching')
  const arrived = useRef(false)
  /** Stops the hops where they are. */
  const stopArriving = useRef<(() => void) | null>(null)
  const land = useRef(onArrived)
  land.current = onArrived

  const hasLanded = arrived.current || act === 'talking' || act === 'leaving'
  const face = useHobReactions(hasLanded ? mood : onTheWay)
  // The story needs a character, so No Pet draws Ears here.
  const pet = usePet()

  const boxesNow = (): Boxes | null => {
    const outer = layer.current
    const middle = riser.current
    const inner = body.current
    return outer && middle && inner ? { outer, middle, inner } : null
  }

  const finish = () => {
    if (arrived.current) return
    arrived.current = true
    land.current()
  }

  // The way in. It always plays to the end: nothing the user does cuts the hops short.
  useEffect(() => {
    if (act !== 'arriving' || arrived.current) return
    const boxes = boxesNow()
    if (!boxes) return

    const performance = startPerformance(animate)
    stopArriving.current = performance.stop
    const cues = { onHidden: () => setSeen(true), onHopping: () => setOnTheWay('idle') }
    void comeIn(performance, boxes, arrival, cues).then((reached) => {
      if (reached) finish()
    })

    return performance.stop
    // Once, as it starts to arrive, with the way in as it was then.
  }, [act])

  // Held still there are no hops: it is simply there.
  useEffect(() => {
    if (!still || arrived.current || act === 'leaving') return
    const boxes = boxesNow()
    if (!boxes) return

    stopArriving.current?.()
    boxes.outer.style.zIndex = String(LAYER.front)
    boxes.outer.style.transform = across(seat)
    boxes.middle.style.transform = down(seat)
    boxes.inner.style.transform = UPRIGHT
    setSeen(true)
    finish()
    // When movement is off, as the setup opens or once it is turned off.
  }, [still, act])

  // On its seat it follows the seat, as the window is resized.
  useEffect(() => {
    if (act !== 'talking' || !arrived.current) return
    const boxes = boxesNow()
    if (!boxes) return

    const settle = still ? AT_ONCE : SETTLE
    void animate(boxes.outer, { transform: across(seat) }, settle)
    void animate(boxes.middle, { transform: down(seat) }, settle)
  }, [act, seat.x, seat.y, seat.scale, still])

  // A new beat makes it hop a little. Not the first one, and not while it is on its way in or out.
  const hoppedFor = useRef(beat)
  useEffect(() => {
    if (hoppedFor.current === beat) return
    hoppedFor.current = beat
    if (still || act !== 'talking' || !body.current) return

    sound('hop')
    void animate(
      body.current,
      { transform: [UPRIGHT, 'translateY(-26px) scale(0.95, 1.07)', 'translateY(0px) scale(1.08, 0.92)', 'translateY(0px) scale(1, 1)'] },
      { duration: 0.56, times: [0, 0.4, 0.72, 1], ease: ['easeOut', 'easeIn', 'easeOut'] },
    )
  }, [beat])

  // The hand-off: it flies to its place by the message input. With no place to land on, or held still, it fades.
  useEffect(() => {
    if (act !== 'leaving') return
    const boxes = boxesNow()
    if (!boxes) return
    stopArriving.current?.()

    if (still || !home) {
      void animate(boxes.outer, { opacity: 0 }, { duration: 0.3, ease: 'linear' })
      return
    }

    const peak = { y: seat.y - FLIGHT_RISE, scale: seat.scale * 1.05 }
    void animate(boxes.outer, { transform: across(home) }, FLY_X)
    void animate(boxes.middle, { transform: [down(seat), down(peak), down(home)] }, FLY_Y)
    // Once, as the setup starts to leave, from where it stands then.
  }, [act])

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: FACE, height: FACE, zIndex: arrival.hiddenLayer, visibility: seen ? 'visible' : 'hidden' }}
    >
      <div ref={riser}>
        <div ref={body} style={{ transformOrigin: '50% 100%' }}>
          {/* Poking it is play, as by the message input. It takes no keyboard. */}
          <button type="button" tabIndex={-1} aria-label="hobkin" data-own="" className="pointer-events-auto block cursor-default rounded-full outline-none" {...face.handlers}>
            <Hob pet={pet} mood={face.mood} size={FACE} still={still} followWithin={followWithin} />
          </button>
        </div>
      </div>
    </div>
  )
}
