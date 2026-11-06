import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { FaceReactions } from '../src/cli/face-reactions.mjs';
import { createDashboard } from '../src/cli/ui.mjs';

const asleep = { mood: 'sleepy', lasting: true, until: Number.MAX_SAFE_INTEGER };

/** A face on a clock that starts at 0, under whatever reaction the app has, counting the wakes the app hears about. */
function face(reaction = null) {
  const h = { clock: 0, reaction, woken: 0 };
  h.face = new FaceReactions({
    now: () => h.clock,
    reaction: () => h.reaction,
    onWake: () => { h.woken += 1; },
  });
  h.mood = () => h.face.shown()?.mood ?? null;
  return h;
}

test('a sleeping face wakes drowsy, stretches, then is awake, and the app hears once that the sleep is over', () => {
  const h = face(asleep);

  const woke = h.face.wake();
  const sequence = [0, 999, 1000, 1900, 3000].map(ms => {
    h.clock = ms;
    return h.mood();
  });

  assert.equal(woke, true);
  assert.deepEqual(sequence, ['focused', 'focused', 'happy', 'hello', null]);
  assert.equal(h.face.current(), null);
  assert.equal(h.face.wake(), false);
  assert.equal(h.woken, 1);

  h.reaction = { ...asleep };
  assert.equal(h.face.wake(), true, 'the room going quiet again is a new sleep');
});

test('only a sleep wakes, and any other reaction of the app passes through', () => {
  const pleased = { mood: 'happy', until: 2000 };
  const h = face(pleased);

  assert.equal(h.face.wake(), false);
  assert.equal(h.face.shown(), null);
  assert.equal(h.face.current(), pleased);
  assert.equal(h.woken, 0);
});

test('a click wakes a sleeping face, then pokes it, more crossly the faster the pokes come, and each poke wears off', () => {
  const h = face(asleep);
  h.face.click();
  h.clock = 500;
  h.face.click();
  assert.equal(h.mood(), 'focused', 'a click while it wakes cuts nothing short');

  h.clock = 3000;
  const poked = [];
  for (let poke = 0; poke < 5; poke++) {
    h.face.click();
    poked.push(h.mood());
    h.clock += 1000;
  }
  assert.deepEqual(poked, ['surprised', 'wink', 'happy', 'grumpy', 'grumpy']);

  h.clock += 400;
  assert.equal(h.mood(), null);

  h.clock += 2500;
  h.face.click();
  assert.equal(h.mood(), 'surprised', 'after a pause the pokes start over');
});

test('the pointer coming onto the face five times in a few seconds makes it dizzy, and slower or sleepy passes do nothing', () => {
  const h = face();
  // Onto the face, a move on it, and off again. Only coming onto it counts.
  const pass = gap => {
    h.clock += gap;
    const reacted = h.face.hover(true);
    h.face.hover(true);
    h.face.hover(false);
    return reacted;
  };
  const passes = (count, gap) => Array.from({ length: count }, () => pass(gap));

  assert.deepEqual(passes(6, 1000), [false, false, false, false, false, false], 'a pass a second is not enough');

  h.clock += 4000;
  assert.deepEqual(passes(5, 500), [false, false, false, false, true]);
  assert.equal(h.mood(), 'dizzy');

  h.clock += 2400;
  assert.equal(h.mood(), null);
  assert.equal(pass(500), false, 'the passes start over after a reaction');

  h.face.click();
  assert.deepEqual(passes(4, 500), [false, false, false, false], 'a poke starts the passes over, so poking and rubbing stay apart');

  h.reaction = asleep;
  assert.deepEqual(passes(5, 100), [false, false, false, false, false], 'a sleeping face does not notice');
});

const room = {
  config: { main: {}, background: { harness: 'pi', model: null, effort: 'medium' } },
  counts: { daily: 0, weekly: 0, monthly: 0 },
  schedules: [],
  reports: [],
  messages: [],
  connection: 'connected',
  runs: [],
  usage: null,
};

// The face fills five rows from the composer's top rule down, from the third column, and the composer runs to its right.
const pointsAround = ui => {
  const rows = ui.render(80, 24).map(row => stripTerminalSequences(row));
  const middleRow = rows.findIndex(row => row.includes('❯')) + 1;
  return { onFace: { x: 7, y: middleRow }, beside: { x: 40, y: middleRow } };
};

test('in the dashboard a click on the face wakes or pokes it, a click beside it is left to the terminal, and no reaction is recorded', () => {
  let clock = 100000;
  const moments = [];
  const recorded = [];
  const handlers = {
    moment: moment => moments.push(moment),
    event: (type, facts) => recorded.push(`${type} ${facts.mood}`),
  };
  const ui = createDashboard({ ...room, mood: asleep }, handlers, { now: () => clock });
  const { onFace, beside } = pointsAround(ui);
  const click = at => ['press', 'click'].map(type => ui.handleMouse({ type, button: 'left', ...at }));

  assert.deepEqual(click(beside), [undefined, undefined]);
  assert.equal(ui.state().mood, 'sleepy');

  assert.deepEqual(click(onFace), [{ handled: true }, { handled: true }]);
  assert.equal(ui.state().mood, 'focused');
  assert.deepEqual(moments, [{ event: 'woken' }]);
  ui.render(80, 24);

  clock += 3000;
  click(onFace);
  assert.equal(ui.state().mood, 'surprised');
  ui.render(80, 24);

  clock += 1400;
  assert.equal(ui.state().mood, 'idle');
  assert.deepEqual(recorded, ['mood_shown sleepy', 'mood_shown idle'], 'only the moods the app gave');
  ui.stop();
});

test('in the dashboard the pointer passing over the face makes it dizzy, and no movement is taken from the terminal', () => {
  let clock = 100000;
  const ui = createDashboard(room, {}, { now: () => clock });
  const { onFace, beside } = pointsAround(ui);
  const move = at => ui.handleMouse({ type: 'move', button: 'none', ...at });

  const results = [];
  for (let pass = 0; pass < 5; pass++) {
    clock += 300;
    results.push(move(onFace), move(beside));
  }

  assert.equal(ui.state().mood, 'dizzy');
  assert.ok(results.every(result => result === undefined));
  ui.stop();
});
