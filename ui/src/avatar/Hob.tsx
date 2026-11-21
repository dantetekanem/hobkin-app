import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { faceMotion } from './face-motion.ts'
import { MOOD_ART, type Mood } from './moods.tsx'
import { BODY_PATH, FEET, drawingOf, type Pet, type PetChoice } from './pets.ts'
import { PetPart } from './PetPart.tsx'
import { usePetChoice } from './use-pet.ts'
import { FaceReactions, type AppReaction } from './reactions.ts'
import './hob.css'

export interface HobProps {
  mood?: Mood
  /** Which pet to draw. Defaults to the one chosen in Settings. 'none' draws the empty outline the Settings tile previews. */
  pet?: PetChoice
  /** Rendered size in CSS pixels. The art is square. */
  size?: number
  /** Color behind the avatar, used to outline parts drawn over the body. Defaults to the page background. */
  stage?: string
  /** Body color, for the small faces that stand for delegated agents. With No Pet chosen, a face given a tint is a dot in this color. */
  tint?: string
  /** Eye color. hobkin's own eyes are yellow. An agent's are the color behind it, so they read on any hue. */
  eye?: string
  /** Hold the pose: no looping animation. */
  still?: boolean
  /** Element the pointer is tracked in. The eyes follow the pointer while it is inside. */
  followWithin?: RefObject<HTMLElement | null>
  className?: string
  title?: string
}

/**
 * The hobkin character, drawn as the chosen pet, every mood from hobkin's own art. An HTML box holds the drawing, so a
 * small face moves as a whole on the compositor (face-motion.ts).
 */
export function Hob({ mood = 'idle', pet, size = 44, stage, tint, eye, still = false, followWithin, className, title }: HobProps) {
  const art = MOOD_ART[mood]
  const chosen = usePetChoice()
  const followRef = useEyeFollow(followWithin)
  const style = { '--hob-stage': stage, '--hob-mark': tint, '--hob-eye': eye } as CSSProperties
  const drawing = drawingOf({ choice: chosen, pet, tint })
  const shown = pet ?? chosen
  const motion = faceMotion({ size, mood, still })

  if (drawing === 'nothing') return null

  if (drawing === 'dot' || drawing === 'outline') {
    // The same box as the pet, so rows keep their alignment. The dot is centred between the pet's mark box and the art's.
    return (
      <svg
        className={['hob', className].filter(Boolean).join(' ')}
        data-pet={drawing === 'dot' ? 'dot' : 'none'}
        width={size}
        height={size}
        viewBox="-28 -28 256 256"
        role="img"
        aria-label={title ?? (drawing === 'dot' ? 'agent' : 'No Pet')}
        style={style}
      >
        {drawing === 'dot' ? (
          <circle className="hob-fm" cx="100" cy="106" r="56" />
        ) : (
          <circle cx="100" cy="125" r="60" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="5" strokeDasharray="3 14" strokeLinecap="round" />
        )}
      </svg>
    )
  }

  return (
    <span
      className={['hob', className].filter(Boolean).join(' ')}
      data-mood={mood}
      data-pet={shown}
      data-still={still || undefined}
      data-held={motion.parts ? undefined : true}
      data-whole={motion.whole ?? undefined}
      role="img"
      aria-label={title ?? `hobkin, ${mood}`}
      style={{ ...style, '--hob-size': `${size}px` } as CSSProperties}
    >
      <svg viewBox="-28 -28 256 256" aria-hidden="true">
        <g className={`hob-body hob-m-${mood}`}>
          {/* The pet's part goes behind the body, so it can turn about its base without a gap. */}
          <PetPart pet={shown as Pet} />
          {FEET.map((foot) => (
            <ellipse key={foot.cx} className="hob-fm" {...foot} />
          ))}
          <path className="hob-fm" d={BODY_PATH} />
          <g ref={followRef} className="hob-follow">
            {/* Keyed by mood so each mood's own animation starts at its beginning. */}
            <g key={mood} className={['hob-look hob-part', art.look].filter(Boolean).join(' ')}>
              <g className={['hob-blink', art.blink].filter(Boolean).join(' ')} opacity={art.eyesOpacity ?? 1}>
                {art.eyes}
              </g>
            </g>
          </g>
        </g>
        {art.extras ? (
          <g key={mood} className="hob-part">
            {art.extras}
          </g>
        ) : null}
      </svg>
    </span>
  )
}

/**
 * Moves the eyes toward the pointer. The transform is set on the element itself, not through a
 * variable on a parent, so only this one node restyles as the pointer moves.
 */
function useEyeFollow(within?: RefObject<HTMLElement | null>) {
  const ref = useRef<SVGGElement | null>(null)

  useEffect(() => {
    const area = within?.current
    const eyes = ref.current
    if (!area || !eyes) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    let x = 0
    let y = 0
    const apply = () => {
      frame = 0
      eyes.style.transform = `translate(${(x * 7).toFixed(2)}px, ${(y * 5).toFixed(2)}px)`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onMove = (event: PointerEvent) => {
      const box = eyes.ownerSVGElement?.getBoundingClientRect()
      if (!box) return
      // Full deflection is reached a few avatar-widths away, so nearby movement still reads.
      const reach = Math.max(box.width * 4, 160)
      x = clamp((event.clientX - (box.left + box.width / 2)) / reach)
      y = clamp((event.clientY - (box.top + box.height / 2)) / reach)
      schedule()
    }
    const onLeave = () => {
      x = 0
      y = 0
      schedule()
    }

    area.addEventListener('pointermove', onMove)
    area.addEventListener('pointerleave', onLeave)
    return () => {
      area.removeEventListener('pointermove', onMove)
      area.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
      eyes.style.transform = ''
    }
  }, [within])

  return ref
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value))
}

export interface HobReactions {
  /** The mood to draw now: a pointer reaction while one plays, otherwise the app's mood. */
  mood: Mood
  handlers: {
    onClick: () => void
    onPointerEnter: () => void
    onPointerLeave: () => void
  }
}

/**
 * Layers pointer reactions (wake, poke, rub) over the mood the app asks for.
 * `appMood` is what hobkin reports. `lasting` marks sleep, which holds until the user wakes the face.
 */
export function useHobReactions(appMood: Mood, { lasting = false, onWake }: { lasting?: boolean; onWake?: () => void } = {}): HobReactions {
  const app = useRef<AppReaction | null>(null)
  // One object per sleep, so the face can tell the sleep it woke from apart from a new one.
  if (!app.current || app.current.mood !== appMood || Boolean(app.current.lasting) !== lasting) {
    app.current = { mood: appMood, lasting }
  }
  const wake = useRef(onWake)
  wake.current = onWake

  const face = useMemo(() => new FaceReactions({ reaction: () => app.current, onWake: () => wake.current?.() }), [])
  const [, redraw] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refresh = () => {
    clearTimeout(timer.current)
    const shown = face.shown()
    if (shown) timer.current = setTimeout(refresh, shown.endsIn + 1)
    redraw((count) => count + 1)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const shown = face.shown()
  const awake = face.current()
  const mood = shown?.mood ?? awake?.mood ?? 'idle'

  return {
    mood,
    handlers: {
      onClick: () => {
        face.click()
        refresh()
      },
      onPointerEnter: () => {
        if (face.hover(true)) refresh()
      },
      onPointerLeave: () => {
        face.hover(false)
      },
    },
  }
}
