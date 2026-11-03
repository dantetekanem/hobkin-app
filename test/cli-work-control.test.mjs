import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../src/cli/main.mjs';
import { openDiff } from '../src/cli/work/controls.mjs';
import {
  chooseProject, dropProject, fileItem, paths, prFile, proposeProject, readItems, readMode, readProject, readProjects, recordTokens, updateItem, writeMode, writeState,
} from '../src/cli/work/store.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { branched, git, repository } from './helpers/work-fixture.mjs';

const brief = 'Evidence, who benefits, the first change, the proof.';
const item = (title, details = {}) => ({ key: title, kind: 'fix', title, brief, impact: 'high', effort: 'small', ...details });
const proposal = (name, details = {}) => ({ name, path: `/repos/${name}`, level: 'casual', summary: `About ${name}.`, ...details });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const untilAborted = request => new Promise(resolve => {
  if (request.signal.aborted) resolve();
  request.signal.addEventListener('abort', resolve, { once: true });
});

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-work-control-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Everything goes through `main`, the way another process gets it. */
async function hobkin(root, ...args) {
  let text = '';
  const code = await main(['work', ...args, '--home', root], { write: chunk => { text += chunk; } }, { input: Readable.from([]) });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Help is text, not JSON.
  }
  return { code, text, json };
}

async function failure(root, ...args) {
  const { code, json } = await hobkin(root, ...args);
  assert.equal(code, 1, `${args.join(' ')} should fail`);
  assert.equal(json.ok, false);
  return json;
}

async function success(root, ...args) {
  const { code, json } = await hobkin(root, ...args);
  assert.equal(code, 0, json?.message);
  assert.equal(json.ok, true);
  assert.equal(typeof json.message, 'string');
  return json;
}

/** A real director, on today's clock because a command in another process reads the real one, with the lock an open owner keeps. */
function owned(t) {
  const h = director(t);
  h.clock = Date.now();
  mkdirSync(join(h.root, 'runtime.lock'));
  return h;
}

// An item is finished for the plan once it has a PR, so a run started here does not come round again.
const finishes = h => request => {
  const { project, item: filed } = h.work(request);
  if (filed) updateItem(h.root, project.slug, filed.id, { state: 'pr', pr: 'https://example.com/1' });
};

const startedProjects = h => h.calls.map(call => h.work(call).project.slug);

// Reads.

test('status says where work mode stands with nothing running and nothing written', async t => {
  const root = home(t);

  const { code, json } = await hobkin(root, 'status');

  assert.equal(code, 0);
  assert.deepEqual([json.on, json.owner, json.autoPick, json.paused, json.running, json.queued], [false, false, true, false, 0, 0]);
  assert.match(json.next, /work start <folder>/);
  assert.deepEqual(readdirSync(root), [], 'a read leaves nothing behind');
});

test('status gives the tokens, the limits and what comes next', async t => {
  const h = owned(t);
  studied(h, 'api', 'critical');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  writeMode(h.root, { dailyTokens: 120000000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 5000, cached: 900 }, h.clock);

  const { json } = await hobkin(h.root, 'status');

  assert.deepEqual([json.on, json.owner, json.queued, json.running], [true, true, 1, 0]);
  assert.deepEqual(json.tokens, { today: 5000, cached: 900, thisHour: 5000 });
  assert.deepEqual(json.limits, { agents: 2, agentsAllowed: 2, dailyTokens: 120000000, hourShare: 10000000 });
  assert.match(json.next, /api: Fix login/);
});

test('status says when no owner is open, because nothing can start then', async t => {
  const h = owned(t);
  rmSync(join(h.root, 'runtime.lock'), { recursive: true });
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login'), h.clock);

  const { json } = await hobkin(h.root, 'status');

  assert.deepEqual([json.on, json.owner], [true, false]);
  assert.match(json.next, /until the dashboard is open/);
});

test('status says a limit paused it, and why, with its real numbers', async t => {
  const h = owned(t);
  writeMode(h.root, { dailyTokens: 1000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 2000 }, h.clock);

  const { json } = await hobkin(h.root, 'status');

  assert.deepEqual([json.paused, json.pausedBy], [true, 'day']);
  assert.match(json.pauseWhy, /Paused for today: 2k of the 1k daily limit used/);
  assert.equal(json.next, json.pauseWhy);
});

test('projects lists each one with its counts, and --state narrows it', async t => {
  const root = home(t);
  proposeProject(root, proposal('site', { slug: 'the-site' }));
  chooseProject(root, '/repos/api', 'critical');
  fileItem(root, 'api', item('Open one'));
  fileItem(root, 'api', item('Goes first', { kind: 'attention' }));
  const shipped = fileItem(root, 'api', item('Shipped'));
  updateItem(root, 'api', shipped.id, { state: 'pr', pr: 'https://example.com/1' });
  const finished = fileItem(root, 'api', item('Finished'));
  updateItem(root, 'api', finished.id, { state: 'branch', branch: 'hobkin/finished', left: 'Deploy it.' });
  writeState(root, 'api', { lastLensAt: '2026-01-01T00:00:00.000Z' });

  const { json } = await hobkin(root, 'projects');

  assert.deepEqual(json.map(({ name, slug, state }) => [name, slug, state]), [['api', 'api', 'chosen'], ['site', 'the-site', 'proposed']]);
  assert.deepEqual(json[0], {
    name: 'api', slug: 'api', level: 'critical', priority: 'P0', prMode: 'off', state: 'chosen', path: '/repos/api', paused: false, open: 2, merged: 0, prs: 1, branches: 1, left: 1, nextLookAt: '2026-01-01T01:00:00.000Z',
  });
  assert.deepEqual((await hobkin(root, 'projects', '--state', 'proposed')).json.map(({ slug }) => slug), ['the-site']);
  assert.match((await failure(root, 'projects', '--state', 'lost')).message, /chosen, proposed, skipped/);
});

test('projects go by priority, then by name', async t => {
  const root = home(t);
  chooseProject(root, '/repos/zeta', 'important');
  chooseProject(root, '/repos/alpha', 'important');
  chooseProject(root, '/repos/site', 'casual');
  chooseProject(root, '/repos/billing', 'critical');

  assert.deepEqual((await hobkin(root, 'projects')).json.map(({ slug, priority }) => [slug, priority]), [['billing', 'P0'], ['alpha', 'P1'], ['zeta', 'P1'], ['site', 'P2']]);
});

test('running names each agent from another process', async t => {
  const h = owned(t);
  studied(h, 'api', 'max');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  const release = Promise.withResolvers();
  let opened = false;
  h.director.panes = {
    run: async () => {
      opened = true;
      await release.promise;
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
  };

  await h.director.tick();
  while (!opened) await wait(10);

  const { json } = await hobkin(h.root, 'running');

  assert.equal(json.length, 1);
  const [run] = json;
  assert.match(run.id, /^work:api:do:/);
  assert.deepEqual([run.project, run.slug, run.item, run.lane, run.level, run.harness, run.pane], ['api', 'api', filed.id, 'do', 'max', 'claude', 'work-do-api']);
  assert.ok(run.seconds >= 0 && run.seconds < 60);
  assert.equal((await hobkin(h.root, 'status')).json.running, 1);

  release.resolve();
  await h.settled();
  assert.deepEqual((await hobkin(h.root, 'running')).json, []);
});

test('a run outside a pane has no pane to name, and runs on Pi', async t => {
  const h = owned(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();

  const { json: [run] } = await hobkin(h.root, 'running');

  assert.deepEqual([run.harness, run.pane, run.level], ['pi', null, 'important']);
  await hobkin(h.root, 'cancel', 'api');
  await h.tick();
});

test('nothing counts as running once the owner is gone, whatever it left behind', async t => {
  const h = owned(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  assert.equal((await hobkin(h.root, 'running')).json.length, 1);

  const longAgo = new Date(Date.now() - 2 * 60000);
  utimesSync(join(h.root, 'runtime.lock'), longAgo, longAgo);

  assert.deepEqual((await hobkin(h.root, 'running')).json, []);
  const { json } = await hobkin(h.root, 'status');
  assert.deepEqual([json.owner, json.running], [false, 0]);

  rmSync(join(h.root, 'runtime.lock'), { recursive: true });
  mkdirSync(join(h.root, 'runtime.lock'));
  await hobkin(h.root, 'cancel', 'api');
  await h.tick();
});

test('queue gives the plan in order, with the key, the item, the grade, why and what each row waits on', async t => {
  const h = owned(t);
  studied(h, 'api', 'critical');
  studied(h, 'site', 'casual');
  const first = fileItem(h.root, 'api', item('Fix login'), h.clock);
  const second = fileItem(h.root, 'site', item('Tidy up', { kind: 'chore', impact: 'low' }), h.clock);
  await hobkin(h.root, 'pause', 'site');

  const { json } = await hobkin(h.root, 'queue');

  assert.deepEqual(json.map(row => [row.key, row.project, row.item, row.level, row.grade, row.why, row.waiting]), [
    [`item:api:${first.id}`, 'api', first.id, 'critical', 'P0', 'critical, high impact, small', null],
    [`item:site:${second.id}`, 'site', second.id, 'casual', 'P3', 'low impact, small', 'paused'],
  ]);
});

test('queue sees what the owner has running, so a full house waits on a free worker', async t => {
  const h = owned(t);
  studied(h, 'api');
  studied(h, 'site');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  fileItem(h.root, 'site', item('Fix site'), h.clock);
  writeMode(h.root, { agents: 1 });
  h.agent = untilAborted;
  await h.startedRun();

  const { json } = await hobkin(h.root, 'queue');

  assert.deepEqual(json.map(row => [row.project, row.waiting]), [['site', 'a free worker']]);
  h.agent = finishes(h);
  await hobkin(h.root, 'cancel', 'api');
  await h.tick();
});

test('items lists every project or one, and --state narrows it', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  chooseProject(root, '/repos/site', 'casual');
  const login = fileItem(root, 'api', item('Fix login'));
  updateItem(root, 'api', login.id, { state: 'pr', pr: 'https://example.com/1', max: true, branch: 'hobkin/login', summary: 'Login works.', proof: 'The test passes.' });
  const broken = fileItem(root, 'site', item('Broken'));
  updateItem(root, 'site', broken.id, { state: 'branch', branch: 'hobkin/broken', left: 'Rotate the token.', attempts: 2, lastError: 'No clone.' });

  const { json } = await hobkin(root, 'items');

  assert.deepEqual(json, [
    {
      project: 'api', slug: 'api', id: login.id, title: 'Fix login', kind: 'fix', state: 'pr', grade: 'P0', level: 'max', pr: 'https://example.com/1',
      branch: 'hobkin/login', summary: 'Login works.', proof: 'The test passes.', left: null, attempts: 0, lastError: null, reason: null,
    },
    {
      project: 'site', slug: 'site', id: broken.id, title: 'Broken', kind: 'fix', state: 'branch', grade: 'P3', level: 'casual', pr: null,
      branch: 'hobkin/broken', summary: null, proof: null, left: 'Rotate the token.', attempts: 2, lastError: 'No clone.', reason: null,
    },
  ]);
  assert.deepEqual((await hobkin(root, 'items', 'site')).json.map(({ id }) => id), [broken.id]);
  assert.deepEqual((await hobkin(root, 'items', '--state', 'branch')).json.map(({ id }) => id), [broken.id]);
  assert.deepEqual((await hobkin(root, 'items', 'api', '--state', 'branch')).json, []);
  assert.match((await failure(root, 'items', 'nowhere')).message, /Unknown project: nowhere/);
  assert.match((await failure(root, 'items', '--state', 'lost')).message, /open, doing/);
});

test('items says why an agent dropped one', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  const filed = fileItem(root, 'api', item('Gone already'));
  updateItem(root, 'api', filed.id, { state: 'dropped', reason: 'The last release fixed it.' });

  const { json: [row] } = await hobkin(root, 'items');

  assert.deepEqual([row.state, row.reason], ['dropped', 'The last release fixed it.']);
});

test('pr reads a local PR with its description, and an item names that file once there is one', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  const filed = fileItem(root, 'api', item('Fix login'));
  updateItem(root, 'api', filed.id, { state: 'branch', branch: 'hobkin/login', summary: 'Login works.', proof: 'The test passes.', left: 'Deploy it.' });
  const look = () => hobkin(root, 'pr', 'api', filed.id.slice(0, 4));
  const row = async () => (await hobkin(root, 'items', 'api')).json[0];

  assert.equal((await look()).json.description, null);
  assert.equal((await row()).prFile, undefined);

  const file = prFile(root, 'api', filed.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '# Fix login\n\nWhat changed.\n');

  assert.deepEqual((await look()).json, {
    project: 'api',
    item: filed.id,
    title: 'Fix login',
    state: 'branch',
    branch: 'hobkin/login',
    summary: 'Login works.',
    proof: 'The test passes.',
    left: 'Deploy it.',
    launch: null,
    description: '# Fix login\n\nWhat changed.\n',
  });
  assert.equal((await row()).prFile, file);
  assert.match((await failure(root, 'pr', 'api')).message, /Say which item/);
});

test('status lists the local PRs waiting for review on chosen projects, oldest first', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  chooseProject(root, '/repos/site', 'casual');
  chooseProject(root, '/repos/old', 'casual');
  const first = fileItem(root, 'api', item('First'));
  const second = fileItem(root, 'site', item('Second'));
  const gone = fileItem(root, 'old', item('On a dropped project'));
  fileItem(root, 'api', item('Still open'));
  updateItem(root, 'api', first.id, { state: 'branch', branch: 'hobkin/first', summary: 'The first.', left: 'Deploy it.' }, Date.parse('2026-01-01T00:00:00Z'));
  updateItem(root, 'site', second.id, { state: 'branch', branch: 'hobkin/second' }, Date.parse('2026-01-02T00:00:00Z'));
  updateItem(root, 'old', gone.id, { state: 'branch', branch: 'hobkin/gone' }, Date.parse('2026-01-03T00:00:00Z'));
  dropProject(root, 'old');

  const { json } = await hobkin(root);

  assert.deepEqual(json.ready, [
    { slug: 'api', project: 'api', item: first.id, title: 'First', grade: 'P1', kind: 'fix', branch: 'hobkin/first', head: null, summary: 'The first.', about: 'The first.', proof: null, left: 'Deploy it.', at: '2026-01-01T00:00:00.000Z', behind: null, conflict: null, size: null, safety: null, quality: null, notices: null, launch: null, onlyDocs: false, landedOn: null, gap: 'land', holds: 0, described: false, proved: false, like: null },
    { slug: 'site', project: 'site', item: second.id, title: 'Second', grade: 'P2', kind: 'fix', branch: 'hobkin/second', head: null, summary: null, about: null, proof: null, left: null, at: '2026-01-02T00:00:00.000Z', behind: null, conflict: null, size: null, safety: null, quality: null, notices: null, launch: null, onlyDocs: false, landedOn: null, gap: 'land', holds: 0, described: false, proved: false, like: null },
  ]);
});

test('status keeps the fifty local PRs that have waited longest', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  const day = 86400000;
  for (let index = 0; index < 51; index++) {
    const { id } = fileItem(root, 'api', item(`Item ${index}`));
    updateItem(root, 'api', id, { state: 'branch' }, Date.parse('2026-01-01T00:00:00Z') + index * day);
  }

  const { json: { ready } } = await hobkin(root);

  assert.equal(ready.length, 50);
  assert.deepEqual([ready[0].title, ready.at(-1).title], ['Item 0', 'Item 49']);
});

function localPr(t) {
  const root = home(t);
  const checkout = repository(root, 'api');
  chooseProject(root, checkout, 'important');
  const { id } = fileItem(root, 'api', item('Fix login'));
  updateItem(root, 'api', id, { state: 'branch', branch: 'hobkin/login' });
  return { root, checkout, id };
}

test('a review starts only when asked: the item goes first in the queue, marked for its run', async t => {
  const { root, id } = localPr(t);

  const { message } = await success(root, 'review', 'api', id);

  assert.match(message, /Fix login/);
  const [reviewed] = readItems(root, 'api');
  assert.deepEqual([reviewed.state, reviewed.reviewAsked, reviewed.attempts], ['open', true, 0]);
  assert.deepEqual(readMode(root).queueNext, [`item:api:${id}`]);
});

test('review with nothing named is still the weekly review', async t => {
  const { root } = localPr(t);

  const { code, text } = await hobkin(root, 'review');

  assert.equal(code, 0);
  assert.match(text, /stale/);
  assert.deepEqual(readMode(root).queueNext, []);
});

test('there is nothing to review on an item with no branch, or one that is over', async t => {
  const { root, id } = localPr(t);
  const { id: unstarted } = fileItem(root, 'api', item('Fix billing'));
  assert.match((await failure(root, 'review', 'api', unstarted)).message, /no branch/);

  updateItem(root, 'api', id, { state: 'merged' });
  assert.match((await failure(root, 'review', 'api', id)).message, /merged/);
});

test('a local PR opens its diff against the default branch, in the project\'s own folder', async t => {
  const { root, checkout, id } = localPr(t);
  const opened = [];
  const followed = [];
  const panes = { startDiff: async request => { opened.push(request); return { name: request.name, pane: 'w1:p9' }; } };

  const { ok, range } = await openDiff(root, 'api', id, { panes, follow: session => followed.push(session) });

  assert.equal(ok, true);
  assert.equal(range, 'main...hobkin/login');
  assert.equal(opened[0].cwd, checkout);
  assert.equal(opened[0].range, 'main...hobkin/login');
  assert.deepEqual(followed, [{ name: opened[0].name, pane: 'w1:p9' }], 'something has to close the pane, whatever the user does');
});

test('each diff gets its own agent, because Herdr refuses a name already taken', async t => {
  const { root, id } = localPr(t);
  const names = [];
  const panes = { startDiff: async ({ name }) => { names.push(name); return { name, pane: 'w1:p9' }; } };

  await openDiff(root, 'api', id, { panes, follow: () => {} });
  await openDiff(root, 'api', id, { panes, follow: () => {} });

  assert.notEqual(names[0], names[1]);
  assert.ok(names.every(name => /^[a-z][a-z0-9_-]{0,31}$/.test(name)), names.join());
});

test('outside Herdr there is no pane to open, so a diff says how to get there by hand', async t => {
  const { root, checkout, id } = localPr(t);

  const { message } = await openDiff(root, 'api', id, { panes: null });

  assert.match(message, /\/diff main\.\.\.hobkin\/login/);
  assert.ok(message.includes(checkout.split('/').at(-1)), message);
});

test('an item with no branch has no diff, and says so', async t => {
  const root = home(t);
  chooseProject(root, repository(root, 'api'), 'important');
  const { id } = fileItem(root, 'api', item('Fix login'));

  await assert.rejects(openDiff(root, 'api', id, { panes: null }), /no branch/);
});

test('what a run left for the user stays listed on a done item, until the user marks it done', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  const { id } = fileItem(root, 'api', item('Publish the release'));
  updateItem(root, 'api', id, { state: 'done', summary: 'Nothing to change.', left: 'Publish 0.8.18.' });

  assert.deepEqual((await hobkin(root, 'attention')).json.map(({ reason }) => reason), ['Publish 0.8.18.']);

  await success(root, 'done', 'api', id);
  assert.deepEqual((await hobkin(root, 'attention')).json, []);
});

test('search finds projects and items by name, path, title, summary, what is left or the last error, in plain text', async t => {
  const root = home(t);
  chooseProject(root, '/repos/billing-api', 'important');
  proposeProject(root, proposal('Website', { path: '/elsewhere/www' }));
  const login = fileItem(root, 'billing-api', item('Fix the Login page'));
  const broken = fileItem(root, 'billing-api', item('Update rack'));
  updateItem(root, 'billing-api', broken.id, { lastError: 'The clone is gone.' });
  const tidied = fileItem(root, 'billing-api', item('Tidy up'));
  updateItem(root, 'billing-api', tidied.id, { summary: 'Removed the dead code.', left: 'Rotate the deploy key.' });

  const found = async (...words) => (await hobkin(root, 'search', ...words)).json.map(row => [row.type, row.id ?? row.slug]);

  assert.deepEqual(await found('billing'), [['project', 'billing-api']]);
  assert.deepEqual(await found('website'), [['project', 'website']]);
  assert.deepEqual(await found('/elsewhere'), [['project', 'website']]);
  assert.deepEqual(await found('login'), [['item', login.id]]);
  assert.deepEqual(await found('page', 'LOGIN'), [['item', login.id]], 'every word, in any order and any case');
  assert.deepEqual(await found('clone'), [['item', broken.id]]);
  assert.deepEqual(await found('dead', 'code'), [['item', tidied.id]]);
  assert.deepEqual(await found('deploy', 'key'), [['item', tidied.id]]);
  assert.deepEqual(await found('nothing like this'), []);
  assert.match((await failure(root, 'search')).message, /what to search for/);
});

test('attention lists what is left for the user, and how to answer each', async t => {
  const h = owned(t);
  studied(h, 'api');
  const finished = fileItem(h.root, 'api', item('Rotate the secret', { kind: 'attention' }), h.clock);
  updateItem(h.root, 'api', finished.id, { state: 'branch', left: 'Paste the new secret in the vault.' }, h.clock);
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  proposeProject(h.root, proposal('site'));
  writeMode(h.root, { allowanceRequest: { day: new Date().toDateString(), limit: 100, proposed: 200, reason: 'Paused for today.' } });

  const { json } = await hobkin(h.root, 'attention');

  assert.deepEqual(json.map(row => [row.kind, row.project, row.item]), [
    ['allowance', null, null],
    ['proposal', 'site', null],
    ['item', 'api', finished.id],
  ]);
  assert.match(json[1].answer, /choose site/);
  assert.equal(json[2].reason, 'Paste the new secret in the vault.');
  assert.equal(json[2].answer, `hobkin work done api ${finished.id}, once it is sorted`);
});

test('attention includes what the user paused', async t => {
  const h = owned(t);
  studied(h, 'site');
  await hobkin(h.root, 'pause', 'site');
  await hobkin(h.root, 'pause');

  const { json } = await hobkin(h.root, 'attention');

  assert.deepEqual(json.map(row => [row.kind, row.project]), [['pause', null], ['pause', 'site']]);
});

test('what was left stops asking for the user once its item is merged or dropped', async t => {
  const h = owned(t);
  studied(h, 'api');
  for (const state of ['branch', 'pr', 'merged', 'done', 'dropped']) {
    const filed = fileItem(h.root, 'api', item(state), h.clock);
    updateItem(h.root, 'api', filed.id, { state, left: `Still ${state}.` }, h.clock);
  }

  const { json } = await hobkin(h.root, 'attention');

  assert.deepEqual(json.map(({ reason }) => reason), ['Still branch.', 'Still pr.', 'Still done.']);
  assert.equal((await hobkin(h.root, 'projects')).json[0].left, 3, 'the project counts the same ones');
});

// Controls.

test('start and stop are on and off, and starting ends a pause', async t => {
  const root = home(t);
  assert.match((await failure(root, 'start')).message, /Say which folder/);

  await success(root, 'start', root);
  assert.deepEqual([readMode(root).enabled, readMode(root).folder], [true, root]);
  await success(root, 'pause');
  assert.ok(readMode(root).pausedAt);

  await success(root, 'stop');
  assert.equal(readMode(root).enabled, false);

  await success(root, 'on');
  assert.deepEqual([readMode(root).enabled, readMode(root).pausedAt], [true, null]);
  await success(root, 'off');
  assert.equal(readMode(root).enabled, false);
});

test('pause stops new work everywhere, while work mode stays on and running agents finish', async t => {
  const h = owned(t);
  studied(h, 'api', 'critical');
  studied(h, 'site', 'casual');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  fileItem(h.root, 'site', item('Fix site'), h.clock);
  const release = Promise.withResolvers();
  h.agent = async request => {
    await release.promise;
    finishes(h)(request);
  };
  await h.startedRun();
  assert.deepEqual(startedProjects(h), ['api']);

  await success(h.root, 'pause');
  await h.director.tick();
  await wait(30);

  assert.deepEqual(startedProjects(h), ['api'], 'nothing new starts');
  assert.equal(h.director.running().length, 1, 'what was running keeps running');
  const { json } = await hobkin(h.root, 'status');
  assert.deepEqual([json.on, json.paused, json.pausedBy, json.running], [true, true, 'hand', 1]);
  assert.equal(readMode(h.root).enabled, true);

  release.resolve();
  await h.settled();
  assert.equal(readItems(h.root, 'api')[0].state, 'pr', 'the agent finished its work');

  await h.tick();
  assert.deepEqual(startedProjects(h), ['api']);

  await success(h.root, 'resume');
  await h.tick();
  assert.deepEqual(startedProjects(h), ['api', 'site']);
});

test('pause for one project holds that project alone until it resumes', async t => {
  const h = owned(t);
  studied(h, 'api', 'critical');
  studied(h, 'site', 'casual');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  fileItem(h.root, 'site', item('Fix site'), h.clock);
  h.agent = finishes(h);

  await success(h.root, 'pause', 'api');
  await h.tick();

  assert.deepEqual(startedProjects(h), ['site'], 'the higher project waits and the other carries on');
  const { json: status } = await hobkin(h.root, 'status');
  assert.deepEqual([status.paused, status.pausedProjects], [false, ['api']]);
  const { json: [api] } = await hobkin(h.root, 'projects', '--state', 'chosen');
  assert.deepEqual([api.slug, api.state, api.paused], ['api', 'chosen', true]);

  await success(h.root, 'resume', 'api');
  await h.tick();

  assert.deepEqual(startedProjects(h), ['site', 'api']);
  assert.equal(readProject(h.root, 'api').paused, false);
});

test('resume with nothing paused says so', async t => {
  const h = owned(t);

  assert.match((await success(h.root, 'resume')).message, /Nothing was paused/);
});

test('resume says which pause it cannot end', async t => {
  const h = owned(t);
  writeMode(h.root, { dailyTokens: 1000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 2000 }, h.clock);

  const { message } = await success(h.root, 'resume');

  assert.match(message, /resume does not end this pause. Paused for today/);
});

test('add project takes a real repository by hand, at the level given', async t => {
  const h = owned(t);
  const checkout = repository(h.base, 'api');

  const { slug } = await success(h.root, 'add', 'project', checkout, 'critical');

  assert.equal(slug, 'api');
  assert.deepEqual(readProjects(h.root).map(({ path, level, state }) => [path, level, state]), [[checkout, 'critical', 'chosen']]);
  assert.equal((await hobkin(h.root, 'queue')).json[0].key, 'study:api');
});

test('add project refuses a folder that cannot be worked on, and never replaces a project', async t => {
  const h = owned(t);
  const plain = join(h.base, 'plain');
  mkdirSync(plain);
  mkdirSync(join(h.base, 'other'));
  const elsewhere = repository(join(h.base, 'other'), 'api');
  const checkout = repository(h.base, 'api');
  await success(h.root, 'add', 'project', checkout);

  assert.match((await failure(h.root, 'add', 'project', join(h.base, 'missing'))).message, /Not a folder/);
  assert.match((await failure(h.root, 'add', 'project', plain)).message, /Not a git repository/);
  assert.match((await failure(h.root, 'add', 'project', elsewhere)).message, /already/);
  assert.match((await failure(h.root, 'add', 'project', checkout, 'huge')).message, /level must be one of/);
  assert.deepEqual(readProjects(h.root).map(({ path }) => path), [checkout]);
});

test('add project and choose take a proposal by name, and it keeps what was proposed', async t => {
  const root = home(t);
  proposeProject(root, proposal('api', { first: [item('First thing')] }));
  proposeProject(root, proposal('site'));

  await success(root, 'add', 'project', 'api', 'critical');
  await success(root, 'choose', 'site');

  assert.deepEqual(readProjects(root).map(({ slug, level, state }) => [slug, level, state]), [['api', 'critical', 'chosen'], ['site', 'casual', 'chosen']]);
  assert.deepEqual(readItems(root, 'api').map(({ title }) => title), ['First thing']);
});

test('add item files work by hand, from a title of plain words', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');

  const plain = await success(root, 'add', 'item', 'api', 'Fix', 'the', 'login');
  const briefed = await success(root, 'add', 'item', 'api', 'Tidy the docs', '--brief', '-- only the README');

  const [first, second] = readItems(root, 'api');
  assert.deepEqual([plain.id, first.title, first.brief, first.state], [first.id, 'Fix the login', 'Fix the login', 'open']);
  assert.deepEqual([briefed.id, second.title, second.brief], [second.id, 'Tidy the docs', '-- only the README']);
  assert.equal((await hobkin(root, 'queue')).json.some(row => row.item === first.id), true);
});

test('adding the same title twice files one item, and a dropped one comes back', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  const { id } = await success(root, 'add', 'item', 'api', 'Fix login');

  await success(root, 'add', 'item', 'api', 'Fix login');
  assert.equal(readItems(root, 'api').length, 1);

  await success(root, 'drop', 'api', id);
  assert.equal(readItems(root, 'api')[0].state, 'dropped');

  await success(root, 'add', 'item', 'api', 'Fix login');
  assert.deepEqual(readItems(root, 'api').map(({ state }) => state), ['open']);
});

test('add item needs a title and a known project', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');

  assert.match((await failure(root, 'add', 'item', 'api')).message, /title/);
  assert.match((await failure(root, 'add', 'item', 'nowhere', 'Fix')).message, /Unknown project: nowhere/);
  assert.deepEqual(readItems(root, 'api'), []);
});

test('trigger puts an item first by the start of its id, ahead of the plan and the gap between starts', async t => {
  const h = owned(t);
  studied(h, 'top', 'critical');
  studied(h, 'low', 'casual');
  fileItem(h.root, 'top', item('top fix'), h.clock);
  const low = fileItem(h.root, 'low', item('low fix', { impact: 'low', effort: 'medium' }), h.clock);
  writeMode(h.root, { startGapMs: 300000 });
  h.director.lastStartAt = h.clock - 1000;

  const { key } = await success(h.root, 'trigger', 'low', low.id.slice(0, 4));
  await h.tick();

  assert.equal(key, `item:low:${low.id}`);
  assert.deepEqual(h.calls.map(call => h.work(call).item.title), ['low fix']);
  assert.deepEqual(readMode(h.root).queueNext, []);
});

test('trigger runs a look that is not due, once', async t => {
  const h = owned(t);
  studied(h, 'api');
  await h.tick();
  assert.deepEqual(h.calls, []);

  await success(h.root, 'trigger', 'api', 'look');
  await h.tick();
  await h.tick();

  assert.deepEqual(h.calls.map(({ purpose }) => purpose), ['work-look']);
  assert.equal(h.work(h.calls[0]).focus, 'security');
});

test('trigger runs a fresh study on a project that has one', async t => {
  const h = owned(t);
  studied(h, 'api');

  await success(h.root, 'trigger', 'api', 'study');
  await h.tick();

  assert.equal(h.work(h.calls[0]).focus, 'study');
});

test('trigger with nothing named takes the project\'s own next thing', async t => {
  const h = owned(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  studied(h, 'site');
  chooseProject(h.root, '/repos/unread');

  assert.equal((await success(h.root, 'trigger', 'api')).key, `item:api:${filed.id}`);
  assert.equal((await success(h.root, 'trigger', 'site')).key, 'look:site', 'a look, when nothing else is there');
  assert.equal((await success(h.root, 'trigger', 'unread')).key, 'study:unread');
  assert.equal((await success(h.root, 'trigger', 'unread', 'look')).key, 'study:unread', 'a look comes after its study');
});

test('trigger stays inside the worker ceiling, and says what it waits on', async t => {
  const h = owned(t);
  studied(h, 'api', 'critical');
  studied(h, 'site', 'casual');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  const held = fileItem(h.root, 'site', item('Fix site'), h.clock);
  writeMode(h.root, { agents: 1 });
  h.agent = untilAborted;
  await h.startedRun();

  const { message } = await success(h.root, 'trigger', 'site', held.id);
  await h.director.tick();
  await wait(30);

  assert.match(message, /a free worker/);
  assert.deepEqual(startedProjects(h), ['api']);

  h.agent = finishes(h);
  await hobkin(h.root, 'cancel', 'api');
  await h.ticks(2);
  assert.deepEqual(startedProjects(h), ['api', 'site'], 'it goes once a worker is free');
});

test('trigger stays inside the budget and the stops', async t => {
  const h = owned(t);
  studied(h, 'api', 'critical');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  writeMode(h.root, { dailyTokens: 1000000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000000 }, h.clock);

  const { message } = await success(h.root, 'trigger', 'api', filed.id);
  await h.tick();

  assert.match(message, /Paused for today/);
  assert.deepEqual(h.calls, []);

  writeMode(h.root, { dailyTokens: 100000000, pausedAt: new Date(h.clock).toISOString() });
  assert.match((await success(h.root, 'trigger', 'api', filed.id)).message, /Paused by hand/);
  await h.tick();
  assert.deepEqual(h.calls, []);
});

test('trigger says when work mode is off or nothing is open to run it', async t => {
  const h = owned(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);

  rmSync(join(h.root, 'runtime.lock'), { recursive: true });
  assert.match((await success(h.root, 'trigger', 'api', filed.id)).message, /until the dashboard is open/);

  writeMode(h.root, { enabled: false });
  assert.match((await success(h.root, 'trigger', 'api', filed.id)).message, /work start/);
});

test('trigger runs an attention item, and one an older version left stuck', async t => {
  const h = owned(t);
  studied(h, 'api');
  const asked = fileItem(h.root, 'api', item('Rotate the secret', { kind: 'attention' }), h.clock);
  const stuck = fileItem(h.root, 'api', item('Stuck one'), h.clock);
  updateItem(h.root, 'api', stuck.id, { state: 'stuck', stuckReason: 'The clone is gone.' }, h.clock);

  await success(h.root, 'trigger', 'api', asked.id);
  await success(h.root, 'trigger', 'api', stuck.id);

  assert.deepEqual(readMode(h.root).queueNext, [`item:api:${asked.id}`, `item:api:${stuck.id}`]);
});

test('trigger sends a finished branch back to open and runs it next, on that branch', async t => {
  const h = owned(t);
  const checkout = studied(h, 'api');
  git(checkout, 'branch', 'hobkin/finished');
  const finished = fileItem(h.root, 'api', item('Finished'), h.clock);
  updateItem(h.root, 'api', finished.id, { state: 'branch', branch: 'hobkin/finished', attempts: 2 }, h.clock);

  const { key, message } = await success(h.root, 'trigger', 'api', finished.id);

  assert.equal(key, `item:api:${finished.id}`);
  assert.match(message, /starts on the next tick/);
  assert.deepEqual(readItems(h.root, 'api').map(({ state, attempts }) => [state, attempts]), [['open', 2]]);

  await h.tick();

  assert.equal(h.work(h.calls[0]).item.branch, 'hobkin/finished');
});

test('trigger refuses what cannot run', async t => {
  const h = owned(t);
  studied(h, 'api');
  proposeProject(h.root, proposal('site'));
  const shipped = fileItem(h.root, 'api', item('Shipped'), h.clock);
  updateItem(h.root, 'api', shipped.id, { state: 'pr', pr: 'https://example.com/1' }, h.clock);
  const running = fileItem(h.root, 'api', item('Running'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();

  assert.match((await failure(h.root, 'trigger', 'site')).message, /site is proposed/);
  assert.match((await failure(h.root, 'trigger', 'api', shipped.id)).message, /is pr/);
  assert.match((await failure(h.root, 'trigger', 'api', running.id)).message, /already running/);
  assert.match((await failure(h.root, 'trigger', 'api', 'nothing')).message, /Unknown item/);
  assert.match((await failure(h.root, 'trigger')).message, /Say which project/);
  assert.deepEqual(readMode(h.root).queueNext, []);

  await hobkin(h.root, 'cancel', 'api');
  await h.tick();
});

test('cancel leaves a request, and the owner stops the run on its next tick the way k does', async t => {
  const h = owned(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  const { id } = h.director.running()[0];

  const { message, runs } = await success(h.root, 'cancel', 'api');

  assert.match(message, /requested/i);
  assert.match(message, /end of the queue until hobkin work back/);
  assert.deepEqual(runs, [id]);
  assert.equal(h.director.running().length, 1, 'a command only asks, and the owner does it');

  await h.tick();

  const key = `item:api:${filed.id}`;
  assert.equal(h.director.running().length, 0);
  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['open']);
  assert.deepEqual(readMode(h.root).queueSkipped, [key]);
  assert.deepEqual((await hobkin(h.root, 'running')).json, []);

  await h.ticks(2);
  assert.equal(h.calls.length, 1, 'a cancelled item stays at the end of the queue, and the request is spent');

  h.agent = finishes(h);
  await success(h.root, 'back', 'api', filed.id);
  await h.tick();
  assert.equal(h.calls.length, 2);
});

test('cancel reaches a run by its id or its item, and leaves the others alone', async t => {
  const h = owned(t);
  studied(h, 'api');
  studied(h, 'site');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  const other = fileItem(h.root, 'site', item('Fix site'), h.clock);
  writeMode(h.root, { agents: 2 });
  h.agent = untilAborted;
  await h.startedRun();
  h.clock += 1;
  while (h.director.running().length < 2) {
    await h.director.tick();
    await wait(10);
  }
  const [first, second] = h.director.running();
  assert.equal(second.item, other.id);

  await success(h.root, 'cancel', first.id);
  await h.director.tick();
  while (h.director.running().length > 1) await wait(10);
  assert.deepEqual(h.director.running().map(({ id }) => id), [second.id]);

  await success(h.root, 'cancel', other.id.slice(0, 4));
  await h.tick();
  assert.deepEqual(h.director.running(), []);
});

test('cancel stops everything on a project, look and item alike', async t => {
  const h = owned(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login', { impact: 'low', effort: 'large' }), h.clock);
  writeState(h.root, 'api', { lastLensAt: null });
  writeMode(h.root, { agents: 2 });
  h.agent = untilAborted;
  await h.startedRun();
  while (h.director.running().length < 2) {
    await h.director.tick();
    await wait(10);
  }

  const { runs } = await success(h.root, 'cancel', 'api');
  assert.equal(runs.length, 2);

  await h.tick();
  assert.deepEqual(h.director.running(), []);
});

test('cancel reaches the look for projects, and works while paused', async t => {
  const h = owned(t);
  writeMode(h.root, { folder: h.base, lastDiscoveryAt: null });
  h.agent = untilAborted;
  await h.startedRun();
  assert.equal(h.director.running()[0].lane, 'discover');
  await success(h.root, 'pause');

  await success(h.root, 'cancel', 'discover');
  await h.tick();
  assert.deepEqual(h.director.running(), []);
});

test('cancel keeps working after work mode goes off, because agents keep running', async t => {
  const h = owned(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();
  await success(h.root, 'stop');

  await success(h.root, 'cancel', 'api');
  await h.tick();

  assert.deepEqual(h.director.running(), []);
  assert.deepEqual(readMode(h.root).queueSkipped, [`item:api:${readItems(h.root, 'api')[0].id}`]);
});

test('cancel says so when there is nothing to stop', async t => {
  const h = owned(t);
  studied(h, 'api');

  assert.match((await failure(h.root, 'cancel', 'api')).message, /Nothing is running on api/);
  assert.match((await failure(h.root, 'cancel', 'nowhere')).message, /nowhere/);
  assert.match((await failure(h.root, 'cancel')).message, /Say what to cancel/);

  rmSync(join(h.root, 'runtime.lock'), { recursive: true });
  assert.match((await failure(h.root, 'cancel', 'api')).message, /no dashboard is open/);
  assert.equal(existsSync(join(h.root, 'work', 'cancels.jsonl')), false);
});

test('a project and an item that answer to the same name are not guessed between', async t => {
  const h = owned(t);
  studied(h, 'site');
  const running = fileItem(h.root, 'site', item('Fix site'), h.clock);
  proposeProject(h.root, proposal(running.id.slice(0, 2)));
  h.agent = untilAborted;
  await h.startedRun();

  const { message } = await failure(h.root, 'cancel', running.id.slice(0, 2));

  assert.match(message, /work:site:do:/);
  await hobkin(h.root, 'cancel', 'site');
  await h.tick();
});

test('skip takes a proposal off the list, or a row out of the queue, and back puts the row back', async t => {
  const h = owned(t);
  proposeProject(h.root, proposal('site'));
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Not now'), h.clock);
  const key = `item:api:${filed.id}`;

  await success(h.root, 'skip', 'site');
  assert.equal(readProject(h.root, 'site').state, 'skipped');

  await success(h.root, 'skip', 'api', filed.id.slice(0, 3));
  assert.deepEqual(readMode(h.root).queueSkipped, [key]);
  assert.equal(readProject(h.root, 'api').state, 'chosen');
  await h.tick();
  assert.deepEqual(h.calls, []);

  await success(h.root, 'back', 'api', filed.id.slice(0, 3));
  assert.deepEqual(readMode(h.root).queueSkipped, []);
  await h.tick();
  assert.equal(h.calls.length, 1);
});

test('the old queue names still work, keys and all', async t => {
  const h = owned(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  const key = `item:api:${filed.id}`;

  await success(h.root, 'later', key);
  assert.deepEqual(readMode(h.root).queueSkipped, [key]);
  await success(h.root, 'back', key);
  assert.deepEqual(readMode(h.root).queueSkipped, []);
  await success(h.root, 'run', key);
  assert.deepEqual(readMode(h.root).queueNext, [key]);
  await success(h.root, 'skip', key);
  assert.deepEqual([readMode(h.root).queueNext, readMode(h.root).queueSkipped], [[], [key]]);
  await success(h.root, 'back', key);

  writeMode(h.root, { folder: h.base });
  await success(h.root, 'run', 'discover');
  assert.deepEqual(readMode(h.root).queueNext, ['discover']);
});

test('retry puts an open, started or old stuck item back in the queue with its tries at zero, by the start of its id', async t => {
  const h = owned(t);
  studied(h, 'api');
  const tried = fileItem(h.root, 'api', item('Tried'), h.clock);
  updateItem(h.root, 'api', tried.id, { attempts: 4, lastError: 'The tests would not start.' }, h.clock);
  const stuck = fileItem(h.root, 'api', item('Stuck one'), h.clock);
  updateItem(h.root, 'api', stuck.id, { state: 'stuck', stuckReason: 'The clone is gone.', attempts: 2 }, h.clock);
  const started = fileItem(h.root, 'api', item('Started'), h.clock);
  updateItem(h.root, 'api', started.id, { state: 'doing', branch: 'hobkin/started', attempts: 1 }, h.clock);

  for (const { id } of [tried, stuck, started]) await success(h.root, 'retry', 'api', id.slice(0, 4));

  assert.deepEqual(readItems(h.root, 'api').map(({ title, state, attempts, lastError }) => [title, state, attempts, lastError]), [
    ['Tried', 'open', 0, null],
    ['Stuck one', 'open', 0, null],
    ['Started', 'doing', 0, null],
  ]);
  assert.deepEqual(readMode(h.root).queueNext, []);
});

test('retry sends a finished branch back to open, with the branch kept', async t => {
  const h = owned(t);
  studied(h, 'api');
  const finished = fileItem(h.root, 'api', item('Finished'), h.clock);
  updateItem(h.root, 'api', finished.id, { state: 'branch', branch: 'hobkin/finished', attempts: 2 }, h.clock);

  await success(h.root, 'retry', 'api', finished.id);

  assert.deepEqual(readItems(h.root, 'api').map(({ state, branch, attempts }) => [state, branch, attempts]), [['open', 'hobkin/finished', 0]]);
  assert.deepEqual(readMode(h.root).queueNext, []);
});

test('retry takes a cancelled item off the end of the queue', async t => {
  const h = owned(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Cancelled'), h.clock);
  await success(h.root, 'skip', 'api', filed.id);

  await success(h.root, 'retry', 'api', filed.id);

  assert.deepEqual([readMode(h.root).queueNext, readMode(h.root).queueSkipped], [[], []]);
});

test('retry refuses what is finished, and what is running now', async t => {
  const h = owned(t);
  studied(h, 'api');
  const shipped = fileItem(h.root, 'api', item('Shipped'), h.clock);
  updateItem(h.root, 'api', shipped.id, { state: 'pr', pr: 'https://example.com/1' }, h.clock);
  const running = fileItem(h.root, 'api', item('Running'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();

  assert.match((await failure(h.root, 'retry', 'api', shipped.id)).message, /is pr/);
  assert.equal(readItems(h.root, 'api')[0].state, 'pr', 'nothing reopens a PR behind the user\'s back');
  assert.match((await failure(h.root, 'retry', 'api', running.id)).message, /already running/);

  await hobkin(h.root, 'cancel', 'api');
  await h.tick();
});

test('level changes a level and nothing else, so it never takes a proposal or wakes a skipped project', async t => {
  const root = home(t);
  proposeProject(root, proposal('site'));
  chooseProject(root, '/repos/api', 'casual');
  proposeProject(root, proposal('old'));
  await success(root, 'skip', 'old');
  const skippedAt = readProject(root, 'old').at;

  await success(root, 'level', 'site', 'critical');
  await success(root, 'level', 'api', 'max');
  await success(root, 'level', 'old', 'low');

  assert.deepEqual(readProjects(root).map(({ slug, level, state }) => [slug, level, state]), [
    ['site', 'critical', 'proposed'],
    ['api', 'max', 'chosen'],
    ['old', 'casual', 'skipped'],
  ]);
  assert.equal(readProject(root, 'old').at, skippedAt, 'the watcher measures new activity from when it was skipped');
  assert.match((await failure(root, 'level', 'api', 'huge')).message, /level must be one of/);
  assert.match((await failure(root, 'level', 'api')).message, /level must be one of/);
});

test('priority sets a project\'s place in the queue, and prs how its finished work lands', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'casual');

  assert.match((await success(root, 'priority', 'api', 'P0')).message, /api is now P0/);
  assert.match((await success(root, 'prs', 'api', 'draft')).message, /draft PR/);

  assert.deepEqual((await hobkin(root, 'projects')).json.map(({ priority, prMode, level }) => [priority, prMode, level]), [['P0', 'draft', 'casual']]);
  assert.deepEqual((await hobkin(root)).json.projects.map(({ priority, prMode }) => [priority, prMode]), [['P0', 'draft']]);
  assert.match((await success(root, 'prs', 'api', 'off')).message, /local branch/);
  assert.match((await failure(root, 'priority', 'api', 'urgent')).message, /priority must be one of: P0, P1, P2, P3/);
  assert.match((await failure(root, 'priority', 'api')).message, /priority must be one of/);
  assert.match((await failure(root, 'prs', 'api', 'loud')).message, /PR mode must be one of: off, draft, published/);
});

test('status gives each project its priority, its PR mode and its counts, and every plan row its grade and item', async t => {
  const root = home(t);
  writeMode(root, { enabled: true });
  chooseProject(root, '/repos/api', 'important');
  const filed = fileItem(root, 'api', item('Fix login'));

  const { json: { projects: [project], plan } } = await hobkin(root);

  assert.deepEqual([project.priority, project.prMode, project.open, project.prs, project.branches, project.left], ['P1', 'off', 1, 0, 0, 0]);
  assert.deepEqual(plan.map(({ key, grade, item: id }) => [key, grade, id]), [['study:api', 'P1', null], [`item:api:${filed.id}`, 'P1', filed.id]]);
});

test('grade sets an item\'s place by hand, and auto hands it back to the queue', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'important');
  const filed = fileItem(root, 'api', item('Fix login'));
  const gradeInTheQueue = async () => (await hobkin(root, 'queue')).json.find(row => row.item === filed.id).grade;
  assert.equal(await gradeInTheQueue(), 'P1');

  assert.match((await success(root, 'grade', 'api', filed.id.slice(0, 4), 'P3')).message, /is now P3/);
  assert.equal(await gradeInTheQueue(), 'P3');
  assert.equal((await hobkin(root, 'items', 'api')).json[0].grade, 'P3');

  assert.match((await success(root, 'grade', 'api', filed.id, 'auto')).message, /P1, the grade the queue gives it/);
  assert.equal(await gradeInTheQueue(), 'P1');
  assert.match((await failure(root, 'grade', 'api', filed.id, 'P9')).message, /grade must be one of/);
  assert.match((await failure(root, 'grade', 'api', filed.id)).message, /P0 to P3, or auto/);
});

/** A command runs with nothing to hand it a `gh`, so a stand-in goes first on the path. */
function fakeGh(t, h, pulls) {
  const bin = join(h.base, 'bin');
  mkdirSync(bin);
  writeFileSync(join(h.base, 'pulls.json'), JSON.stringify(pulls));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat '${join(h.base, 'pulls.json')}'\n`, { mode: 0o755 });
  const { PATH } = process.env;
  process.env.PATH = `${bin}:${PATH}`;
  t.after(() => { process.env.PATH = PATH; });
}

test('sync closes what was merged, says so and lists it, and changes nothing in the repository', async t => {
  const h = owned(t);
  fakeGh(t, h, []);
  const checkout = studied(h, 'api');
  const merged = fileItem(h.root, 'api', item('Fix login'), h.clock);
  branched(checkout, 'hobkin/login');
  updateItem(h.root, 'api', merged.id, { state: 'branch', branch: 'hobkin/login' }, h.clock);
  git(checkout, 'merge', '-q', '--no-ff', '--no-edit', 'hobkin/login');
  const before = git(checkout, 'for-each-ref');

  const { message, settled } = await success(h.root, 'sync');

  assert.match(message, /1 merged\.$/);
  assert.deepEqual(settled, [{ slug: 'api', id: merged.id, title: 'Fix login', state: 'merged' }]);
  assert.equal(readItems(h.root, 'api')[0].state, 'merged');
  assert.equal(git(checkout, 'for-each-ref'), before);

  assert.match((await success(h.root, 'sync')).message, /Nothing was merged or closed/);
});

test('sync says what it dropped as backups and which finished branches it sent for a review', async t => {
  const h = owned(t);
  fakeGh(t, h, []);
  const checkout = studied(h, 'api');
  branched(checkout, 'hobkin/login');
  git(checkout, 'branch', 'hobkin/login-before-c289e6', 'hobkin/login');
  const finished = fileItem(h.root, 'api', item('Fix login'), h.clock);
  updateItem(h.root, 'api', finished.id, { state: 'branch', branch: 'hobkin/login', proof: 'It failed, then it passed.' }, h.clock);
  // A branch with no description or proof gets its describe agent first, and its review on a later pass.
  mkdirSync(dirname(prFile(h.root, 'api', finished.id)), { recursive: true });
  writeFileSync(prFile(h.root, 'api', finished.id), '# Fix login\n\nLogins work again.\n');
  const stray = fileItem(h.root, 'api', { ...item('Copy of login'), key: 'branch:hobkin/login-before-c289e6', kind: 'chore' }, h.clock);
  updateItem(h.root, 'api', stray.id, { state: 'branch', branch: 'hobkin/login-before-c289e6' }, h.clock);

  const { message } = await success(h.root, 'sync');

  assert.match(message, /1 dropped as a backup of another branch/);
  assert.match(message, /1 sent for a review/);
});

test('sync says when a closed PR sent an item back to its local branch', async t => {
  const h = owned(t);
  const pr = 'https://example.com/pull/1';
  fakeGh(t, h, [{ number: 1, title: 'Fix login', url: pr, state: 'CLOSED', headRefName: 'hobkin/login', createdAt: '2026-05-20T00:00:00Z', mergedAt: null }]);
  const checkout = studied(h, 'api');
  const closed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  branched(checkout, 'hobkin/login');
  updateItem(h.root, 'api', closed.id, { state: 'pr', pr, branch: 'hobkin/login' }, h.clock);

  const { message, settled } = await success(h.root, 'sync');

  assert.match(message, /1 back to a local branch, because a PR was closed/);
  assert.deepEqual(settled, [{ slug: 'api', id: closed.id, title: 'Fix login', state: 'branch' }]);
  assert.equal(readItems(h.root, 'api')[0].state, 'branch');
});

test('drop stops work on a project and keeps its items', async t => {
  const h = owned(t);
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login'), h.clock);

  await success(h.root, 'drop', 'api');
  await h.tick();

  assert.equal(readProject(h.root, 'api').state, 'dropped');
  assert.equal(readItems(h.root, 'api').length, 1);
  assert.deepEqual(h.calls, []);
});

test('done closes an item by the start of its id, and refuses one still running', async t => {
  const h = owned(t);
  studied(h, 'api');
  const finished = fileItem(h.root, 'api', item('Rotate the secret', { kind: 'attention' }), h.clock);
  updateItem(h.root, 'api', finished.id, { state: 'branch', left: 'Paste the new secret in the vault.' }, h.clock);
  const running = fileItem(h.root, 'api', item('Fix login'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();

  await success(h.root, 'done', 'api', finished.id.slice(0, 4));

  assert.deepEqual([readItems(h.root, 'api')[0].state, readItems(h.root, 'api')[0].left], ['done', null]);
  assert.deepEqual((await hobkin(h.root, 'attention')).json, [], 'nothing is left for the user once it is sorted');
  assert.match((await failure(h.root, 'done', 'api', running.id)).message, /running/);
  assert.match((await failure(h.root, 'drop', 'api', running.id)).message, /running/);
  assert.match((await failure(h.root, 'done', 'api')).message, /Say which item/);
  assert.equal(readItems(h.root, 'api')[1].state, 'doing');

  await hobkin(h.root, 'cancel', 'api');
  await h.tick();
});

test('the settings print ok and a message too, and only auto with no word is a read', async t => {
  const root = home(t);
  mkdirSync(join(root, 'checks'));

  await success(root, 'harness', 'claude');
  await success(root, 'agents', '3');
  await success(root, 'tokens', '250000');
  await success(root, 'auto', 'off');
  await success(root, 'allow', 'no');
  await success(root, 'allow', '5000000');

  const mode = readMode(root);
  assert.deepEqual([mode.harness, mode.agents, mode.dailyTokens, mode.autoPick, mode.raisedTo], ['claude', 3, 250000, false, 5000000]);
  assert.deepEqual((await hobkin(root, 'auto')).json, { autoPick: false });
  assert.match((await failure(root, 'allow')).message, /Nothing is waiting/);
  assert.match((await failure(root, 'harness', 'emacs')).message, /harness must be one of/);

  const { forgot } = await success(root, 'reset');
  assert.equal(forgot, 0);
  await success(root, 'on', root);
  assert.match((await failure(root, 'reset')).message, /off first/);
});

test('pausing with work mode off changes nothing, because nothing starts anyway', async t => {
  const root = home(t);

  await success(root, 'pause');

  assert.equal(readMode(root).pausedAt, undefined);
});

test('a trigger on a paused project says so, and it starts once resumed', async t => {
  const h = owned(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  await success(h.root, 'pause', 'api');
  h.agent = finishes(h);

  assert.match((await success(h.root, 'trigger', 'api', filed.id)).message, /waiting: paused/);
  await h.tick();
  assert.deepEqual(h.calls, []);

  await success(h.root, 'resume', 'api');
  await h.tick();
  assert.equal(h.calls.length, 1);
});

test('max makes one item max by the start of its id', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'casual');
  const filed = fileItem(root, 'api', item('Fix login'));

  await success(root, 'max', 'api', filed.id.slice(0, 4));

  assert.equal(readItems(root, 'api')[0].max, true);
  assert.equal((await hobkin(root, 'items', 'api')).json[0].level, 'max');
});

// Names.

test('a project answers to its name, its slug and its path, in any case', async t => {
  const h = owned(t);
  const checkout = repository(h.base, 'dante.github.io');
  chooseProject(h.root, checkout, 'casual');

  for (const name of ['dante.github.io', 'dante-github-io', 'DANTE.github.IO', checkout, `${checkout}/`]) {
    await success(h.root, 'level', name, 'critical');
    await success(h.root, 'level', name, 'casual');
  }
});

test('a name two projects share fails, lists them and changes nothing, and the slug or path still works', async t => {
  const root = home(t);
  proposeProject(root, proposal('api', { slug: 'api-one', path: '/one/api' }));
  proposeProject(root, proposal('api', { slug: 'api-two', path: '/two/api' }));
  const before = readProjects(root);

  for (const args of [
    ['level', 'api', 'critical'], ['priority', 'api', 'P1'], ['prs', 'api', 'draft'], ['drop', 'api'], ['skip', 'api'], ['pause', 'api'], ['resume', 'api'], ['trigger', 'api'],
    ['retry', 'api', 'abc'], ['done', 'api', 'abc'], ['max', 'api', 'abc'], ['grade', 'api', 'abc', 'P1'], ['pr', 'api', 'abc'], ['add', 'project', 'api'],
    ['add', 'item', 'api', 'Fix'], ['choose', 'api'], ['items', 'api'], ['cancel', 'api'],
  ]) {
    const { message, matches } = await failure(root, ...args);
    assert.match(message, /api-one/, args.join(' '));
    assert.match(message, /api-two/, args.join(' '));
    assert.deepEqual(matches.map(({ slug, path }) => [slug, path]), [['api-one', '/one/api'], ['api-two', '/two/api']], args.join(' '));
  }
  assert.deepEqual(readProjects(root), before);
  assert.deepEqual(readItems(root, 'api-one'), []);

  await success(root, 'level', 'api-one', 'critical');
  await success(root, 'level', '/two/api', 'important');
  assert.deepEqual(readProjects(root).map(({ level }) => level), ['critical', 'important']);
});

test('one project\'s name is another\'s slug, so neither is guessed and the path decides', async t => {
  const root = home(t);
  proposeProject(root, proposal('api', { path: '/one/api' }));
  proposeProject(root, proposal('api', { slug: 'api-two', path: '/two/api' }));

  assert.deepEqual((await failure(root, 'skip', 'api')).matches.map(({ slug }) => slug), ['api', 'api-two']);

  await success(root, 'skip', '/one/api');
  assert.deepEqual(readProjects(root).map(({ state }) => state), ['skipped', 'proposed']);
});

test('an item prefix that fits two fails and lists them, and a longer one goes through', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'casual');
  const filed = Array.from({ length: 17 }, (_, index) => fileItem(root, 'api', item(`Item ${index}`)));
  const seen = new Map();
  const [first, second] = filed.flatMap(entry => {
    const twin = seen.get(entry.id[0]);
    seen.set(entry.id[0], entry);
    return twin ? [twin, entry] : [];
  });

  const { message, matches } = await failure(root, 'done', 'api', first.id[0]);

  assert.match(message, new RegExp(first.id));
  assert.match(message, new RegExp(second.id));
  assert.ok(matches.some(({ id }) => id === second.id));
  assert.equal(readItems(root, 'api').some(({ state }) => state === 'done'), false);

  await success(root, 'done', 'api', first.id);
  assert.equal(readItems(root, 'api').find(({ id }) => id === first.id).state, 'done');
});

test('an unknown name fails and changes nothing', async t => {
  const root = home(t);
  chooseProject(root, '/repos/api', 'casual');

  for (const args of [
    ['level', 'nowhere', 'critical'], ['priority', 'nowhere', 'P1'], ['prs', 'nowhere', 'draft'], ['grade', 'nowhere', 'abc', 'P1'], ['pr', 'nowhere', 'abc'], ['drop', 'nowhere'],
    ['skip', 'nowhere'], ['pause', 'nowhere'], ['resume', 'nowhere'], ['trigger', 'nowhere'], ['add', 'item', 'nowhere', 'Fix'], ['choose', 'nowhere'],
  ]) {
    assert.match((await failure(root, ...args)).message, /Unknown project: nowhere/, args.join(' '));
  }
  for (const args of [
    ['retry', 'api', 'zzz'], ['done', 'api', 'zzz'], ['drop', 'api', 'zzz'], ['max', 'api', 'zzz'], ['grade', 'api', 'zzz', 'P1'], ['pr', 'api', 'zzz'], ['skip', 'api', 'zzz'], ['trigger', 'api', 'zzz'],
  ]) {
    assert.match((await failure(root, ...args)).message, /Unknown item: zzz/, args.join(' '));
  }
  assert.deepEqual(readProjects(root).map(({ state }) => state), ['chosen']);
  assert.equal(existsSync(paths(root, 'nowhere').directory), false);
});

// Help.

test('help shows every command on one screen, and a wrong command prints the same help and fails', async t => {
  const root = home(t);

  const help = await hobkin(root, 'help');

  assert.equal(help.code, 0);
  assert.ok(help.text.trimEnd().split('\n').length <= 40, 'one screen');
  assert.ok(help.text.split('\n').every(line => line.length <= 80), 'one line each, at the narrowest usual width');
  for (const args of [['dance'], ['add'], ['add', 'nonsense']]) {
    const wrong = await hobkin(root, ...args);
    assert.equal(wrong.code, 1, args.join(' '));
    assert.equal(wrong.text, help.text, args.join(' '));
  }
  assert.equal((await hobkin(root, '--help')).text, help.text);
  assert.equal((await hobkin(root, 'status', '-h')).text, help.text);
  assert.deepEqual(readdirSync(root), []);
});

test('every command the help names is one hobkin work knows', async t => {
  const root = home(t);
  const { text: help } = await hobkin(root, 'help');
  const named = [...help.matchAll(/^ {2}([a-z]+(?: (?:project|item)(?= <))?)/gm)].map(match => match[1].split(' '));

  assert.ok(named.length >= 30);
  for (const command of named) {
    const { text } = await hobkin(root, ...command, ...(command[0] === 'item' ? ['nowhere'] : []));
    assert.notEqual(text, help, `${command.join(' ')} is in the help but is not a command`);
  }
});
