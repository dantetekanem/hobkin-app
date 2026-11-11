import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moods } from './face.mjs';

// The terminal stretches the picture onto these cells, so the box has to be square on screen. A cell is about 2.2 times as tall as it is wide.
export const IMAGE_FACE_COLUMNS = 10;
export const IMAGE_FACE_ROWS = 5;
export const WORDMARK_COLUMNS = 10;

const ASSETS = fileURLToPath(new URL('../../assets/faces', import.meta.url));
const CHUNK_LENGTH = 4096;
const FIRST_FRAME_MS = 125;
const PLACEHOLDER = '\u{10EEEE}';
// Kitty's table of combining marks: the mark at index n means row n. Cells after the first take their place from the one before.
const ROWS = ['̅', '̍', '̎', '̐', '̒'];
const FIRST_ID = 0x100000;
const LAST_ID = 0xE00000;

export const supportsFaceImages = (env = process.env) => env.HOBKIN_FACE !== 'blocks' && !env.TMUX
  && (Boolean(env.GHOSTTY_RESOURCES_DIR || env.KITTY_WINDOW_ID) || /ghostty|kitty/i.test(`${env.TERM_PROGRAM} ${env.TERM}`));

const transmission = (id, data, columns, rows) => {
  const pieces = data.match(new RegExp(`.{1,${CHUNK_LENGTH}}`, 'g'));
  return pieces.map((piece, index) => {
    const control = index ? '' : `a=T,f=100,q=2,U=1,i=${id},c=${columns},r=${rows},`;
    return `\x1b_G${control}m=${index < pieces.length - 1 ? 1 : 0};${piece}\x1b\\`;
  }).join('');
};

const pointingAt = id => `\x1b[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m`;

const placeholderRow = (id, row, columns) => `${pointingAt(id)}${PLACEHOLDER}${ROWS[row]}${PLACEHOLDER.repeat(columns - 1)}\x1b[39m`;

const deletion = ids => ids.map(id => `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`).join('');

// Every picture the terminal keeps takes memory, so only the moods shown last stay in it: enough for the face to go
// back and forth between thinking, searching and working, or into a reaction and out of it, without sending and freeing pictures each time.
const KEPT_MOODS = 4;

/**
 * Shows the design's frames through text cells that stand for an image. Every frame is its own image, sent once,
 * so moving to the next one only changes a text colour; replacing an image in place is what flickers.
 */
export class FaceImages {
  constructor({ write, theme = 'dark', directory = ASSETS }) {
    Object.assign(this, { write, theme, directory });
    this.nextId = randomInt(FIRST_ID, LAST_ID);
    this.shown = null;
    // The moods in the terminal, the one shown longest ago first.
    this.kept = new Map();
    this.wordmarkId = null;
    this.retiring = [];
  }

  read(name) {
    return JSON.parse(readFileSync(join(this.directory, this.theme, `${name}.json`), 'utf8'));
  }

  send(frames, columns, rows) {
    const ids = frames.map(() => this.nextId++);
    this.write(`\x1b[?2026h${frames.map((frame, index) => transmission(ids[index], frame, columns, rows)).join('')}\x1b[?2026l`);
    return ids;
  }

  load(name) {
    const { seconds, frames } = this.read(name);
    return { name, seconds, ids: this.send(frames, IMAGE_FACE_COLUMNS, IMAGE_FACE_ROWS) };
  }

  // A mood shown lately is still in the terminal, so going back to it sends nothing. One that falls out goes a frame after the new one
  // arrives, so the cells never point at nothing.
  show(mood) {
    const name = moods.includes(mood) ? mood : 'idle';
    if (this.shown?.name === name) {
      if (this.retiring.length) this.write(deletion(this.retiring));
      this.retiring = [];
      return this.shown;
    }

    const next = this.kept.get(name) ?? this.load(name);
    this.kept.delete(name);
    this.kept.set(name, next);
    while (this.kept.size > KEPT_MOODS) {
      const [oldest] = this.kept.keys();
      this.retiring.push(...this.kept.get(oldest).ids);
      this.kept.delete(oldest);
    }
    this.shown = next;
    return next;
  }

  lines(mood, milliseconds) {
    const { seconds, ids } = this.show(mood);
    const frame = Math.floor((milliseconds / (seconds * 1000)) * ids.length) % ids.length;
    return Array.from({ length: IMAGE_FACE_ROWS }, (_, row) => placeholderRow(ids[frame], row, IMAGE_FACE_COLUMNS));
  }

  frameMs(mood) {
    const known = this.kept.get(mood);
    if (!known) return FIRST_FRAME_MS;
    return (known.seconds * 1000) / known.ids.length;
  }

  wordmark() {
    if (!this.wordmarkId) [this.wordmarkId] = this.send(this.read('wordmark').frames, WORDMARK_COLUMNS, 1);
    return placeholderRow(this.wordmarkId, 0, WORDMARK_COLUMNS);
  }

  /** A pasted image, through the same kind of cells as the face. It never changes, so it has nothing to flicker. */
  showPicture(image) {
    if (!image.picture) return image;
    const { picture, columns, preview: { length: rows } } = image;
    const [pictureId] = this.send([picture], columns, rows);
    return { ...image, pictureId, preview: Array.from({ length: rows }, (_, row) => placeholderRow(pictureId, row, columns)) };
  }

  forgetPictures(images) {
    const ids = images.flatMap(({ pictureId }) => pictureId ?? []);
    if (ids.length) this.write(deletion(ids));
  }

  useTheme(theme) {
    if (theme === this.theme) return;
    this.clear();
    this.theme = theme;
  }

  clear() {
    const kept = [...this.kept.values()].flatMap(({ ids }) => ids);
    const ids = [...this.retiring, ...kept, ...(this.wordmarkId ? [this.wordmarkId] : [])];
    this.shown = null;
    this.kept = new Map();
    this.wordmarkId = null;
    this.retiring = [];
    if (ids.length) this.write(deletion(ids));
  }
}
