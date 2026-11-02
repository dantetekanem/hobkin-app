import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentMood, Moods } from '../src/cli/mood.mjs';
import { createDashboard } from '../src/cli/ui.mjs';

function fixture() {
  const h = { clock: 100000 };
  h.moods = new Moods({ now: () => h.clock });
  return h;
}

const view = (patch = {}) => ({ messages: [], runs: [], busy: false, ...patch });
const report = (tone, id = 'one') => ({ messages: [{ id, role: 'notice', content: 'Email follow-ups: two replies are due.', tone }] });

test('a face gone quiet wakes when the user types, and a passing reaction plays out', () => {
  const asleep = { mood: 'sleepy', lasting: true, until: Number.MAX_SAFE_INTEGER };
  const pleased = { mood: 'happy', until: 2000 };

  assert.equal(currentMood({ reaction: asleep, now: 1000 }), 'sleepy');
  assert.equal(currentMood({ reaction: asleep, typing: true, now: 1000 }), 'listening');
  assert.equal(currentMood({ reaction: pleased, typing: true, now: 1000 }), 'happy');
});

test('typing in the composer wakes the face, and clearing it lets it sleep again', () => {
  const asleep = { mood: 'sleepy', lasting: true, until: Number.MAX_SAFE_INTEGER };
  const ui = createDashboard({
    config: { main: {}, background: { harness: 'pi', model: null, effort: 'medium' } },
    counts: { daily: 0, weekly: 0, monthly: 0 },
    schedules: [],
    reports: [],
    messages: [],
    connection: 'connected',
    runs: [],
    usage: null,
    mood: asleep,
  });
  assert.equal(ui.state().mood, 'sleepy');

  ui.input('h');
  assert.equal(ui.state().mood, 'listening');

  ui.input('\x03');
  assert.equal(ui.state().mood, 'sleepy');
  ui.stop();
});

test('a good report makes hobkin happy, and that steps aside for real work', () => {
  const h = fixture();
  h.moods.observe(view());

  h.moods.observe(view(report('useful')));

  assert.equal(h.moods.reaction.mood, 'happy');
  assert.equal(h.moods.reaction.yields, true);
});

test('a request for more tokens is no reason to look happy', () => {
  const h = fixture();
  h.moods.observe(view());

  h.moods.observe(view({ messages: [{ id: 'notice:work-allowance:2026', role: 'notice', content: 'Work mode paused.', tone: 'useful' }] }));

  assert.equal(h.moods.reaction, null);
});

test('a reaction wears off', () => {
  const h = fixture();
  h.moods.observe(view());
  h.moods.observe(view(report('useful')));

  assert.ok(h.moods.reaction.until > h.clock);
  assert.ok(h.moods.reaction.until - h.clock <= 60000);
});
