import type { ReactNode } from 'react'
import type { ArtPoint } from './pets.ts'

/** The 18 moods of hobkin's face. Same names as `src/cli/face.mjs` in hobkin. */
export const MOODS = [
  'idle',
  'hello',
  'listening',
  'thinking',
  'searching',
  'working',
  'focused',
  'happy',
  'celebrating',
  'love',
  'wink',
  'surprised',
  'confused',
  'sad',
  'grumpy',
  'error',
  'dizzy',
  'sleepy',
] as const

export type Mood = (typeof MOODS)[number]

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value)
}

/**
 * One of a face's boxes (Layer.tsx): art in the face's square, and the classes in hob.css that move it: a loop that
 * plays for about two seconds when the mood changes. `at` is the point it turns or grows about, in the art's units: the
 * middle or the corner of what it draws, where the SVG parts turned with their fill box before they were boxes.
 */
export interface Piece {
  art: ReactNode
  loop?: string
  at?: ArtPoint
}

export interface MoodLayers {
  /** Class that moves the eyes as a pair. */
  look?: string
  /** Class that marks eyes that blink now and then (blink.ts). `hob-b-slow` blinks slower. */
  blink?: string
  eyesOpacity?: number
  /** The middle of the eyes, which the look and the blink scale about. (100, 138) unless given. */
  eyesAt?: ArtPoint
  eyes: readonly Piece[]
  /** Parts drawn outside the body: hands, dots, a keyboard. */
  extras?: readonly Piece[]
}

const still = (art: ReactNode): Piece => ({ art })

const roundEyes = still(
  <>
    <circle className="hob-fe" cx="84" cy="138" r="8" />
    <circle className="hob-fe" cx="116" cy="138" r="8" />
  </>,
)

const happyEyes = still(
  <g className="hob-se" strokeWidth="6">
    <path d="M76 141 Q84 129 92 141" />
    <path d="M108 141 Q116 129 124 141" />
  </g>,
)

const KEY_COLUMNS = [56, 69, 82, 95, 108, 121, 134]

/**
 * Coordinates and paths are the art from the terminal app's `assets/animations` (removed in 4c02ae7b). The thinking dots, the question mark and the Zs
 * sit further right and higher, clear of the pets' ears, antenna and sprout (avatar/pets.ts). Each part that loops on
 * its own is a piece of its own, in the order it is drawn.
 */
export const MOOD_LAYERS: Record<Mood, MoodLayers> = {
  idle: { blink: 'hob-b-on', eyes: [roundEyes] },

  hello: {
    eyes: [happyEyes],
    extras: [
      { loop: 'hob-wavehand', at: [162, 124], art: <ellipse className="hob-cut" cx="168" cy="116" rx="10" ry="8" strokeWidth="3" /> },
      {
        loop: 'hob-wl',
        art: (
          <g className="hob-sm" strokeWidth="3">
            <path d="M182 96 Q190 102 189 111" />
            <path d="M186 86 Q198 96 197 110" />
          </g>
        ),
      },
    ],
  },

  listening: {
    look: 'hob-l-left',
    blink: 'hob-b-on',
    eyes: [roundEyes],
    extras: [
      { loop: 'hob-snd hob-s1', art: <path className="hob-sm" strokeWidth="3.5" d="M30 108 Q24 118 30 128" /> },
      { loop: 'hob-snd hob-s2', art: <path className="hob-sm" strokeWidth="3.5" d="M20 100 Q10 118 20 136" /> },
      { loop: 'hob-snd', art: <path className="hob-sm" strokeWidth="3.5" d="M10 92 Q-4 118 10 144" /> },
    ],
  },

  thinking: {
    look: 'hob-l-up',
    blink: 'hob-b-on',
    eyes: [roundEyes],
    extras: [
      { loop: 'hob-dot', art: <circle className="hob-fm" cx="166" cy="52" r="4" /> },
      { loop: 'hob-dot hob-d2', art: <circle className="hob-fm" cx="180" cy="36" r="5" /> },
      { loop: 'hob-dot hob-d3', art: <circle className="hob-fm" cx="196" cy="18" r="6" /> },
    ],
  },

  searching: {
    look: 'hob-l-search',
    eyes: [
      still(
        <>
          <circle className="hob-fe" cx="84" cy="138" r="8" />
          <circle className="hob-fe" cx="116" cy="138" r="10.5" />
          <circle className="hob-se" cx="116" cy="138" r="17" strokeWidth="4" />
          <path className="hob-se" d="M128 150 L142 164" strokeWidth="6" />
        </>,
      ),
    ],
  },

  working: {
    look: 'hob-l-type',
    blink: 'hob-b-on',
    eyes: [roundEyes],
    extras: [
      still(
        <>
          <rect className="hob-cut" x="44" y="164" width="112" height="26" rx="6" strokeWidth="4" />
          <g className="hob-fs">
            {KEY_COLUMNS.map((x) => (
              <rect key={`a${x}`} x={x} y="170" width="10" height="5" rx="1.5" />
            ))}
            <rect x="56" y="178" width="10" height="5" rx="1.5" />
            <rect x="69" y="178" width="10" height="5" rx="1.5" />
            <rect x="82" y="178" width="36" height="5" rx="1.5" />
            <rect x="121" y="178" width="10" height="5" rx="1.5" />
            <rect x="134" y="178" width="10" height="5" rx="1.5" />
          </g>
        </>,
      ),
      { loop: 'hob-key', art: <rect className="hob-fe" x="69" y="170" width="10" height="5" rx="1.5" /> },
      { loop: 'hob-key hob-k2', art: <rect className="hob-fe" x="121" y="170" width="10" height="5" rx="1.5" /> },
      { loop: 'hob-key hob-k3', art: <rect className="hob-fe" x="69" y="178" width="10" height="5" rx="1.5" /> },
      { loop: 'hob-key hob-k4', art: <rect className="hob-fe" x="121" y="178" width="10" height="5" rx="1.5" /> },
      { loop: 'hob-hand', art: <ellipse className="hob-cut" cx="80" cy="160" rx="10" ry="7" strokeWidth="3" /> },
      { loop: 'hob-hand hob-h2', art: <ellipse className="hob-cut" cx="120" cy="160" rx="10" ry="7" strokeWidth="3" /> },
    ],
  },

  focused: {
    look: 'hob-l-focus',
    eyes: [
      {
        loop: 'hob-narrow',
        at: [100, 138],
        art: (
          <>
            <rect className="hob-fe" x="76" y="135.5" width="16" height="5" rx="2.5" />
            <rect className="hob-fe" x="108" y="135.5" width="16" height="5" rx="2.5" />
          </>
        ),
      },
    ],
  },

  happy: { eyes: [happyEyes] },

  celebrating: {
    eyes: [
      { loop: 'hob-twinkle', at: [84, 138], art: <path className="hob-fe" d="M84 128 Q86 136 94 138 Q86 140 84 148 Q82 140 74 138 Q82 136 84 128 Z" /> },
      { loop: 'hob-twinkle', at: [116, 138], art: <path className="hob-fe" d="M116 128 Q118 136 126 138 Q118 140 116 148 Q114 140 106 138 Q114 136 116 128 Z" /> },
    ],
    extras: [
      {
        loop: 'hob-confetti',
        at: [100, 46],
        art: (
          <>
            <circle className="hob-fe" cx="38" cy="46" r="3" />
            <rect className="hob-fm" x="38.2" y="23.3" width="7" height="3" rx="1" transform="rotate(37 41.7 24.8)" />
            <rect className="hob-fe" x="52.7" y="0.7" width="7" height="3" rx="1" transform="rotate(74 56.2 2.2)" />
            <circle className="hob-fm" cx="78.8" cy="-12.3" r="3" />
            <rect className="hob-fe" x="96.5" y="-17.5" width="7" height="3" rx="1" transform="rotate(148 100 -16)" />
            <rect className="hob-fm" x="117.7" y="-13.8" width="7" height="3" rx="1" transform="rotate(5 121.2 -12.3)" />
            <circle className="hob-fe" cx="143.8" cy="2.2" r="3" />
            <rect className="hob-fm" x="154.8" y="23.3" width="7" height="3" rx="1" transform="rotate(79 158.3 24.8)" />
            <rect className="hob-fe" x="158.5" y="44.5" width="7" height="3" rx="1" transform="rotate(116 162 46)" />
          </>
        ),
      },
    ],
  },

  love: {
    eyes: [
      { loop: 'hob-pulse', at: [84, 138.32], art: <path className="hob-fe" d="M84 145 C73 137 76 127 84 134 C92 127 95 137 84 145 Z" /> },
      { loop: 'hob-pulse', at: [116, 138.32], art: <path className="hob-fe" d="M116 145 C105 137 108 127 116 134 C124 127 127 137 116 145 Z" /> },
    ],
  },

  wink: {
    eyes: [
      still(
        <>
          <circle className="hob-fe" cx="84" cy="138" r="8" />
          <path className="hob-se" d="M108 141 Q116 129 124 141" strokeWidth="6" />
        </>,
      ),
    ],
  },

  surprised: { look: 'hob-l-big', eyes: [roundEyes] },

  confused: {
    blink: 'hob-b-on',
    eyesAt: [101.75, 137],
    eyes: [
      still(
        <>
          <circle className="hob-fe" cx="84" cy="140" r="6" />
          <circle className="hob-fe" cx="116" cy="137" r="9.5" />
        </>,
      ),
    ],
    extras: [
      {
        loop: 'hob-qfloat',
        at: [164, 14],
        art: (
          <>
            <path className="hob-sm" d="M164 26 Q164 14 176 14 Q188 14 188 26 Q188 34 178 38 L176 46" strokeWidth="4" />
            <circle className="hob-fm" cx="176" cy="56" r="3" />
          </>
        ),
      },
    ],
  },

  sad: { look: 'hob-l-down', blink: 'hob-b-slow', eyesOpacity: 0.6, eyes: [roundEyes] },

  grumpy: {
    eyes: [
      still(
        <>
          <path className="hob-fe" d="M76 132 L92 139 Q92 147 84 147 Q76 147 76 140 Z" />
          <path className="hob-fe" d="M124 132 L108 139 Q108 147 116 147 Q124 147 124 140 Z" />
        </>,
      ),
    ],
    extras: [
      { loop: 'hob-puff', at: [83, 10], art: <circle className="hob-fm" cx="88" cy="15" r="5" /> },
      { loop: 'hob-puff hob-p2', at: [106, 5], art: <circle className="hob-fm" cx="112" cy="11" r="6" /> },
    ],
  },

  error: {
    eyes: [
      still(
        <g className="hob-se" strokeWidth="5">
          <path d="M79 133 L89 143 M89 133 L79 143" />
          <path d="M111 133 L121 143 M121 133 L111 143" />
        </g>,
      ),
    ],
  },

  dizzy: {
    eyes: [
      { loop: 'hob-spin', at: [84, 139], art: <path className="hob-se" d="M84 138 a2 2 0 0 1 4 0 a4 4 0 0 1 -8 0 a6 6 0 0 1 12 0 a8 8 0 0 1 -16 0" strokeWidth="3" /> },
      { loop: 'hob-spin', at: [116, 139], art: <path className="hob-se" d="M116 138 a2 2 0 0 1 4 0 a4 4 0 0 1 -8 0 a6 6 0 0 1 12 0 a8 8 0 0 1 -16 0" strokeWidth="3" /> },
    ],
  },

  sleepy: {
    eyes: [
      still(
        <g className="hob-se" strokeWidth="5">
          <path d="M76 137 Q84 145 92 137" />
          <path d="M108 137 Q116 145 124 137" />
        </g>,
      ),
    ],
    extras: [
      { loop: 'hob-z', art: <path className="hob-sm" strokeWidth="3" d="M160 22 H168 L160 31 H168" /> },
      { loop: 'hob-z hob-z2', art: <path className="hob-sm" strokeWidth="3" d="M172 8 H183 L172 20 H183" /> },
      { loop: 'hob-z hob-z3', art: <path className="hob-sm" strokeWidth="3" d="M186 -8 H200 L186 7 H200" /> },
    ],
  },
}
