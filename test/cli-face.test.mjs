import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { visibleWidth } from '@earendil-works/pi-tui';
import { FACE_COLUMNS, FACE_ROWS, faceFrame, faceLines, moods, octantFor, supportsOctants } from '../src/cli/face.mjs';
import { currentMood, defaultMoods } from '../src/cli/mood.mjs';

const colors = { hood: [240, 234, 214], eye: [232, 163, 23] };

test('the design has eighteen moods, and four of them need no model', () => {
  assert.equal(moods.length, 18);
  assert.deepEqual(defaultMoods, ['idle', 'thinking', 'working', 'happy']);
  assert.ok(defaultMoods.every(mood => moods.includes(mood)));
});

test('each dot pattern maps to the Unicode character named for it', () => {
  assert.equal(octantFor(0), ' ');
  assert.equal(octantFor(255), '█');
  assert.equal(octantFor(15), '▀');
  assert.equal(octantFor(0b00000100), '\u{1CD00}', 'BLOCK OCTANT-3');
  assert.equal(octantFor(0b00000110), '\u{1CD01}', 'BLOCK OCTANT-23');
  assert.equal(octantFor(0b00010000), '\u{1CD09}', 'BLOCK OCTANT-5');
  assert.equal(octantFor(0b11111110), '\u{1CDE5}', 'BLOCK OCTANT-2345678');
  assert.equal(octantFor(0b00000011), '\u{1FB82}', 'UPPER ONE QUARTER BLOCK');
});

test('every mood stays in the same box at every moment, on both kinds of terminal', () => {
  for (const octants of [true, false]) {
    for (const mood of moods) {
      for (let milliseconds = 0; milliseconds < 8000; milliseconds += 125) {
        const lines = faceLines(mood, milliseconds, { ...colors, octants });
        assert.equal(lines.length, FACE_ROWS);
        for (const value of lines) assert.equal(visibleWidth(value), FACE_COLUMNS, `${mood} at ${milliseconds}ms`);
      }
    }
  }
});

test('every mood draws a hood with eyes, and moves', () => {
  for (const mood of moods) {
    const frames = new Set();
    for (let seconds = 0; seconds < 6; seconds += 0.125) frames.add(faceFrame(mood, seconds).join(''));
    const first = faceFrame(mood, 0);
    assert.ok(first.includes(1), `${mood} has a hood`);
    assert.ok(first.some(pixel => pixel > 1), `${mood} has eyes`);
    assert.ok(frames.size > 1, `${mood} moves`);
  }
});

test('an unknown mood is idle rather than a blank space', () => {
  assert.deepEqual(faceFrame('no such mood', 0), faceFrame('idle', 0));
});

test('terminals without the finer characters get half blocks', () => {
  assert.equal(supportsOctants({ GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app' }), true);
  assert.equal(supportsOctants({ TERM_PROGRAM: 'kitty' }), true);
  assert.equal(supportsOctants({ TERM_PROGRAM: 'Apple_Terminal' }), false);

  const text = faceLines('idle', 0, { ...colors, octants: false }).map(stripVTControlCharacters).join('');
  assert.equal(/[\u{1CD00}-\u{1CDE5}]/u.test(text), false);
});

test('with nothing to react to, the mood follows the work', () => {
  const now = 1000;

  assert.equal(currentMood({ now }), 'idle');
  assert.equal(currentMood({ running: 1, now }), 'working');
  assert.equal(currentMood({ busy: true, running: 1, now }), 'thinking');
});

test('the default happy gives way as soon as real work starts', () => {
  const reaction = { mood: 'happy', until: 2000, yields: true };

  assert.equal(currentMood({ reaction, now: 1000 }), 'happy');
  assert.equal(currentMood({ reaction, busy: true, now: 1000 }), 'thinking');
  assert.equal(currentMood({ reaction, running: 1, now: 1000 }), 'working');
});

test('a reaction shows until it runs out', () => {
  const reaction = { mood: 'happy', until: 2000 };

  assert.equal(currentMood({ reaction, busy: true, now: 1999 }), 'happy');
  assert.equal(currentMood({ reaction, busy: true, now: 2000 }), 'thinking');
});
