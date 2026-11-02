// New chat rows rise from the bottom edge. The conversation's lines stay the source of truth: this only decides
// which rows a frame shows and how faint they are.
export const FRAME_MS = 33;
const TAU_MS = 80;
// Text cannot sit between rows, so the fade carries the movement a row step cannot. A row shows once less than
// half a row is left, and it needs the rest of the decay to come up to full, or it would appear all at once.
const SHOWS_BELOW = 0.5;
const SETTLED = 0.2;
const EMERGING = SHOWS_BELOW - 0.01;
const FADE_ROWS = 3;
const TOP_TAU_MS = 50;
const TOP_GONE = 0.02;
// The bottom fade lasts a moment. This one can hold for a whole reply, over text still being read.
const TOP_STRENGTH = 0.7;
// A slow stream settles between rows, and letting the top edge go each time would pulse it at the rate rows arrive,
// so while a turn runs it waits this long for the next row.
const STREAM_HOLD_MS = 800;

// Neither the palette nor a Pi theme knows the terminal's background, so these stand in by the theme's type. A small mismatch cannot be seen in a fade.
export const fadeColors = {
  dark: { text: [224, 224, 230], background: [30, 31, 41] },
  light: { text: [45, 47, 56], background: [250, 250, 247] },
};

const clamp = value => Math.max(0, Math.min(1, value));
const mixed = (from, to, amount) => from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
const ink = rgb => `\x1b[38;2;${rgb.join(';')}m`;
const FOREGROUND = /\x1b\[(?:38;2;(\d+);(\d+);(\d+)|39|0?)m/g;

/** What is left of `pending` after `elapsed` ms. Exponential, so it eases out and an arrival can add to it at any moment. */
export const decayed = (pending, elapsed) => {
  const left = pending * Math.exp(-Math.max(0, elapsed) / TAU_MS);
  return left < SETTLED ? 0 : left;
};

const ramp = distance => clamp(1 - distance / (FADE_ROWS + 1));

/** How far a row `distance` rows above the edge sinks toward the background. */
export const fadeAt = (distance, pending) => ramp(distance) * clamp((pending - SETTLED) / (SHOWS_BELOW - SETTLED));

/** Blends a row toward the background. Text with no color of its own has to take one first, because terminals have no alpha. */
export const fadeRow = (row, amount, { text, background }) => {
  if (!amount || !row.trim()) return row;
  const plain = ink(mixed(text, background, amount));
  const faded = row.replace(FOREGROUND, (sequence, red, green, blue) => {
    if (red) return ink(mixed([+red, +green, +blue], background, amount));
    return sequence === '\x1b[39m' ? plain : `${sequence}${plain}`;
  });
  return `${plain}${faded}\x1b[39m`;
};

const rowsIn = marks => marks.at(-1)?.end ?? 0;
const rowsAfter = (marks, index) => rowsIn(marks) - (marks[index]?.end ?? 0);
const grownSince = (before, after, from, to) => ({
  rows: rowsAfter(after, to) - rowsAfter(before, from),
  messages: (after.length - to) - (before.length - from),
});

/**
 * What arrived at the tail between two frames, or null when the conversation was replaced. It counts from the newest
 * message still there, because old messages leave the top as new ones arrive and a streaming reply has a new key at every delta.
 */
export const tailGrowth = (before, after) => {
  for (let from = before.length - 1; from >= 0; from--) {
    const to = after.findLastIndex(mark => mark.key === before[from].key);
    if (to >= 0) return grownSince(before, after, from, to);
  }
  return before.length < 2 ? grownSince(before, after, -1, -1) : null;
};

/** One number of rows still to come up, and the frames it takes to get them there. */
export class Slide {
  pending = 0;
  fresh = 0;
  top = 0;
  held = false;
  heldUntil = 0;
  faded = new Map();
  marks = null;
  layout = '';
  at = 0;

  // A held top edge changes nothing, and a hold only lasts while a turn runs, whose own ticker ends it.
  get moving() { return this.pending > 0 || (this.top > 0 && !this.held); }
  get faint() { return this.pending > 0 || this.top > 0; }
  get behind() { return Math.round(this.pending); }

  settle() {
    this.pending = 0;
    this.fresh = 0;
    this.faded.clear();
  }

  /** Forgets the chat, so the next frame draws it at rest. */
  reset() {
    this.settle();
    this.top = 0;
    this.marks = null;
  }

  /** Takes in the chat as of this frame, and returns how far a view scrolled up must shift to hold still. */
  advance({ marks, available, layout, clock, following, fading, busy }) {
    const elapsed = clock - this.at;
    this.pending = decayed(this.pending, elapsed);
    this.at = clock;
    const before = layout === this.layout ? this.marks : null;
    this.layout = layout;
    this.marks = marks;
    const arrived = before && marks.length ? tailGrowth(before, marks) : null;
    const onTheTail = arrived && following;
    if (!onTheTail) this.top = 0;
    else if (fading) this.easeTop(elapsed, rowsIn(marks) - available, busy && clock < this.heldUntil);
    if (!onTheTail || !this.pending) this.settle();
    if (!arrived || arrived.rows <= 0) return 0;
    if (!following) return arrived.rows;
    this.rise(arrived, Math.max(0, available - rowsIn(before)), available);
    this.heldUntil = clock + STREAM_HOLD_MS;
    return 0;
  }

  // Eases in once the window lifts, then ignores `pending`, which rises and falls with every row of a stream.
  easeTop(elapsed, room, held) {
    const left = Math.exp(-Math.max(0, elapsed) / TOP_TAU_MS);
    this.held = held;
    if (this.behind > 0 && this.behind <= room) this.top = 1 - (1 - this.top) * left;
    else if (!this.behind && !held) this.top = this.top * left < TOP_GONE ? 0 : this.top * left;
  }

  // A new message crosses the blank rows below a short chat. Rows added to one already moving join it, and a
  // reply growing in such a chat stays on its row and only fades in, since a row flying up per line would never rest.
  rise({ rows, messages }, blank, available) {
    const climb = !this.pending && messages > 0 ? Math.max(rows, blank) : Math.max(0, rows - blank);
    this.pending = Math.min(available, Math.max(this.pending + climb, EMERGING));
    this.fresh += rows;
  }

  /** Where the window over the chat sits this frame. It waits above its rest, and a chat too short to scroll holds the new rows lower instead. */
  place(content, offset) {
    const lift = Math.min(this.behind, offset);
    const gap = this.behind - lift;
    // The chat ends in a blank row that stays last, so rows arrive just above it.
    const anchor = Math.max(0, content.length - this.fresh - 1);
    return { rows: gap ? content.toSpliced(anchor, 0, ...Array(gap).fill('')) : content, offset: offset - lift, anchor, gap };
  }

  /** Sinks new rows at the bottom edge, and rows about to leave at the top, which starts below `first` pinned rows. */
  fade(body, { rows, offset, anchor, first = 0 }, colors) {
    const edge = Math.min(body.length, rows.length - offset);
    const slip = this.pending - this.behind;
    return body.map((value, row) => {
      if (row < first) return value;
      const arriving = offset + row < anchor ? 0 : this.arriving(value, edge - row - slip);
      return fadeRow(value, Math.max(arriving, ramp(row - first + 1 + slip) * this.top * TOP_STRENGTH), colors);
    });
  }

  // Text already at rest stays as it is, or every line of a stream would pulse it, and a row never goes back below what it has shown.
  arriving(value, distance) {
    const amount = Math.min(fadeAt(distance, this.pending), this.faded.get(value) ?? 1);
    this.faded.set(value, amount);
    return amount;
  }
}
