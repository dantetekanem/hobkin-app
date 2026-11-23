import { useEffect, useState, type CSSProperties } from 'react'
import { AgentHood } from '@/components/Mark.tsx'
import { CRAB_SPAN, Crab, type CrabProps } from './Crab.tsx'
import { SMALL_FACE_PX } from './face-motion.ts'
import type { Mood } from './moods.tsx'
import { palsState, restedLong, SLEEP_AFTER_MS } from './pals.ts'
import { ART_BOX, MARK_BOX } from './pets.ts'

export interface PalsProps {
  /** The run or durable hobkin the pair stands for. They greet once in a window for each, not each time it comes back into view. */
  id?: string
  /** Hue of hobkin's face, as AgentHood takes it. */
  hue: number
  /** Size of hobkin's face box, in CSS pixels. The crab stands beside it at the same scale, on the same ground. */
  size: number
  /** The face's mood, as the page would give the face alone. */
  mood: Mood
  /** The run waits for the user. */
  asking?: boolean
  /** False: the run rests (it waits for its next turn, or it ended), and both hold their pose. */
  working?: boolean
  /** The run ended well: both are happy. */
  endedWell?: boolean
  /** Since when the run rests, in milliseconds since the epoch. After a while both fall asleep. */
  restingSince?: number
  /** Hold both for good, as a small row does: no loop and no greeting. */
  still?: boolean
  className?: string
}

/** The crab's share of the pair, in the art's units: from its left claw, with room for its lean, to its right. */
const CRAB_WIDTH = CRAB_SPAN.right - CRAB_SPAN.left

/** The pair's width for a face of this size: the face's box and the crab's beside it. */
function palsWidth(size: number): number {
  return size + (CRAB_WIDTH * size) / MARK_BOX.size
}

/**
 * hobkin's face and Claude Code's crab side by side, two pals, for a run on Claude Code. The pair's box is fixed by the
 * face's size, so nothing around it moves as their moods change. The crab takes the face's mood (pals.ts): it taps its
 * claws while the run works, leans in toward hobkin while the run waits, cheers with it when a run ends well and sleeps
 * with it once they have rested long. When the pair first shows for a run, and when the run finishes, they lean together
 * for a claw bump.
 */
export function Pals({ id, hue, size, mood, asking = false, working = true, endedWell = false, restingSince, still = false, className }: PalsProps) {
  // A crab drawn smaller than a face moves as a whole, so it holds still, as a small row's figure.
  const held = still || (ART_BOX.size * size) / MARK_BOX.size < SMALL_FACE_PX
  const asleep = useRestedLong(working ? undefined : restingSince)
  const state = palsState({ mood, asking, working, endedWell, restedLong: asleep })
  const greet = useGreeting(id, working && !endedWell)

  return (
    <span
      className={['pals', className].filter(Boolean).join(' ')}
      data-still={held || undefined}
      style={{ width: palsWidth(size), height: size }}
    >
      {/* Keyed by the greeting, so hobkin's lean plays from its start with the crab's. */}
      <span key={greet ?? 'stand'} className={greet === null ? 'pals-face' : 'pals-face pals-face-greet'} style={{ width: size, height: size }}>
        <AgentHood hue={hue} size={size} mood={state.face} asking={asking} working={working && !endedWell} />
      </span>
      <CrabBeside size={size} mood={state.crab} still={held} resting={!state.moving} greet={greet} />
    </span>
  )
}

export interface PalCrabProps {
  /** Size of the face box it stands beside, in CSS pixels. */
  size: number
  mood: Mood
  asking?: boolean
  working?: boolean
  className?: string
}

/**
 * The crab alone, held still in its pose, as it stands beside a face of `size` in the pair: for a small row that keeps
 * the face in a slot of its own. Its box is fixed by `size`.
 */
export function PalCrab({ size, mood, asking = false, working = true, className }: PalCrabProps) {
  const { crab } = palsState({ mood, asking, working })
  return <CrabBeside size={size} mood={crab} still resting className={className} title="on Claude Code" />
}

type CrabBesideProps = Pick<CrabProps, 'mood' | 'still' | 'resting' | 'greet' | 'title'> & {
  /** Size of the face box it stands beside, in CSS pixels. */
  size: number
  className?: string
}

/** The crab's box beside a face of `size`: its art square set back so it stands on the face's ground, at the face's scale. */
function CrabBeside({ size, className, ...crab }: CrabBesideProps) {
  const unit = size / MARK_BOX.size
  const art = { left: -(CRAB_SPAN.left - ART_BOX.min) * unit, top: -(MARK_BOX.y - ART_BOX.min) * unit } as CSSProperties
  return (
    <span className={['pals-crab', className].filter(Boolean).join(' ')} style={{ width: CRAB_WIDTH * unit, height: size }}>
      <span className="pals-crab-art" style={art}>
        <Crab {...crab} size={ART_BOX.size * unit} />
      </span>
    </span>
  )
}

/** The runs whose pair has greeted in this window, the latest last. On globalThis, so a hot update keeps it. */
const greeted: Set<string> = ((globalThis as { __hobkinPalsGreeted?: Set<string> }).__hobkinPalsGreeted ??= new Set())
const MOST_GREETED = 200

/**
 * The greeting to play, by a number that grows each time: when the pair first shows for a run in this window, and each
 * time the run stops working. Null while there is none, as when the user comes back to a run the pair has greeted.
 */
function useGreeting(id: string | undefined, working: boolean): number | null {
  const [count, setCount] = useState<number | null>(() => (id !== undefined && greeted.has(id) ? null : 0))
  const [was, setWas] = useState(working)
  if (was !== working) {
    setWas(working)
    if (!working) setCount((count ?? -1) + 1)
  }
  useEffect(() => {
    if (id === undefined) return
    greeted.delete(id)
    greeted.add(id)
    if (greeted.size > MOST_GREETED) greeted.delete(greeted.values().next().value!)
  }, [id])
  return count
}

/** Whether the run has rested since `since` long enough for the pair to sleep, looked at again once it would be. */
function useRestedLong(since: number | undefined): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === undefined) return
    const left = since + SLEEP_AFTER_MS - Date.now()
    if (left <= 0) {
      setNow(Date.now())
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), left + 100)
    return () => clearTimeout(timer)
  }, [since])
  return restedLong(since, now)
}
