import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { triggerRow } from '../src/cli/work/controls.mjs';
import { planWork, rowWait } from '../src/cli/work/plan.mjs';
import { chooseProject, fileItem, paths, pickNext, pickNow, readMode, recordTokens, setProjectPaused, skipInQueue, writeMode, writeState } from '../src/cli/work/store.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { repository, writeJson } from './helpers/work-fixture.mjs';

// Start now: the user's word to start a queued row at once. With no worker free it goes as one extra worker, it does not wait out the gap between
// starts, and a pause, the budget and every stop still hold it.

const HOUR = 3600000;
const now = new Date(2026, 5, 1, 12).getTime();
const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (title, details = {}) => ({ key: title, kind: 'fix', title, brief, impact: 'high', effort: 'small', ...details });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const titles = h => h.calls.map(call => h.work(call).item.title);

/** Two projects past their study with an item each, and both of the two workers busy elsewhere. */
function bothWorkersBusy(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-start-now-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeMode(root, { enabled: true });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: now + 3 * 24 * HOUR } });
  const keys = {};
  for (const slug of ['api', 'site']) {
    chooseProject(root, `/repos/${slug}`, 'important', now);
    mkdirSync(paths(root, slug).directory, { recursive: true });
    writeFileSync(paths(root, slug).project, '# What it is\n');
    const at = new Date(now).toISOString();
    writeState(root, slug, { lastLensAt: at, lastIdeasAt: at, lastSignalsAt: at });
    keys[slug] = `item:${slug}:${fileItem(root, slug, item(`fix ${slug}`), now).id}`;
  }
  const running = [{ slug: 'one', lane: 'do' }, { slug: 'two', lane: 'do' }];
  return { root, keys, plan: (options = {}) => planWork(root, { now, running, ...options }) };
}

const rowOf = ({ entries }, key) => entries.find(entry => entry.key === key);

test('with no worker free a row started now is next, as one extra worker, while an ordinary pick still waits for a free worker', t => {
  const { root, keys, plan } = bothWorkersBusy(t);

  pickNext(root, keys.api);
  const afterPick = plan();

  assert.equal(afterPick.free, 0);
  assert.equal(afterPick.next, null);
  assert.equal(rowWait(rowOf(afterPick, keys.api), afterPick.free), 'a free worker');

  pickNow(root, keys.site);
  const afterStartNow = plan();

  assert.equal(afterStartNow.next?.key, keys.site, 'it goes ahead of the earlier pick, past the worker ceiling');
  assert.equal(rowWait(afterStartNow.next, afterStartNow.free), null, 'it waits for no worker');
  assert.equal(rowWait(rowOf(afterStartNow, keys.api), afterStartNow.free), 'a free worker', 'the earlier pick still does');
  assert.deepEqual(readMode(root).queueNext, [keys.site, keys.api]);
});

test('a pause, the budget and every stop still hold a row started now, and the gap between starts does not', t => {
  const { root, keys, plan } = bothWorkersBusy(t);
  pickNow(root, keys.site);
  assert.equal(plan().next?.key, keys.site);

  setProjectPaused(root, 'site', true);
  const projectPaused = plan();
  assert.equal(projectPaused.next, null, 'its project paused');
  assert.equal(rowOf(projectPaused, keys.site).waiting, 'paused');
  setProjectPaused(root, 'site', false);

  writeMode(root, { pausedAt: new Date(now).toISOString() });
  assert.equal(plan().next, null, 'a pause by hand');
  writeMode(root, { pausedAt: null });

  const usageLimit = { at: new Date(now).toISOString(), until: new Date(now + HOUR).toISOString(), reason: 'A usage limit.' };
  writeMode(root, { usagePause: usageLimit });
  assert.equal(plan().next, null, 'a usage limit');
  writeMode(root, { usagePause: null });

  writeMode(root, { dailyTokens: 1000000 });
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 1000000 }, now - 2 * HOUR);
  const daySpent = plan();
  assert.equal(daySpent.next, null, 'the day\'s budget');
  assert.equal(rowOf(daySpent, keys.site).waiting, 'over today\'s budget');
  writeMode(root, { dailyTokens: 100000000 });

  assert.equal(plan({ lastStartAt: now - 60000 }).next?.key, keys.site, 'the gap between starts does not hold it');
});

test('the gap between starts still holds every other start, a pick among them, and lets only a row started now through', t => {
  const { root, keys, plan } = bothWorkersBusy(t);
  // One worker is free, so only the gap stands in the way.
  const withAFreeWorker = { running: [{ slug: 'one', lane: 'do' }], lastStartAt: now - 60000 };

  pickNext(root, keys.api);
  assert.equal(plan(withAFreeWorker).next, null, 'a pick waits out the gap');

  pickNow(root, keys.site);
  assert.equal(plan(withAFreeWorker).next?.key, keys.site);
});

test('a row started now and then skipped loses its mark with its pick', t => {
  const { root, keys, plan } = bothWorkersBusy(t);
  pickNow(root, keys.site);
  skipInQueue(root, keys.site);

  assert.deepEqual([readMode(root).queueNext, readMode(root).queueNow], [[], []]);
  assert.equal(plan().next, null);
});

test('start now begins at once as one extra worker, and its mark goes once it starts', async t => {
  const h = director(t);
  const release = Promise.withResolvers();
  h.agent = () => release.promise;
  writeMode(h.root, { agents: 1 });
  studied(h, 'api', 'critical');
  studied(h, 'site', 'casual');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  const key = `item:site:${fileItem(h.root, 'site', item('Fix site'), h.clock).id}`;
  await h.startedRun();

  pickNext(h.root, key);
  await h.director.tick();
  await wait(30);
  assert.deepEqual(titles(h), ['Fix login'], 'a pick waits for a free worker');

  pickNow(h.root, key);
  await h.director.tick();
  while (h.calls.length < 2) await wait(10);
  assert.deepEqual(titles(h), ['Fix login', 'Fix site'], 'one extra worker');
  assert.deepEqual([readMode(h.root).queueNext, readMode(h.root).queueNow], [[], []]);

  release.resolve();
  await h.settled();
});

test('starting a row now says it starts as one extra worker, or what still holds it', async t => {
  const h = director(t);
  // A command reads the real clock and sees the lock an open owner keeps.
  h.clock = Date.now();
  mkdirSync(join(h.root, 'runtime.lock'));
  const release = Promise.withResolvers();
  h.agent = () => release.promise;
  writeMode(h.root, { agents: 1 });
  studied(h, 'api', 'critical');
  studied(h, 'site', 'casual');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  const site = fileItem(h.root, 'site', item('Fix site'), h.clock);
  await h.startedRun();

  const startSiteNow = () => triggerRow(h.root, 'site', site.id, { now: true });

  assert.deepEqual(startSiteNow(), {
    ok: true,
    message: 'Queued "Fix site" on site to start at once. It starts now as one extra worker.',
    key: `item:site:${site.id}`,
  });

  writeMode(h.root, { pausedAt: new Date(h.clock).toISOString() });
  assert.match(startSiteNow().message, /^Queued "Fix site" on site to start at once\. Paused by hand\./);
  writeMode(h.root, { pausedAt: null });

  writeMode(h.root, { dailyTokens: 1000000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock);
  assert.match(startSiteNow().message, /to start at once\. Paused for today/);
  writeMode(h.root, { dailyTokens: 100000000 });

  // "Fix login" has only just started, so any other start waits out the gap.
  writeMode(h.root, { startGapMs: 300000 });
  assert.equal(startSiteNow().message, 'Queued "Fix site" on site to start at once. It starts now as one extra worker.');

  setProjectPaused(h.root, 'site', true);
  assert.match(startSiteNow().message, /to start at once\. For now it is waiting: paused\.$/);

  assert.match(triggerRow(h.root, 'api', 'look').message, /^Queued the look on api to run next\./, 'run next is as it was');

  release.resolve();
  await h.settled();
});

test('the client\'s Start now is hobkin\'s own work action, and it starts the row at once as one extra worker', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-start-now-app-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const repositories = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-start-now-repos-')));
  t.after(() => rmSync(repositories, { recursive: true, force: true }));
  const at = new Date().toISOString();
  const keys = [];
  for (const [slug, level] of [['api', 'critical'], ['site', 'casual']]) {
    chooseProject(root, repository(repositories, slug), level);
    mkdirSync(paths(root, slug).directory, { recursive: true });
    writeFileSync(paths(root, slug).project, '# What it is\n');
    writeState(root, slug, { lastLookAt: at, lastLensAt: at, lastIdeasAt: at, lastSignalsAt: at });
    keys.push(`item:${slug}:${fileItem(root, slug, item(`Fix ${slug}`)).id}`);
  }
  atomicJson(join(root, 'work', 'unmerged.json'), { at, projects: {} });
  // With no reading of the subscription one agent runs at a time.
  writeMode(root, { enabled: true, startGapMs: 0, lastDiscoveryAt: at });

  const started = [];
  const runHarness = request => {
    started.push(JSON.parse(request.prompt).work.item.title);
    return new Promise(resolve => {
      const stop = () => resolve({ status: 'interrupted', error: 'Harness cancelled.' });
      if (request.signal.aborted) stop();
      else request.signal.addEventListener('abort', stop, { once: true });
    });
  };
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, runHarness, intervalMs: 60000 });
  try {
    // The runner's own first tick starts the top of the queue.
    while (!started.length) await wait(10);
    assert.deepEqual(started, ['Fix api']);

    const { message } = await app.workAction('now', keys[1]);
    while (started.length < 2) await wait(10);

    assert.equal(message, 'Queued "Fix site" on site to start at once. It starts now as one extra worker.');
    assert.deepEqual(started, ['Fix api', 'Fix site']);
    assert.deepEqual([readMode(root).queueNext, readMode(root).queueNow], [[], []]);
  } finally {
    await app.close();
  }
});
