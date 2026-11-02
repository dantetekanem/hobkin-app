import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Markdown, setCapabilityOverrides, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { FRAME_MS, Slide, decayed, fadeAt, fadeRow, tailGrowth } from '../src/cli/motion.mjs';
import { createDashboard, startDashboard } from '../src/cli/ui.mjs';

const START = Date.parse('2026-11-01T12:00:00.000Z');
const colors = { text: [224, 224, 230], background: [30, 31, 41] };
const base = {
  config: { background: { harness: 'pi', model: null, effort: 'medium' } },
  counts: {},
  schedules: [],
  reports: [],
  connection: 'connected',
  runs: [],
  usage: null,
};
const chat = messages => ({ ...base, messages });
const message = (index, content = `Message ${index}`) => ({
  id: `m${index}:${content.length}`,
  role: index % 2 ? 'assistant' : 'user',
  content,
  at: '2026-11-01T10:00:00.000Z',
});
const conversation = amount => Array.from({ length: amount }, (_, index) => message(index));
const paragraphs = amount => Array.from({ length: amount }, (_, index) => `Line ${index}`).join('\n\n');
const bullets = amount => Array.from({ length: amount }, (_, index) => `- Line ${index}`).join('\n');
const oneMore = (amount, lines) => [...conversation(amount), message(amount, paragraphs(lines))];
const fiftyRows = Array.from({ length: 50 }, (_, index) => `row ${index}`);
const plain = rows => rows.map(value => stripTerminalSequences(value));
const place = (rows, text) => rows.findIndex(value => value.includes(text));
// How far a row has come back from the fade: the red of its first color, and it has none at full strength.
const levelOf = (row, full = 255) => Number(/^\x1b\[38;2;(\d+)/.exec(row)?.[1] ?? full);
const marks = (...heights) => {
  let end = 0;
  return heights.map((height, index) => ({ key: `${index}:${height}`, end: (end += height) }));
};
// A frame of `slide` on the tail of a chat with a 30-row window. `scene` is what the test is about, and `change` is for one frame.
const stepper = (slide, scene = {}) => (heights, clock = 0, change = {}) => slide.advance({
  marks: marks(...heights),
  available: 30,
  layout: 'a',
  clock,
  following: true,
  ...scene,
  ...change,
});
const frames = (ui, advance, amount = 40) => Array.from({ length: amount }, () => {
  const rows = ui.render(120, 40);
  advance(FRAME_MS);
  return rows;
});
const setTrueColor = (t, trueColor = true) => {
  setCapabilityOverrides({ trueColor });
  t.after(() => setCapabilityOverrides({}));
};
// A dashboard with the clock in the test's hands.
const driven = (t, messages) => {
  let clock = START;
  const ui = createDashboard(chat(messages), {}, { motion: true, now: () => clock });
  t.after(() => ui.stop());
  return {
    ui,
    advance: ms => { clock += ms; },
    still: next => createDashboard(chat(next), {}, { now: () => clock }),
  };
};
// A dashboard that redraws itself on mocked timers, as the real screen does, and counts each frame.
const selfDrawing = (t, size = [60, 18]) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const screen = { clock: START, size, drawn: 0, latest: null };
  screen.ui = createDashboard(chat(conversation(40)), {}, {
    motion: true,
    now: () => screen.clock,
    onChange: () => {
      screen.drawn++;
      screen.latest = screen.ui.render(...screen.size);
    },
  });
  t.after(() => screen.ui.stop());
  screen.wait = ms => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1) {
      screen.clock += 1;
      t.mock.timers.tick(1);
    }
  };
  return screen;
};

class FakeTerminal {
  columns = 60;
  rows = 18;
  writes = [];
  start(input, resize) {
    this.input = input;
    this.resize = resize;
  }
  stop() {}
  drainInput() { return Promise.resolve(); }
  write(data) { this.writes.push(data); }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  get kittyProtocolActive() { return false; }
}

test('pending decays as an ease-out that lands on exactly zero', () => {
  let pending = 8;
  const steps = [];
  while (pending) {
    const next = decayed(pending, FRAME_MS);
    steps.push(pending - next);
    pending = next;
  }
  assert.ok(steps.length > 4, 'it takes several frames');
  assert.ok(steps.slice(0, 4).every((step, index, all) => !index || step < all[index - 1]), 'the fastest frame comes first');
  assert.equal(decayed(5, -1000), 5, 'a clock set back does not grow it');
});

test('a short message settles in about 250ms, and a whole screen in not much more', () => {
  const settle = rows => {
    let pending = rows;
    let elapsed = 0;
    for (; pending; elapsed++) pending = decayed(pending, 1);
    return elapsed;
  };
  assert.ok(Math.abs(settle(5) - 250) <= 25, `5 rows took ${settle(5)}ms`);
  assert.ok(settle(40) < 450, `40 rows took ${settle(40)}ms`);
});

test('the decay does not depend on the frame rate', () => {
  const after = frameMs => {
    let pending = 20;
    for (let elapsed = 0; elapsed < 120; elapsed += frameMs) pending = decayed(pending, frameMs);
    return pending;
  };
  assert.ok(Math.abs(after(8) - after(40)) < 1e-9);
  assert.ok(Math.abs(after(24) - after(120)) < 1e-9);
});

test('rows added mid-slide add to what is left, so nothing restarts', () => {
  const slide = new Slide();
  const frame = stepper(slide);
  frame([40], 0);
  frame([40, 10], 0);
  assert.equal(slide.pending, 10);

  frame([40, 10], 80);
  const left = slide.pending;
  assert.ok(left < 10);

  frame([40, 13], 80);
  assert.equal(slide.pending, left + 3);
});

test('a huge paste takes no longer than one viewport', () => {
  const slide = new Slide();
  const frame = stepper(slide);
  frame([100]);
  frame([100, 500]);
  assert.equal(slide.pending, 30);
  frame([100, 520]);
  assert.equal(slide.pending, 30);
});

test('the first frame, a new layout and a scrolled-up view start nothing', () => {
  const slide = new Slide();
  const step = stepper(slide);
  const frame = (heights, change) => step(heights, 0, change);
  frame([40, 10]);
  assert.equal(slide.pending, 0);
  frame([40, 20], { layout: 'b' });
  assert.equal(slide.pending, 0);
  assert.equal(frame([40, 25], { layout: 'b', following: false }), 5, 'a reader hears how far to hold');
  assert.equal(slide.pending, 0);
  frame([40, 30], { layout: 'b' });
  assert.equal(slide.pending, 5);
  frame([40, 30], { layout: 'b', following: false });
  assert.equal(slide.pending, 0, 'scrolling up ends a slide');
});

test('growth is measured at the tail, so a chat at its message cap still rises', () => {
  const before = [{ key: 'a', end: 20 }, { key: 'b', end: 25 }, { key: 'c', end: 30 }];
  const after = [{ key: 'b', end: 5 }, { key: 'c', end: 10 }, { key: 'd', end: 14 }];
  assert.deepEqual(tailGrowth(before, after), { rows: 4, messages: 1 });
});

test('a streaming reply changes its key with every delta and still counts as growth', () => {
  const before = [{ key: 'a', end: 10 }, { key: 'draft 1', end: 14 }];
  assert.deepEqual(tailGrowth(before, [{ key: 'a', end: 10 }, { key: 'draft 2', end: 16 }]), { rows: 2, messages: 0 });
  assert.deepEqual(tailGrowth([{ key: 'draft 1', end: 4 }], [{ key: 'draft 2', end: 6 }]), { rows: 2, messages: 0 });
});

test('a first message counts whole, and a replaced conversation is not an arrival', () => {
  assert.deepEqual(tailGrowth([], [{ key: 'a', end: 5 }]), { rows: 5, messages: 1 });
  assert.equal(tailGrowth([{ key: 'a', end: 5 }, { key: 'b', end: 9 }], [{ key: 'c', end: 40 }]), null);
});

test('a row added above a waiting message is not tail growth, so that message never wobbles', () => {
  const before = [{ key: 'reply', end: 10 }, { key: 'waiting', end: 13 }];
  const after = [{ key: 'reply longer', end: 11 }, { key: 'waiting', end: 14 }];
  assert.deepEqual(tailGrowth(before, after), { rows: 0, messages: 0 });
});

test('a faded row keeps its width, its text and its balance', () => {
  const row = `  \x1b[38;2;189;147;249m\x1b[1m◆ Hobkin\x1b[22m\x1b[39m plain 你好 \x1b[38;2;80;250;123mgreen\x1b[39m tail\x1b[0m end`;
  for (const amount of [0.1, 0.5, 0.9, 1]) {
    const faded = fadeRow(row, amount, colors);
    assert.equal(visibleWidth(faded), visibleWidth(row));
    assert.equal(stripTerminalSequences(faded), stripTerminalSequences(row));
    assert.ok(faded.endsWith('\x1b[39m'), 'the row hands the default color back');
    assert.equal(faded.split('\x1b[39m').length, 2, 'inside the row a color always returns to the faded text color');
    assert.equal(faded.split('\x1b[1m').length, row.split('\x1b[1m').length, 'bold is left alone');
    assert.equal(faded.split('\x1b[22m').length, row.split('\x1b[22m').length);
  }
});

test('the fade blends every color toward the background, and text with no color of its own too', () => {
  assert.equal(fadeRow('plain', 0.5, colors), '\x1b[38;2;127;128;136mplain\x1b[39m');
  assert.equal(fadeRow('\x1b[38;2;200;100;41mpink\x1b[39m', 0.5, colors),
    '\x1b[38;2;127;128;136m\x1b[38;2;115;66;41mpink\x1b[38;2;127;128;136m\x1b[39m');
  assert.ok(fadeRow('gone', 1, colors).startsWith('\x1b[38;2;30;31;41m'), 'at the very edge a row is the background');
  assert.equal(fadeRow('after\x1b[0m', 0.5, colors), '\x1b[38;2;127;128;136mafter\x1b[0m\x1b[38;2;127;128;136m\x1b[39m');
});

test('resting text, blank rows and sequences that are not a foreground are never touched', () => {
  const row = '\x1b[38;2;1;2;3mtext\x1b[39m';
  assert.equal(fadeRow(row, 0, colors), row, 'no fade, same string');
  assert.equal(fadeRow('   ', 0.5, colors), '   ');
  const other = fadeRow('\x1b[48;2;68;71;90mbar\x1b[49m \x1b[38;5;141mindexed\x1b[39m', 0.5, colors);
  assert.ok(other.includes('\x1b[48;2;68;71;90m'), 'a background stays');
  assert.ok(other.includes('\x1b[38;5;141m'), 'an indexed color stays');
});

test('the fade is strongest at the very edge, gone a few rows up, and gone once the slide lands', () => {
  assert.ok(fadeAt(0.5, 5) > fadeAt(1.5, 5));
  assert.ok(fadeAt(1.5, 5) > fadeAt(2.5, 5));
  assert.ok(fadeAt(2.5, 5) > fadeAt(3.5, 5));
  assert.equal(fadeAt(0, 5), 1);
  assert.equal(fadeAt(6, 5), 0);
  assert.ok(fadeAt(1, 0.3) < fadeAt(1, 0.5), 'the last part of the slide lets the row come up to full');
  assert.equal(fadeAt(1, decayed(0.2, 1) || 0), 0);
});

test('a row brightens evenly as it rises, because the fade carries what the row step cannot', () => {
  const slide = new Slide();
  slide.fresh = 3;
  const levels = [];
  for (slide.pending = 3; slide.pending > 0.45; slide.pending -= 0.01) {
    const placed = slide.place(fiftyRows, 20);
    const body = slide.fade(placed.rows.slice(placed.offset, placed.offset + 30), placed, colors);
    const shown = body.find(value => value.includes('row 47'));
    if (shown) levels.push(levelOf(shown, colors.text[0]));
  }

  assert.ok(levels.length > 100);
  for (let index = 1; index < levels.length; index++) {
    assert.ok(levels[index] >= levels[index - 1], 'it only ever gets brighter');
    assert.ok(levels[index] - levels[index - 1] <= 8, `a step of ${levels[index] - levels[index - 1]} is a visible jump`);
  }
});

test('the top edge stays off on the frame rows arrive, then eases in', () => {
  const slide = new Slide();
  const frame = stepper(slide, { fading: true });
  frame([100], 0);
  frame([100, 12], 5000);
  assert.equal(slide.top, 0, 'nothing has moved yet, however long the chat sat still');
  const levels = [33, 66, 99].map(step => {
    frame([100, 12], 5000 + step);
    return slide.top;
  });
  assert.ok(levels[0] > 0.3 && levels[0] < 0.7, `it starts at ${levels[0]}, not all at once`);
  assert.ok(levels[0] < levels[1] && levels[1] < levels[2]);
  assert.ok(levels[2] <= 1);
});

test('the top edge eases in at the same speed at any frame rate', () => {
  const after = frameMs => {
    const slide = new Slide();
    const frame = stepper(slide, { fading: true });
    frame([100]);
    frame([100, 30]);
    for (let clock = frameMs; clock <= 72; clock += frameMs) frame([100, 30], clock);
    return slide.top;
  };
  assert.ok(Math.abs(after(8) - after(24)) < 1e-9);
  assert.ok(Math.abs(after(12) - after(72)) < 1e-9);
});

test('the top edge holds through a stream whatever pending does, then lets go and ends the slide', () => {
  for (const gap of [99, 132, 297, 660]) {
    const slide = new Slide();
    const step = stepper(slide, { fading: true, busy: true });
    const frame = (height, clock) => step([100, height], clock);
    frame(10, 0);
    let clock = 0;
    let height = 10;
    let highest = 0;
    for (let row = 0; row < 12; row++) {
      height++;
      frame(height, clock);
      for (let elapsed = 0; elapsed < gap; elapsed += 33) {
        clock += 33;
        frame(height, clock);
        assert.ok(slide.top >= highest - 1e-9, `a row every ${gap}ms dropped it from ${highest} to ${slide.top}`);
        highest = slide.top;
      }
    }
    assert.ok(highest > 0.3, `a row every ${gap}ms only reached ${highest}`);
    for (let elapsed = 0; elapsed < 1400; elapsed += 33) {
      clock += 33;
      frame(height, clock);
    }
    assert.equal(slide.top, 0, 'nothing is left at rest');
    assert.equal(slide.moving, false);
  }
});

test('a reply opens on a new message, and the top edge holds from there', () => {
  const slide = new Slide();
  const frame = stepper(slide, { fading: true, busy: true });
  frame([100], 0);
  frame([100, 3], 0);
  let highest = 0;
  for (let clock = 33; clock < 700; clock += 33) {
    frame([100, 3], clock);
    assert.ok(slide.top >= highest - 1e-9, `it dropped from ${highest} to ${slide.top}`);
    highest = slide.top;
  }
});

test('when the turn ends the top edge lets go without waiting out the hold', () => {
  const slide = new Slide();
  const step = stepper(slide, { fading: true });
  const frame = (heights, clock, busy) => step(heights, clock, { busy });
  frame([100, 3], 0, true);
  frame([100, 12], 0, true);
  let clock = 0;
  while (slide.behind) frame([100, 12], clock += 33, true);
  const held = slide.top;
  assert.ok(held > 0.3);
  frame([100, 12], clock += 33, false);
  assert.ok(slide.top < held, 'it starts on the first frame after the turn');
  assert.ok(slide.top > held / 3, 'and it eases out, it does not pop off');
  for (let elapsed = 0; elapsed < 330; elapsed += 33) frame([100, 12], clock += 33, false);
  assert.equal(slide.top, 0);
});

test('a lone message lets the top edge go as soon as it lands', () => {
  const slide = new Slide();
  const frame = stepper(slide, { fading: true });
  frame([100], 0);
  frame([100, 5], 0);
  let clock = 0;
  for (; slide.moving && clock < 2000; clock += 33) frame([100, 5], clock + 33);
  assert.ok(clock <= 450, `it took ${clock}ms`);
});

test('the top edge is held while there is a slide to end, so a frame always comes to clear it', () => {
  const slide = new Slide();
  const frame = stepper(slide, { fading: true });
  frame([100], 0);
  frame([100, 5], 0);
  for (let clock = 33; clock < 2000; clock += 33) {
    frame([100, 5], clock);
    if (slide.top > 0) assert.equal(slide.moving, true);
  }
});

test('nothing leaves a chat that is not scrolling, and a crossing starts the top edge only once the window lifts', () => {
  const short = new Slide();
  const shortFrame = stepper(short, { fading: true });
  shortFrame([5], 0);
  shortFrame([5, 6], 0);
  for (let clock = 33; clock < 900; clock += 33) {
    shortFrame([5, 6], clock);
    assert.equal(short.top, 0);
  }

  const crossing = new Slide();
  const crossingFrame = stepper(crossing, { fading: true });
  crossingFrame([20], 0);
  crossingFrame([20, 22], 0);
  for (let clock = 33; clock < 900; clock += 33) {
    crossingFrame([20, 22], clock);
    if (crossing.behind > 12) assert.equal(crossing.top, 0, 'the chat has 12 rows to lift, and until then nothing leaves');
  }
});

test('anything that ends a slide at once ends the top edge at once', () => {
  const rising = end => {
    const slide = new Slide();
    const frame = stepper(slide, { fading: true });
    frame([100], 0);
    frame([100, 12], 0);
    frame([100, 12], 33);
    frame([100, 12], 66);
    assert.ok(slide.top > 0);
    end(slide, frame);
    return slide;
  };
  assert.equal(rising((_, frame) => frame([100, 12], 66, { following: false })).top, 0);
  assert.equal(rising((_, frame) => frame([100, 12], 66, { layout: 'b' })).top, 0);
  assert.equal(rising(slide => slide.reset()).top, 0);
  assert.equal(rising((_, frame) => frame([], 66)).top, 0);
});

test('a terminal that cannot fade never holds frames open for the top edge', () => {
  const slide = new Slide();
  const frame = stepper(slide, { fading: false });
  frame([100], 0);
  frame([100, 12], 0);
  for (let clock = 33; clock < 500; clock += 33) {
    frame([100, 12], clock);
    assert.equal(slide.top, 0);
  }
});

test('rows leave through a ramp at the top, below the pinned rows, strongest at the edge', () => {
  const slide = new Slide();
  slide.top = 1;
  const placed = slide.place(fiftyRows, 20);
  const inView = placed.rows.slice(placed.offset, placed.offset + 30);

  const body = slide.fade(inView, { ...placed, first: 2 }, colors);

  assert.deepEqual(body.slice(0, 2), ['row 20', 'row 21'], 'pinned rows do not leave');
  assert.ok(levelOf(body[2]) < levelOf(body[3]) && levelOf(body[3]) < levelOf(body[4]));
  assert.equal(levelOf(body[6]), 255, 'a few rows down it is gone');
  assert.ok(levelOf(body[2]) >= 110, `it can hold for a whole reply, so the row at the edge stays readable, not ${levelOf(body[2])}`);

  const unpinned = slide.fade(inView, { ...placed, first: 0 }, colors);

  assert.ok(levelOf(unpinned[0]) < levelOf(unpinned[1]), 'with nothing pinned the edge is the first row');
});

test('a row keeps fading evenly as it climbs to the top, because the ramp follows its true place', () => {
  const slide = new Slide();
  slide.top = 1;
  slide.fresh = 8;
  const levels = [];
  for (slide.pending = 6; slide.pending > 0.3; slide.pending -= 0.01) {
    const placed = slide.place(fiftyRows, 20);
    const body = slide.fade(placed.rows.slice(placed.offset, placed.offset + 30), { ...placed, first: 0 }, colors);
    const shown = body.find(value => value.includes('row 20'));
    if (shown) levels.push(levelOf(shown, colors.text[0]));
  }

  assert.ok(levels.length > 100);
  for (let index = 1; index < levels.length; index++) {
    assert.ok(levels[index] <= levels[index - 1], 'it only ever gets fainter');
    assert.ok(levels[index - 1] - levels[index] <= 8, `a step of ${levels[index - 1] - levels[index]} is a visible jump`);
  }
});

test('new rows come up from the bottom edge and end on the same screen a still render gives', t => {
  const { ui, advance, still } = driven(t, conversation(40));
  ui.render(120, 40);
  const next = oneMore(40, 6);

  ui.update(chat(next));
  const rows = frames(ui, advance).map(plain);

  const places = rows.map(value => place(value, 'Line 0'));
  const composer = place(rows.at(-1), '❯');
  assert.equal(places[0], -1, 'nothing new shows on the frame it arrives');
  const shown = places.filter(value => value >= 0);
  assert.ok(new Set(shown).size >= 4, `it rose through ${new Set(shown).size} rows`);
  assert.ok(shown.every((value, index) => !index || value <= shown[index - 1]), 'it only ever rises');
  assert.ok(shown[0] < composer);
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

test('older rows rise with the new ones, one way only', t => {
  const { ui, advance } = driven(t, conversation(40));
  ui.render(120, 40);

  ui.update(chat(oneMore(40, 6)));
  const places = frames(ui, advance).map(rows => place(plain(rows), 'Message 39'));

  assert.ok(new Set(places).size >= 4);
  assert.ok(places.every((value, index) => !index || value <= places[index - 1]));
});

test('rows that arrive mid-slide keep it going without a jump back', t => {
  const { ui, advance, still } = driven(t, conversation(40));
  ui.render(120, 40);
  let next = oneMore(40, 3);
  const places = [];

  ui.update(chat(next));
  for (let extra = 4; extra <= 8; extra++) {
    places.push(...frames(ui, advance, 3).map(rows => place(plain(rows), 'Message 39')));
    next = oneMore(40, extra);
    ui.update(chat(next));
  }
  places.push(place(plain(ui.render(120, 40)), 'Message 39'));
  places.push(...frames(ui, advance).map(rows => place(plain(rows), 'Message 39')));

  assert.ok(places.every((value, index) => !index || value <= places[index - 1]), 'every step goes up');
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

test('a chat at its message cap still rises, though the oldest message leaves as a new one comes', t => {
  const all = conversation(101);
  const { ui, advance, still } = driven(t, all.slice(0, 100));
  ui.render(120, 40);

  ui.update(chat(all.slice(1)));
  const places = frames(ui, advance).map(rows => place(plain(rows), 'Message 100'));

  assert.equal(places[0], -1);
  assert.ok(places.filter(value => value >= 0).length > 1);
  assert.deepEqual(ui.render(120, 40), still(all.slice(1)).render(120, 40));
});

test('a message in a chat too short to scroll comes up from the bottom edge to its place', t => {
  const { ui, advance, still } = driven(t, conversation(1));
  const resting = plain(ui.render(120, 40));
  const composer = place(resting, '❯');
  const next = oneMore(1, 2);

  ui.update(chat(next));
  const rows = frames(ui, advance).map(plain);

  const places = rows.map(value => place(value, 'Line 0')).filter(value => value >= 0);
  const final = places.at(-1);
  const below = value => value.slice(place(resting, 'TODAY') + 1, composer - 1);
  assert.deepEqual(below(rows[0]), below(resting), 'older rows stay exactly where they are');
  assert.ok(places[0] > final + 8, `it first showed at ${places[0]}, resting at ${final}`);
  assert.ok(places.every((value, index) => !index || value <= places[index - 1]));
  assert.equal(place(rows[2], 'Message 0'), place(resting, 'Message 0'));
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

const brightness = (rows, text) => {
  const shown = rows.find(value => stripTerminalSequences(value).includes(text));
  return shown && levelOf(shown);
};
const onlyBrightens = (levels, text) => {
  const seen = levels.filter(level => level !== undefined);
  assert.ok(seen.length > 2, `${text} was seen ${seen.length} times`);
  assert.ok(seen.every((level, index) => !index || level >= seen[index - 1]), `${text} went ${seen.join(', ')}`);
};

test('a row crossing a short chat never dims on its way up', t => {
  setTrueColor(t);
  const { ui, advance } = driven(t, conversation(1));
  ui.render(120, 40);

  ui.update(chat(oneMore(1, 3)));
  const rows = frames(ui, advance);

  for (const text of ['Line 0', 'Line 1', 'Line 2']) onlyBrightens(rows.map(value => brightness(value, text)), text);
});

test('rows of a fast stream never dim when the next row arrives during their fade', t => {
  setTrueColor(t);
  const { ui, advance } = driven(t, conversation(40));
  ui.render(120, 40);
  const seen = [];

  for (let amount = 1; amount <= 8; amount++) {
    ui.update(chat([...conversation(40), message(40, bullets(amount))]));
    seen.push(...frames(ui, advance, 4));
  }
  seen.push(...frames(ui, advance, 20));

  for (const text of ['Line 2', 'Line 3', 'Line 4', 'Line 5']) {
    const levels = seen.map(value => brightness(value, text));
    onlyBrightens(levels, text);
    assert.ok(levels.find(level => level !== undefined) < 128, `${text} came in at full strength`);
  }
});

test('a message longer than the room left crosses it, then lifts the older rows with it', t => {
  const { ui, advance, still } = driven(t, conversation(8));
  ui.render(120, 40);
  const next = oneMore(8, 14);

  ui.update(chat(next));
  const rows = frames(ui, advance).map(plain);

  const older = rows.map(value => place(value, 'Message 3'));
  const arriving = rows.map(value => place(value, 'Line 0')).filter(value => value >= 0);
  assert.ok(new Set(arriving).size >= 4);
  assert.ok(arriving.every((value, index) => !index || value <= arriving[index - 1]), 'the new rows only rise');
  assert.ok(older.filter(value => value >= 0).every((value, index, all) => !index || value <= all[index - 1]), 'so do the older ones');
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

const onlyDims = (levels, text) => {
  const seen = levels.filter(level => level !== undefined);
  assert.ok(seen.length > 2, `${text} was seen ${seen.length} times`);
  assert.ok(seen.every((level, index) => !index || level <= seen[index - 1]), `${text} went ${seen.join(', ')}`);
};
const textRows = rows => rows.filter(value => stripTerminalSequences(value).trim());

test('rows about to leave at the top fade while the window rises, and the pinned day stays', t => {
  setTrueColor(t);
  const { ui, advance, still } = driven(t, conversation(40));
  ui.render(120, 40);
  const next = oneMore(40, 12);
  const settled = still(next).render(120, 40);

  ui.update(chat(next));
  const rows = frames(ui, advance, 4).at(-1);

  const pin = place(plain(rows), 'TODAY');
  assert.equal(rows[pin], settled[pin], 'the pinned day is not leaving');
  const [edge, second, third] = textRows(rows.slice(pin + 2));
  assert.ok(levelOf(edge) < levelOf(second), `${levelOf(edge)} then ${levelOf(second)}`);
  assert.ok(levelOf(second) <= levelOf(third));
  assert.ok(levelOf(edge) < 170, `the row at the edge is at ${levelOf(edge)}`);
  assert.equal(visibleWidth(edge), visibleWidth(stripTerminalSequences(edge)));
  const composer = place(plain(rows), '❯');
  assert.equal(levelOf(rows[Math.floor((pin + composer) / 2)]), 255, 'the middle of the screen is left alone');
});

test('the frame rows arrive on leaves the top edge exactly as it was', t => {
  setTrueColor(t);
  const { ui } = driven(t, conversation(40));
  const resting = ui.render(120, 40);

  ui.update(chat(oneMore(40, 12)));
  const first = ui.render(120, 40);

  const pin = place(plain(first), 'TODAY');
  assert.deepEqual(first.slice(pin + 1, pin + 8), resting.slice(pin + 1, pin + 8));
});

for (const [name, every] of [['fast', 2], ['steady', 4], ['slow', 9], ['very slow', 20]]) {
  test(`in a ${name} stream a row climbing to the top only ever dims, and the top edge goes at rest`, t => {
    setTrueColor(t);
    const { ui, advance, still } = driven(t, conversation(40));
    ui.render(120, 40);
    const seen = [];
    let next;

    for (let amount = 1; amount <= 18; amount++) {
      next = [...conversation(40), message(40, bullets(amount))];
      ui.update({ ...chat(next), busy: true });
      seen.push(...frames(ui, advance, every));
    }

    let checked = 0;
    for (let index = 26; index < 40; index++) {
      const levels = seen.map(rows => brightness(rows, `Message ${index}`));
      if (levels.filter(level => level !== undefined && level < 255).length < 3) continue;
      onlyDims(levels, `Message ${index}`);
      checked++;
    }
    assert.ok(checked >= 2, `only ${checked} rows reached the top`);

    ui.update(chat(next));
    frames(ui, advance, 20);

    assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
  });
}

test('a lone message lets the top edge go right after it lands', t => {
  setTrueColor(t);
  const { ui, advance, still } = driven(t, conversation(40));
  ui.render(120, 40);
  const next = oneMore(40, 2);

  ui.update(chat(next));
  frames(ui, advance, 14);

  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

test('a chat that is not scrolling has nothing leaving, so its top rows never fade', t => {
  setTrueColor(t);
  const { ui, advance } = driven(t, conversation(3));
  ui.render(120, 40);

  ui.update(chat(oneMore(3, 4)));
  const rows = frames(ui, advance, 20);

  assert.ok(rows.every(value => brightness(value, 'Message 0') === 255));
  assert.ok(rows.every(value => brightness(value, 'Message 1') === 255));
});

test('while a crossing has not lifted the window its top rows stay untouched', t => {
  setTrueColor(t);
  const { ui, advance } = driven(t, conversation(8));
  const resting = plain(ui.render(120, 40));
  const rest = place(resting, 'Message 1');

  ui.update(chat(oneMore(8, 14)));
  const rows = frames(ui, advance, 30);

  const unlifted = rows.filter(value => place(plain(value), 'Message 1') === rest);
  assert.ok(unlifted.length, 'the window waits while the rows cross');
  assert.ok(unlifted.every(value => brightness(value, 'Message 1') === 255));
  const lifted = rows.filter(value => place(plain(value), 'Message 1') !== rest);
  assert.ok(lifted.some(value => levelOf(textRows(value.slice(place(plain(value), 'TODAY') + 2))[0]) < 255), 'once the window lifts the rows do fade');
});

test('a reply streaming into a short chat grows in place rather than flying each row up', t => {
  const { ui, advance, still } = driven(t, conversation(2));
  ui.render(120, 40);
  ui.update(chat(oneMore(2, 1)));
  frames(ui, advance);
  const grown = oneMore(2, 2);

  ui.update(chat(grown));
  const rows = frames(ui, advance, 12);

  const places = rows.map(value => place(plain(value), 'Line 1')).filter(value => value >= 0);
  assert.equal(new Set(places).size, 1, 'it stays on its row');
  assert.deepEqual(ui.render(120, 40), still(grown).render(120, 40));
});

test('in a short chat a streamed row fades in where it stands', t => {
  setTrueColor(t);
  const { ui, advance } = driven(t, conversation(2));
  ui.render(120, 40);
  ui.update(chat(oneMore(2, 1)));
  frames(ui, advance);

  ui.update(chat(oneMore(2, 2)));
  const levels = frames(ui, advance, 12).map(rows => brightness(rows, 'Line 1'));

  onlyBrightens(levels, 'Line 1');
  assert.ok(levels[0] < 160, `it came in at ${levels[0]}`);
});

test('a row that starts a slide of its own fades in too', t => {
  setTrueColor(t);
  const { ui, advance } = driven(t, conversation(40));
  ui.render(120, 40);
  ui.update(chat([...conversation(40), message(40, bullets(1))]));
  frames(ui, advance);

  ui.update(chat([...conversation(40), message(40, bullets(2))]));
  const levels = frames(ui, advance, 12).map(rows => brightness(rows, 'Line 1'));

  onlyBrightens(levels, 'Line 1');
  assert.ok(levels.find(level => level !== undefined) < 128, 'not at full strength');
});

test('the first message of an empty chat rises alone, with one day heading', t => {
  const { ui, advance, still } = driven(t, []);
  ui.render(120, 40);
  const next = conversation(1);

  ui.update(chat(next));

  for (const rows of frames(ui, advance)) {
    assert.ok(plain(rows).filter(value => value.includes('TODAY')).length <= 1);
  }
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

test('while the user reads older rows, new rows hold the view still', t => {
  const { ui, advance } = driven(t, conversation(60));
  ui.render(120, 40);
  ui.input('\x1b[5~');
  advance(FRAME_MS);
  const reading = plain(ui.render(120, 40)).slice(6, 20);
  for (let amount = 61; amount < 64; amount++) {
    ui.update(chat(conversation(amount)));
    assert.deepEqual(plain(ui.render(120, 40)).slice(6, 20), reading);
    advance(FRAME_MS);
    assert.deepEqual(plain(ui.render(120, 40)).slice(6, 20), reading);
  }
});

test('no motion on the first render, when a view is left and reopened, on a resize or on a clear', async t => {
  const { ui, advance, still } = driven(t, conversation(40));
  const next = oneMore(40, 6);
  assert.deepEqual(ui.render(120, 40), still(conversation(40)).render(120, 40), 'first render');

  ui.update(chat(next));
  ui.render(120, 40);
  advance(FRAME_MS);
  ui.render(120, 40);
  ui.input('\x1b[C');
  ui.render(120, 40);
  ui.input('\x1b[D');
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40), 'changing tab mid-slide just ends it');

  const longer = [...next, message(41, paragraphs(6))];
  ui.update(chat(longer));
  ui.render(120, 40);
  assert.deepEqual(ui.render(100, 30), still(longer).render(100, 30), 'a resize ends it too');

  const last = [...longer, message(42, paragraphs(6))];
  ui.update(chat(last));
  ui.render(100, 30);
  ui.input('/clear');
  ui.input('\r');
  await ui.pending();
  const cleared = plain(ui.render(100, 30));
  assert.ok(place(cleared, 'What would you like to work on?') >= 0);
  advance(FRAME_MS);
  assert.deepEqual(plain(ui.render(100, 30)), cleared, 'the clear draws at rest at once');
});

test('clearing the only message while it rises draws the empty chat at rest', async t => {
  const { ui, advance, still } = driven(t, []);
  ui.render(120, 40);
  ui.update(chat(conversation(1)));
  ui.render(120, 40);
  advance(FRAME_MS);
  ui.render(120, 40);
  ui.input('/clear');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(plain(ui.render(120, 40)).slice(3, 20), plain(still([]).render(120, 40)).slice(3, 20));
});

test('reopening the chat after rows arrived on another tab draws them at rest', t => {
  const { ui, still } = driven(t, conversation(40));
  ui.render(120, 40);
  ui.input('\x1b[C');
  ui.render(120, 40);
  const next = oneMore(40, 6);
  ui.update(chat(next));
  ui.render(120, 40);
  ui.input('\x1b[D');
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

test('connecting replaces the saved view without a slide', t => {
  const { ui, still } = driven(t, []);
  ui.render(120, 40);
  ui.update({ ...chat(conversation(40)), connection: 'offline' });
  ui.render(120, 40);
  const next = conversation(45);
  ui.update(chat(next));
  assert.deepEqual(ui.render(120, 40), still(next).render(120, 40));
});

test('a job view never slides', t => {
  const run = { id: 'job', state: 'running', kind: 'background', scheduleId: 'recap', title: 'Recap' };
  let clock = START;
  const blocks = amount => ({ job: Array.from({ length: amount }, (_, index) => ({ kind: 'assistant', text: `Block ${index}` })) });
  const ui = createDashboard({ ...chat(conversation(4)), runs: [run], jobActivity: blocks(30) }, {}, { motion: true, now: () => clock });
  t.after(() => ui.stop());
  const open = createDashboard({ ...chat(conversation(4)), runs: [run], jobActivity: blocks(31) }, {}, { now: () => clock });
  for (const dashboard of [ui, open]) {
    dashboard.render(120, 40);
    for (let press = 0; press < 3; press++) dashboard.input('\x1b[C');
  }
  ui.render(120, 40);
  ui.update({ ...chat(conversation(4)), runs: [run], jobActivity: blocks(31) });
  clock += FRAME_MS;
  assert.deepEqual(ui.render(120, 40), open.render(120, 40));
  open.stop();
});

test('frames run at about 30 a second only while rows move, and no timer is left at rest', t => {
  const screen = selfDrawing(t);
  screen.ui.render(60, 18);
  screen.wait(1000);
  assert.equal(screen.drawn, 0, 'an idle dashboard draws nothing extra');

  screen.ui.update(chat(oneMore(40, 6)));
  screen.drawn = 0;
  screen.wait(99);
  assert.equal(screen.drawn, 3, 'a slide draws every 33ms');

  screen.wait(1000);
  screen.drawn = 0;
  screen.wait(800);
  assert.equal(screen.drawn, 0, 'the fast timer ended with the slide');
});

test('with the face on screen the ticker goes back to the face speed after a slide', t => {
  const screen = selfDrawing(t, [120, 40]);
  screen.ui.render(120, 40);
  screen.ui.update(chat(oneMore(40, 6)));
  screen.wait(2000);

  screen.drawn = 0;
  screen.wait(1000);

  assert.equal(screen.drawn, 4, 'an idle face draws every 250ms');
});

test('a terminal shrunk below its minimum mid-slide ends the fast timer', t => {
  const screen = selfDrawing(t);
  screen.ui.render(60, 18);
  screen.ui.update(chat(oneMore(40, 6)));

  screen.size = [20, 8];
  screen.clock += FRAME_MS * 2;
  t.mock.timers.tick(FRAME_MS * 2);
  screen.drawn = 0;
  screen.clock += 1000;
  t.mock.timers.tick(1000);

  assert.equal(screen.drawn, 0);
});

test('stopping mid-slide leaves no timer behind', t => {
  const running = new Set();
  t.mock.method(globalThis, 'setInterval', (_tick, ms) => {
    const timer = { ms, unref() {} };
    running.add(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearInterval', timer => running.delete(timer));
  const ui = createDashboard(chat(conversation(40)), {}, { motion: true, now: () => START });
  ui.render(60, 18);
  ui.update(chat(oneMore(40, 6)));
  ui.render(60, 18);
  assert.ok([...running].some(({ ms }) => ms === FRAME_MS), 'the slide is running');
  ui.stop();
  assert.equal(running.size, 0);
});

test('the fast timer runs until the top edge has gone, and not a frame longer', t => {
  setTrueColor(t);
  const screen = selfDrawing(t);
  screen.ui.render(60, 18);

  screen.ui.update(chat(oneMore(40, 6)));
  screen.wait(297);
  assert.ok(screen.drawn >= 9, `${screen.drawn} frames`);

  screen.wait(1000);
  screen.drawn = 0;
  screen.wait(800);
  assert.equal(screen.drawn, 0);
});

test('between the rows of a stream nothing moves, so the fast timer rests while the fade stays drawn', t => {
  setTrueColor(t);
  const screen = selfDrawing(t);
  screen.ui.render(60, 18);

  screen.ui.update({ ...chat(oneMore(40, 6)), busy: true });
  screen.wait(400);
  screen.drawn = 0;
  screen.wait(300);
  assert.equal(screen.drawn, 3, 'only the 100ms ticker of the running turn');
  assert.ok(screen.latest.some(value => value.startsWith('\x1b[38;2;')), 'the rows at the top stay faded');

  screen.wait(600);
  screen.drawn = 0;
  screen.wait(99);
  assert.equal(screen.drawn, 1, 'and the hold has run out and been let go');
  assert.ok(!screen.latest.some(value => value.startsWith('\x1b[38;2;')), 'with nothing left faded');
});

test('the moment a hold runs out the fast timer comes back to let the top edge go', () => {
  const slide = new Slide();
  const frame = stepper(slide, { fading: true, busy: true });
  frame([100], 0);
  frame([100, 12], 0);
  let clock = 0;
  while (slide.pending) frame([100, 12], clock += 33);
  const held = slide.top;
  assert.ok(held > 0.3);
  assert.equal(slide.moving, false, 'nothing changes during the hold');
  assert.equal(slide.faint, true, 'but it is still drawn');
  while (clock < 900) frame([100, 12], clock += 33);
  assert.ok(slide.top < held);
  assert.equal(slide.moving, true);
  assert.equal(slide.faint, true);
  while (clock < 1400) frame([100, 12], clock += 33);
  assert.equal(slide.moving, false);
  assert.equal(slide.faint, false);
});

test('a slide frame builds no markdown, and a streamed update builds only the message that changed', t => {
  const { ui, advance } = driven(t, conversation(200));
  ui.render(120, 40);
  const render = t.mock.method(Markdown.prototype, 'render');
  ui.update(chat(oneMore(200, 3)));
  ui.render(120, 40);
  assert.equal(render.mock.callCount(), 1, 'the new message alone');

  render.mock.resetCalls();
  advance(FRAME_MS);
  frames(ui, advance, 8);
  assert.equal(render.mock.callCount(), 0, 'a frame reuses the lines');

  ui.update(chat(oneMore(200, 4)));
  ui.render(120, 40);
  assert.equal(render.mock.callCount(), 1, 'a delta rebuilds its own message');
});

test('only new rows fade, and only near the edge', t => {
  setTrueColor(t);
  const { ui, advance } = driven(t, conversation(40));
  const resting = ui.render(120, 40);
  ui.update(chat(oneMore(40, 6)));
  const first = ui.render(120, 40);
  const composer = place(plain(first), '❯');
  assert.deepEqual(first.slice(6, composer - 1), resting.slice(6, composer - 1), 'older rows stay as they were');

  advance(FRAME_MS * 2);
  const rising = ui.render(120, 40);
  const isNew = value => /Line \d/.test(stripTerminalSequences(value));
  const lowest = rising.findLast(isNew);
  const highest = rising.find(isNew);
  assert.notEqual(lowest, highest, 'several new rows are in sight');
  assert.ok(lowest.startsWith('\x1b[38;2;'), 'the new row nearest the edge is faded');
  assert.equal(visibleWidth(lowest), visibleWidth(stripTerminalSequences(lowest)));
  assert.ok(!highest.startsWith('\x1b[38;2;'), 'a new row that has climbed clear is not');
  const older = rising.find(value => stripTerminalSequences(value).includes('Message 39'));
  assert.ok(!older.startsWith('\x1b[38;2;'), 'an old row is left alone');
});

test('a terminal without true color still rises, with no fade', t => {
  setTrueColor(t, false);
  const { ui, advance } = driven(t, conversation(40));
  ui.render(120, 40);

  ui.update(chat(oneMore(40, 6)));
  ui.render(120, 40);
  advance(FRAME_MS * 2);

  const lowest = ui.render(120, 40).findLast(value => /Line \d/.test(stripTerminalSequences(value)));
  assert.ok(lowest, 'it has come up');
  assert.doesNotMatch(lowest, /\x1b\[38;2;/);
});

test('through the real screen a slide is a run of synchronized frames that goes quiet when it lands', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const terminal = new FakeTerminal();
  let clock = START;
  const ui = startDashboard(chat(conversation(40)), {}, { terminal, now: () => clock });
  t.after(() => ui.stop());
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const wait = async ms => {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      clock += 16;
      t.mock.timers.tick(16);
      await flush();
      await flush();
    }
  };
  await wait(160);
  terminal.writes.length = 0;
  ui.update(chat(oneMore(40, 6)));
  await wait(800);
  const written = terminal.writes.length;
  assert.ok(written >= 4, `${written} frames reached the terminal`);
  for (const frame of terminal.writes) {
    assert.ok(frame.startsWith('\x1b[?2026h') && frame.endsWith('\x1b[?2026l'), 'a frame never tears');
  }
  await wait(800);
  assert.equal(terminal.writes.length, written, 'at rest it writes nothing');
});

test('a dashboard can be started with motion off', t => {
  const terminal = new FakeTerminal();
  const ui = startDashboard(chat(conversation(40)), {}, { terminal, motion: false });
  t.after(() => ui.stop());
  ui.render(60, 18);
  const next = conversation(41);
  ui.update(chat(next));
  const still = createDashboard(chat(next), {});
  t.after(() => still.stop());
  assert.deepEqual(plain(ui.render(60, 18)).slice(4, 8), plain(still.render(60, 18)).slice(4, 8));
});
