import { motion } from 'motion/react'
import { useTheme } from '@/app/theme.ts'
import { spring } from '@/lib/motion.ts'

/**
 * A wide line of hills across a 2000 by 200 box. The line curves through the midpoints between the given heights,
 * with each height as the curve's control, so it never rises above the highest of them: a ridge's crest is where its
 * heights say, which the steps that fill the window count on.
 */
function ridge(heights: readonly number[]): string {
  const step = 2000 / (heights.length - 1)
  const curves = heights.slice(1, -1).map((height, index) => {
    const x = step * (index + 1)
    const nextHeight = heights[index + 2]!
    return `Q${x} ${height} ${x + step / 2} ${(height + nextHeight) / 2}`
  })
  return `M0 ${heights[0]} ${curves.join(' ')} L2000 ${heights.at(-1)} V200 H0 Z`
}

/** Back to front. The nearer a ridge, the lower it sits and the faster it passes. */
const RIDGES = [
  { fill: 'var(--hb-ridge-0)', height: '34vh', pace: 3, path: ridge([110, 30, 124, 40, 112, 24, 128, 46, 100]) },
  { fill: 'var(--hb-ridge-1)', height: '27vh', pace: 6, path: ridge([116, 60, 132, 52, 126, 66, 120, 56, 128]) },
  { fill: 'var(--hb-ridge-2)', height: '20vh', pace: 10, path: ridge([100, 136, 76, 128, 88, 140, 80, 132, 104]) },
  { fill: 'var(--hb-ridge-3)', height: '13vh', pace: 15, path: ridge([126, 92, 140, 100, 132, 88, 136, 106, 128]) },
] as const

const STARS = [
  [22, 18, 1.6],
  [54, 64, 1.2],
  [96, 30, 1.8],
  [140, 76, 1.2],
  [180, 22, 1.4],
  [12, 92, 1.1],
] as const

interface SceneProps {
  /** How far along the steps the setup is, from 0. The hills pass by as it grows. */
  at: number
  /** The step fills the window: the hills sink until their crests are below its scrolling box (steps.tsx, FILLED). */
  low: boolean
  /** The setup is handing over to the app: the land sinks away. */
  leaving: boolean
  /** The setup opened over the app, not before it: the land rises in. */
  rise: boolean
  /** Movement is still: the land holds where it is and only fades. */
  still: boolean
}

const JUMP = { duration: 0 } as const

/** The land the setup stands in: hills that move at different speeds as the steps go by, and the sun or the moon. */
export function Scene({ at, low, leaving, rise: risesIn, still }: SceneProps) {
  const dark = useTheme() === 'dark'
  const rise = risesIn && !still
  const travel = still ? JUMP : spring.screen

  // The sky drifts a little as the steps go by and lifts away as the setup leaves. Still, it holds.
  const sky = `translateX(${still ? 0 : -at * 1.6}vw) translateY(${leaving && !still ? -30 : 0}px)`
  // As the theme turns dark the sun sets below the moon's spot and the moon rises into it. Still, they only fade.
  const sunSet = dark && !still
  const sun = `translateY(${sunSet ? 120 : 0}px) scale(${sunSet ? 0.8 : 1})`
  const moon = `translateY(${dark || still ? 0 : 90}px)`

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute top-[9vh] right-[11vw]"
        initial={rise ? { opacity: 0, transform: 'translateX(0vw) translateY(40px)' } : false}
        animate={{ opacity: leaving ? 0 : 1, transform: sky }}
        transition={{ transform: travel, opacity: { duration: leaving ? 0.3 : 0.5 } }}
      >
        <motion.div
          className="size-[76px] rounded-full bg-sun"
          initial={false}
          animate={{ opacity: dark ? 0 : 1, transform: sun }}
          transition={{ transform: travel, opacity: { duration: 0.4 } }}
        />
        <motion.svg
          viewBox="0 0 200 110"
          className="absolute -top-6 -right-10 h-[110px] w-[200px]"
          initial={false}
          animate={{ opacity: dark ? 1 : 0, transform: moon }}
          transition={{ transform: travel, opacity: { duration: 0.4 } }}
        >
          <path d="M132 22 a32 32 0 1 0 28 47 a26 26 0 1 1 -28 -47 Z" fill="var(--hb-text)" />
          {STARS.map(([cx, cy, r]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="var(--hb-text)" opacity="0.7" />
          ))}
        </motion.svg>
      </motion.div>

      {RIDGES.map((layer, index) => {
        // One unit per axis, so every move between these interpolates. 40vh is below the tallest ridge.
        const sink = leaving ? 40 : low ? 12 : 0
        // Still, the hills stay put through the steps and fade with the rest as the setup leaves.
        const place = still ? 'translateX(0vw) translateY(0vh)' : `translateX(${-at * layer.pace}vw) translateY(${sink}vh)`
        // Sinking away, the far ridge goes first. Rising in, the near one does.
        const delay = leaving ? index * 0.03 : rise ? 0.08 * (RIDGES.length - index) : 0
        const transition = still ? { ...JUMP, opacity: { duration: 0.24 } } : { ...spring.screen, delay }

        return (
          <motion.svg
            key={layer.fill}
            viewBox="0 0 2000 200"
            preserveAspectRatio="none"
            className="absolute bottom-0 left-0 w-[200vw]"
            style={{ height: layer.height }}
            initial={rise ? { transform: 'translateX(0vw) translateY(40vh)' } : false}
            animate={{ transform: place, opacity: still && leaving ? 0 : 1 }}
            transition={transition}
          >
            <path d={layer.path} fill={layer.fill} />
          </motion.svg>
        )
      })}
    </div>
  )
}
