import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { readEvents } from '../src/cli/events.mjs';
import { main } from '../src/cli/main.mjs';
import { surveyAndClose } from '../src/cli/work/closing.mjs';
import { pulseLaunches, recordWatch } from '../src/cli/work/launches.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import { recordSignals } from '../src/cli/work/signals.mjs';
import {
  chooseProject, fileItem, lenses, paths, pickNext, readItems, readLaunches, readState, recordLaunch, updateItem, writeMode, writeState,
} from '../src/cli/work/store.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { branched, commit, git, repository, withOrigin, writeJson } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-01T12:00:00Z');
const iso = time => new Date(time).toISOString();
const proof = { command: 'kamal app version', saw: 'abc1234' };
const brief = 'Evidence, who benefits, the first change, the proof.';

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-launch-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  mkdirSync(root);
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  const h = { base, root, checkout, ghCalls: [], gets: [], runs: [], merged: 0 };
  h.gh = async args => {
    h.ghCalls.push(args);
    if (h.ghFails) throw Error('gh is signed out');
    return JSON.stringify(h.runs);
  };
  h.answer = async () => ({ ok: true });
  h.fetch = async (url, options) => {
    h.gets.push([url, options]);
    return h.answer(url);
  };
  h.pulse = (now = NOW) => pulseLaunches(root, { now, gh: h.gh, fetch: h.fetch });
  return h;
}

/** A branch merged the way hobkin merges one, with the item the merge wrote `landed` on. */
function land(h, { file, text = 'changed\n', title = `Change ${++h.merged}`, landed = {}, launch } = {}) {
  const branch = `hobkin/${h.merged}-${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkout, branch, file ?? `${title.replaceAll(' ', '-')}.txt`, text);
  git(h.checkout, 'merge', '-q', '--no-ff', '--no-edit', '-m', `Merge: ${title}`, branch);
  const sha = git(h.checkout, 'rev-parse', 'HEAD');
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief }, NOW);
  updateItem(h.root, 'api', id, { state: 'merged', branch, ...(launch ? { launch } : {}), landed: { sha, at: iso(NOW), route: 'key', ...landed } }, NOW);
  return { id, sha, title };
}

const launchOf = (h, { id }) => readLaunches(h.root, 'api').find(({ item }) => item === id);
const itemsOf = h => readItems(h.root, 'api');
const watchable = h => recordSignals(h.root, 'api', { type: 'service', deploy: proof, logs: proof }, NOW);

test('a launch that closes goes on the record with how it ended', async t => {
  const h = workspace(t);
  const { id } = land(h);

  await h.pulse();
  await h.pulse(NOW + 3 * DAY);

  const closed = readEvents(h.root).filter(({ type }) => type === 'launch_closed');
  assert.deepEqual(closed.map(({ project, item, outcome }) => [project, item, outcome]), [['api', id, 'quiet']]);
});

test('a merge opens one launch, for the item that says it landed, and only for that', async t => {
  const h = workspace(t);
  const merged = land(h);
  fileItem(h.root, 'api', { key: 'open', kind: 'fix', title: 'Not landed', brief }, NOW);

  await h.pulse();
  await h.pulse(NOW + HOUR);

  const launches = readLaunches(h.root, 'api');
  assert.equal(launches.length, 1);
  assert.deepEqual([launches[0].item, launches[0].sha, launches[0].mergedAt], [merged.id, merged.sha, iso(NOW)]);
});

test('the pulse writes only what changed, so a quiet project grows no record', async t => {
  const h = workspace(t);
  land(h);
  await h.pulse();
  const lines = () => readLaunches(h.root, 'api').map(({ updatedAt }) => updatedAt);
  const first = lines();

  await h.pulse(NOW + HOUR);

  assert.deepEqual(lines(), first);
});

test('a launch keeps what the change touched', async t => {
  const h = workspace(t);
  const merged = land(h, { file: 'cashback.rb' });

  await h.pulse();

  assert.deepEqual(launchOf(h, merged).files, ['cashback.rb']);
});

test('a repository with no remote counts as pushed when merged, and asks gh nothing', async t => {
  const h = workspace(t);
  const merged = land(h);

  await h.pulse(NOW + HOUR);

  const { stage, pushedAt, ci } = launchOf(h, merged);
  assert.deepEqual([stage, pushedAt, ci], ['pushed', iso(NOW), 'none']);
  assert.deepEqual(h.ghCalls, []);
});

test('a merge stays local until origin holds it, however it got there', async t => {
  const h = workspace(t);
  const origin = withOrigin(h.base, h.checkout);
  const merged = land(h);

  await h.pulse();
  assert.equal(launchOf(h, merged).stage, 'merged');
  assert.deepEqual(h.ghCalls, [], 'no CI can run on a commit only this machine holds');

  git(h.checkout, 'push', '-q', origin, 'main');
  git(h.checkout, 'update-ref', '-d', 'refs/remotes/origin/main');
  await h.pulse(NOW + HOUR);

  const { stage, pushedAt } = launchOf(h, merged);
  assert.deepEqual([stage, pushedAt], ['pushed', iso(NOW + HOUR)]);
});

test('a PR merged on the remote starts out pushed', async t => {
  const h = workspace(t);
  withOrigin(h.base, h.checkout);
  const merged = land(h, { landed: { route: 'remote' } });

  await h.pulse(NOW + HOUR);

  const { stage, pushedAt } = launchOf(h, merged);
  assert.deepEqual([stage, pushedAt], ['pushed', iso(NOW)]);
});

test('CI is read on the commit itself, and a failure is suspected trouble and nothing more', async t => {
  const h = workspace(t);
  const merged = land(h, { landed: { route: 'remote' } });
  withOrigin(h.base, h.checkout);
  h.runs = [{ status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'success' }];

  await h.pulse(NOW + HOUR);

  const [args] = h.ghCalls;
  assert.deepEqual(args.slice(0, 2), ['run', 'list']);
  assert.equal(args[args.indexOf('--commit') + 1], merged.sha);
  const { ci, suspectedAt, outcome, stage } = launchOf(h, merged);
  assert.deepEqual([ci, suspectedAt, outcome, stage], ['failing', iso(NOW + HOUR), undefined, 'pushed']);
  assert.deepEqual(itemsOf(h).filter(({ kind, title }) => kind === 'fix' && title !== merged.title), []);
});

test('CI that passed is not asked again, and a run cancelled by a newer push says nothing', async t => {
  const h = workspace(t);
  const merged = land(h, { landed: { route: 'remote' } });
  withOrigin(h.base, h.checkout);

  h.runs = [{ status: 'completed', conclusion: 'cancelled' }, { status: 'in_progress', conclusion: '' }];
  await h.pulse(NOW + HOUR);
  assert.equal(launchOf(h, merged).ci, 'pending');

  h.runs = [{ status: 'completed', conclusion: 'cancelled' }, { status: 'completed', conclusion: 'success' }];
  await h.pulse(NOW + 2 * HOUR);
  assert.equal(launchOf(h, merged).ci, 'passing');

  await h.pulse(NOW + 3 * HOUR);
  assert.equal(h.ghCalls.length, 2);
});

test('a gh failure is a gap, never a clean result, and it holds a launch open', async t => {
  const h = workspace(t);
  const merged = land(h, { landed: { route: 'remote' } });
  withOrigin(h.base, h.checkout);
  h.ghFails = true;

  await h.pulse(NOW + 3 * DAY);

  const { ci, stage, outcome } = launchOf(h, merged);
  assert.deepEqual([ci, stage, outcome], ['gap', 'pushed', undefined]);

  await h.pulse(NOW + 8 * DAY);
  assert.deepEqual([launchOf(h, merged).stage, launchOf(h, merged).outcome], ['closed', 'unexercised']);
});

test('a remote that cannot be reached is a gap too, even when CI already passed', async t => {
  const h = workspace(t);
  const merged = land(h, { landed: { route: 'remote' } });
  withOrigin(h.base, h.checkout);
  h.runs = [{ status: 'completed', conclusion: 'success' }];
  await h.pulse(NOW + HOUR);
  git(h.checkout, 'remote', 'set-url', 'origin', join(h.base, 'gone.git'));

  await h.pulse(NOW + 3 * DAY);
  assert.deepEqual([launchOf(h, merged).stage, launchOf(h, merged).outcome], ['pushed', undefined], 'a revert could be out there unseen');

  await h.pulse(NOW + 8 * DAY);
  assert.deepEqual([launchOf(h, merged).stage, launchOf(h, merged).outcome], ['closed', 'unexercised']);
});

test('the health URL is fetched with a timeout, and an answer that is not OK is down', async t => {
  const h = workspace(t);
  const merged = land(h);
  recordSignals(h.root, 'api', { type: 'site', health: { url: 'https://example.com/pricing', status: 200 } }, NOW);

  await h.pulse(NOW + HOUR);
  assert.equal(launchOf(h, merged).health, 'up');
  const [[url, { signal, method }]] = h.gets;
  assert.equal(url, 'https://example.com/pricing');
  assert.ok(signal instanceof AbortSignal, 'a site that never answers must not hold the survey');
  assert.ok(method === undefined || method === 'GET');

  h.answer = async () => ({ ok: false, status: 502 });
  await h.pulse(NOW + 2 * HOUR);
  const { health, suspectedAt } = launchOf(h, merged);
  assert.deepEqual([health, suspectedAt], ['down', iso(NOW + 2 * HOUR)]);
});

test('a network failure on the health URL is a gap, and no sign of trouble either way', async t => {
  const h = workspace(t);
  const merged = land(h);
  recordSignals(h.root, 'api', { type: 'site', health: { url: 'https://example.com/pricing', status: 200 } }, NOW);
  h.answer = async () => { throw Error('getaddrinfo ENOTFOUND'); };

  await h.pulse(NOW + 3 * DAY);

  const { health, suspectedAt, stage } = launchOf(h, merged);
  assert.deepEqual([health, suspectedAt, stage], ['gap', undefined, 'pushed']);
});

test('suspicion clears when the reading does', async t => {
  const h = workspace(t);
  const merged = land(h);
  recordSignals(h.root, 'api', { type: 'site', health: { url: 'https://example.com/pricing', status: 200 } }, NOW);
  h.answer = async () => ({ ok: false });
  await h.pulse(NOW + HOUR);

  h.answer = async () => ({ ok: true });
  await h.pulse(NOW + 2 * HOUR);

  assert.equal(launchOf(h, merged).suspectedAt, null);
});

test('a project with no proved health URL gets no request at all', async t => {
  const h = workspace(t);
  land(h);

  await h.pulse(NOW + HOUR);

  assert.deepEqual(h.gets, []);
});

test('the pulse runs nothing an agent wrote', async t => {
  const h = workspace(t);
  const marker = join(h.base, 'ran');
  land(h);
  recordSignals(h.root, 'api', { type: 'service', deploy: { command: `touch ${marker}`, saw: 'ok' }, logs: { command: `touch ${marker}`, saw: 'ok' } }, NOW);

  await h.pulse(NOW + HOUR);

  assert.equal(existsSync(marker), false);
});

test('a docs-only change closes quiet at once, even before it is pushed', async t => {
  const h = workspace(t);
  withOrigin(h.base, h.checkout);
  const merged = land(h, { file: 'README.md' });

  await h.pulse();

  const { stage, outcome, closesAt } = launchOf(h, merged);
  assert.deepEqual([stage, outcome, closesAt], ['closed', 'quiet', iso(NOW)]);
});

test('the area a merge recorded speaks for the whole branch, whatever its last commit touched', async t => {
  const h = workspace(t);
  const code = land(h, { file: 'README.md', landed: { area: 'app/models' } });
  const docs = land(h, { file: 'docs.txt', landed: { area: 'docs' } });

  await h.pulse();

  assert.equal(launchOf(h, code).stage, 'pushed');
  assert.deepEqual([launchOf(h, docs).stage, launchOf(h, docs).outcome], ['closed', 'quiet']);
});

test('a project under signal 2 closes quiet 48 hours after the push', async t => {
  const h = workspace(t);
  const merged = land(h);

  await h.pulse(NOW + 47 * HOUR);
  assert.equal(launchOf(h, merged).stage, 'pushed');

  await h.pulse(NOW + 48 * HOUR);
  const { stage, outcome, closesAt } = launchOf(h, merged);
  assert.deepEqual([stage, outcome, closesAt], ['closed', 'quiet', iso(NOW + 48 * HOUR)]);
});

test('with no signals on record nothing shows exposure, so a launch closes the same way', async t => {
  const h = workspace(t);
  const merged = land(h);

  await h.pulse(NOW + 3 * DAY);

  assert.equal(launchOf(h, merged).outcome, 'quiet');
});

test('CI failing under signal 2 is no clean result: the launch holds, and ends with no credit', async t => {
  const h = workspace(t);
  const merged = land(h, { landed: { route: 'remote' } });
  withOrigin(h.base, h.checkout);
  h.runs = [{ status: 'completed', conclusion: 'failure' }];

  await h.pulse(NOW + 3 * DAY);
  assert.equal(launchOf(h, merged).stage, 'pushed');

  await h.pulse(NOW + 7 * DAY);
  assert.deepEqual([launchOf(h, merged).stage, launchOf(h, merged).outcome], ['closed', 'unexercised']);
});

test('a watched launch closes on the later of 48 hours live and exposure seen', async t => {
  const h = workspace(t);
  watchable(h);
  const merged = land(h);
  await h.pulse(NOW + HOUR);

  recordWatch(h.root, 'api', { launches: [{ item: merged.id, live: true, exercised: 0 }] }, NOW + HOUR);
  await h.pulse(NOW + 2 * DAY);
  assert.equal(launchOf(h, merged).stage, 'live', 'no exposure yet');

  recordWatch(h.root, 'api', { launches: [{ item: merged.id, exercised: 40, note: 'POST /refunds took 40 requests.' }] }, NOW + 3 * DAY);
  await h.pulse(NOW + 3 * DAY);

  const { stage, outcome, exercised, note, closesAt } = launchOf(h, merged);
  assert.deepEqual([stage, outcome, exercised, note, closesAt], ['closed', 'held', 40, 'POST /refunds took 40 requests.', iso(NOW + 3 * DAY)]);
});

test('exposure early still waits out 48 hours live', async t => {
  const h = workspace(t);
  watchable(h);
  const merged = land(h);
  await h.pulse(NOW + HOUR);
  recordWatch(h.root, 'api', { launches: [{ item: merged.id, live: true, exercised: 40 }] }, NOW + HOUR);

  await h.pulse(NOW + 48 * HOUR);
  assert.equal(launchOf(h, merged).stage, 'live');

  await h.pulse(NOW + 49 * HOUR);
  assert.equal(launchOf(h, merged).outcome, 'held');
});

test('with no exposure a watched launch ends unexercised at 7 days, and live or not makes no difference', async t => {
  const h = workspace(t);
  watchable(h);
  const live = land(h);
  const never = land(h);
  await h.pulse(NOW + HOUR);
  recordWatch(h.root, 'api', { launches: [{ item: live.id, live: true }] }, NOW + HOUR);

  await h.pulse(NOW + 7 * DAY - HOUR);
  assert.deepEqual([launchOf(h, live).stage, launchOf(h, never).stage], ['live', 'pushed']);

  await h.pulse(NOW + 7 * DAY);
  assert.deepEqual([launchOf(h, live).outcome, launchOf(h, never).outcome], ['unexercised', 'unexercised']);
});

test('a merge nobody pushed is not watched, so no clock runs on it', async t => {
  const h = workspace(t);
  withOrigin(h.base, h.checkout);
  const merged = land(h);

  await h.pulse(NOW + 30 * DAY);

  assert.deepEqual([launchOf(h, merged).stage, launchOf(h, merged).outcome], ['merged', undefined]);
});

test('a revert on the default branch is trouble, and files one urgent fix naming the merge', async t => {
  const h = workspace(t);
  const merged = land(h, { launch: { undo: 'code', how: 'kamal rollback', risk: 'The refund branch.', lookAt: 'app/models/cashback.rb:42' } });
  await h.pulse(NOW + HOUR);

  git(h.checkout, 'revert', '--no-edit', '-m', '1', merged.sha);
  const { trouble } = await h.pulse(NOW + 2 * HOUR);

  const { stage, outcome, note, troubleAt } = launchOf(h, merged);
  assert.deepEqual([stage, outcome, troubleAt], ['closed', 'trouble', iso(NOW + 2 * HOUR)]);
  assert.match(note, /Reverted/);
  assert.deepEqual(trouble.map(({ item }) => item), [merged.id]);

  const fix = itemsOf(h).find(({ causedBy }) => causedBy === merged.id);
  assert.deepEqual([fix.kind, fix.urgent, fix.key], ['fix', true, `trouble:${merged.id}`]);
  assert.match(fix.title, new RegExp(merged.title));
  assert.match(fix.brief, /fix forward/i);
  assert.match(fix.brief, /revert branch/i);
  assert.match(fix.brief, /app\/models\/cashback\.rb:42/);
  assert.match(fix.brief, new RegExp(merged.sha.slice(0, 7)));

  await h.pulse(NOW + 3 * HOUR);
  assert.equal(itemsOf(h).filter(({ causedBy }) => causedBy === merged.id).length, 1);
});

test('a commit reverted on its own counts, and so does a revert named by its title', async t => {
  const h = workspace(t);
  const byCommit = land(h);
  const byTitle = land(h);
  const other = land(h);
  await h.pulse(NOW + HOUR);

  git(h.checkout, 'revert', '--no-edit', git(h.checkout, 'rev-parse', `${byCommit.sha}^2`));
  commit(h.checkout, 'undo.txt', `Revert "${byTitle.title} (#12)"\n`);
  await h.pulse(NOW + 2 * HOUR);

  assert.deepEqual([byCommit, byTitle, other].map(launch => launchOf(h, launch).outcome), ['trouble', 'trouble', undefined]);
});

test('a revert that only reached origin still counts', async t => {
  const h = workspace(t);
  const origin = withOrigin(h.base, h.checkout);
  const merged = land(h);
  git(h.checkout, 'push', '-q', 'origin', 'main');
  await h.pulse(NOW + HOUR);

  const other = join(h.base, 'other');
  git(h.base, 'clone', '-q', origin, other);
  git(other, 'config', 'user.email', 'test@example.com');
  git(other, 'config', 'user.name', 'Test');
  git(other, 'revert', '--no-edit', '-m', '1', merged.sha);
  git(other, 'push', '-q', 'origin', 'main');
  await h.pulse(NOW + 2 * HOUR);

  assert.equal(launchOf(h, merged).outcome, 'trouble');
});

test('a closed launch can still flip to trouble for 14 days after its merge, and not after that', async t => {
  const h = workspace(t);
  const merged = land(h);
  const late = land(h);
  await h.pulse(NOW + 3 * DAY);
  assert.deepEqual([launchOf(h, merged).outcome, launchOf(h, late).outcome], ['quiet', 'quiet']);

  git(h.checkout, 'revert', '--no-edit', '-m', '1', merged.sha);
  await h.pulse(NOW + 14 * DAY - HOUR);
  assert.equal(launchOf(h, merged).outcome, 'trouble');
  assert.equal(launchOf(h, late).outcome, 'quiet');

  git(h.checkout, 'revert', '--no-edit', '-m', '1', late.sha);
  await h.pulse(NOW + 14 * DAY);
  assert.equal(launchOf(h, late).outcome, 'quiet');
});

test('a fix that names a merge is trouble, and no second fix is filed for it', async t => {
  const h = workspace(t);
  const merged = land(h);
  await h.pulse(NOW + HOUR);
  fileItem(h.root, 'api', { key: 'found', kind: 'fix', title: 'Fix what the watch found', brief, causedBy: merged.id }, NOW + HOUR);

  await h.pulse(NOW + 2 * HOUR);

  assert.equal(launchOf(h, merged).outcome, 'trouble');
  assert.deepEqual(itemsOf(h).filter(({ causedBy }) => causedBy === merged.id).map(({ key }) => key), ['found']);
});

test('a launch with a flag that closes clean files the flag\'s removal, once', async t => {
  const h = workspace(t);
  const flag = { name: 'new_checkout', expires: '2026-09-01' };
  const merged = land(h, { launch: { undo: 'code', flag } });

  await h.pulse(NOW + 3 * DAY);
  await h.pulse(NOW + 4 * DAY);

  assert.equal(launchOf(h, merged).outcome, 'quiet');
  const removal = itemsOf(h).filter(({ key }) => key === 'flag:remove:new_checkout');
  assert.equal(removal.length, 1);
  assert.equal(removal[0].kind, 'chore');
  assert.match(removal[0].title, /new_checkout/);
  assert.match(removal[0].brief, new RegExp(merged.title));
});

test('a flag stays when its launch did not close clean', async t => {
  const h = workspace(t);
  watchable(h);
  const flag = { name: 'new_checkout', expires: '2026-09-01' };
  const quiet = land(h, { launch: { undo: 'code', flag } });
  await h.pulse(NOW + 8 * DAY);
  assert.equal(launchOf(h, quiet).outcome, 'unexercised');

  assert.deepEqual(itemsOf(h).filter(({ key }) => key === 'flag:remove:new_checkout'), []);
});

test('a watch run says what it saw, and what it can set stops there', async t => {
  const h = workspace(t);
  watchable(h);
  const merged = land(h);
  await h.pulse(NOW + HOUR);

  recordWatch(h.root, 'api', { launches: [{ item: merged.id, live: true, exercised: 12, note: 'Quiet so far.', stage: 'closed', outcome: 'held', sha: 'nonsense', closesAt: iso(NOW) }] }, NOW + 2 * HOUR);

  const { stage, liveAt, exercised, note, outcome, sha, closesAt } = launchOf(h, merged);
  assert.deepEqual([stage, liveAt, exercised, note, outcome, sha], ['live', iso(NOW + 2 * HOUR), 12, 'Quiet so far.', undefined, merged.sha]);
  assert.notEqual(closesAt, iso(NOW));
});

test('requests seen never go down, because logs roll over', async t => {
  const h = workspace(t);
  watchable(h);
  const merged = land(h);
  await h.pulse(NOW + HOUR);

  recordWatch(h.root, 'api', { launches: [{ item: merged.id, exercised: 40 }] }, NOW + 2 * HOUR);
  recordWatch(h.root, 'api', { launches: [{ item: merged.id, exercised: 3 }] }, NOW + 14 * HOUR);

  assert.equal(launchOf(h, merged).exercised, 40);
});

test('a run cannot call a change live before origin holds it', async t => {
  const h = workspace(t);
  withOrigin(h.base, h.checkout);
  const merged = land(h);
  await h.pulse(NOW + HOUR);

  recordWatch(h.root, 'api', { launches: [{ item: merged.id, live: true }] }, NOW + 2 * HOUR);

  assert.deepEqual([launchOf(h, merged).stage, launchOf(h, merged).liveAt], ['merged', undefined]);
});

test('a new error from a watch run is trouble, severe when it says so', async t => {
  const h = workspace(t);
  watchable(h);
  const merged = land(h);
  await h.pulse(NOW + HOUR);

  const { trouble } = recordWatch(h.root, 'api', { launches: [{ item: merged.id, live: true, exercised: 8, newErrors: ['NoMethodError in RefundsController#create'], severe: true, note: 'New since the merge.' }] }, NOW + 2 * HOUR);

  const launch = launchOf(h, merged);
  assert.deepEqual([launch.stage, launch.outcome, launch.severe, launch.exercised, launch.liveAt], ['closed', 'trouble', true, 8, iso(NOW + 2 * HOUR)]);
  assert.match(launch.note, /NoMethodError/);
  assert.match(launch.note, /New since the merge/);
  assert.deepEqual(trouble, [merged.id]);
  assert.equal(itemsOf(h).filter(({ causedBy, urgent }) => causedBy === merged.id && urgent).length, 1);
});

test('a bad watch report changes nothing, even for the launches it got right', async t => {
  const h = workspace(t);
  watchable(h);
  const merged = land(h);
  await h.pulse(NOW + HOUR);
  const refused = launches => assert.throws(() => recordWatch(h.root, 'api', { launches }, NOW + 2 * HOUR));

  refused([{ item: merged.id, exercised: 40 }, { item: 'nobody' }]);
  refused([{ item: merged.id, exercised: -1 }]);
  refused([{ item: merged.id, exercised: 'lots' }]);
  refused([{ item: merged.id, newErrors: 'oops' }]);
  assert.throws(() => recordWatch(h.root, 'api', {}, NOW + 2 * HOUR), /launches/);

  assert.equal(launchOf(h, merged).exercised, undefined);
});

test('a project that cannot be read is a gap: its launches wait and the rest go on', async t => {
  const h = workspace(t);
  const merged = land(h);
  rmSync(join(h.checkout, '.git'), { recursive: true, force: true });

  await h.pulse(NOW + 3 * DAY);

  assert.equal(launchOf(h, merged).stage, 'merged');
});

test('the survey carries the pulse, and what the pulse filed stays apart from what needs a rebase', async t => {
  const h = workspace(t);
  const merged = land(h);
  git(h.checkout, 'revert', '--no-edit', '-m', '1', merged.sha);

  const { filed, pulse } = await surveyAndClose(h.root, { now: NOW + HOUR, gh: h.gh, fetch: h.fetch });

  assert.deepEqual(filed, []);
  assert.deepEqual(pulse.trouble.map(({ item }) => item), [merged.id]);
});

async function work(root, args, input) {
  let text = '';
  const code = await main(['work', ...args, '--home', root], { write: chunk => { text += chunk; } }, {
    input: Readable.from(input === undefined ? [] : [JSON.stringify(input)]),
  });
  return { code, result: JSON.parse(text) };
}

test('hobkin work watch takes a run\'s report, by any name for the project', async t => {
  const h = workspace(t);
  watchable(h);
  const merged = land(h);
  await h.pulse(NOW + HOUR);

  const { code, result } = await work(h.root, ['watch', 'api'], { launches: [{ item: merged.id, live: true, exercised: 5 }] });

  assert.deepEqual([code, result.ok, result.trouble], [0, true, []]);
  assert.equal(launchOf(h, merged).exercised, 5);
});

test('hobkin work watching prints open launches and changes nothing', async t => {
  const h = workspace(t);
  const merged = land(h);
  const docs = land(h, { file: 'README.md' });
  await h.pulse(NOW + HOUR);
  const before = readLaunches(h.root, 'api');

  const { result } = await work(h.root, ['watching']);

  assert.deepEqual(result.map(({ project, item, title, stage }) => [project, item, title, stage]), [['api', merged.id, merged.title, 'pushed']]);
  assert.equal(result[0].sha, merged.sha.slice(0, 7));
  assert.equal(result[0].since, iso(NOW));
  assert.match(result[0].known, /no CI/);
  assert.deepEqual(readLaunches(h.root, 'api'), before);
  assert.equal(launchOf(h, docs).stage, 'closed');
});

test('hobkin work trouble is the user\'s word, severe or not, with their reason', async t => {
  const h = workspace(t);
  const merged = land(h);
  const severe = land(h);
  await h.pulse(NOW + HOUR);

  const { code, result } = await work(h.root, ['trouble', 'api', merged.id, 'the', 'totals', 'are', 'wrong']);
  assert.deepEqual([code, result.ok], [0, true]);
  assert.deepEqual([launchOf(h, merged).outcome, launchOf(h, merged).severe, launchOf(h, merged).note], ['trouble', undefined, 'the totals are wrong']);

  await work(h.root, ['trouble', 'api', severe.id, 'severe', 'it', 'lost', 'orders']);
  assert.deepEqual([launchOf(h, severe).outcome, launchOf(h, severe).severe, launchOf(h, severe).note], ['trouble', true, 'it lost orders']);
  assert.equal(itemsOf(h).filter(({ urgent }) => urgent).length, 2);
});

test('the user can name trouble on a merge no pulse has seen, and after its watch closed', async t => {
  const h = workspace(t);
  const unseen = land(h);
  const closed = land(h, { file: 'README.md' });
  await work(h.root, ['trouble', 'api', unseen.id]);
  assert.equal(launchOf(h, unseen).outcome, 'trouble');

  await h.pulse(NOW + HOUR);
  assert.equal(launchOf(h, closed).outcome, 'quiet');
  await work(h.root, ['trouble', 'api', closed.id, 'severe']);
  assert.deepEqual([launchOf(h, closed).outcome, launchOf(h, closed).severe], ['trouble', true]);
});

test('work that never landed has no trouble to name', async t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'open', kind: 'fix', title: 'Not landed', brief }, NOW);

  const { code, result } = await work(h.root, ['trouble', 'api', id]);

  assert.deepEqual([code, result.ok], [1, false]);
  assert.match(result.message, /has not landed/);
});

test('the review run records how a change is undone, and work item checks it', async t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'done', kind: 'fix', title: 'Finished', brief }, NOW);
  const send = launch => work(h.root, ['item', 'api'], { id, state: 'branch', launch });

  for (const undo of ['code', 'one-way', 'forward-fix', 'two-phase', 'permanent']) assert.equal((await send({ undo })).code, 0);

  const refused = await send({ undo: 'maybe', risk: 'The refund branch.' });
  assert.deepEqual([refused.code, refused.result.ok], [1, false]);
  assert.match(refused.result.message, /undo must be one of/);
  assert.equal((await send({ risk: 'No undo at all.' })).code, 1);

  const launch = { undo: 'code', how: 'kamal rollback', risk: 'The refund branch.', lookAt: 'app/models/cashback.rb:42', flag: { name: 'refunds', expires: '2026-09-01' } };
  assert.equal((await send(launch)).code, 0);
  assert.deepEqual(itemsOf(h)[0].launch, launch);
});

test('a flag with no expiry is refused, because every flag gets one when it is made', async t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'done', kind: 'fix', title: 'Finished', brief }, NOW);

  const { code, result } = await work(h.root, ['item', 'api'], { id, launch: { undo: 'code', flag: { name: 'refunds' } } });

  assert.equal(code, 1);
  assert.match(result.message, /expires/);
  assert.equal(itemsOf(h)[0].launch, undefined);
});

/** A studied project with nothing due, ready for a test to say what landed. */
function looking(t, { signals = true } = {}) {
  const h = workspace(t);
  const at = iso(NOW);
  writeMode(h.root, { enabled: true });
  writeJson(join(h.root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: NOW + 3 * DAY } });
  writeJson(paths(h.root, 'api').state, { lastLookAt: at, lastLensAt: at, lastIdeasAt: at, lastSignalsAt: at });
  writeFileSync(paths(h.root, 'api').project, '# What it is\n');
  if (signals) watchable(h);
  return h;
}
const pushed = (h, item, at, details = {}) => recordLaunch(h.root, 'api', { item, sha: 'abc1234', stage: 'pushed', mergedAt: iso(at), pushedAt: iso(at), ...details }, at);
const watchLooks = (h, now, options = {}) => planWork(h.root, { now, ...options }).entries.filter(({ focus }) => focus === 'watch');
const watchedAt = (h, at) => writeState(h.root, 'api', { lastWatchAt: iso(at) });

test('a watch look comes an hour after a push, then every 12 hours, at its project\'s priority', t => {
  const h = looking(t);
  pushed(h, 'one', NOW);

  assert.deepEqual(watchLooks(h, NOW + HOUR - 1), []);
  const [look] = watchLooks(h, NOW + HOUR);
  assert.deepEqual([look.key, look.kind, look.lane, look.focus, look.grade], ['watch:api', 'watch', 'look', 'watch', 'P1']);

  watchedAt(h, NOW + HOUR);
  assert.deepEqual(watchLooks(h, NOW + 13 * HOUR - 1), []);
  assert.equal(watchLooks(h, NOW + 13 * HOUR).length, 1);
});

test('one project gets one watch look however many changes it covers', t => {
  const h = looking(t);
  pushed(h, 'one', NOW);
  pushed(h, 'two', NOW);
  pushed(h, 'three', NOW + HOUR / 2);

  assert.equal(watchLooks(h, NOW + 2 * HOUR).length, 1);
});

test('a new push gets its own first look an hour later, whatever the 12-hour clock says', t => {
  const h = looking(t);
  pushed(h, 'one', NOW);
  watchedAt(h, NOW + HOUR);
  pushed(h, 'two', NOW + 2 * HOUR);

  assert.deepEqual(watchLooks(h, NOW + 3 * HOUR - 1), []);
  assert.equal(watchLooks(h, NOW + 3 * HOUR).length, 1);
});

test('suspected trouble brings the look at once, at P0, and only once for each suspicion', t => {
  const h = looking(t);
  pushed(h, 'one', NOW, { suspectedAt: iso(NOW + 2 * HOUR) });
  watchedAt(h, NOW + HOUR);

  const [look] = watchLooks(h, NOW + 2 * HOUR);
  assert.deepEqual([look.grade, look.urgent, look.why], ['P0', true, 'trouble suspected']);

  watchedAt(h, NOW + 2 * HOUR + 1);
  assert.deepEqual(watchLooks(h, NOW + 3 * HOUR), []);
});

test('a project under signal 2 gets no watch look, whatever is suspected', t => {
  const h = looking(t, { signals: false });
  pushed(h, 'one', NOW, { suspectedAt: iso(NOW) });
  assert.deepEqual(watchLooks(h, NOW + DAY), [], 'no signals at all');

  recordSignals(h.root, 'api', { type: 'service', deploy: proof }, NOW);
  assert.deepEqual(watchLooks(h, NOW + DAY), [], 'signal 1');

  recordSignals(h.root, 'api', { type: 'service', deploy: proof, logs: proof }, NOW);
  assert.equal(watchLooks(h, NOW + DAY).length, 1);
});

test('what is not pushed, or is closed, is no reason for a look', t => {
  const h = looking(t);
  recordLaunch(h.root, 'api', { item: 'local', sha: 'abc1234', stage: 'merged', mergedAt: iso(NOW) }, NOW);
  pushed(h, 'over', NOW, { stage: 'closed', outcome: 'held' });

  assert.deepEqual(watchLooks(h, NOW + DAY), []);
});

test('asking for a watch look brings it forward while anything is open', t => {
  const h = looking(t);
  pickNext(h.root, 'watch:api');
  assert.deepEqual(watchLooks(h, NOW), []);

  pushed(h, 'one', NOW);
  assert.deepEqual(watchLooks(h, NOW).map(({ picked }) => picked), [true]);
});

test('a watch look stands beside a due lens instead of taking its turn, and one look runs at a time', t => {
  const h = looking(t);
  pushed(h, 'one', NOW);
  writeState(h.root, 'api', { lastLensAt: null });

  const { entries } = planWork(h.root, { now: NOW + HOUR, running: [{ slug: 'api', lane: 'look' }] });

  assert.deepEqual(entries.map(({ waiting }) => waiting), ['a look is running here', 'a look is running here']);
  assert.deepEqual(entries.map(({ kind }) => kind).toSorted(), ['look', 'watch']);
});

test('a watch look runs with what it needs, stamps its own clock and leaves the lenses where they were', async t => {
  const h = director(t);
  h.checkout = studied(h, 'api');
  h.merged = 0;
  watchable(h);
  const merged = land(h, { file: 'cashback.rb', launch: { undo: 'code', risk: 'The refund branch.', lookAt: 'cashback.rb:1' } });
  writeState(h.root, 'api', { lensIndex: 3 });

  await h.tick();
  assert.deepEqual(h.calls, [], 'the first pulse only opens the launch');

  h.clock += HOUR;
  await h.tick();

  assert.equal(h.calls.length, 1);
  const { focus, watch, commands } = h.work(h.calls[0]);
  assert.equal(focus, 'watch');
  assert.match(commands.watch, /work watch api/);
  const [launch] = watch.launches;
  assert.deepEqual([launch.item, launch.sha, launch.files, launch.stage], [merged.id, merged.sha, ['cashback.rb'], 'pushed']);
  assert.equal(launch.since, iso(NOW));
  assert.equal(launch.review.risk, 'The refund branch.');
  assert.equal(watch.signals.signal, 2);

  const { lastWatchAt, lensIndex } = readState(h.root, 'api');
  assert.deepEqual([lastWatchAt, lensIndex], [iso(NOW + HOUR), 3]);

  h.clock += 5 * HOUR;
  await h.tick();
  assert.deepEqual(h.calls.map(call => h.work(call).focus), ['watch', lenses[3]], 'the lens due by now, and no second watch look');
});

test('a signals look gets the last record and the command to record a new one', async t => {
  const h = director(t);
  studied(h, 'api');
  recordSignals(h.root, 'api', { type: 'site', deploy: proof }, h.clock - 31 * DAY);
  writeState(h.root, 'api', { lastSignalsAt: null });

  await h.tick();

  const { focus, signals, commands } = h.work(h.calls[0]);
  assert.equal(focus, 'signals');
  assert.equal(signals.signal, 1);
  assert.match(commands.signals, /work signals api/);
  assert.equal(readState(h.root, 'api').lastSignalsAt, iso(h.clock));
});

test('with the mode off the pulse goes on and no look starts, and what is due goes ahead when it comes back on', async t => {
  const h = director(t);
  h.checkout = studied(h, 'api');
  h.merged = 0;
  watchable(h);
  const merged = land(h);
  writeMode(h.root, { enabled: false });

  await h.tick();
  assert.equal(launchOf(h, merged).stage, 'pushed');

  h.clock += 2 * HOUR;
  await h.tick();
  assert.deepEqual(h.calls, []);

  writeMode(h.root, { enabled: true });
  await h.tick();
  assert.deepEqual(h.calls.map(call => h.work(call).focus), ['watch']);
});

test('trouble on a merge sends its urgent fix to the front, and nothing waits for it', async t => {
  const h = director(t);
  h.checkout = studied(h, 'api');
  h.merged = 0;
  const merged = land(h);
  git(h.checkout, 'revert', '--no-edit', '-m', '1', merged.sha);

  await h.tick();
  await h.tick();

  const [fix] = h.calls.map(call => h.work(call).item);
  assert.deepEqual([fix.causedBy, fix.urgent, fix.key], [merged.id, true, `trouble:${merged.id}`]);
});
