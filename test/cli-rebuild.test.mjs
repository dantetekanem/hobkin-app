import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { fakePi } from './helpers/pi-session.mjs';

// A real application on a temporary home with the fake main chat, as cli-application.test.mjs opens one. Its clock does not tick.
async function open(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-rebuild-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 3600000, runHarness: async () => ({ status: 'completed', text: 'Useful: done.', cost: null }) });
  t.after(() => app.close());
  return app;
}

const finished = id => ({
  id, kind: 'background', scheduleId: 'news', title: 'News', harness: 'pi', status: 'completed', startedAt: '2026-01-02T09:00:00.000Z', finishedAt: '2026-01-02T09:05:00.000Z',
  cost: { usd: 0.5, kind: 'estimate', cumulative: true, sessionId: `s-${id}` }, result: { status: 'completed', text: 'Useful: the news.', sessionId: `s-${id}`, freshSession: true, cost: { usd: 0.5, kind: 'estimate', cumulative: true, sessionId: `s-${id}` } },
});

test('a rebuild reads the runtime document once, a commit shows in the next one, and a returned copy can be changed freely', async t => {
  const app = await open(t);
  await app.project();
  const state = t.mock.method(app.runtime, 'state');
  await app.project();
  assert.equal(state.mock.callCount(), 1, 'one read of the document for the whole rebuild');

  // With its evidence already taken, so the rebuild has nothing to collect first.
  await app.runtime.change(document => {
    document.runs.one = finished('one');
    document.evidenceReceipts = { ...document.evidenceReceipts, one: true };
  });
  const shown = await app.project();
  assert.equal(state.mock.callCount(), 2);
  assert.ok(shown.runs.some(run => run.id === 'one'), 'the commit shows in the next rebuild');
  assert.equal(shown.usage.usd, 0.5, 'usage counts the finished run');
  const usageText = JSON.stringify(shown.usage);

  // A caller that edits what a rebuild handed it changes nothing the next rebuild shows.
  shown.runs.length = 0;
  shown.usage.edited = true;
  shown.schedules.push({ id: 'edited' });
  const again = await app.project();
  assert.ok(again.runs.some(run => run.id === 'one'));
  assert.equal(JSON.stringify(again.usage), usageText);
  assert.equal(again.schedules.some(schedule => schedule.id === 'edited'), false);
});

test('a rebuild with nothing committed since the last one collects no evidence and works out the usage ledger once', async t => {
  const app = await open(t);
  await app.runtime.change(document => { document.runs.one = finished('one'); });
  await app.project();
  const collected = t.mock.method(app.delivery, 'collectEvidence');
  const synced = t.mock.method(app.ledger, 'sync');
  await app.project();
  await app.project();
  assert.equal(synced.mock.callCount(), 0, 'the ledger is not worked out again for the same document');
  const evidence = await app.runtime.state();
  assert.equal(evidence.evidenceReceipts.one, true, 'the finished run had its evidence taken');
  assert.ok(collected.mock.callCount() <= 2);

  await app.runtime.change(document => { document.runs.two = finished('two'); });
  await app.project();
  assert.equal(synced.mock.callCount(), 1, 'a commit works it out again');
  assert.equal((await app.runtime.state()).evidenceReceipts.two, true, 'and takes the new run\'s evidence');
});
