import type { ReactNode } from 'react'
import { motion, type Transition } from 'motion/react'
import { useTheme } from '@/app/theme.ts'
import { ease, spring } from '@/lib/motion.ts'
import { LAYER, PACE, SHAPES, STARS, boxOf, pathOf, type Shape } from './world-geometry.ts'

// The phases' lengths are counted where the numbers they come from live, so a node test can read them too.
export { WORLD_TIMES } from './world-geometry.ts'

export type WorldPhase = 'void' | 'sky' | 'land' | 'ready'

export interface WorldProps {
  phase: WorldPhase
  /** The setup is handing over to the app: the land sinks away, far ridge first, and the sky lifts and fades. */
  leaving: boolean
  /** Movement is off: nothing travels. Each phase's things fade in where they belong, and leaving is a fade. */
  still: boolean
  /** Drawn inside the same stacking context as the ridges, so the caller's character can sit between two ridges. */
  children?: ReactNode
}

const ORDER: Record<WorldPhase, number> = { void: 0, sky: 1, land: 2, ready: 3 }

/** The sun and the moon ride one slow spring with no bounce: a sky does not wobble. */
const ARC = { type: 'spring', duration: PACE.arc, bounce: 0 } as const
/** Below the horizon, the sun and the moon are turned this far round the arc's middle. */
const SET = 80
/** Each ridge rises on its own spring, a little past its place and back: about 3% of the way, a few pixels. */
const RISE = { type: 'spring', duration: PACE.rise, bounce: 0.25 } as const
/** Down out of sight, as a share of a ridge's own height. */
const SUNK = 104
const JUMP = { duration: 0 } as const

/** A crescent: a circle with a smaller one bitten out of its upper right. */
const CRESCENT = 'M53.73 6.16 A44 44 0 1 0 91.03 65.86 A36 36 0 1 1 53.73 6.16 Z'

/**
 * The ambient loops, and the hill's color, one step past the nearest ridge. In the built-in themes each ridge is a
 * step darker than the one behind it, so the hill takes one more: black takes lightness off in proportion, so the
 * dark theme needs more of it for the same step. In a custom theme each ridge leans further on the accent, and so
 * does the hill.
 */
const CSS = `
@keyframes hb-world-twinkle { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
@keyframes hb-world-breathe { 0%, 100% { opacity: 0.55; transform: scale(1) } 50% { opacity: 0.9; transform: scale(1.12) } }
.hb-world-hill { fill: color-mix(in oklab, var(--hb-ridge-3) 94%, black) }
.dark .hb-world-hill { fill: color-mix(in oklab, var(--hb-ridge-3) 78%, black) }
:root[data-palette="custom"] .hb-world-hill { fill: color-mix(in oklab, var(--hb-ridge-3) 87.5%, var(--hb-accent)) }
`

/** The sky warms (or, at night, glows blue) from the horizon up. */
const TINT = 'linear-gradient(to top, color-mix(in oklab, var(--hb-ridge-1) 70%, transparent) 0%, color-mix(in oklab, var(--hb-ridge-0) 45%, transparent) 45%, transparent 82%)'
const SUN_GLOW = 'radial-gradient(circle, color-mix(in oklab, var(--hb-sun) 55%, transparent) 0%, transparent 68%)'
const MOON_GLOW = 'radial-gradient(circle, color-mix(in oklab, var(--hb-text) 12%, transparent) 0%, transparent 66%)'

const FILL: Record<Shape, string | undefined> = {
  0: 'var(--hb-ridge-0)',
  1: 'var(--hb-ridge-1)',
  2: 'var(--hb-ridge-2)',
  3: 'var(--hb-ridge-3)',
  hill: undefined,
}
const layerOf = (shape: Shape) => (shape === 'hill' ? LAYER.hill : LAYER.ridges[shape])

/** Rising, the far ridge leads and the hill comes last. Sinking away, the far ridge goes first too. */
function landTransition(index: number, { still, land, leaving }: { still: boolean; land: boolean; leaving: boolean }): Transition {
  if (still) return { duration: land ? 0.5 : 0.3, delay: land ? index * 0.06 : 0, ease: ease.out }
  if (leaving) return { ...spring.screenExit, delay: index * 0.04 }
  return { ...RISE, delay: index * PACE.riseStep }
}

/**
 * The world the first-run setup happens in: the sky, the sun or the moon and stars, four ridges of mountains and the
 * hill the character talks from. It builds itself phase by phase. A phase that is there on the first render shows
 * settled; one that arrives later comes in.
 */
export function World({ phase, leaving, still, children }: WorldProps) {
  const dark = useTheme() === 'dark'
  const sky = ORDER[phase] >= ORDER.sky
  const land = ORDER[phase] >= ORDER.land && !leaving
  // Quietly alive once it has settled. Loops only move transform and opacity, and stop when movement is off.
  const alive = phase === 'ready' && !still && !leaving

  // The sky lifts a little as it fades out. Still, it only fades.
  const skyTransition: Transition = { duration: still ? 0.3 : 0.7, ease: ease.out }
  const arcTransition = (up: boolean): Transition => ({ transform: still ? JUMP : ARC, opacity: { duration: up ? 0.6 : 0.45, ease: ease.out } })

  return (
    // A size container, so the sun and the moon are sized by the world's own box rather than by the window.
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 isolate overflow-hidden" style={{ containerType: 'size' }}>
      <style>{CSS}</style>

      <motion.div
        className="absolute inset-0"
        style={{ zIndex: 0 }}
        initial={false}
        animate={{ opacity: leaving ? 0 : 1, transform: `translateY(${leaving && !still ? -40 : 0}px)` }}
        transition={skyTransition}
      >
        <motion.div
          className="absolute inset-0"
          style={{ background: TINT }}
          initial={false}
          animate={{ opacity: sky ? 1 : 0, transform: `translateY(${sky || still ? 0 : 35}%)` }}
          transition={{ transform: still ? JUMP : ARC, opacity: { duration: 1.2, ease: ease.out } }}
        />

        <Arc up={sky && !dark} still={still} transition={arcTransition(sky && !dark)}>
          <div className="absolute top-[17%] left-[80%] size-[calc(6cqmin+36px)] -translate-x-1/2 -translate-y-1/2">
            <div
              className="absolute -inset-[70%] rounded-full"
              style={{ background: SUN_GLOW, opacity: 0.55, animation: alive ? 'hb-world-breathe 5.6s ease-in-out infinite' : undefined }}
            />
            <div className="absolute inset-0 rounded-full bg-sun" />
          </div>
        </Arc>

        <Arc up={sky && dark} still={still} transition={arcTransition(sky && dark)}>
          <div className="absolute top-[17%] left-[80%] size-[calc(5.4cqmin+32px)] -translate-x-1/2 -translate-y-1/2">
            <div className="absolute -inset-[80%] rounded-full" style={{ background: MOON_GLOW }} />
            <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
              <path d={CRESCENT} fill="var(--hb-text)" />
            </svg>
          </div>
        </Arc>

        {STARS.map(([left, top, radius], index) => {
          const out = sky && dark
          const twinkleSeconds = 3.4 + (index % 4) * 0.9
          const twinkleDelay = index * 0.37
          return (
            <motion.div
              key={`${left}-${top}`}
              className="absolute"
              style={{ left: `${left}%`, top: `${top}%`, width: radius * 2, height: radius * 2 }}
              initial={false}
              animate={{ opacity: out ? 0.85 : 0, transform: `scale(${out || still ? 1 : 0.5})` }}
              transition={{ duration: out ? PACE.starFade : 0.3, delay: out && !still ? PACE.starFirst + index * PACE.starStep : 0, ease: ease.out }}
            >
              <div
                className="size-full rounded-full"
                style={{ background: 'var(--hb-text)', animation: alive ? `hb-world-twinkle ${twinkleSeconds}s ease-in-out ${twinkleDelay}s infinite` : undefined }}
              />
            </motion.div>
          )
        })}
      </motion.div>

      {SHAPES.map((shape, index) => {
        const box = boxOf(shape)
        const transition = landTransition(index, { still, land, leaving })
        return (
          <motion.div
            key={shape}
            className="absolute inset-x-0 bottom-0"
            style={{ top: `calc(${box.share * 100}% + ${box.offset}px)`, zIndex: layerOf(shape) }}
            initial={false}
            animate={{ transform: `translateY(${land || still ? 0 : SUNK}%)`, opacity: still && !land ? 0 : 1 }}
            transition={transition}
          >
            {/* Stretched over the box, so the drawing is exactly where crestY says. It runs on below, under any overshoot. */}
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
              <path d={pathOf(shape)} fill={FILL[shape]} className={shape === 'hill' ? 'hb-world-hill' : undefined} />
            </svg>
          </motion.div>
        )
      })}

      {children}
    </div>
  )
}

/**
 * Turns its sun or moon along an arc round a point low in the middle of the window, so it rises from below the
 * bottom edge on the right up to its place. Still, it stays in its place and only fades.
 */
function Arc({ up, still, transition, children }: { up: boolean; still: boolean; transition: Transition; children: ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0"
      style={{ transformOrigin: '50% 80%' }}
      initial={false}
      animate={{ opacity: up ? 1 : 0, transform: `rotate(${up || still ? 0 : SET}deg)` }}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}
