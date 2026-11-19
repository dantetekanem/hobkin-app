import type { CSSProperties } from 'react'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { BODY_PATH, FEET, MARK_BOX } from '@/avatar/pets.ts'
import { PetPart } from '@/avatar/PetPart.tsx'
import { usePetChoice } from '@/avatar/use-pet.ts'
import './mark.css'

const MARK_PAINT = { mark: 'var(--hb-mark)', eye: 'var(--hb-mark-eye)' }

/** The hobkin mark: the chosen pet and its two eyes, still. For the wordmark and other brand spots. */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  const pet = usePetChoice()
  // No Pet: the wordmark is the word alone.
  if (pet === 'none') return null
  return (
    <svg className={className} width={size} height={size} viewBox={`${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.size} ${MARK_BOX.size}`} aria-hidden="true">
      <PetPart pet={pet} paint={MARK_PAINT} />
      {FEET.map((foot) => (
        <ellipse key={foot.cx} {...foot} fill={MARK_PAINT.mark} />
      ))}
      <path d={BODY_PATH} fill={MARK_PAINT.mark} />
      <circle cx="84" cy="138" r="10" fill={MARK_PAINT.eye} />
      <circle cx="116" cy="138" r="10" fill={MARK_PAINT.eye} />
    </svg>
  )
}

interface AgentHoodProps {
  /** Hue of this agent's body, in degrees. */
  hue: number
  /** Size of the pet's box, in CSS pixels. What floats beside it (hands, dots) is drawn outside this box. */
  size?: number
  /** What the agent is doing. Its small face shows it the way hobkin's own face does. */
  mood?: Mood
  /** The agent is waiting for the user: it looks puzzled and wears a question mark that asks to be noticed. */
  asking?: boolean
  /** False holds the pose. An agent that is working moves. */
  working?: boolean
  className?: string
}

/** The art's own box (-28 to 228) and where the mark's box sits in it, in the art's units. The pet sits in the same place in both. */
const ART = { size: 256, left: MARK_BOX.x + 28, top: MARK_BOX.y + 28 }

/**
 * A small hobkin in a hue of its own, standing for one delegated agent. It is the same character as the
 * one by the message input, so it shows the same moods: working, thinking, searching and the rest.
 */
export function AgentHood({ hue, size = 22, mood = 'working', asking = false, working = true, className }: AgentHoodProps) {
  const unit = size / MARK_BOX.size
  const style = {
    width: size,
    height: size,
    fontSize: size,
    // A start point taken from the hue, so faces side by side are out of step with each other.
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
