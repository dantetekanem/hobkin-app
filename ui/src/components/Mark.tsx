import type { CSSProperties } from 'react'
import { Hob } from '@/avatar/Hob.tsx'
import { HOOD_PATH, type Mood } from '@/avatar/moods.tsx'
import './mark.css'

/** The hobkin mark: the hood and its two eyes, still. For the wordmark and other brand spots. */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="12 17 176 176" aria-hidden="true">
      <path d={HOOD_PATH} fill="var(--hb-mark)" />
      <circle cx="84" cy="138" r="13" fill="var(--hb-mark-eye)" />
      <circle cx="116" cy="138" r="13" fill="var(--hb-mark-eye)" />
    </svg>
  )
}

interface AgentHoodProps {
  /** Hue of this agent's hood, in degrees. */
  hue: number
  /** Size of the hood itself, in CSS pixels. What floats beside it (hands, dots) is drawn outside this box. */
  size?: number
  /** What the agent is doing. Its small face shows it the way hobkin's own face does. */
  mood?: Mood
  /** The agent is waiting for the user: it looks puzzled and wears a question mark that asks to be noticed. */
  asking?: boolean
  /** False holds the pose. An agent that is working moves. */
  working?: boolean
  className?: string
}

/** The art's own box and the mark's box, in the art's units. The hood sits in the same place in both. */
const ART = { size: 256, left: 40, top: 45 }
const HOOD_BOX = 176

/**
 * A small hobkin in a hue of its own, standing for one delegated agent. It is the same character as the
 * one by the message input, so it shows the same moods: working, thinking, searching and the rest.
 */
export function AgentHood({ hue, size = 22, mood = 'working', asking = false, working = true, className }: AgentHoodProps) {
  const unit = size / HOOD_BOX
  const style = {
    width: size,
    height: size,
    fontSize: size,
    // A start point taken from the hue, so hoods side by side are out of step with each other.
    '--agent-delay': `${-((hue * 7) % 100) / 100}s`,
  } as CSSProperties

  return (
    <span className={['agent-hood', className].filter(Boolean).join(' ')} data-asking={asking || undefined} data-large={size >= 64 || undefined} style={style}>
      <span className="agent-hood-art" style={{ left: -ART.left * unit, top: -ART.top * unit }}>
        <Hob
          mood={asking ? 'confused' : mood}
          size={ART.size * unit}
          tint={`oklch(var(--agent-l, 0.62) 0.11 ${hue})`}
          eye="var(--background)"
          stage="var(--background)"
          still={!working}
          title={asking ? 'waiting for you' : mood}
        />
      </span>
      {asking ? (
        <span className="agent-hood-ask" aria-hidden="true">
          ?
        </span>
      ) : null}
    </span>
  )
}
