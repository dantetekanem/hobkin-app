import type { CSSProperties, ReactNode } from 'react'
import { Art, Layer } from './Layer.tsx'
import type { CrabMood } from './pals.ts'
import type { ArtPoint } from './pets.ts'
import './hob.css'
import './crab.css'

/**
 * The crab pal, drawn in hobkin's own art: the same 256-unit square from -28, standing on the same ground line as the
 * pets (197.5), at about half hobkin's height. A blocky body on four legs, two eyes and two small claws. Our own
 * drawing, in Claude's warm terracotta (`--hb-crab`).
 *
 * Like the face (Hob.tsx), it is a stack of HTML boxes, each with one SVG, so every loop moves a box on the compositor.
 * Its root is a `.hob`, so hob.css holds it still exactly as it holds the face: Still, reduced motion and away.
 */

/** Where the crab stands: the middle of its feet. The body turns, hops and leans about it. */
const FEET_AT: ArtPoint = [100, 197.5]
const EYES_AT: ArtPoint = [100, 145]
/** Where each claw meets the body, which it turns about. */
const LEFT_SHOULDER: ArtPoint = [56, 151]
const RIGHT_SHOULDER: ArtPoint = [144, 151]

/** How far the crab reaches across its square, in the art's units, with room for its lean: what a pair lays out. */
export const CRAB_SPAN = { left: 20, right: 180 } as const

const LEG_XS = [62, 78, 112, 128]

/** Four short legs under the body, reaching up behind it so a hop or a lean never opens a gap. */
const LEGS = LEG_XS.map((x) => <rect key={x} className="hob-fm" x={x} y="170" width="10" height="27.5" rx="3.5" />)

const BODY = <rect className="hob-fm" x="54" y="118" width="92" height="66" rx="12" />

/** A short arm and a pincer, its tip split in two. The right claw is the left one turned over. */
const LEFT_CLAW = (
  <>
    <rect className="hob-fm" x="38" y="145" width="20" height="13" rx="4" />
    <path className="hob-fm" d="M26 154 Q22 154 22 150 L22 128 Q22 124 26 124 L30 124 L34 135 L38 124 L42 124 Q46 124 46 128 L46 150 Q46 154 42 154 Z" />
  </>
)
const RIGHT_CLAW = (
  <>
    <rect className="hob-fm" x="142" y="145" width="20" height="13" rx="4" />
    <path className="hob-fm" d="M174 154 Q178 154 178 150 L178 128 Q178 124 174 124 L170 124 L166 135 L162 124 L158 124 Q154 124 154 128 L154 150 Q154 154 158 154 Z" />
  </>
)

const BLOCK_EYES = (
  <>
    <rect className="hob-fe" x="74" y="135" width="11" height="20" rx="3" />
    <rect className="hob-fe" x="115" y="135" width="11" height="20" rx="3" />
  </>
)

const EYES: Record<'block' | 'happy' | 'closed' | 'low' | 'wide' | 'crossed', ReactNode> = {
  block: BLOCK_EYES,
  happy: (
    <g className="hob-se" strokeWidth="6">
      <path d="M72 150 Q79.5 137 87 150" />
      <path d="M113 150 Q120.5 137 128 150" />
    </g>
  ),
  closed: (
    <g className="hob-se" strokeWidth="5">
      <path d="M72 145 Q79.5 152 87 145" />
      <path d="M113 145 Q120.5 152 128 145" />
    </g>
  ),
  low: (
    <>
      <rect className="hob-fe" x="74" y="143" width="11" height="12" rx="3" />
      <rect className="hob-fe" x="115" y="143" width="11" height="12" rx="3" />
    </>
  ),
  wide: (
    <>
      <rect className="hob-fe" x="72" y="132" width="15" height="24" rx="4" />
      <rect className="hob-fe" x="113" y="132" width="15" height="24" rx="4" />
    </>
  ),
  crossed: (
    <g className="hob-se" strokeWidth="4.5">
      <path d="M75 139 L84 151 M84 139 L75 151" />
      <path d="M116 139 L125 151 M125 139 L116 151" />
    </g>
  ),
}

/** Each mood's eyes, and the classes in crab.css that move them as a pair and blink them. */
const MOOD_EYES: Record<CrabMood, { eyes: keyof typeof EYES; look?: string; blink?: boolean }> = {
  idle: { eyes: 'block', blink: true },
  working: { eyes: 'block', look: 'hob-cl-down', blink: true },
  thinking: { eyes: 'block', look: 'hob-cl-up', blink: true },
  searching: { eyes: 'block', look: 'hob-cl-scan' },
  listening: { eyes: 'block', look: 'hob-cl-left', blink: true },
  happy: { eyes: 'happy' },
  surprised: { eyes: 'wide' },
  sad: { eyes: 'low', look: 'hob-cl-sad' },
  dizzy: { eyes: 'crossed' },
  sleepy: { eyes: 'closed' },
}

export interface CrabProps {
  mood?: CrabMood
  /** Rendered size of the art's square, in CSS pixels, as a Hob's size is. */
  size?: number
  /** Hold the pose, for good: no loop and no greeting. */
  still?: boolean
  /** Hold the mood's pose, while a greeting still plays. */
  resting?: boolean
  /** A new number plays the greeting again: the crab leans toward hobkin, on its left, and bumps a claw. */
  greet?: number
  title?: string
}

export function Crab({ mood = 'idle', size = 44, still = false, resting = false, greet = 0, title }: CrabProps) {
  const look = MOOD_EYES[mood]
  return (
    <span
      className="hob hob-crab"
      data-crab={mood}
      data-still={still || undefined}
      data-rest={resting || undefined}
      role="img"
      aria-label={title ?? `Claude Code, ${mood}`}
      style={{ '--hob-size': `${size}px` } as CSSProperties}
    >
      {/* Keyed by the greeting, so each one plays from its start. */}
      <Layer key={greet} className="hob-crab-greet" at={FEET_AT}>
        <Layer className={`hob-crab-body hob-c-${mood}`} at={FEET_AT}>
          {/* The claws go behind the body, so they can turn about the shoulder without a gap. */}
          <Layer className="hob-claw-bump" at={LEFT_SHOULDER}>
            <Layer className="hob-claw hob-claw-l" at={LEFT_SHOULDER}>
              <Art>{LEFT_CLAW}</Art>
            </Layer>
          </Layer>
          <Layer className="hob-claw hob-claw-r" at={RIGHT_SHOULDER}>
            <Art>{RIGHT_CLAW}</Art>
          </Layer>
          <Art>
            {LEGS}
            {BODY}
          </Art>
          {/* Keyed by mood so each mood's own animation starts at its beginning. */}
          <Layer key={mood} className={['hob-crab-look hob-part', look.look].filter(Boolean).join(' ')} at={EYES_AT}>
            <Layer className={['hob-crab-blink', look.blink && 'hob-cb-on'].filter(Boolean).join(' ')} at={EYES_AT}>
              <Art>{EYES[look.eyes]}</Art>
            </Layer>
          </Layer>
        </Layer>
      </Layer>
    </span>
  )
}
