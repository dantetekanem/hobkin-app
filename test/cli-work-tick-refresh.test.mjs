import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { initialize } from '../src/cli/config.mjs';
import { fileDecision } from '../src/cli/decisions.mjs';
import { chooseProject, fileItem, writeMode } from '../src/cli/work/store.mjs';
import { repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:30.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

// A bare application over a real home with one chosen project, as cli-tick-signature.test.mjs builds one. The director is a stand-in whose
// running agent's counts the test moves, as its meter does when the agent's session file grows. Every rebuild asked for is counted.
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-work-tick-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  chooseProject(root, repository(base, 'api'), 'important', NOW);
  writeMode(root, { enabled: true });
  const clock = { now: NOW };
  const running = [{ id: 'work:api:do:one', slug: 'api', lane: 'do', kind: 'do', level: 'important', title: 'Fix it', tokens: 1000, cached: 5000, estimate: { fresh: 100000 }, startedAt: new Date(NOW).toISOString() }];
  const app = new HobkinApplication();
  const published = [];
  let rebuilds = 0;
  app.now = () => clock.now;
  app.runtime = { directory: root };
  app.moods = { notice() {} };
  app.learner = { enabled: () => false };
  app.director = { tick: async () => {}, outlook: () => ({ now: clock.now, running: running.map(run => ({ ...run })) }), running: () => [] };
  app.snapshot = { messages: [] };
  app.onChange = snapshot => published.push(snapshot);
  app.requestRefresh = () => { rebuilds += 1; };
  const tick = async (after = SECOND) => {
    clock.now += after;
    await app.tickWork();
    return rebuilds;
  };
  const grow = () => { running[0].tokens += 1500; running[0].cached += 40000; };
  return { root, app, running, published, tick, grow };
}

test('a tick where only a work session grew publishes its tokens and rebuilds nothing', async t => {
  const h = fixture(t);
  assert.equal(await h.tick(0), 1, 'the first tick rebuilds');
  h.grow();
  assert.equal(await h.tick(), 1);
  h.grow();
  assert.equal(await h.tick(), 1);
  assert.equal(h.published.length, 2, 'each grown tick publishes once');
  const { work } = h.published.at(-1);
  assert.equal(work.running[0].tokens, 4000);
  assert.equal(work.running[0].cached, 85000);
  assert.equal(work.discovering, false, 'it is the same view a rebuild shows');
  assert.equal(h.app.snapshot.work, work);
  assert.equal(await h.tick(), 1, 'nothing new, nothing published');
  assert.equal(h.published.length, 2);
});

test('a filed item, a decision, a pause notice, a finished run and a new minute each still rebuild', async t => {
  const h = fixture(t);
  assert.equal(await h.tick(0), 1);
  h.grow();
  fileItem(h.root, 'api', { key: 'bug', kind: 'fix', title: 'A new bug', brief: 'Found while working.' }, NOW);
  assert.equal(await h.tick(), 2, 'a filed item, with tokens grown too');
  fileDecision(h.root, { from: 'work', question: 'Merge it?', choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }, NOW);
  assert.equal(await h.tick(), 3, 'a decision');
  h.grow();
  writeMode(h.root, { pausedAt: new Date(NOW).toISOString(), pauseNotice: { id: 'hand', at: new Date(NOW).toISOString(), line: 'Paused by hand.', tone: 'quiet' } });
  assert.equal(await h.tick(), 4, 'a pause and its notice');
  h.running.pop();
  assert.equal(await h.tick(), 5, 'a run that finished');
  assert.equal(await h.tick(MINUTE), 6, 'a new minute');
  assert.equal(h.published.length, 0, 'every one of them went as a rebuild');
});
