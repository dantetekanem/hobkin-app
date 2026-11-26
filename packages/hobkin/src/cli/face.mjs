// Hobkin's face, drawn with block characters. Animated images can flicker inside terminal multiplexers; text cells never do.
const WIDTH = 24;
const HEIGHT = 20;
const HOOD_WIDTH = 13;
const HOOD_HEIGHT = 18;
const HOOD = 1;
const EYE = 2;
const DIM_EYE = 3;
const EYE_LEFT = 9;
const EYE_RIGHT = 14;
const EYE_ROW = 14;

export const FACE_COLUMNS = WIDTH / 2;
export const FACE_ROWS = HEIGHT / 4;
export const FRAMES_PER_SECOND = 8;

const step = (seconds, period, values) => values[Math.floor(((seconds % period) / period) * values.length)];
const blinking = (seconds, period = 4) => seconds % period > period - 0.25;

const eyeShapes = {
  round: ['###', '###', '###'],
  small: ['##', '##'],
  wide: ['.##.', '####', '####', '.##.'],
  shut: ['###'],
  happy: ['.#.', '#.#'],
  closed: ['#.#', '.#.'],
  cross: ['#.#', '.#.', '#.#'],
  slit: ['###'],
  heart: ['#.#', '###', '.#.'],
  star: ['.#.', '###', '.#.'],
  twinkle: ['#.#', '.#.', '#.#'],
  lens: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  angryLeft: ['#..', '##.', '###'],
  angryRight: ['..#', '.##', '###'],
  spinA: ['###', '#..', '###'],
  spinB: ['#.#', '#.#', '###'],
  spinC: ['###', '..#', '###'],
  spinD: ['###', '#.#', '#.#'],
};

const stamp = (pixels, shape, left, top, color) => {
  shape.forEach((row, y) => [...row].forEach((mark, x) => {
    const px = left + x;
    const py = top + y;
    if (mark === '#' && px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) pixels[py * WIDTH + px] = color;
  }));
};

// The design's hood: a curve from the hem at (40, 180) through (40, 100) to the tip at (100, 22), mirrored.
const hoodHalfWidth = designY => {
  if (designY >= 180) return 60;
  const t = (160 - Math.sqrt(160 ** 2 - 8 * (180 - designY))) / 4;
  return 60 * (1 - t ** 2);
};

const drawHood = (pixels, { x, lift, stretch, lean }) => {
  const bottom = HEIGHT - 1 - lift;
  const height = HOOD_HEIGHT + stretch;
  const top = bottom - height + 1;
  const scale = (HOOD_WIDTH - stretch) / 120;
  for (let y = Math.max(0, top); y <= bottom; y++) {
    const half = hoodHalfWidth(22 + ((y + 0.5 - top) / height) * 166) * scale - (y === bottom ? 1 : 0);
    const centre = 12 + x + lean * (bottom - y);
    const start = Math.round(centre - half);
    const end = Math.round(centre + half);
    for (let px = Math.max(0, start); px < Math.min(WIDTH, end); px++) pixels[y * WIDTH + px] = HOOD;
  }
};

const drawEyes = (pixels, pose) => {
  const [left, right] = pose.eyes;
  const row = EYE_ROW - pose.lift - Math.round(pose.stretch / 2) + pose.look[1];
  const shift = pose.x + pose.look[0] + Math.round(pose.lean * (HEIGHT - 1 - EYE_ROW));
  const color = pose.dim ? DIM_EYE : EYE;
  const place = (name, centre) => {
    const shape = eyeShapes[name];
    stamp(pixels, shape, centre + shift - Math.floor(shape[0].length / 2), row - Math.floor(shape.length / 2), color);
  };
  place(left, EYE_LEFT);
  place(right, EYE_RIGHT);
};

const glance = seconds => step(seconds, 2, [-1, 0, 1, 0]);

// Small marks around the hood, in the room the design leaves beside and above it.
const decorations = {
  wave(pixels, seconds) {
    const up = step(seconds, 0.6, [0, 1]);
    stamp(pixels, ['.##', '###', '##.'], 19, 9 - up, HOOD);
    if (up) stamp(pixels, ['#', '#'], 23, 5, EYE);
  },
  sound(pixels, seconds) {
    const lit = step(seconds, 1.5, [0, 1, 2, 3]);
    if (lit > 0) stamp(pixels, ['.#', '#.', '#.', '.#'], 4, 11, HOOD);
    if (lit > 1) stamp(pixels, ['.#', '#.', '#.', '#.', '#.', '.#'], 2, 10, HOOD);
    if (lit > 2) stamp(pixels, ['#', '#', '#', '#', '#', '#'], 0, 10, HOOD);
  },
  dots(pixels, seconds) {
    const lit = step(seconds, 1.2, [1, 2, 3, 3]);
    stamp(pixels, ['##', '##'], 16, 8, HOOD);
    if (lit > 1) stamp(pixels, ['##', '##'], 19, 5, HOOD);
    if (lit > 2) stamp(pixels, ['###', '###', '###'], 21, 1, HOOD);
  },
  keys(pixels, seconds) {
    const beat = step(seconds, 1, [0, 1, 2, 3]);
    [7, 10, 13, 16].forEach((x, index) => {
      if (index === beat) stamp(pixels, ['##'], x - 1, 18, EYE);
    });
    stamp(pixels, ['#'.repeat(20)], 2, 19, EYE);
  },
  confetti(pixels, seconds) {
    const fall = step(seconds, 1.2, [0, 1, 2, 3]);
    [[2, 2, EYE], [5, 0, HOOD], [8, 3, EYE], [16, 1, HOOD], [19, 3, EYE], [22, 0, HOOD], [1, 7, HOOD], [22, 6, EYE]].forEach(([x, y, color]) => {
      stamp(pixels, ['##'], x, y + fall, color);
    });
  },
  heart(pixels, seconds) {
    const rise = step(seconds, 2.4, [0, 1, 2, 3]);
    stamp(pixels, ['#.#', '###', '.#.'], 19, 6 - rise, EYE);
  },
  question(pixels, seconds) {
    const bob = step(seconds, 2.4, [0, 1]);
    stamp(pixels, ['.##.', '#..#', '...#', '..#.', '....', '..#.'], 19, 1 + bob, HOOD);
  },
  steam(pixels, seconds) {
    const rise = step(seconds, 1.4, [0, 1, 2]);
    stamp(pixels, ['##', '##'], 7, 3 - rise, HOOD);
    stamp(pixels, ['##', '##'], 15, 2 - rise + 1, HOOD);
  },
  zzz(pixels, seconds) {
    const lit = step(seconds, 3, [1, 2, 3]);
    stamp(pixels, ['###', '.#.', '###'], 17, 8, HOOD);
    if (lit > 1) stamp(pixels, ['###', '..#', '.#.', '###'], 19, 3, HOOD);
    if (lit > 2) stamp(pixels, ['####', '..#.', '.#..', '####'], 20, 0, EYE);
  },
};

const resting = { x: 0, lift: 0, stretch: 0, lean: 0, look: [0, 0], eyes: ['round', 'round'], dim: false, deco: null };
const roundEyes = seconds => (blinking(seconds) ? ['shut', 'shut'] : ['round', 'round']);

const poses = {
  idle: seconds => ({ stretch: step(seconds, 3.2, [0, 0, 1, 1]), eyes: roundEyes(seconds) }),
  hello: seconds => ({ lean: step(seconds, 1, [0.08, 0.14]), eyes: ['happy', 'happy'], deco: 'wave' }),
  listening: seconds => ({ lean: -0.1, look: [-1, 0], eyes: roundEyes(seconds), deco: 'sound' }),
  thinking: seconds => ({
    lean: step(seconds, 3, [-0.07, -0.03, 0, 0.03, 0.07, 0.03, 0, -0.03]),
    look: [1, -1],
    eyes: roundEyes(seconds),
    deco: 'dots',
  }),
  searching: seconds => ({ x: step(seconds, 1.6, [-1, 0, 1, 0]), look: [glance(seconds), 0], eyes: ['small', 'lens'] }),
  working: seconds => ({ lift: step(seconds, 0.35, [0, 1]), look: [step(seconds, 1, [-1, 1]), 1], eyes: roundEyes(seconds), deco: 'keys' }),
  focused: seconds => ({ stretch: step(seconds, 5, [0, 0, 1, 1]), look: [0, 1], eyes: ['slit', 'slit'] }),
  happy: seconds => ({
    lift: step(seconds, 0.9, [0, 1, 2, 1, 0, 0]),
    stretch: step(seconds, 0.9, [-1, 1, 1, 0, -1, 0]),
    eyes: ['happy', 'happy'],
  }),
  celebrating: seconds => ({
    lift: step(seconds, 0.8, [0, 2, 2, 0]),
    stretch: step(seconds, 0.8, [-1, 1, 0, -1]),
    eyes: step(seconds, 0.4, [['star', 'star'], ['twinkle', 'twinkle']]),
    deco: 'confetti',
  }),
  love: seconds => ({ lean: step(seconds, 2.4, [-0.06, 0, 0.06, 0]), eyes: ['heart', 'heart'], deco: 'heart' }),
  wink: seconds => ({ lean: step(seconds, 2, [0, 0.1, 0.1, 0]), eyes: ['round', 'happy'] }),
  surprised: seconds => ({ lift: step(seconds, 2.4, [1, 0, 0, 0]), stretch: 1, eyes: ['wide', 'wide'] }),
  confused: seconds => ({ lean: step(seconds, 2.4, [0.08, 0.13]), eyes: blinking(seconds) ? ['shut', 'shut'] : ['small', 'round'], deco: 'question' }),
  sad: seconds => ({ stretch: step(seconds, 4, [-1, -1, -2, -2]), look: [0, 1], eyes: blinking(seconds, 6) ? ['shut', 'shut'] : ['round', 'round'], dim: true }),
  grumpy: seconds => ({ x: step(seconds, 0.18, [-1, 1]), eyes: ['angryLeft', 'angryRight'], deco: 'steam' }),
  error: seconds => ({ x: step(seconds, 1.6, [0, -1, 1, -1, 1, 0, 0, 0]), eyes: ['cross', 'cross'] }),
  dizzy: seconds => {
    const spin = step(seconds, 1.2, ['spinA', 'spinB', 'spinC', 'spinD']);
    return { lean: step(seconds, 1.2, [-0.12, -0.06, 0, 0.06, 0.12, 0.06, 0, -0.06]), eyes: [spin, spin] };
  },
  sleepy: seconds => ({ stretch: step(seconds, 4.5, [0, 0, 1, 1]), look: [0, 1], eyes: ['closed', 'closed'], deco: 'zzz' }),
};

export const moods = Object.keys(poses);

/** One frame as pixels: 0 is empty, then hood, eye and dimmed eye. */
export function faceFrame(mood, seconds) {
  const pose = { ...resting, ...(poses[mood] ?? poses.idle)(seconds) };
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  drawHood(pixels, pose);
  drawEyes(pixels, pose);
  if (pose.deco) decorations[pose.deco](pixels, seconds);
  return pixels;
}

/** Terminals that draw these characters themselves; a font may not have them. */
export const supportsOctants = (env = process.env) => Boolean(env.GHOSTTY_RESOURCES_DIR || env.KITTY_WINDOW_ID)
  || /ghostty|kitty/i.test(`${env.TERM_PROGRAM} ${env.TERM}`);

// Bit patterns with a character of their own elsewhere in Unicode. The other 230 run in order from U+1CD00.
const namedOctants = new Map([
  [0, ' '], [1, '\u{1CEA8}'], [2, '\u{1CEAB}'], [3, '\u{1FB82}'], [5, '▘'], [10, '▝'], [15, '▀'], [20, '\u{1FBE6}'], [40, '\u{1FBE7}'],
  [63, '\u{1FB85}'], [64, '\u{1CEA3}'], [80, '▖'], [85, '▌'], [90, '▞'], [95, '▛'], [128, '\u{1CEA0}'], [160, '▗'], [165, '▚'], [170, '▐'],
  [175, '▜'], [192, '▂'], [240, '▄'], [245, '▙'], [250, '▟'], [252, '▆'], [255, '█'],
]);
const octants = [];
for (let bits = 0, next = 0x1CD00; bits < 256; bits++) {
  octants[bits] = namedOctants.get(bits) ?? String.fromCodePoint(next++);
}
export const octantFor = bits => octants[bits];

const sgr = (code, rgb) => (rgb ? `\x1b[${code};2;${rgb.join(';')}m` : `\x1b[${code + 1}m`);

const paintCells = (cells, colors) => {
  const rows = [];
  for (let start = 0; start < cells.length; start += FACE_COLUMNS) {
    let text = '';
    let foreground = 0;
    let background = 0;
    for (const { char, fg, bg } of cells.slice(start, start + FACE_COLUMNS)) {
      if (char !== ' ' && fg !== foreground) {
        text += sgr(38, colors[fg]);
        foreground = fg;
      }
      if (bg !== background) {
        text += sgr(48, colors[bg]);
        background = bg;
      }
      text += char;
    }
    rows.push(`${text}\x1b[39;49m`);
  }
  return rows;
};

const octantCell = (pixels, column, row) => {
  const samples = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 2; x++) samples.push(pixels[(row * 4 + y) * WIDTH + column * 2 + x]);
  }
  const lit = samples.filter(Boolean);
  if (!lit.length) return { char: ' ', fg: 0, bg: 0 };
  const eye = lit.find(value => value !== HOOD);
  const fg = eye ?? HOOD;
  const bits = samples.reduce((sum, value, index) => (value === fg ? sum | (1 << index) : sum), 0);
  return { char: octants[bits], fg, bg: eye && lit.includes(HOOD) ? HOOD : 0 };
};

const halfCell = (pixels, column, row) => {
  const half = offset => {
    const samples = [];
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) samples.push(pixels[(row * 4 + offset + y) * WIDTH + column * 2 + x]);
    }
    const lit = samples.filter(Boolean);
    return lit.find(value => value !== HOOD) ?? (lit.length > 1 ? HOOD : 0);
  };
  const top = half(0);
  const bottom = half(2);
  if (!top && !bottom) return { char: ' ', fg: 0, bg: 0 };
  if (!top) return { char: '▄', fg: bottom, bg: 0 };
  return { char: top === bottom ? '█' : '▀', fg: top, bg: top === bottom ? 0 : bottom };
};

/** The frame for this moment as five rows of twelve cells. `octants` is false for terminals without those characters. */
export function faceLines(mood, milliseconds, { hood, eye, octants: fine = true }) {
  const seconds = Math.floor((milliseconds / 1000) * FRAMES_PER_SECOND) / FRAMES_PER_SECOND;
  const pixels = faceFrame(mood, seconds);
  const cell = fine ? octantCell : halfCell;
  const cells = [];
  for (let row = 0; row < FACE_ROWS; row++) {
    for (let column = 0; column < FACE_COLUMNS; column++) cells.push(cell(pixels, column, row));
  }
  const dimmed = eye.map((channel, index) => Math.round((channel + hood[index]) / 2));
  return paintCells(cells, [null, hood, eye, dimmed]);
}
