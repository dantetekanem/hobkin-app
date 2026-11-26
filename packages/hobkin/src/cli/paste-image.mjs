import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { getNativeClipboard } from '@earendil-works/pi-tui';

export const MAX_IMAGES = 4;
export const MAX_PASTE_BYTES = 64 * 1024 * 1024;
/** What goes out when a message is only pictures, because a model turn needs words. */
export const IMAGE_ONLY_TEXT = 'Look at what I pasted.';

// Every image stays in the session file for good, and past its limit a chat will not reopen, so about 250 of these have to fit. The bytes are base64.
const SEND_LIMITS = { maxWidth: 1568, maxHeight: 1568, maxBytes: 1024 * 1024 };
// Half blocks hold two pixels to a cell, so this is at most 18 columns by 3 rows.
const CELL_LIMITS = { maxWidth: 18, maxHeight: 6 };
// The same box in real pixels, on a Retina screen, for a terminal that draws images.
const PICTURE_LIMITS = { maxWidth: 360, maxHeight: 132 };
const NO_PREVIEW = { preview: [], columns: 0 };
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const NO_IMAGE = { notice: 'No image on the clipboard.', tone: 'warning' };
const UNREADABLE = { notice: 'The clipboard cannot be read here.', tone: 'error' };
const TOO_BIG = { notice: `That image is over ${MAX_PASTE_BYTES / (1024 * 1024)} MB, too big to paste.`, tone: 'warning' };
const UNSUPPORTED = { notice: 'That image format cannot be sent. PNG, JPEG, GIF and WebP can.', tone: 'warning' };
const UNSHRINKABLE = { notice: 'That image could not be shrunk to send.', tone: 'warning' };

/**
 * Why images that go with a message to an agent's run cannot be sent to Pi, or null when they can. Each is Pi's image
 * content, its bytes already read: one of the four types, at most `MAX_IMAGES` of them. None at all is fine too.
 */
export function imagesProblem(images) {
  if (images === undefined) return null;
  const sendable = image => image?.type === 'image' && typeof image.data === 'string' && image.data.length > 0 && Object.hasOwn(EXTENSIONS, image.mimeType);
  return Array.isArray(images) && images.length <= MAX_IMAGES && images.every(sendable) ? null
    : `A message can hold up to ${MAX_IMAGES} images, each a PNG, JPEG, GIF or WebP.`;
}

const imageType = bytes => {
  const start = bytes.toString('latin1', 0, 12);
  if (start.startsWith('\x89PNG')) return 'image/png';
  if (start.startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (start.startsWith('GIF8')) return 'image/gif';
  return start.startsWith('RIFF') && start.endsWith('WEBP') ? 'image/webp' : null;
};

const paeth = (left, up, upLeft) => {
  const estimate = left + up - upLeft;
  const [fromLeft, fromUp, fromUpLeft] = [left, up, upLeft].map(value => Math.abs(estimate - value));
  if (fromLeft <= fromUp && fromLeft <= fromUpLeft) return left;
  return fromUp <= fromUpLeft ? up : upLeft;
};

const CHANNELS = 4;
const SIGNATURE_BYTES = 8;
const predictors = [
  () => 0,
  left => left,
  (_, up) => up,
  (left, up) => Math.floor((left + up) / 2),
  paeth,
];

function compressedPixels(data) {
  const chunks = [];
  for (let offset = SIGNATURE_BYTES; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    const holdsPixels = data.toString('latin1', offset + 4, offset + 8) === 'IDAT';
    if (holdsPixels) chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return Buffer.concat(chunks);
}

/** Pi's thumbnails are always 8-bit RGBA, and anything else gets no preview. */
export const pngPixels = bytes => {
  const data = Buffer.from(bytes);
  const [depth, kind, , , interlace] = data.subarray(24, 29);
  if (depth !== 8 || kind !== 6 || interlace) return null;

  const [width, height] = [data.readUInt32BE(16), data.readUInt32BE(20)];
  const lines = inflateSync(compressedPixels(data));
  const stride = width * CHANNELS;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const predict = predictors[lines[y * (stride + 1)]];
    for (let x = 0; x < stride; x++) {
      const here = y * stride + x;
      const left = x >= CHANNELS ? pixels[here - CHANNELS] : 0;
      const up = y ? pixels[here - stride] : 0;
      const upLeft = y && x >= CHANNELS ? pixels[here - stride - CHANNELS] : 0;
      pixels[here] = lines[y * (stride + 1) + 1 + x] + predict(left, up, upLeft);
    }
  }
  return { width, height, pixels };
};

const colorAt = ({ width, pixels }, x, y) => {
  const at = (y * width + x) * CHANNELS;
  const opacity = pixels[at + 3] / 255;
  return [0, 1, 2].map(channel => Math.round(pixels[at + channel] * opacity)).join(';');
};

/** Two pixels to a cell, for a terminal not known to draw images. */
export const halfBlocks = image => {
  const rows = [];
  for (let y = 0; y < image.height; y += 2) {
    let cells = '';
    for (let x = 0; x < image.width; x++) {
      const below = y + 1 < image.height ? `\x1b[48;2;${colorAt(image, x, y + 1)}m` : '\x1b[49m';
      cells += `\x1b[38;2;${colorAt(image, x, y)}m${below}▀`;
    }
    rows.push(`${cells}\x1b[39;49m`);
  }
  return rows;
};

// The image is already safe to send by here, so a preview that fails only leaves the preview out.
const previewOf = async (resizeImage, { data, mimeType }) => {
  try {
    const picture = await resizeImage(Buffer.from(data, 'base64'), mimeType, PICTURE_LIMITS);
    const small = await resizeImage(Buffer.from(picture.data, 'base64'), picture.mimeType, CELL_LIMITS);
    const image = small.mimeType === 'image/png' ? pngPixels(Buffer.from(small.data, 'base64')) : null;
    if (!image) return NO_PREVIEW;
    return {
      preview: halfBlocks(image),
      columns: image.width,
      ...(picture.mimeType === 'image/png' ? { picture: picture.data } : {}),
    };
  } catch {
    return NO_PREVIEW;
  }
};

/** Images attached to the message being written. Each is a private file until the message has gone. */
export class PastedImages {
  constructor(root, clipboard = getNativeClipboard()) {
    this.clipboard = clipboard;
    this.directory = join(root, 'runtime', 'pasted');
  }

  // A file copied in Finder also puts its icon on the clipboard as an image, so the file has to come first.
  async read() {
    if (!this.clipboard) return UNREADABLE;
    const [copied] = await this.clipboard.getFilePaths?.() ?? [];
    if (copied) return IMAGE_FILE.test(copied) ? this.readFile(copied) : NO_IMAGE;

    const bytes = await this.clipboard.getImage();
    if (bytes === undefined) return UNREADABLE;
    if (bytes?.length) return { bytes: Buffer.from(bytes) };
    return await this.clipboard.getText() ? {} : NO_IMAGE;
  }

  readFile(file) {
    return statSync(file).size > MAX_PASTE_BYTES ? TOO_BIG : { bytes: readFileSync(file) };
  }

  /** `refusal` is why the conversation cannot take an image just now. Text on the clipboard has no use for it. */
  async paste(refusal = null) {
    const { bytes, ...result } = await this.read();
    if (!bytes) return result;
    if (refusal) return { notice: refusal, tone: 'warning' };
    if (bytes.length > MAX_PASTE_BYTES) return TOO_BIG;
    const mimeType = imageType(bytes);
    if (!mimeType) return UNSUPPORTED;

    const { resizeImage } = await import('@earendil-works/pi-coding-agent');
    const sendable = await resizeImage(bytes, mimeType, SEND_LIMITS);
    if (!sendable) return UNSHRINKABLE;

    const image = {
      ...await previewOf(resizeImage, sendable),
      file: this.save(sendable),
      mimeType: sendable.mimeType,
    };
    const shrunk = sendable.wasResized ? { notice: `Shrunk to ${sendable.width}×${sendable.height} to send.`, tone: 'info' } : {};
    return { image, ...shrunk };
  }

  save({ data, mimeType }) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${randomUUID()}.${EXTENSIONS[mimeType]}`);
    writeFileSync(file, data, { encoding: 'base64', flag: 'wx', mode: 0o600 });
    return file;
  }

  contents(images) {
    return images.map(({ file, mimeType }) => ({ type: 'image', data: readFileSync(file, 'base64'), mimeType }));
  }

  remove(images) {
    for (const { file } of images) rmSync(file, { force: true });
  }

  clear() {
    rmSync(this.directory, { recursive: true, force: true });
  }
}
