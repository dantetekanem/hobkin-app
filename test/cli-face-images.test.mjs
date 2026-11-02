import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visibleWidth } from '@earendil-works/pi-tui';
import { moods } from '../src/cli/face.mjs';
import { FaceImages, IMAGE_FACE_ROWS, WORDMARK_COLUMNS, supportsFaceImages } from '../src/cli/face-images.mjs';

const transmissions = text => text.match(/\x1b_G[^;]*a=T[^;]*;/g) ?? [];
const imageIdOf = value => {
  const [, red, green, blue] = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(value);
  return (Number(red) << 16) + (Number(green) << 8) + Number(blue);
};

function images(options = {}) {
  const written = [];
  return { written, faces: new FaceImages({ write: data => written.push(data), ...options }) };
}

test('every mood has real frames in both themes, and so does the wordmark', () => {
  for (const theme of ['dark', 'light']) {
    const { faces, written } = images({ theme });
    for (const mood of moods) {
      assert.equal(faces.lines(mood, 0).length, IMAGE_FACE_ROWS, `${theme} ${mood}`);
    }
    assert.equal(visibleWidth(faces.wordmark()), WORDMARK_COLUMNS);
    assert.ok(written.join('').length > 100000);
  }
});

test('the face is a fixed box of 10 by 5 text cells, and the terminal is told the same box', () => {
  const { faces, written } = images();

  const rows = faces.lines('thinking', 1234);

  assert.equal(rows.length, 5);
  for (const value of rows) assert.equal(visibleWidth(value), 10);
  assert.ok(transmissions(written.join('')).every(control => control.includes('c=10,r=5,')));
});

test('each row of cells names its own row of the picture', () => {
  const { faces } = images();
  const markOf = value => [...value.replace(/\x1b\[[0-9;]*m/g, '')][1];

  const marks = faces.lines('thinking', 0).map(markOf);

  assert.deepEqual(marks, ['\u0305', '\u030D', '\u030E', '\u0310', '\u0312']);
});

test('a mood is sent to the terminal once, one image per frame, and never again', () => {
  const { faces, written } = images();

  faces.lines('idle', 0);
  const first = written.join('');
  const sent = transmissions(first).length;
  assert.ok(sent > 10);
  for (let milliseconds = 0; milliseconds < 20000; milliseconds += 125) faces.lines('idle', milliseconds);

  assert.equal(written.join(''), first, 'moving between frames sends no image data');
  assert.ok(first.startsWith('\x1b[?2026h') && first.endsWith('\x1b[?2026l'), 'the upload is one atomic update');
  assert.ok(transmissions(first).every(control => /U=1/.test(control) && /q=2/.test(control)), 'virtual placement, no replies on stdin');
});

test('only the mood on screen stays in the terminal', () => {
  const { faces, written } = images();
  const deletions = () => written.join('').match(/a=d,d=I,i=\d+/g) ?? [];

  faces.lines('idle', 0);
  const idleImages = transmissions(written.join('')).length;
  faces.lines('thinking', 0);
  assert.deepEqual(deletions(), [], 'the old mood stays until the new one has been drawn');

  faces.lines('thinking', 125);

  assert.equal(deletions().length, idleImages);
  faces.lines('thinking', 250);
  assert.equal(deletions().length, idleImages, 'each image is freed once');
});

test('coming back to a mood sends it again', () => {
  const { faces, written } = images();
  faces.lines('idle', 0);
  faces.lines('thinking', 0);
  faces.lines('thinking', 125);
  const before = transmissions(written.join('')).length;

  faces.lines('idle', 0);

  assert.ok(transmissions(written.join('')).length > before);
});

test('the speed of a mood not yet sent costs no upload', () => {
  const { faces, written } = images();

  assert.ok(faces.frameMs('thinking') > 0);

  assert.deepEqual(written, []);
});

test('moving to the next frame changes only which image the cells point at', () => {
  const { faces } = images();
  const strip = rows => rows.join('').replace(/\x1b\[[0-9;]*m/g, '');

  const first = faces.lines('thinking', 0);
  const later = faces.lines('thinking', 1000);

  assert.notEqual(imageIdOf(first[0]), imageIdOf(later[0]));
  assert.equal(strip(first), strip(later));
});

test('a frame ID fits the 24 bits a colour can carry', () => {
  const { faces } = images();

  for (const mood of moods) assert.ok(imageIdOf(faces.lines(mood, 0)[0]) < 2 ** 24);
});

test('the animation loops at the speed the design set', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hobkin-faces-'));
  try {
    mkdirSync(join(directory, 'dark'));
    writeFileSync(join(directory, 'dark/idle.json'), JSON.stringify({ seconds: 2, frames: ['AA==', 'AA==', 'AA==', 'AA=='] }));
    const { faces } = images({ directory });
    const id = milliseconds => imageIdOf(faces.lines('idle', milliseconds)[0]);

    assert.equal(id(0), id(2000));
    assert.equal(id(250), id(0));
    assert.equal(id(500), id(0) + 1);
    assert.equal(id(1999), id(0) + 3);
    assert.equal(faces.frameMs('idle'), 500);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a big frame goes out in chunks the protocol allows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hobkin-faces-'));
  try {
    mkdirSync(join(directory, 'dark'));
    writeFileSync(join(directory, 'dark/idle.json'), JSON.stringify({ seconds: 1, frames: ['A'.repeat(9000)] }));
    const { faces, written } = images({ directory });

    faces.lines('idle', 0);

    const pieces = written.join('').split('\x1b_G').slice(1);
    assert.equal(pieces.length, 3);
    assert.match(pieces[0], /^a=T.*m=1;/);
    assert.match(pieces[1], /^m=1;/);
    assert.match(pieces[2], /^m=0;/);
    assert.ok(pieces.every(piece => piece.split(';')[1].split('\x1b')[0].length <= 4096));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unknown mood is idle', () => {
  const { faces } = images();

  assert.deepEqual(faces.lines('no such mood', 0), faces.lines('idle', 0));
});

test('leaving removes exactly the images Hobkin sent', () => {
  const { faces, written } = images();
  faces.lines('idle', 0);
  written.length = 0;

  faces.clear();

  const deleted = written.join('').match(/a=d,d=I,i=\d+/g) ?? [];
  assert.ok(deleted.length > 10);
  assert.equal(new Set(deleted).size, deleted.length);
  assert.doesNotMatch(written.join(''), /d=A/, 'other panes keep their images');
});

test('a theme change sends the other theme\'s frames', () => {
  const { faces, written } = images({ theme: 'dark' });
  faces.lines('idle', 0);
  written.length = 0;

  faces.useTheme('light');
  faces.lines('idle', 0);

  assert.ok(transmissions(written.join('')).length > 10);
});

test('a pasted picture goes out once and fills the box its text cells stand for', () => {
  const { faces, written } = images();
  const image = { file: 'one.png', columns: 12, preview: ['cells', 'cells', 'cells'], picture: 'cGljdHVyZQ==' };

  const shown = faces.showPicture(image);

  const sent = written.join('');
  assert.equal(transmissions(sent).length, 1);
  assert.ok(transmissions(sent)[0].includes('f=100'));
  assert.ok(transmissions(sent)[0].includes('c=12,r=3,'));
  assert.ok(sent.includes('cGljdHVyZQ=='));
  assert.equal(shown.preview.length, 3);
  for (const value of shown.preview) {
    assert.equal(visibleWidth(value), 12);
    assert.equal(imageIdOf(value), shown.pictureId);
  }
  assert.equal(shown.file, 'one.png');
});

test('an image with no picture keeps its text cells', () => {
  const { faces, written } = images();
  const image = { file: 'one.png', columns: 12, preview: ['cells'] };

  assert.equal(faces.showPicture(image), image);
  assert.deepEqual(written, []);
});

test('forgetting pictures deletes them from the terminal, and only them', () => {
  const { faces, written } = images();
  const shown = faces.showPicture({ columns: 2, preview: ['ab'], picture: 'cGljdHVyZQ==' });
  written.length = 0;

  faces.forgetPictures([shown, { columns: 2, preview: ['cd'] }]);

  assert.deepEqual(written, [`\x1b_Ga=d,d=I,i=${shown.pictureId},q=2\x1b\\`]);
});

test('images need a terminal that draws them, and a way out', () => {
  assert.equal(supportsFaceImages({ GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app', HERDR_ENV: '1' }), true);
  assert.equal(supportsFaceImages({ KITTY_WINDOW_ID: '1' }), true);
  assert.equal(supportsFaceImages({ TERM_PROGRAM: 'Apple_Terminal' }), false);
  assert.equal(supportsFaceImages({ GHOSTTY_RESOURCES_DIR: '/x', TMUX: '/tmp/tmux' }), false, 'tmux would need its own wrapping');
  assert.equal(supportsFaceImages({ GHOSTTY_RESOURCES_DIR: '/x', HOBKIN_FACE: 'blocks' }), false);
});
