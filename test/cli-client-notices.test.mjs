import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { postClientNotice } from '../src/cli/client-notices.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { fakePi } from './helpers/pi-session.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-client-notices-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePi(root);
  const runHarness = async () => { throw Error('No agent runs in this test.'); };
  const openApp = () => HobkinApplication.open(root, { createMain: fake.createMain, runHarness, now: () => Date.parse('2026-11-12T15:00:00Z') });
  return { root, openApp };
}

const ready = {
  key: 'review-ready:change:shop:4c9e21@4c9e21aa',
  line: 'The change review of "Round the total" in shop is ready: high risk.',
  tone: 'useful',
  review: 'change:shop:4c9e21',
};
const clientLines = view => view.messages.filter(({ id }) => id?.startsWith('notice:client:'));

test('a line the client app posts comes up once in Chat as hobkin\'s own notice, and no model hears it', async t => {
  const h = fixture(t);
  assert.equal(postClientNotice(h.root, ready, Date.parse('2026-11-12T14:59:00Z')), true);
  assert.equal(postClientNotice(h.root, ready), false, 'the same news posted again adds nothing');

  let app = await h.openApp();
  try {
    const sent = t.mock.method(app.runtime, 'send');
    const lines = clientLines(await app.refresh());
    assert.deepEqual(lines, [{ id: `notice:client:${ready.key}`, role: 'notice', content: ready.line, tone: 'useful', review: 'change:shop:4c9e21', at: '2026-11-12T14:59:00.000Z' }]);
    assert.equal(clientLines(await app.refresh()).length, 1);
    assert.equal(sent.mock.calls.length, 0, 'posting it takes no turn of the main agent');
  } finally {
    await app.close();
  }

  // It stays in the saved chat after a restart, and a restart that lost the saved chat does not post it again.
  app = await h.openApp();
  try {
    assert.equal(clientLines(await app.refresh()).length, 1);
  } finally {
    await app.close();
  }
  atomicJson(join(h.root, 'runtime/view.json'), { version: 1, messages: [] });
  app = await h.openApp();
  try {
    assert.equal(clientLines(await app.refresh()).length, 0);
  } finally {
    await app.close();
  }
});

test('a client notice is plain, bounded text with a key of its own, or it is refused', t => {
  const h = fixture(t);
  assert.throws(() => postClientNotice(h.root, { ...ready, key: 'two words' }), /key/);
  assert.throws(() => postClientNotice(h.root, { ...ready, key: 'blank', line: ' \u0007 ' }), /line/);
  assert.equal(postClientNotice(h.root, { key: 'long', line: `${'x'.repeat(700)}\u0000`, tone: 'loud' }), true);
});
