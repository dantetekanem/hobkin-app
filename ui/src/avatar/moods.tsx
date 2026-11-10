import type { ReactNode } from 'react'

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

export interface MoodArt {
  /** Class that moves the eyes as a pair. */
  look?: string
  /** Class that blinks the eyes. */
  blink?: string
  eyesOpacity?: number
  eyes: ReactNode
  /** Parts drawn outside the hood: hands, dots, a keyboard. */
  extras?: ReactNode
}

const roundEyes = (
  <>
    <circle className="hob-fe" cx="84" cy="138" r="8" />
    <circle className="hob-fe" cx="116" cy="138" r="8" />
  </>
)

const happyEyes = (
  <g className="hob-se" strokeWidth="6">
    <path d="M76 141 Q84 129 92 141" />
    <path d="M108 141 Q116 129 124 141" />
  </g>
)

const KEY_COLUMNS = [56, 69, 82, 95, 108, 121, 134]

/** Coordinates and paths are the art from hobkin's `assets/animations`, unchanged. */
export const MOOD_ART: Record<Mood, MoodArt> = {
  idle: { blink: 'hob-b-on', eyes: roundEyes },

  hello: {
    eyes: happyEyes,
    extras: (
      <>
        <ellipse className="hob-wavehand hob-cut" cx="168" cy="116" rx="10" ry="8" strokeWidth="3" />
        <g className="hob-sm" strokeWidth="3">
          <path className="hob-wl" d="M182 96 Q190 102 189 111" />
          <path className="hob-wl" d="M186 86 Q198 96 197 110" />
        </g>
      </>
    ),
  },

  listening: {
    look: 'hob-l-left',
    blink: 'hob-b-on',
    eyes: roundEyes,
    extras: (
      <g className="hob-sm" strokeWidth="3.5">
        <path className="hob-snd hob-s1" d="M30 108 Q24 118 30 128" />
        <path className="hob-snd hob-s2" d="M20 100 Q10 118 20 136" />
        <path className="hob-snd" d="M10 92 Q-4 118 10 144" />
      </g>
    ),
  },

  thinking: {
    look: 'hob-l-up',
    blink: 'hob-b-on',
    eyes: roundEyes,
    extras: (
      <g className="hob-fm">
        <circle className="hob-dot" cx="150" cy="46" r="4" />
        <circle className="hob-dot hob-d2" cx="164" cy="30" r="5" />
        <circle className="hob-dot hob-d3" cx="181" cy="12" r="6" />
      </g>
    ),
  },

  searching: {
    look: 'hob-l-search',
    eyes: (
      <>
        <circle className="hob-fe" cx="84" cy="138" r="8" />
        <circle className="hob-fe" cx="116" cy="138" r="10.5" />
        <circle className="hob-se" cx="116" cy="138" r="17" strokeWidth="4" />
        <path className="hob-se" d="M128 150 L142 164" strokeWidth="6" />
      </>
    ),
  },

  working: {
    look: 'hob-l-type',
    blink: 'hob-b-on',
    eyes: roundEyes,
    extras: (
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
        <g className="hob-fe">
          <rect className="hob-key" x="69" y="170" width="10" height="5" rx="1.5" />
          <rect className="hob-key hob-k2" x="121" y="170" width="10" height="5" rx="1.5" />
          <rect className="hob-key hob-k3" x="69" y="178" width="10" height="5" rx="1.5" />
          <rect className="hob-key hob-k4" x="121" y="178" width="10" height="5" rx="1.5" />
        </g>
        <ellipse className="hob-hand hob-cut" cx="80" cy="160" rx="10" ry="7" strokeWidth="3" />
        <ellipse className="hob-hand hob-h2 hob-cut" cx="120" cy="160" rx="10" ry="7" strokeWidth="3" />
      </>
    ),
  },

  focused: {
    look: 'hob-l-focus',
    eyes: (
      <>
        <rect className="hob-narrow hob-fe" x="76" y="135.5" width="16" height="5" rx="2.5" />
        <rect className="hob-narrow hob-fe" x="108" y="135.5" width="16" height="5" rx="2.5" />
      </>
    ),
  },

  happy: { eyes: happyEyes },

  celebrating: {
    eyes: (
      <>
        <path className="hob-twinkle hob-fe" d="M84 128 Q86 136 94 138 Q86 140 84 148 Q82 140 74 138 Q82 136 84 128 Z" />
        <path className="hob-twinkle hob-fe" d="M116 128 Q118 136 126 138 Q118 140 116 148 Q114 140 106 138 Q114 136 116 128 Z" />
      </>
    ),
    extras: (
      <g className="hob-confetti">
        <circle className="hob-fe" cx="38" cy="46" r="3" />
        <rect className="hob-fm" x="38.2" y="23.3" width="7" height="3" rx="1" transform="rotate(37 41.7 24.8)" />
        <rect className="hob-fe" x="52.7" y="0.7" width="7" height="3" rx="1" transform="rotate(74 56.2 2.2)" />
        <circle className="hob-fm" cx="78.8" cy="-12.3" r="3" />
        <rect className="hob-fe" x="96.5" y="-17.5" width="7" height="3" rx="1" transform="rotate(148 100 -16)" />
        <rect className="hob-fm" x="117.7" y="-13.8" width="7" height="3" rx="1" transform="rotate(5 121.2 -12.3)" />
        <circle className="hob-fe" cx="143.8" cy="2.2" r="3" />
        <rect className="hob-fm" x="154.8" y="23.3" width="7" height="3" rx="1" transform="rotate(79 158.3 24.8)" />
        <rect className="hob-fe" x="158.5" y="44.5" width="7" height="3" rx="1" transform="rotate(116 162 46)" />
      </g>
    ),
  },

  love: {
    eyes: (
      <>
        <path className="hob-pulse hob-fe" d="M84 145 C73 137 76 127 84 134 C92 127 95 137 84 145 Z" />
        <path className="hob-pulse hob-fe" d="M116 145 C105 137 108 127 116 134 C124 127 127 137 116 145 Z" />
      </>
    ),
  },

  wink: {
    eyes: (
      <>
        <circle className="hob-fe" cx="84" cy="138" r="8" />
        <path className="hob-se" d="M108 141 Q116 129 124 141" strokeWidth="6" />
      </>
    ),
  },

  surprised: { look: 'hob-l-big', eyes: roundEyes },

  confused: {
    blink: 'hob-b-on',
    eyes: (
      <>
        <circle className="hob-fe" cx="84" cy="140" r="6" />
        <circle className="hob-fe" cx="116" cy="137" r="9.5" />
      </>
    ),
    extras: (
      <g className="hob-qfloat">
        <path className="hob-sm" d="M152 26 Q152 14 164 14 Q176 14 176 26 Q176 34 166 38 L164 46" strokeWidth="4" />
        <circle className="hob-fm" cx="164" cy="56" r="3" />
      </g>
    ),
  },

  sad: { look: 'hob-l-down', blink: 'hob-b-slow', eyesOpacity: 0.6, eyes: roundEyes },

  grumpy: {
    eyes: (
      <>
        <path className="hob-fe" d="M76 132 L92 139 Q92 147 84 147 Q76 147 76 140 Z" />
        <path className="hob-fe" d="M124 132 L108 139 Q108 147 116 147 Q124 147 124 140 Z" />
      </>
    ),
    extras: (
      <>
        <circle className="hob-puff hob-fm" cx="88" cy="15" r="5" />
        <circle className="hob-puff hob-p2 hob-fm" cx="112" cy="11" r="6" />
      </>
    ),
  },

  error: {
    eyes: (
      <g className="hob-se" strokeWidth="5">
        <path d="M79 133 L89 143 M89 133 L79 143" />
        <path d="M111 133 L121 143 M121 133 L111 143" />
      </g>
    ),
  },

  dizzy: {
    eyes: (
      <>
        <path className="hob-spin hob-se" d="M84 138 a2 2 0 0 1 4 0 a4 4 0 0 1 -8 0 a6 6 0 0 1 12 0 a8 8 0 0 1 -16 0" strokeWidth="3" />
        <path className="hob-spin hob-se" d="M116 138 a2 2 0 0 1 4 0 a4 4 0 0 1 -8 0 a6 6 0 0 1 12 0 a8 8 0 0 1 -16 0" strokeWidth="3" />
      </>
    ),
  },

  sleepy: {
    eyes: (
      <g className="hob-se" strokeWidth="5">
        <path d="M76 137 Q84 145 92 137" />
        <path d="M108 137 Q116 145 124 137" />
      </g>
    ),
    extras: (
      <g className="hob-sm" strokeWidth="3">
        <path className="hob-z" d="M140 36 H148 L140 45 H148" />
        <path className="hob-z hob-z2" d="M152 22 H163 L152 34 H163" />
        <path className="hob-z hob-z3" d="M166 6 H180 L166 21 H180" />
      </g>
    ),
  },
}

export const HOOD_PATH = 'M40 180 Q40 100 100 22 Q160 100 160 180 Q160 188 152 188 L48 188 Q40 188 40 180 Z'
