import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HobkinApplication } from '../src/cli/application.mjs';
import { CHROME_NOTE } from '../src/cli/chrome.mjs';

const idOf = message => createHash('sha256').update(JSON.stringify(message,
  (_, value) => value?.type === 'image' ? { ...value, data: '' } : value)).digest('hex');
const image = (data = 'aGk=', mimeType = 'image/png') => ({ type: 'image', mimeType, data });
const message = (parts = [image()], extra = {}) => ({ role: 'user', content: parts, ...extra });
const fixture = (messages = [message()]) => {
  const app = new HobkinApplication();
  app.runtime = { main: { sessionId: 'selected-main' }, messages: () => messages };
  app.snapshot = { messages: messages.map(raw => ({ id: idOf(raw), images: 1 })) };
  const request = { sessionId: 'selected-main', messageId: idOf(messages[0]), ordinal: 0 };
  return { app, request };
};

test('returns the selected visible message image in image ordinal order without changing snapshots', () => {
  const { app, request } = fixture([message([{ type: 'text', text: 'photo' }, image(), image('b2s=', 'image/webp')])]);
  const before = JSON.stringify(app.snapshot);
  assert.deepEqual(app.messageImage(request), { mimeType: 'image/png', data: 'aGk=' });
  assert.deepEqual(app.messageImage({ ...request, ordinal: 1 }), { mimeType: 'image/webp', data: 'b2s=' });
  assert.equal(JSON.stringify(app.snapshot), before);
});

test('refuses stale sessions, missing or path-like identities, invalid ordinals and nonvisible messages', () => {
  const { app, request } = fixture();
  for (const change of [{ sessionId: 'old' }, { sessionId: '../selected-main' }, { messageId: '../file' },
    { messageId: '0'.repeat(64) }, { ordinal: -1 }, { ordinal: 0.5 }, { ordinal: '0' }, { ordinal: 1 }]) {
    assert.equal(app.messageImage({ ...request, ...change }), null);
  }
  for (const extra of [{ display: false }, { role: 'toolResult' }, { customType: CHROME_NOTE }]) {
    const hidden = fixture([message([image()], extra)]);
    assert.equal(hidden.app.messageImage(hidden.request), null);
  }
  app.snapshot.messages = [];
  assert.equal(app.messageImage(request), null);
  const old = fixture([message(), ...Array.from({ length: 100 }, (_, timestamp) => message([], { timestamp }))]);
  assert.equal(old.app.messageImage(old.request), null);
});

test('refuses unavailable, unsupported, malformed and oversized data and a session swap during retrieval', () => {
  for (const part of [{ type: 'image' }, image('', 'image/png'), image('aGk=', 'image/svg+xml'),
    image('???='), image('aGl='), image('aGk'), image('aGk=\n'), image(Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'))]) {
    const { app, request } = fixture([message([part])]);
    assert.equal(app.messageImage(request), null);
  }
  const bounded = fixture([message([image(Buffer.alloc(5 * 1024 * 1024).toString('base64'))])]);
  assert.equal(Buffer.from(bounded.app.messageImage(bounded.request).data, 'base64').length, 5 * 1024 * 1024);
  const { app, request } = fixture();
  app.runtime.messages = () => { app.runtime.main = { sessionId: request.sessionId }; return [message()]; };
  assert.equal(app.messageImage(request), null);
});
