import { ArrowRight, BriefcaseBusiness, Check, Clock, House, MessageCircleQuestion, ShieldCheck, Volume2, VolumeX, X, type LucideIcon } from 'lucide-react'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { play } from '@/features/sound/index.ts'
import { ease, spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { lean, shadesFor, sizesFor } from './balance.ts'
import type { Option } from './story.ts'
import './story.css'

/** The picture on each choice, by its value. A choice without one shows its words alone. */
const ICONS: Partial<Record<string, LucideIcon>> = {
  personal: House,
  work: BriefcaseBusiness,
  yes: MessageCircleQuestion,
  no: ArrowRight,
  'sound-on': Volume2,
  'sound-off': VolumeX,
  // The questions' own two words.
  Yes: Check,
  No: X,
  'Set it up': ShieldCheck,
  Later: Clock,
}

type Side = 'left' | 'right'
const SIDES: readonly Side[] = ['left', 'right']

/** How long the picked bubble takes to fly into hobkin, in seconds, before the story goes on. */
const PICK = 0.3
/** The right bubble arrives this long after the left one, in seconds. */
const ARRIVE_STEP = 0.07

/** A bubble in its place, with its middle on the point it is given, and the one that was not picked as it lets go. */
const AT_REST = 'translate(-50%, -50%) translateX(0px) scale(1)'
const LET_GO = 'translate(-50%, -50%) translateX(0px) scale(0.92)'

/** How big a bubble is: it grows with the window, within what reads well. */
const ORB_SIZE = 'size-[clamp(132px,9.6vw,164px)]'
/** The ring that spreads from the picked bubble, from its edge outward. */
const RING = { from: 'translate(-50%, -50%) scale(0.92)', to: 'translate(-50%, -50%) scale(1.5)' }

interface ChoicesProps {
  label: string
  options: readonly [Option, Option]
  /** The middle between the two, in the window: hobkin. */
  around: { x: number; y: number }
  /** How far each one sits from the middle. */
  apart: number
  onChoose: (value: string) => void
  /** Told the moment a bubble is picked, before its sound and its flight, for a choice that changes either. */
  onPicked?: (value: string) => void
  still: boolean
  /** Filled with the way to hand the keyboard to a side, for the story's Left and Right. */
  reach: RefObject<((side: Side) => void) | null>
}

/**
 * Two bubbles, one each side of hobkin, floating. They balance against each other: the one the pointer nears grows
 * a little and the other gives up the same, on a spring, since the pointer never stops asking. The keyboard does
 * the same as it lands on one. The picked one flies into hobkin, and the other lets go.
 */
export function Choices({ label, options, around, apart, onChoose, onPicked, still, reach }: ChoicesProps) {
  const [picked, setPicked] = useState<string | null>(null)
  const buttons = useRef<Record<Side, HTMLButtonElement | null>>({ left: null, right: null })
  const middles = { left: { x: around.x - apart, y: around.y }, right: { x: around.x + apart, y: around.y } }

  // 1 leans to the left bubble, -1 to the right one. The sizes follow it on a spring that never overshoots much.
  const pull = useMotionValue(0)
  const eased = useSpring(pull, { stiffness: 300, damping: 30 })
  const sizes: Record<Side, MotionValue<string>> = {
    left: useTransform(eased, (value) => `scale(${sizesFor(value)[0]})`),
    right: useTransform(eased, (value) => `scale(${sizesFor(value)[1]})`),
  }
  // The one leaned to also gets lighter, and the other darker.
  const lights: Record<Side, MotionValue<string>> = {
    left: useTransform(eased, (value) => `brightness(${shadesFor(value)[0]})`),
    right: useTransform(eased, (value) => `brightness(${shadesFor(value)[1]})`),
  }

  useEffect(() => {
    // Held still, the bubbles keep their size.
    if (still) return
    const onMove = (event: PointerEvent) => pull.set(lean({ x: event.clientX, y: event.clientY }, middles.left, middles.right))
    const rest = () => pull.set(0)
    addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', rest)
    return () => {
      removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', rest)
    }
    // The middles are numbers taken from these three.
  }, [still, around.x, around.y, apart])

  useEffect(() => {
    reach.current = (side) => buttons.current[side]?.focus()
    return () => {
      reach.current = null
    }
  }, [reach])

  const choose = (value: string) => {
    if (picked !== null) return
    onPicked?.(value)
    play('pick')
    setPicked(value)
    // The pick is seen before the story goes on. Held still there is nothing to wait for.
    setTimeout(() => onChoose(value), still ? 0 : PICK * 1000)
  }

  return (
    <div role="group" aria-label={label}>
      {SIDES.map((side, index) => {
        const option = options[index]!
        const Icon = ICONS[option.value]
        // Which way hobkin is from this bubble: to the right of the left one, to the left of the right one.
        const toward = side === 'left' ? 1 : -1
        // It comes out of hobkin, and the picked one goes back in.
        const fromHobkin = `translate(-50%, -50%) translateX(${toward * apart * 0.5}px) scale(0.9)`
        const intoHobkin = `translate(-50%, -50%) translateX(${toward * apart * 0.62}px) scale(0.72)`

        const arrive = {
          opacity: 1,
          transform: AT_REST,
          transition: {
            transform: { ...spring.rise, delay: index * ARRIVE_STEP },
            opacity: { ...tween.enter, delay: index * ARRIVE_STEP },
          },
        }
        const flyIntoHobkin = { opacity: 0, transform: still ? AT_REST : intoHobkin, transition: { duration: PICK, ease: ease.inOut } }
        const letGo = { opacity: 0, transform: still ? AT_REST : LET_GO, transition: tween.exit }
        const afterThePick = picked === option.value ? flyIntoHobkin : letGo

        return (
          <div key={option.value} className="absolute z-[80]" style={{ left: middles[side].x, top: middles[side].y }}>
            <motion.div
              className="absolute top-0 left-0"
              initial={{ opacity: 0, transform: still ? AT_REST : fromHobkin }}
              animate={picked === null ? arrive : afterThePick}
            >
              <div className="tale-float relative" data-side={side}>
                <span className="tale-bead" data-n="1" />
                <span className="tale-bead" data-n="2" />
                <motion.button
                  ref={(element) => {
                    buttons.current[side] = element
                  }}
                  type="button"
                  disabled={picked !== null}
                  style={{ transform: sizes[side], filter: lights[side] }}
                  onClick={() => choose(option.value)}
                  // The keyboard landing on one leans to it, as the pointer nearing it does.
                  onFocus={(event) => {
                    if (!still && event.currentTarget.matches(':focus-visible')) pull.set(toward)
                  }}
                  className={cn('tale-glassy tale-glass tale-orb grid place-items-center rounded-full font-heading text-[16px] font-semibold tracking-[-0.01em] text-foreground outline-none', ORB_SIZE)}
                >
                  <span className="tale-orb-face flex flex-col items-center gap-2.5">
                    {Icon ? <Icon className="size-6" aria-hidden="true" /> : null}
                    {option.label}
                  </span>
                </motion.button>
              </div>
            </motion.div>
            {picked === option.value && !still ? (
              <motion.span
                aria-hidden="true"
                className={cn('pointer-events-none absolute top-0 left-0 rounded-full border-2 border-sun', ORB_SIZE)}
                initial={{ opacity: 0.8, transform: RING.from }}
                animate={{ opacity: 0, transform: RING.to }}
                transition={{ duration: 0.45, ease: ease.out }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
