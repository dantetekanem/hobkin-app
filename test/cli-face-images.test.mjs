import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visibleWidth } from '@earendil-works/pi-tui';
import { moods } from '../src/cli/face.mjs';
import { FaceImages, IMAGE_FACE_COLUMNS, IMAGE_FACE_ROWS, WORDMARK_COLUMNS, supportsFaceImages } from '../src/cli/face-images.mjs';

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

test('the face is a fixed box of text cells', () => {
  const { faces } = images();

  for (const value of faces.lines('thinking', 1234)) assert.equal(visibleWidth(value), IMAGE_FACE_COLUMNS);
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

test('images need a terminal that draws them, and a way out', () => {
  assert.equal(supportsFaceImages({ GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app', HERDR_ENV: '1' }), true);
  assert.equal(supportsFaceImages({ KITTY_WINDOW_ID: '1' }), true);
  assert.equal(supportsFaceImages({ TERM_PROGRAM: 'Apple_Terminal' }), false);
  assert.equal(supportsFaceImages({ GHOSTTY_RESOURCES_DIR: '/x', TMUX: '/tmp/tmux' }), false, 'tmux would need its own wrapping');
  assert.equal(supportsFaceImages({ GHOSTTY_RESOURCES_DIR: '/x', HOBKIN_FACE: 'blocks' }), false);
});
