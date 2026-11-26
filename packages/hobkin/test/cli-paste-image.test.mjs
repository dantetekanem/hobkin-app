import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { visibleWidth } from '@earendil-works/pi-tui';
import { MAX_PASTE_BYTES, PastedImages, halfBlocks, pngPixels } from '../src/cli/paste-image.mjs';
import { png } from './helpers/png.mjs';

const fixture = (t, clipboard) => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-paste-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, pasted: new PastedImages(root, { getFilePaths: async () => null, getImage: async () => null, getText: async () => null, ...clipboard }) };
};
const saved = root => readdirSync(join(root, 'runtime', 'pasted'));

test('an image on the clipboard is kept private under runtime, with a preview of a few rows', async t => {
  const { root, pasted } = fixture(t, { getImage: async () => png(800, 400) });

  const { image, notice } = await pasted.paste();

  assert.equal(notice, undefined);
  assert.equal(image.mimeType, 'image/png');
  assert.match(image.file, /runtime\/pasted\/[\w-]+\.png$/);
  assert.equal(statSync(image.file).mode & 0o777, 0o600);
  assert.equal(statSync(join(root, 'runtime', 'pasted')).mode & 0o777, 0o700);
  assert.equal(image.preview.length, 3);
  assert.equal(image.columns, 12);
  assert.ok(image.preview.every(row => visibleWidth(row) === 12));
  const picture = Buffer.from(image.picture, 'base64');
  assert.equal(picture.toString('latin1', 1, 4), 'PNG');
  assert.equal(picture.readUInt32BE(20), 132, 'sharp enough for the box of cells, and no bigger');
});

test('a big image is shrunk to fit, and says so', async t => {
  const { pasted } = fixture(t, { getImage: async () => png(3000, 1500) });

  const { image, notice } = await pasted.paste();

  assert.equal(notice, 'Shrunk to 1568×784 to send.');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(readFileSync(image.file).readUInt32BE(16), 1568);
});

test('an image too heavy to keep as it is goes under 1 MiB of base64, at any cost in quality', async t => {
  let seed = 1;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return [seed & 255, (seed >> 8) & 255, (seed >> 16) & 255, 255];
  };
  const { pasted } = fixture(t, { getImage: async () => png(700, 700, noise) });

  const { image } = await pasted.paste();

  assert.ok(readFileSync(image.file, 'base64').length < 1024 * 1024);
});

test('an image over the paste limit is refused and leaves nothing behind', async t => {
  const { root, pasted } = fixture(t, { getImage: async () => Buffer.alloc(MAX_PASTE_BYTES + 1) });

  const { image, notice, tone } = await pasted.paste();

  assert.equal(image, undefined);
  assert.equal(notice, 'That image is over 64 MB, too big to paste.');
  assert.equal(tone, 'warning');
  assert.equal(existsSync(join(root, 'runtime', 'pasted')), false);
});

test('a format that cannot be sent says which ones can', async t => {
  const { pasted } = fixture(t, { getImage: async () => Buffer.from('II*\0 not one the models take') });

  const { image, notice } = await pasted.paste();

  assert.equal(image, undefined);
  assert.equal(notice, 'That image format cannot be sent. PNG, JPEG, GIF and WebP can.');
});

test('with text on the clipboard Ctrl+V has nothing to say', async t => {
  const { pasted } = fixture(t, { getText: async () => 'some copied words' });

  assert.deepEqual(await pasted.paste(), {});
});

test('a clipboard with neither image nor text says so', async t => {
  const { pasted } = fixture(t);

  assert.deepEqual(await pasted.paste(), { notice: 'No image on the clipboard.', tone: 'warning' });
});

test('a machine with no clipboard access says so', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-paste-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const unreadable = { getImage: async () => undefined, getText: async () => undefined };

  assert.deepEqual(await new PastedImages(root, unreadable).paste(), { notice: 'The clipboard cannot be read here.', tone: 'error' });
  assert.deepEqual(await new PastedImages(root, null).paste(), { notice: 'The clipboard cannot be read here.', tone: 'error' });
});

test('a model that cannot see images hears about it before anything is saved', async t => {
  const { root, pasted } = fixture(t, { getImage: async () => png(10, 10) });

  const result = await pasted.paste('fixture/text cannot see images.');

  assert.deepEqual(result, { notice: 'fixture/text cannot see images.', tone: 'warning' });
  assert.equal(existsSync(join(root, 'runtime', 'pasted')), false);
});

test('with text on the clipboard an unsupported model says nothing either', async t => {
  const { pasted } = fixture(t, { getText: async () => 'some copied words' });

  assert.deepEqual(await pasted.paste('fixture/text cannot see images.'), {});
});

test('a copied image file is pasted itself, not the icon Finder puts beside it', async t => {
  const picture = png(40, 20, () => [10, 20, 30, 255]);
  const { root, pasted } = fixture(t, { getImage: async () => png(4, 4, () => [255, 255, 255, 255]) });
  const file = join(root, 'shot.PNG');
  writeFileSync(file, picture);
  pasted.clipboard.getFilePaths = async () => [file];

  const { image } = await pasted.paste();

  assert.deepEqual(readFileSync(image.file), picture);
  assert.ok(existsSync(file), 'the copied file stays where it was');
});

test('a copied file that is not an image is no image', async t => {
  const { root, pasted } = fixture(t, { getImage: async () => png(4, 4), getText: async () => 'notes.txt' });
  mkdirSync(join(root, 'folder'));
  pasted.clipboard.getFilePaths = async () => [join(root, 'folder')];

  assert.deepEqual(await pasted.paste(), { notice: 'No image on the clipboard.', tone: 'warning' });
});

test('a read that fails reaches the caller', async t => {
  const { pasted } = fixture(t, { getImage: async () => { throw Error('pasteboard busy'); } });

  await assert.rejects(pasted.paste(), /pasteboard busy/);
});

test('attached images load as image content and go when removed', async t => {
  const bytes = png(10, 10);
  const { root, pasted } = fixture(t, { getImage: async () => bytes });
  const { image: first } = await pasted.paste();
  const { image: second } = await pasted.paste();

  assert.deepEqual(pasted.contents([first]), [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }]);

  pasted.remove([first]);
  assert.deepEqual(saved(root), [second.file.split('/').at(-1)]);

  pasted.clear();
  assert.equal(existsSync(join(root, 'runtime', 'pasted')), false);
});

test('half blocks paint the top pixel in front and the bottom pixel behind', () => {
  const colors = { '0,0': [255, 0, 0, 255], '1,0': [0, 255, 0, 255], '0,1': [0, 0, 255, 255], '1,1': [255, 255, 255, 0] };
  const image = pngPixels(png(2, 3, (x, y) => colors[`${x},${y}`] ?? [10, 20, 30, 255]));

  assert.deepEqual(halfBlocks(image), [
    '\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀\x1b[38;2;0;255;0m\x1b[48;2;0;0;0m▀\x1b[39;49m',
    '\x1b[38;2;10;20;30m\x1b[49m▀\x1b[38;2;10;20;30m\x1b[49m▀\x1b[39;49m',
  ]);
});

test('every PNG line filter decodes', () => {
  // Each of the five rows uses the next filter: none, sub, up, average, paeth.
  const row = (filter, ...bytes) => Buffer.from([filter, ...bytes]);
  const header = png(2, 5).subarray(0, 33);
  const rows = Buffer.concat([
    row(0, 10, 20, 30, 255, 20, 30, 40, 255),
    row(1, 1, 2, 3, 255, 1, 1, 1, 0),
    row(2, 1, 1, 1, 0, 1, 1, 1, 0),
    row(3, 1, 1, 1, 128, 1, 1, 1, 0),
    row(4, 1, 1, 1, 0, 1, 1, 1, 0),
  ]);
  const body = deflateSync(rows);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);

  const { pixels } = pngPixels(Buffer.concat([header, length, Buffer.from('IDAT'), body, Buffer.alloc(4)]));

  assert.deepEqual([...pixels], [
    10, 20, 30, 255, 20, 30, 40, 255,
    1, 2, 3, 255, 2, 3, 4, 255,
    2, 3, 4, 255, 3, 4, 5, 255,
    2, 2, 3, 255, 3, 4, 5, 255,
    3, 3, 4, 255, 4, 5, 6, 255,
  ]);
});

test('an image too tiny for Pi to redraw has no preview, and still attaches', async t => {
  // Pi hands it back as it came, and the preview only decodes the 8-bit RGBA that Pi writes.
  const tiny = png(4, 4, () => [1, 2, 3], 3);
  assert.equal(pngPixels(tiny), null);
  const { pasted } = fixture(t, { getImage: async () => tiny });

  const { image } = await pasted.paste();

  assert.ok(existsSync(image.file));
  assert.deepEqual(image.preview, []);
  assert.equal(image.picture, undefined);
});
