import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize, setTelemetryUpload, telemetryUploadEnabled } from '../src/cli/config.mjs';
import { recordEvent } from '../src/cli/events.mjs';
import { deliverFeedback, draftFromChat, sendApproved } from '../src/cli/feedback/outbox.mjs';
import { credentialsFile, enroll, enrollment } from '../src/cli/remote/credentials.mjs';
import { isRealHome } from '../src/cli/remote/real-home.mjs';
import { sendTelemetry } from '../src/cli/telemetry/sender.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { fakeServer, provision, reply } from './fixtures/hobkin-api/fake-server.mjs';

const NOW = Date.parse('2026-11-05T12:00:00Z');
// What the server issues to a new installation. None of it is a live credential.
const ISSUED = Object.freeze({
  installation_id: '33333333-3333-4333-8333-333333333333',
  key_id: '44444444-4444-4444-8444-444444444444',
  secret: 'ab'.repeat(32),
});

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-real-home-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  atomicJson(join(root, 'config.json'), { ...config, main: { ...config.main, model: 'fixture/local' }, background: { ...config.background, model: 'fixture/check' } });
  return root;
}

/** Stands in for the real fetch, and keeps every URL anything reached for with it. */
function replaceGlobalFetch(t, fetch = async () => { throw Error('A test home reached for the network.'); }) {
  const reached = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    reached.push(String(url));
    return fetch(url, init);
  };
  t.after(() => { globalThis.fetch = original; });
  return reached;
}

function nameHobkinHome(t, root) {
  const original = process.env.HOBKIN_HOME;
  process.env.HOBKIN_HOME = root;
  t.after(() => {
    if (original === undefined) delete process.env.HOBKIN_HOME;
    else process.env.HOBKIN_HOME = original;
  });
}

test('the real home is ~/.hobkin or the folder HOBKIN_HOME names, by real path, and a link to it counts', t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-real-home-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const userHome = join(base, 'user');
  const dotHobkin = join(userHome, '.hobkin');
  const named = join(base, 'named');
  const other = join(base, 'other');
  for (const folder of [dotHobkin, named, other]) mkdirSync(folder, { recursive: true });
  symlinkSync(dotHobkin, join(base, 'to-dot-hobkin'));
  symlinkSync(named, join(base, 'to-named'));
  const none = { env: {}, userHome };
  const naming = { env: { HOBKIN_HOME: named }, userHome };

  assert.equal(isRealHome(dotHobkin, none), true);
  assert.equal(isRealHome(join(base, 'to-dot-hobkin'), none), true, 'a link to ~/.hobkin');
  assert.equal(isRealHome(dotHobkin, naming), true, '~/.hobkin stays real while HOBKIN_HOME names another folder');
  assert.equal(isRealHome(named, naming), true);
  assert.equal(isRealHome(join(base, 'to-named'), naming), true, 'a link to the folder HOBKIN_HOME names');
  assert.equal(isRealHome(named, { env: { HOBKIN_HOME: join(base, 'to-named') }, userHome }), true, 'HOBKIN_HOME naming a link');
  assert.equal(isRealHome(named, none), false);
  assert.equal(isRealHome(other, naming), false);
  assert.equal(isRealHome(join(dotHobkin, 'runtime'), none), false, 'a folder inside the real home is not a home');

  const upgraded = id => join(id, 'migration', '5f0c2b8e-1d2a-4c4e-9a51-2f6a8c1d0e3b', 'data');
  mkdirSync(upgraded(dotHobkin), { recursive: true });
  mkdirSync(upgraded(other), { recursive: true });
  assert.equal(isRealHome(upgraded(dotHobkin), none), true, "the real home's data after an upgrade in place");
  assert.equal(isRealHome(upgraded(other), naming), false);
});

test('a test home the application opens with uploads on never enrolls, and nothing reaches the network', async t => {
  const root = home(t);
  const reached = replaceGlobalFetch(t);
  // The user said yes, so only the guard on test homes stands between it and the network.
  setTelemetryUpload(root, true);
  assert.equal(telemetryUploadEnabled(root), true);

  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 3600000 });
  await app.remote.busy;
  await app.remote.pass();
  await app.close();

  assert.deepEqual(reached, []);
  assert.equal(existsSync(credentialsFile(root)), false);
  assert.equal(await enroll(root), false);
  assert.equal(await enroll(root, { fetch: globalThis.fetch }), false, 'handing over the real fetch is not a fetch of its own');
  assert.deepEqual(reached, []);
});

test('a test home holding a key sends no usage and no feedback through the real fetch', async t => {
  const root = home(t);
  provision(root);
  const reached = replaceGlobalFetch(t);
  const options = { now: () => NOW, sleep: async () => {} };

  // The first pass only marks where upload begins, so the event recorded after it is what would go.
  await sendTelemetry(root, options);
  recordEvent(root, 'app_opened', {}, NOW);
  assert.deepEqual(await sendTelemetry(root, options), { sent: 0 });
  assert.deepEqual(await sendTelemetry(root, { ...options, fetch: globalThis.fetch }), { sent: 0 });

  const draft = draftFromChat(root, 'The report list froze', { now: () => NOW });
  assert.equal((await sendApproved(root, draft, options)).ok, false);
  assert.deepEqual(await deliverFeedback(root, options), []);

  assert.deepEqual(reached, []);
});

test('the real home enrolls with hobkin\'s server through the real fetch', async t => {
  const root = home(t);
  nameHobkinHome(t, root);
  setTelemetryUpload(root, true);
  const reached = replaceGlobalFetch(t, fakeServer(reply(201, ISSUED)).fetch);

  await sendTelemetry(root, { now: () => NOW, sleep: async () => {} });

  assert.deepEqual(reached, ['https://api.hobkin.dev/api/v1/enrollments']);
  assert.deepEqual(enrollment(root), { enrolled: true, sendsTo: 'https://api.hobkin.dev' });
});
