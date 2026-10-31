import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_FACE_COLUMNS = 14;
export const IMAGE_FACE_ROWS = 6;
export const WORDMARK_COLUMNS = 10;

const ASSETS = fileURLToPath(new URL('../../assets/faces', import.meta.url));
const CHUNK_LENGTH = 4096;
const PLACEHOLDER = '\u{10EEEE}';
// Kitty's table of combining marks: the mark at index n means row or column n.
const POSITIONS = ['̅', '̍', '̎', '̐', '̒', '̽', '̾', '̿', '͆', '͊', '͋', '͌', '͐', '͑', '͒'];
const FIRST_ID = 0x100000;
const LAST_ID = 0xE00000;

export const supportsFaceImages = (env = process.env) => env.HOBKIN_FACE !== 'blocks' && !env.TMUX
  && (Boolean(env.GHOSTTY_RESOURCES_DIR || env.KITTY_WINDOW_ID) || /ghostty|kitty/i.test(`${env.TERM_PROGRAM} ${env.TERM}`));

const transmission = (id, data, columns, rows) => {
  const pieces = data.match(new RegExp(`.{1,${CHUNK_LENGTH}}`, 'g'));
  return pieces.map((piece, index) => {
    const control = index ? '' : `a=T,U=1,q=2,f=100,i=${id},c=${columns},r=${rows},`;
    return `\x1b_G${control}m=${index < pieces.length - 1 ? 1 : 0};${piece}\x1b\\`;
  }).join('');
};

const pointingAt = id => `\x1b[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m`;

const placeholderRow = (id, row, columns) => {
  const cells = Array.from({ length: columns }, (_, column) => `${PLACEHOLDER}${POSITIONS[row]}${POSITIONS[column]}`);
  return `${pointingAt(id)}${cells.join('')}\x1b[39m`;
};

/**
 * Shows the design's frames through text cells that stand for an image. Every frame is its own image, sent once,
 * so moving to the next one only changes a text colour. Replacing an image in place is what flickers inside Herdr.
 */
export class FaceImages {
  constructor({ write, theme = 'dark', directory = ASSETS }) {
    Object.assign(this, { write, theme, directory });
    this.nextId = randomInt(FIRST_ID, LAST_ID);
    this.loaded = new Map();
  }

  load(name, columns, rows) {
    const key = `${this.theme}/${name}`;
    if (!this.loaded.has(key)) {
      const { seconds, frames } = JSON.parse(readFileSync(join(this.directory, this.theme, `${name}.json`), 'utf8'));
      const ids = frames.map(() => this.nextId++);
      this.write(`\x1b[?2026h${frames.map((frame, index) => transmission(ids[index], frame, columns, rows)).join('')}\x1b[?2026l`);
      this.loaded.set(key, { seconds, ids });
    }
    return this.loaded.get(key);
  }

  face(mood) {
    try {
      return this.load(mood, IMAGE_FACE_COLUMNS, IMAGE_FACE_ROWS);
    } catch (error) {
      if (error.code === 'ENOENT' && mood !== 'idle') return this.face('idle');
      throw error;
    }
  }

  lines(mood, milliseconds) {
    const { seconds, ids } = this.face(mood);
    const frame = Math.floor((milliseconds / (seconds * 1000)) * ids.length) % ids.length;
    return Array.from({ length: IMAGE_FACE_ROWS }, (_, row) => placeholderRow(ids[frame], row, IMAGE_FACE_COLUMNS));
  }

  frameMs(mood) {
    const { seconds, ids } = this.face(mood);
    return (seconds * 1000) / ids.length;
  }

  wordmark() {
    const { ids } = this.load('wordmark', WORDMARK_COLUMNS, 1);
    return placeholderRow(ids[0], 0, WORDMARK_COLUMNS);
  }

  useTheme(theme) {
    if (theme === this.theme) return;
    this.clear();
    this.theme = theme;
  }

  clear() {
    const ids = [...this.loaded.values()].flatMap(set => set.ids);
    this.loaded.clear();
    if (ids.length) this.write(ids.map(id => `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`).join(''));
  }
}
