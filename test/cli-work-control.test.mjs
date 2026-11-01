import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../src/cli/main.mjs';
import {
  chooseProject, fileItem, paths, proposeProject, readItems, readMode, readProject, readProjects, recordTokens, updateItem, writeMode, writeState,
} from '../src/cli/work/store.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { repository, writeJson } from './helpers/work-fixture.mjs';

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
  writeMode(h.root, { dailyTokens: 120000000, unmergedLimit: 10 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 5000, cached: 900 }, h.clock);

  const { json } = await hobkin(h.root, 'status');

  assert.deepEqual([json.on, json.owner, json.queued, json.running], [true, true, 1, 0]);
  assert.deepEqual(json.tokens, { today: 5000, cached: 900, thisHour: 5000 });
  assert.deepEqual(json.limits, { agents: 2, agentsAllowed: 2, dailyTokens: 120000000, hourShare: 10000000, unmerged: 10, unmergedEach: 2 });
  assert.match(json.next, /api: Fix login/);
});

test('status says when no owner is open, because nothing can start then', async t => {
  const h = owned(t);
  rmSync(join(h.root, 'runtime.lock'), { recursive: true });
  studied(h, 'api');
  fileItem(h.root, 'api', item('Fix login'), h.clock);

  const { json } = await hobkin(h.root, 'status');

  assert.deepEqual([json.on, json.owner], [true, false]);
  assert.match(json.next, /dashboard or hobkin run/);
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
  const shipped = fileItem(root, 'api', item('Shipped'));
  updateItem(root, 'api', shipped.id, { state: 'pr', pr: 'https://example.com/1' });
  const broken = fileItem(root, 'api', item('Broken'));
  updateItem(root, 'api', broken.id, { state: 'stuck', stuckReason: 'No clone.' });
  writeState(root, 'api', { lastLensAt: '2026-01-01T00:00:00.000Z' });

  const { json } = await hobkin(root, 'projects');

  assert.deepEqual(json.map(({ name, slug, state }) => [name, slug, state]), [['site', 'the-site', 'proposed'], ['api', 'api', 'chosen']]);
  assert.deepEqual(json[1], {
    name: 'api', slug: 'api', level: 'critical', state: 'chosen', path: '/repos/api', paused: false, open: 1, prs: 1, stuck: 1, nextLookAt: '2026-01-01T08:00:00.000Z',
  });
  assert.deepEqual((await hobkin(root, 'projects', '--state', 'proposed')).json.map(({ slug }) => slug), ['the-site']);
  assert.match((await failure(root, 'projects', '--state', 'lost')).message, /chosen, proposed, skipped/);
});

test('running names each agent from another process, and says when one waits on approval', async t => {
  const h = owned(t);
  studied(h, 'api', 'max');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);
  const release = Promise.withResolvers();
  let tell;
  h.director.panes = {
    run: async ({ onStatus }) => {
      tell = onStatus;
      await release.promise;
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
  };

  await h.director.tick();
  while (!tell) await wait(10);
  assert.equal((await hobkin(h.root, 'running')).json[0].waitingForApproval, false);
  tell('blocked');

  const { json } = await hobkin(h.root, 'running');

  assert.equal(json.length, 1);
  const [run] = json;
  assert.match(run.id, /^work:api:do:/);
  assert.deepEqual([run.project, run.slug, run.item, run.lane, run.level, run.harness, run.pane], ['api', 'api', filed.id, 'do', 'max', 'claude', 'work-do-api']);
  assert.equal(run.waitingForApproval, true);
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

test('queue gives the plan in order, with the key, the item, why and what each row waits on', async t => {
  const h = owned(t);
  studied(h, 'api', 'critical');
  studied(h, 'site', 'casual');
  const first = fileItem(h.root, 'api', item('Fix login'), h.clock);
  const second = fileItem(h.root, 'site', item('Tidy up', { kind: 'chore', impact: 'low' }), h.clock);
  await hobkin(h.root, 'pause', 'site');

  const { json } = await hobkin(h.root, 'queue');

  assert.deepEqual(json.map(row => [row.key, row.project, row.item, row.level, row.why, row.waiting]), [
    [`item:api:${first.id}`, 'api', first.id, 'critical', 'critical, high impact, small', null],
    [`item:site:${second.id}`, 'site', second.id, 'casual', 'low impact, small', 'paused'],
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
  updateItem(root, 'api', login.id, { state: 'pr', pr: 'https://example.com/1', max: true });
  const broken = fileItem(root, 'site', item('Broken'));
  updateItem(root, 'site', broken.id, { state: 'stuck', stuckReason: 'No clone.' });

  const { json } = await hobkin(root, 'items');

  assert.deepEqual(json, [
    { project: 'api', slug: 'api', id: login.id, title: 'Fix login', kind: 'fix', state: 'pr', level: 'max', pr: 'https://example.com/1', stuckReason: null },
    { project: 'site', slug: 'site', id: broken.id, title: 'Broken', kind: 'fix', state: 'stuck', level: 'casual', pr: null, stuckReason: 'No clone.' },
  ]);
  assert.deepEqual((await hobkin(root, 'items', 'site')).json.map(({ id }) => id), [broken.id]);
  assert.deepEqual((await hobkin(root, 'items', '--state', 'stuck')).json.map(({ id }) => id), [broken.id]);
  assert.deepEqual((await hobkin(root, 'items', 'api', '--state', 'stuck')).json, []);
  assert.match((await failure(root, 'items', 'nowhere')).message, /Unknown project: nowhere/);
  assert.match((await failure(root, 'items', '--state', 'lost')).message, /open, doing/);
});

test('search finds projects and items by name, title, path or stuck reason, in plain text', async t => {
  const root = home(t);
  chooseProject(root, '/repos/billing-api', 'important');
  proposeProject(root, proposal('Website', { path: '/elsewhere/www' }));
  const login = fileItem(root, 'billing-api', item('Fix the Login page'));
  const broken = fileItem(root, 'billing-api', item('Update rack'));
  updateItem(root, 'billing-api', broken.id, { state: 'stuck', stuckReason: 'The clone is gone.' });

  const found = async (...words) => (await hobkin(root, 'search', ...words)).json.map(row => [row.type, row.id ?? row.slug]);

  assert.deepEqual(await found('billing'), [['project', 'billing-api']]);
  assert.deepEqual(await found('website'), [['project', 'website']]);
  assert.deepEqual(await found('/elsewhere'), [['project', 'website']]);
  assert.deepEqual(await found('login'), [['item', login.id]]);
  assert.deepEqual(await found('page', 'LOGIN'), [['item', login.id]], 'every word, in any order and any case');
  assert.deepEqual(await found('clone'), [['item', broken.id]]);
  assert.deepEqual(await found('nothing like this'), []);
  assert.match((await failure(root, 'search')).message, /what to search for/);
});

test('attention lists what is waiting on the user, and how to answer each', async t => {
  const h = owned(t);
  studied(h, 'api');
  const asked = fileItem(h.root, 'api', item('Rotate the secret', { kind: 'attention' }), h.clock);
  const broken = fileItem(h.root, 'api', item('Fix login'), h.clock);
  updateItem(h.root, 'api', broken.id, { state: 'stuck', stuckReason: 'The clone is gone.' }, h.clock);
  proposeProject(h.root, proposal('site'));
  writeMode(h.root, {
    allowanceRequest: { day: new Date().toDateString(), limit: 100, proposed: 200, reason: 'Paused for today.' },
    mergeStop: { line: 'Stopped: 30 unmerged and none merged yet.' },
  });

  const { json } = await hobkin(h.root, 'attention');

  assert.deepEqual(json.map(row => [row.kind, row.project, row.item]), [
    ['allowance', null, null],
    ['unmerged', null, null],
    ['proposal', 'site', null],
    ['item', 'api', asked.id],
    ['stuck', 'api', broken.id],
  ]);
  assert.equal(json[4].reason, 'The clone is gone.');
  assert.match(json[2].answer, /choose site/);
  assert.match(json[4].answer, new RegExp(`retry api ${broken.id}`));
});

test('attention includes what the user paused and agents waiting in their panes', async t => {
  const h = owned(t);
  studied(h, 'api', 'max');
  studied(h, 'site');
  fileItem(h.root, 'api', item('Fix login'), h.clock);
  const release = Promise.withResolvers();
  let tell;
  h.director.panes = {
    run: async ({ onStatus }) => {
      tell = onStatus;
      await release.promise;
      return { status: 'completed', text: 'Useful: Done.', cost: null };
    },
  };
  await h.director.tick();
  while (!tell) await wait(10);
  tell('blocked');
  await hobkin(h.root, 'pause', 'site');
  await hobkin(h.root, 'pause');

  const { json } = await hobkin(h.root, 'attention');

  assert.deepEqual(json.map(row => [row.kind, row.project]), [['pause', null], ['pause', 'site'], ['approval', 'api']]);
  assert.match(json[2].answer, /work-do-api/);
  release.resolve();
  await h.settled();
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

test('resume keeps going after an unmerged stop, and only when one is there to clear', async t => {
  const h = owned(t);
  writeMode(h.root, { mergeStop: { at: 'then', line: 'Stopped: 30 unmerged.' } });

  await success(h.root, 'resume');

  const { mergeStop, keptGoingAt } = readMode(h.root);
  assert.equal(mergeStop, null);
  assert.ok(keptGoingAt);

  await success(h.root, 'resume');
  assert.equal(readMode(h.root).keptGoingAt, keptGoingAt, 'an idle resume does not restart the unmerged count');
});

test('resume keeps going when one project is at its own unmerged limit, because that is a stop too', async t => {
  const h = owned(t);
  studied(h, 'api');
  const open = Array.from({ length: 6 }, (_, index) => ({ kind: 'branch', branch: `hobkin/${index}`, openedAt: '2026-01-01T00:00:00.000Z' }));
  writeJson(join(h.root, 'work', 'unmerged.json'), { at: new Date(h.clock).toISOString(), projects: { api: { open } } });

  await success(h.root, 'resume');

  assert.ok(readMode(h.root).keptGoingAt);
});

test('resume says which pause it cannot end, and leaves the unmerged count alone', async t => {
  const h = owned(t);
  writeMode(h.root, { dailyTokens: 1000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 2000 }, h.clock);

  const { message } = await success(h.root, 'resume');

  assert.match(message, /Paused for today/);
  assert.equal(readMode(h.root).keptGoingAt, undefined);
});

test('resume ends a pause first, so ending one never clears an unmerged stop', async t => {
  const h = owned(t);
  writeMode(h.root, { pausedAt: 'then', mergeStop: { at: 'then', line: 'Stopped: 30 unmerged.' } });

  const { message } = await success(h.root, 'resume');

  assert.match(message, /Stopped: 30 unmerged/);
  assert.equal(readMode(h.root).pausedAt, null);
  assert.ok(readMode(h.root).mergeStop);
  assert.equal(readMode(h.root).keptGoingAt, undefined);
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
  assert.equal((await success(h.root, 'trigger', 'unread', 'look')).key, 'study:unread', 'nothing runs before its study');
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
  await h.tick();
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

  writeMode(h.root, { dailyTokens: 100000000, mergeStop: { at: 'then', line: 'Stopped: 30 unmerged.' } });
  assert.match((await success(h.root, 'trigger', 'api', filed.id)).message, /Stopped: 30 unmerged/);
  await h.tick();
  assert.deepEqual(h.calls, []);
});

test('trigger says when work mode is off or nothing is open to run it', async t => {
  const h = owned(t);
  studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Fix login'), h.clock);

  rmSync(join(h.root, 'runtime.lock'), { recursive: true });
  assert.match((await success(h.root, 'trigger', 'api', filed.id)).message, /dashboard or hobkin run/);

  writeMode(h.root, { enabled: false });
  assert.match((await success(h.root, 'trigger', 'api', filed.id)).message, /work start/);
});

test('trigger refuses what cannot run', async t => {
  const h = owned(t);
  studied(h, 'api');
  proposeProject(h.root, proposal('site'));
  const stuck = fileItem(h.root, 'api', item('Stuck one'), h.clock);
  updateItem(h.root, 'api', stuck.id, { state: 'stuck', stuckReason: 'The clone is gone.' }, h.clock);
  const shipped = fileItem(h.root, 'api', item('Shipped'), h.clock);
  updateItem(h.root, 'api', shipped.id, { state: 'pr', pr: 'https://example.com/1' }, h.clock);
  const askedOfTheUser = fileItem(h.root, 'api', item('Rotate the secret', { kind: 'attention' }), h.clock);
  const running = fileItem(h.root, 'api', item('Running'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();

  assert.match((await failure(h.root, 'trigger', 'site')).message, /site is proposed/);
  assert.match((await failure(h.root, 'trigger', 'api', stuck.id)).message, /retry/);
  assert.match((await failure(h.root, 'trigger', 'api', shipped.id)).message, /is pr/);
  assert.match((await failure(h.root, 'trigger', 'api', askedOfTheUser.id)).message, /waiting on the user/);
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
  assert.deepEqual(runs, [id]);
  assert.equal(h.director.running().length, 1, 'a command only asks, and the owner does it');

  await h.tick();

  assert.equal(h.director.running().length, 0);
  assert.deepEqual(readItems(h.root, 'api').map(({ state, stuckReason }) => [state, stuckReason]), [['stuck', 'Cancelled by hand.']]);
  assert.deepEqual((await hobkin(h.root, 'running')).json, []);

  await h.ticks(2);
  assert.equal(h.calls.length, 1, 'a cancelled item waits, and the request is spent');
  await success(h.root, 'retry', 'api', filed.id);
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
  fileItem(h.root, 'api', item('Fix login', { effort: 'large' }), h.clock);
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
  assert.equal(readItems(h.root, 'api')[0].state, 'stuck');
});

test('cancel says so when there is nothing to stop', async t => {
  const h = owned(t);
  studied(h, 'api');

  assert.match((await failure(h.root, 'cancel', 'api')).message, /Nothing is running on api/);
  assert.match((await failure(h.root, 'cancel', 'nowhere')).message, /nowhere/);
  assert.match((await failure(h.root, 'cancel')).message, /Say what to cancel/);

  rmSync(join(h.root, 'runtime.lock'), { recursive: true });
  assert.match((await failure(h.root, 'cancel', 'api')).message, /dashboard or hobkin run/);
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

test('retry puts a stuck item back at the front, by the start of its id, and refuses anything else', async t => {
  const h = owned(t);
  studied(h, 'api');
  const stuck = fileItem(h.root, 'api', item('Stuck one'), h.clock);
  updateItem(h.root, 'api', stuck.id, { state: 'stuck', stuckReason: 'The clone is gone.', attempts: 2 }, h.clock);
  const shipped = fileItem(h.root, 'api', item('Shipped'), h.clock);
  updateItem(h.root, 'api', shipped.id, { state: 'pr', pr: 'https://example.com/1' }, h.clock);

  await success(h.root, 'retry', 'api', stuck.id.slice(0, 4));

  const [retried] = readItems(h.root, 'api');
  assert.deepEqual([retried.state, retried.attempts, retried.stuckReason], ['open', 0, null]);
  assert.deepEqual(readMode(h.root).queueNext, [`item:api:${stuck.id}`]);
  assert.match((await failure(h.root, 'retry', 'api', shipped.id)).message, /is pr/);
  assert.equal(readItems(h.root, 'api')[1].state, 'pr', 'nothing reopens a PR behind the user\'s back');
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
  const asked = fileItem(h.root, 'api', item('Rotate the secret', { kind: 'attention' }), h.clock);
  const running = fileItem(h.root, 'api', item('Fix login'), h.clock);
  h.agent = untilAborted;
  await h.startedRun();

  await success(h.root, 'done', 'api', asked.id.slice(0, 4));

  assert.equal(readItems(h.root, 'api')[0].state, 'done');
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
  await success(root, 'unmerged', '12');
  await success(root, 'auto', 'off');
  await success(root, 'allow', 'no');
  await success(root, 'allow', '5000000');

  const mode = readMode(root);
  assert.deepEqual([mode.harness, mode.agents, mode.dailyTokens, mode.unmergedLimit, mode.autoPick, mode.raisedTo], ['claude', 3, 250000, 12, false, 5000000]);
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
    ['level', 'api', 'critical'], ['drop', 'api'], ['skip', 'api'], ['pause', 'api'], ['resume', 'api'], ['trigger', 'api'], ['retry', 'api', 'abc'],
    ['done', 'api', 'abc'], ['max', 'api', 'abc'], ['add', 'project', 'api'], ['add', 'item', 'api', 'Fix'], ['choose', 'api'], ['items', 'api'],
    ['cancel', 'api'],
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

  for (const args of [['level', 'nowhere', 'critical'], ['drop', 'nowhere'], ['skip', 'nowhere'], ['pause', 'nowhere'], ['resume', 'nowhere'], ['trigger', 'nowhere'], ['add', 'item', 'nowhere', 'Fix'], ['choose', 'nowhere']]) {
    assert.match((await failure(root, ...args)).message, /Unknown project: nowhere/, args.join(' '));
  }
  for (const args of [['retry', 'api', 'zzz'], ['done', 'api', 'zzz'], ['drop', 'api', 'zzz'], ['max', 'api', 'zzz'], ['skip', 'api', 'zzz'], ['trigger', 'api', 'zzz']]) {
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
