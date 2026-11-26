import assert from 'node:assert/strict';
import test from 'node:test';
import { MAIN_PULSE_KEY, createPulses, createPulseWire, feedPiEvent } from '../src/cli/pulse.mjs';

const assistant = { role: 'assistant' };
const update = (type, delta) => ({ type: 'message_update', message: assistant, assistantMessageEvent: { type, delta } });

test('a run begins with the prompt estimate, the arrow up and the phase working', () => {
  const pulses = createPulses();
  pulses.begin(MAIN_PULSE_KEY, 1000, 'abcdefghi');
  assert.deepEqual(pulses.get(MAIN_PULSE_KEY), { startedAt: 1000, lastTokenAt: 1000, phase: 'working', direction: 'up', tokens: 3 });
  pulses.begin('run-2', 5, undefined);
  assert.equal(pulses.get('run-2').tokens, 0);
});

test('a request sets the arrow up and counts as token activity', () => {
  const pulses = createPulses();
  pulses.begin('r', 0, '');
  pulses.arrive('r', 10, { delta: 'abcd' });
  pulses.requestSent('r', 50);
  assert.deepEqual(pulses.get('r'), { startedAt: 0, lastTokenAt: 50, phase: 'working', direction: 'up', tokens: 1 });
});

test('arriving text turns the arrow down and adds the delta estimate', () => {
  const pulses = createPulses();
  pulses.begin('r', 0, 'abcd');
  pulses.arrive('r', 20, { phase: 'thinking', delta: 'abcde' });
  assert.deepEqual(pulses.get('r'), { startedAt: 0, lastTokenAt: 20, phase: 'thinking', direction: 'down', tokens: 3 });
  pulses.arrive('r', 30, { phase: 'working', delta: '' });
  assert.equal(pulses.get('r').phase, 'working');
  assert.equal(pulses.get('r').lastTokenAt, 20);
});

test('a message end takes the larger of the estimate and the reported count', () => {
  const pulses = createPulses();
  pulses.begin('r', 0, '');
  pulses.messageStarted('r');
  pulses.arrive('r', 1, { delta: 'a'.repeat(40) });
  pulses.messageEnded('r', 2, 25);
  assert.equal(pulses.get('r').tokens, 25);
  pulses.messageStarted('r');
  pulses.arrive('r', 3, { delta: 'a'.repeat(40) });
  pulses.messageEnded('r', 4, 5);
  assert.equal(pulses.get('r').tokens, 35);
  pulses.messageStarted('r');
  pulses.messageEnded('r', 5, undefined);
  assert.equal(pulses.get('r').tokens, 35);
});

test('a tool start sets the phase to working and is not token activity', () => {
  const pulses = createPulses();
  pulses.begin('r', 0, '');
  pulses.arrive('r', 5, { phase: 'thinking', delta: 'abcd' });
  pulses.toolStarted('r');
  assert.equal(pulses.get('r').phase, 'working');
  assert.equal(pulses.get('r').lastTokenAt, 5);
});

test('the count never goes down when a new message starts', () => {
  const pulses = createPulses();
  pulses.begin('r', 0, '');
  pulses.arrive('r', 1, { delta: 'a'.repeat(20) });
  pulses.messageStarted('r');
  assert.equal(pulses.get('r').tokens, 5);
});

test('a run that ends has no pulse, and events for an unknown run are ignored', () => {
  const pulses = createPulses();
  pulses.begin('r', 0, '');
  pulses.end('r');
  assert.equal(pulses.get('r'), undefined);
  pulses.arrive('r', 1, { delta: 'abcd' });
  pulses.toolStarted('r');
  assert.deepEqual(pulses.all(), {});
});

test('the Pi adapter follows the raw events of a run', () => {
  const pulses = createPulses();
  const feed = (event, now) => feedPiEvent(pulses, 'r', event, now, 'abcdefgh');
  feed({ type: 'agent_start' }, 100);
  assert.deepEqual(pulses.get('r'), { startedAt: 100, lastTokenAt: 100, phase: 'working', direction: 'up', tokens: 2 });
  feed({ type: 'turn_start' }, 110);
  assert.equal(pulses.get('r').lastTokenAt, 110);
  feed({ type: 'message_start', message: assistant }, 120);
  feed(update('thinking_delta', 'abcdabcd'), 130);
  assert.deepEqual(pulses.get('r'), { startedAt: 100, lastTokenAt: 130, phase: 'thinking', direction: 'down', tokens: 4 });
  feed(update('text_delta', 'abcd'), 140);
  assert.equal(pulses.get('r').phase, 'working');
  assert.equal(pulses.get('r').tokens, 5);
  feed({ type: 'message_end', message: { role: 'assistant', usage: { output: 9 } } }, 150);
  assert.equal(pulses.get('r').tokens, 2 + 9);
  feed({ type: 'tool_execution_start' }, 160);
  assert.equal(pulses.get('r').lastTokenAt, 150);
  feed({ type: 'agent_end' }, 170);
  assert.equal(pulses.get('r'), undefined);
});

test('the Pi adapter ignores messages that are not the assistant', () => {
  const pulses = createPulses();
  feedPiEvent(pulses, 'r', { type: 'agent_start' }, 0);
  feedPiEvent(pulses, 'r', { type: 'message_update', message: { role: 'user' }, assistantMessageEvent: { type: 'text_delta', delta: 'abcd' } }, 5);
  assert.equal(pulses.get('r').tokens, 0);
});

test('the Pi adapter reads an update in its wire form, which leaves the message out', () => {
  const pulses = createPulses();
  feedPiEvent(pulses, 'r', { type: 'agent_start' }, 0);
  feedPiEvent(pulses, 'r', { type: 'message_update', usage: { output: 1 }, assistantMessageEvent: { type: 'thinking_delta', delta: 'abcdabcd' } }, 5);
  assert.deepEqual(pulses.get('r'), { startedAt: 0, lastTokenAt: 5, phase: 'thinking', direction: 'down', tokens: 2 });
});

test("a run's first user message is its prompt, and the messages after it are not", () => {
  const pulses = createPulses();
  const said = (key, content) => feedPiEvent(pulses, key, { type: 'message_end', message: { role: 'user', content } }, 1);
  feedPiEvent(pulses, 'r', { type: 'agent_start' }, 0);
  said('r', 'abcdefgh');
  assert.equal(pulses.get('r').tokens, 2);
  said('r', 'a'.repeat(40));
  assert.equal(pulses.get('r').tokens, 2);

  pulses.begin(MAIN_PULSE_KEY, 0, 'abcdefgh');
  said(MAIN_PULSE_KEY, [{ type: 'text', text: 'abcdefgh' }, { type: 'image', data: 'x'.repeat(400) }]);
  assert.equal(pulses.get(MAIN_PULSE_KEY).tokens, 2, 'the prompt given at the start counts once, and an image not at all');
});

test("a retry goes on with the run's pulse, and only the run's own end ends it", () => {
  const pulses = createPulses();
  const feed = (event, now) => feedPiEvent(pulses, 'r', event, now);
  feed({ type: 'agent_start' }, 0);
  feed(update('text_delta', 'abcdabcd'), 10);
  feed({ type: 'agent_end', willRetry: true }, 20);
  feed({ type: 'agent_start' }, 30);
  assert.deepEqual(pulses.get('r'), { startedAt: 0, lastTokenAt: 10, phase: 'working', direction: 'down', tokens: 2 });
  feed({ type: 'agent_end', willRetry: false }, 40);
  assert.equal(pulses.get('r'), undefined);
  feed({ type: 'agent_start' }, 50);
  assert.equal(pulses.get('r').startedAt, 50);
});

test("a reply that comes in parts counts once, and the provider's count for it takes their place when it is more", () => {
  const pulses = createPulses();
  const feed = (event, now) => feedPiEvent(pulses, 'r', event, now);
  const replyEnded = (output, now) => feed({ type: 'turn_end', message: { role: 'assistant', usage: { output } } }, now);
  // A Claude Code reply as the host gives it: its thinking, then its words as a message of their own.
  feed({ type: 'agent_start' }, 0);
  feed({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'abcdefgh' }] } }, 0);
  feed({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } }, 5);
  assert.equal(pulses.get('r').phase, 'thinking');
  feed({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'a'.repeat(40) } }, 10);
  feed({ type: 'message_start', message: assistant }, 20);
  feed({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'b'.repeat(20) } }, 30);
  feed({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'b'.repeat(20) }] } }, 40);
  assert.equal(pulses.get('r').tokens, 2 + 10 + 5);
  replyEnded(25, 50);
  assert.deepEqual(pulses.get('r'), { startedAt: 0, lastTokenAt: 50, phase: 'working', direction: 'down', tokens: 2 + 25 });
  feed({ type: 'tool_execution_start' }, 60);
  feed({ type: 'turn_start' }, 70);
  assert.equal(pulses.get('r').direction, 'up');
  feed({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: 'c'.repeat(8) } }, 80);
  replyEnded(1, 90);
  assert.deepEqual(pulses.get('r'), { startedAt: 0, lastTokenAt: 80, phase: 'working', direction: 'down', tokens: 2 + 25 + 2 });

  // Pi's own turn end carries the message its message end already counted.
  feed({ type: 'turn_start' }, 100);
  feed({ type: 'message_start', message: assistant }, 110);
  feed(update('text_delta', 'abcd'), 120);
  feed({ type: 'message_end', message: { role: 'assistant', usage: { output: 9 } } }, 130);
  replyEnded(9, 140);
  assert.equal(pulses.get('r').tokens, 2 + 25 + 2 + 9);
  assert.equal(pulses.get('r').lastTokenAt, 130);
});

test('the wire says when a change it held back may go out, and nothing once it holds none', () => {
  const pulses = createPulses();
  const wire = createPulseWire();
  pulses.begin('r', 0, '');
  wire.publish(pulses, 0);
  assert.equal(wire.heldUntil(), undefined);
  pulses.arrive('r', 300, { delta: 'abcd' });
  wire.publish(pulses, 300);
  assert.equal(wire.heldUntil(), 1000);
  pulses.begin('s', 400, '');
  wire.publish(pulses, 400);
  assert.equal(wire.heldUntil(), 1000, 'a new run shows at once and holds nothing back');
  assert.equal(wire.publish(pulses, 1000).r.tokens, 1);
  assert.equal(wire.heldUntil(), undefined);
});

test('the wire shows a new run at once and drops an ended run at once', () => {
  const pulses = createPulses();
  const wire = createPulseWire();
  assert.deepEqual(wire.publish(pulses, 0), {});
  pulses.begin('r', 0, 'abcd');
  assert.deepEqual(wire.publish(pulses, 0).r, pulses.get('r'));
  pulses.end('r');
  assert.deepEqual(wire.publish(pulses, 1), {});
});

test('the wire changes one run at most once a second and publishes the newest state then', () => {
  const pulses = createPulses();
  const wire = createPulseWire();
  pulses.begin('r', 0, '');
  const first = wire.publish(pulses, 0).r;
  pulses.arrive('r', 300, { delta: 'abcd' });
  assert.deepEqual(wire.publish(pulses, 300).r, first);
  pulses.arrive('r', 700, { delta: 'abcdabcd' });
  assert.deepEqual(wire.publish(pulses, 999).r, first);
  const second = wire.publish(pulses, 1000).r;
  assert.equal(second.tokens, 3);
  assert.equal(second.lastTokenAt, 700);
  pulses.arrive('r', 1100, { delta: 'abcd' });
  assert.deepEqual(wire.publish(pulses, 1500).r, second);
  assert.equal(wire.publish(pulses, 2000).r.tokens, 4);
});

test('the wire keeps each run on its own second', () => {
  const pulses = createPulses();
  const wire = createPulseWire();
  pulses.begin('a', 0, '');
  wire.publish(pulses, 0);
  pulses.begin('b', 600, '');
  pulses.arrive('a', 700, { delta: 'abcd' });
  pulses.arrive('b', 700, { delta: 'abcd' });
  const shown = wire.publish(pulses, 700);
  assert.equal(shown.b.tokens, 1);
  assert.equal(shown.a.tokens, 0);
});
