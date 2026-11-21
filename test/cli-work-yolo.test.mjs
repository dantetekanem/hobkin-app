import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { HobkinApplication } from '../src/cli/application.mjs';
import { clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { answerDecision, openDecisions } from '../src/cli/decisions.mjs';
import { surveyAndClose } from '../src/cli/work/closing.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import { recordMachines } from '../src/cli/work/machines.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, paths, prFile, readItems, readMode, skipProject, updateItem, writeMode, writeOwnerView, writeState } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { openReadinessPulls } from '../src/cli/work/yolo-parts.mjs';
import { whyItAsks, yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { holdProject, readinessOf, readYolo, recordReadiness, runReadiness, setYolo, yoloView } from '../src/cli/work/yolo.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { branched, commit, git, repository, withOrigin, writeJson } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const READY_KEY = 'yolo:ready';

const scored = (numbers = {}) => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: numbers[name] ?? 10, evidence: `What the review saw of ${name}.` }]));

const allReady = (change = {}) => ({
  tests: { ready: true, how: 'node --test runs 40 tests in 3 s.' },
  errors: { ready: true, how: 'Exceptions reach the error tracker, which mails the user.' },
  slowQueries: { ready: true, how: 'The database logs queries over 200 ms, and the test suite fails on an N+1.' },
  performance: { ready: true, how: 'Request and job timings are kept, with last week as the baseline.' },
  logs: { ready: true, how: 'bin/logs search finds any request by id.' },
  alerts: { ready: true, how: 'An alert goes to the user by mail within 5 minutes.' },
  rollback: { ready: true, how: 'bin/deploy rollback takes the last release back.' },
  deploy: { ready: true, how: 'bin/deploy from main, undone by bin/deploy rollback.' },
  ...change,
});

/** A part a readiness run set up on a branch of its own, for hobkin to open a PR for. */
const onBranch = (branch, how) => ({ branch, how, proof: `${how} Shown on ${branch}.` });
const PR_URL = 'https://example.com/pull/7';

/** gh as a test plays it: no PR open for a branch yet, and the address a new one gets. Anything else is an empty list. */
function fakeGh() {
  const calls = [];
  const gh = async args => {
    calls.push(args);
    return args[1] === 'create' ? `Creating pull request...\n${PR_URL}\n` : '[]';
  };
  return { gh, calls };
}

function workspace(t, projects = ['api']) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-yolo-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkouts = Object.fromEntries(projects.map(name => [name, repository(base, name)]));
  for (const name of projects) chooseProject(root, checkouts[name], 'important', NOW);
  // Each project's state machines were looked for with TLC and none found, so only what a test sets up decides its readiness.
  for (const name of projects) recordMachines(root, name, { machines: [] }, { tlc: true, now: NOW });
  writeMode(root, { enabled: true });
  return { base, root, checkouts };
}

const itemsOf = (h, slug = 'api') => readItems(h.root, slug);
const readinessItem = (h, slug = 'api') => itemsOf(h, slug).find(({ key }) => key === READY_KEY);
const statesOf = (h, slug = 'api') => Object.fromEntries(Object.entries(readinessOf(h.root, slug).parts).map(([name, { state }]) => [name, state]));
const bar = (h, slug = 'api') => [readinessOf(h.root, slug).ready, readinessOf(h.root, slug).needs];

/** Finished work on a branch of its own, reviewed at its head with these scores. */
function finished(h, title, { slug = 'api', kind = 'bug-fix', numbers, item = {} } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts[slug], branch);
  const head = git(h.checkouts[slug], 'rev-parse', branch);
  const { id } = fileItem(h.root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.', ...item }, NOW);
  updateItem(h.root, slug, id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind, scores: scored(numbers), head } }, NOW);
  return { id, branch, head };
}

test('turning it on files a readiness feature on each project and merges nothing', t => {
  const h = workspace(t, ['api', 'web']);
  const waiting = finished(h, 'Fix login');
  assert.deepEqual(readYolo(h.root), { on: false, rate: 8 }, 'a new home has it off');

  const turned = setYolo(h.root, { on: true }, NOW);

  assert.deepEqual([turned.on, turned.rate, turned.filed.length], [true, 8, 2]);
  assert.deepEqual(readMode(h.root).yolo, { on: true, rate: 8 });
  for (const slug of ['api', 'web']) {
    const { kind, title, state } = readinessItem(h, slug);
    assert.deepEqual([kind, title, state], ['feature', `Get ${slug} ready for YOLO mode`, 'open']);
  }
  assert.equal(itemsOf(h).find(({ id }) => id === waiting.id).state, 'branch');
  assert.equal(setYolo(h.root, { on: true }, NOW).filed.length, 0, 'a project is asked once');
});

test('YOLO mode may run once tests and rollback are in place on the default branch and no model there is broken, and the other parts are improvements', t => {
  const h = workspace(t, ['api', 'web']);
  setYolo(h.root, { on: true }, NOW);
  const { id } = readinessItem(h);

  assert.throws(() => recordReadiness(h.root, 'api', allReady(), NOW), /Only the run of this project's readiness item records it/);
  assert.deepEqual(readinessOf(h.root, 'api').needs, ['Its readiness has not been checked yet.']);

  updateItem(h.root, 'api', id, { state: 'doing' }, NOW);
  assert.throws(() => recordReadiness(h.root, 'api', allReady({ tests: { ready: true } }), NOW), /tests needs ready: true with how it works/);
  // Monitoring and a deploy path still being set up hold nothing back, even while the readiness run goes on.
  recordReadiness(h.root, 'api', allReady({
    errors: onBranch('hobkin/ready-monitoring', 'Exceptions reach Sentry.'),
    alerts: { user: { title: 'Turn on Sentry alerts by mail', step: 'In Sentry, under Alerts, create a rule that mails you on a new issue.' } },
    deploy: { user: { title: 'Say how this project deploys', step: 'Write the deploy command and the one that takes it back in docs/deploy.md.' } },
  }), NOW);
  assert.deepEqual(bar(h), [true, []]);
  assert.deepEqual(statesOf(h), { tests: 'done', errors: 'pr', slowQueries: 'done', performance: 'done', logs: 'done', alerts: 'user', rollback: 'done', deploy: 'user', models: 'done' });
  const needed = Object.entries(readinessOf(h.root, 'api').parts).filter(([, part]) => part.needed).map(([name]) => name);
  assert.deepEqual(needed, ['tests', 'rollback', 'models']);

  // Tests that pass only on a branch count once that branch merges.
  recordReadiness(h.root, 'api', allReady({ tests: onBranch('hobkin/ready-tests', 'bin/test runs 40 tests in 3 s.') }), NOW);
  assert.deepEqual(bar(h), [false, ['Tests: its branch waits for your merge.']]);
  const tests = itemsOf(h).find(({ key }) => key === 'yolo:pr:hobkin/ready-tests');
  updateItem(h.root, 'api', tests.id, { state: 'merged' }, NOW);
  assert.deepEqual([...bar(h), readinessOf(h.root, 'api').parts.tests.state], [true, [], 'done']);

  // A way back only the user can give holds the project until they give it.
  recordReadiness(h.root, 'api', allReady({ rollback: { user: { title: 'Keep two releases', step: 'Set retain_containers: 2 in config/deploy.yml.' } } }), NOW);
  assert.deepEqual(bar(h), [false, ['Rollback: waits on you: Keep two releases.']]);

  recordReadiness(h.root, 'api', allReady(), NOW);
  const view = yoloView(h.root);
  assert.deepEqual([view.on, view.rate, view.ready, view.projects.length], [true, 8, 1, 2]);
  assert.deepEqual(view.projects.map(({ slug, ready }) => [slug, ready]), [['api', true], ['web', false]]);
  assert.deepEqual(view.projects[0].parts.map(({ name, label, state }) => [name, label, state])[0], ['tests', 'Tests', 'done']);
});

/** rpsleague's record as its readiness run left it before readiness opened PRs: in place or missing, part by part, in that record's own shape. */
const RPSLEAGUE = {
  tests: { ready: true, how: 'bin/test runs the suite again, restored on the readiness branch.' },
  errors: { ready: false, missing: 'bin/production-errors has no valid scoped reader' },
  slowQueries: { ready: true, how: 'Query logging marks queries over 100 ms, on the readiness branch.' },
  performance: { ready: true, how: 'Request timings are kept, with last week as the baseline.' },
  logs: { ready: true, how: 'kamal app logs --grep finds a request by id.' },
  alerts: { ready: false, missing: 'no controlled Sentry alert verified' },
  rollback: { ready: true, how: 'kamal rollback takes the last release back.' },
  deploy: { ready: false, missing: 'builders ~51 MiB free; release image unverified' },
};

test('rpsleague\'s record: its readiness branch is offered as a PR on its own, and YOLO mode may run there once that merges', async t => {
  const h = workspace(t, ['rpsleague']);
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(h.base, 'pi');
  t.after(() => {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  });
  const origin = withOrigin(h.base, h.checkouts.rpsleague);
  // Its state machines look never finished.
  recordMachines(h.root, 'rpsleague', { machines: [] }, { tlc: false, now: NOW });
  runReadiness(h.root, 'rpsleague', NOW);
  const { id } = readinessItem(h, 'rpsleague');
  const branch = 'hobkin/ready-rpsleague';
  branched(h.checkouts.rpsleague, branch, 'bin-test', 'restored\n');
  atomicJson(join(paths(h.root, 'rpsleague').directory, 'yolo.json'), { parts: RPSLEAGUE, at: new Date(NOW).toISOString() });
  updateItem(h.root, 'rpsleague', id, { state: 'branch', branch, proof: 'bin/test passes on the branch.' }, NOW);

  // What it set up waits on its branch, and what it found missing is still to do. Neither is a verdict on the project.
  assert.deepEqual(bar(h, 'rpsleague'), [false, ['Tests: its branch waits for your merge.', 'Rollback: its branch waits for your merge.']]);
  assert.deepEqual(statesOf(h, 'rpsleague'), { tests: 'pr', errors: 'todo', slowQueries: 'pr', performance: 'pr', logs: 'pr', alerts: 'todo', rollback: 'pr', deploy: 'todo', models: 'doing' });
  assert.equal(readinessOf(h.root, 'rpsleague').parts.errors.line, 'bin/production-errors has no valid scoped reader');

  // The owner's survey offers that branch as a PR by itself.
  const { gh, calls } = fakeGh();
  const director = new WorkDirector({ root: h.root, now: () => NOW, gh, onChange: () => {} });
  director.surveyWork();
  await director.surveying;

  assert.deepEqual([readinessItem(h, 'rpsleague').state, readinessItem(h, 'rpsleague').pr], ['pr', PR_URL]);
  assert.ok(calls.some(args => args[1] === 'create' && args.includes(branch)));
  assert.equal(git(origin, 'rev-parse', branch), git(h.checkouts.rpsleague, 'rev-parse', branch));
  assert.deepEqual(readinessOf(h.root, 'rpsleague').parts.tests, {
    state: 'pr', line: RPSLEAGUE.tests.how, needed: true, blocks: true, pr: PR_URL, branch, item: id,
  });

  // Merging it is the user's one yes, and the rest stay improvements.
  updateItem(h.root, 'rpsleague', id, { state: 'merged' }, NOW);
  assert.deepEqual(bar(h, 'rpsleague'), [true, []]);
  assert.deepEqual(statesOf(h, 'rpsleague'), { tests: 'done', errors: 'todo', slowQueries: 'done', performance: 'done', logs: 'done', alerts: 'todo', rollback: 'done', deploy: 'todo', models: 'doing' });
});

test('each part a readiness run set up goes in a PR hobkin opens, and each step only the user can take is one action item', async t => {
  const h = workspace(t);
  const origin = withOrigin(h.base, h.checkouts.api);
  runReadiness(h.root, 'api', NOW);
  const readiness = readinessItem(h);
  updateItem(h.root, 'api', readiness.id, { state: 'doing' }, NOW);
  branched(h.checkouts.api, 'hobkin/ready-monitoring', 'sentry.txt', 'sentry\n');
  const dsn = { title: 'Put SENTRY_DSN in production', step: 'Add SENTRY_DSN under env.secret in config/deploy.yml, and its value from Sentry, Settings, Client Keys, to .kamal/secrets.' };
  const space = { title: 'Free space on the builder', step: 'Run docker system prune -af on the builder host, then bin/kamal build push.' };

  // A part is never only a verdict.
  assert.throws(() => recordReadiness(h.root, 'api', allReady({ errors: { ready: false, missing: 'No error tracker.' } }), NOW), /never recorded as only missing/);
  assert.throws(() => recordReadiness(h.root, 'api', allReady({ errors: { branch: 'main', how: 'Sentry.', proof: 'Seen.' } }), NOW), /a hobkin\/ branch/);
  assert.throws(() => recordReadiness(h.root, 'api', allReady({ errors: { user: { title: 'Set it up' } } }), NOW), /the one step only the user can take/);
  assert.equal(itemsOf(h).length, 1, 'a refused record files nothing');

  recordReadiness(h.root, 'api', allReady({
    errors: { ...onBranch('hobkin/ready-monitoring', 'Sentry takes every exception.'), user: dsn },
    alerts: { ...onBranch('hobkin/ready-monitoring', 'A new Sentry issue mails the user.'), user: dsn },
    deploy: { user: space },
  }), NOW);

  // Related parts on one branch are one PR, and one step two parts need is one action item.
  const pulls = itemsOf(h).filter(({ key }) => key.startsWith('yolo:pr:'));
  assert.deepEqual(pulls.map(({ kind, title, state, branch }) => [kind, title, state, branch]), [['feature', 'YOLO readiness: error tracking and alerts', 'branch', 'hobkin/ready-monitoring']]);
  assert.match(readFileSync(prFile(h.root, 'api', pulls[0].id), 'utf8'), /Sentry takes every exception\.[\s\S]*A new Sentry issue mails the user\./);
  const asked = openDecisions(h.root).filter(({ key }) => key?.startsWith('yolo:api:'));
  assert.deepEqual(asked.map(({ tldr, question }) => [tldr, question]), [[dsn.title, dsn.step], [space.title, space.step]]);

  const { gh, calls } = fakeGh();
  await openReadinessPulls(h.root, { gh, now: NOW });

  const pull = itemsOf(h).find(({ id }) => id === pulls[0].id);
  assert.deepEqual([pull.state, pull.pr], ['pr', PR_URL]);
  assert.equal(git(origin, 'rev-parse', 'hobkin/ready-monitoring'), git(h.checkouts.api, 'rev-parse', 'hobkin/ready-monitoring'));
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [['pr', 'list'], ['pr', 'create']]);
  const { errors, alerts, deploy } = readinessOf(h.root, 'api').parts;
  assert.deepEqual(errors, { state: 'user', line: dsn.title, needed: false, blocks: false, pr: PR_URL, branch: 'hobkin/ready-monitoring', item: pull.id, action: asked[0].id });
  assert.deepEqual([alerts.state, alerts.action, deploy.state, deploy.action], ['user', asked[0].id, 'user', asked[1].id]);

  // Once the user did a step, a part waits on its PR, and a part with nothing else to wait on is the next check's to confirm.
  answerDecision(h.root, asked[0].id, 'done', NOW);
  answerDecision(h.root, asked[1].id, 'done', NOW);
  assert.deepEqual([readinessOf(h.root, 'api').parts.errors.state, readinessOf(h.root, 'api').parts.deploy.state], ['pr', 'doing']);

  // Each branch is offered once.
  await openReadinessPulls(h.root, { gh, now: NOW });
  assert.equal(calls.length, 2);
});

test('a part whose PR cannot open from the readiness run waits on its branch and says why, and the owner\'s survey tries once more', async t => {
  const h = workspace(t);
  runReadiness(h.root, 'api', NOW);
  updateItem(h.root, 'api', readinessItem(h).id, { state: 'doing' }, NOW);
  branched(h.checkouts.api, 'hobkin/ready-tests', 'bin-test', 'restored\n');

  const { message, ready } = await runWorkCommand(h.root, ['yolo', 'api'], Readable.from([JSON.stringify(allReady({ tests: onBranch('hobkin/ready-tests', 'bin/test runs 40 tests in 3 s.') }))]));

  assert.equal(ready, false);
  assert.match(message, /^Recorded the readiness of api\. YOLO mode waits on: Tests: its branch waits for your merge\./);
  const { tests } = readinessOf(h.root, 'api').parts;
  assert.deepEqual([tests.state, tests.pr, tests.problem], ['pr', undefined, 'api has no origin to push to, so no PR was opened.']);

  withOrigin(h.base, h.checkouts.api);
  const { gh } = fakeGh();
  await openReadinessPulls(h.root, { gh, now: NOW });
  assert.deepEqual([readinessOf(h.root, 'api').parts.tests.state, readinessOf(h.root, 'api').parts.tests.pr], ['pr', PR_URL]);
});

test('no hobkin work command changes YOLO mode, and a rate outside 6 to 10 is refused', async t => {
  const h = workspace(t);

  await assert.rejects(runWorkCommand(h.root, ['yolo', 'on']), /Unknown project: on/);
  assert.equal(readYolo(h.root).on, false);
  const view = await runWorkCommand(h.root, ['yolo']);
  assert.deepEqual([view.on, view.rate, view.ready], [false, 8, 0]);

  for (const rate of [5, 11, 7.5, '8']) assert.throws(() => setYolo(h.root, { on: true, rate }, NOW), /a whole number from 6 to 10/);
  assert.throws(() => setYolo(h.root, { on: 'yes' }, NOW), /on or off/);
  assert.equal(readMode(h.root).yolo, undefined, 'a refused change writes nothing');

  assert.deepEqual(setYolo(h.root, { rate: 9 }, NOW), { on: false, rate: 9, filed: [] });
  assert.equal(readinessItem(h), undefined, 'a rate alone files nothing');
});

/** A project the user's yes made ready: every part recorded as in place, and the readiness work merged. */
function makeReady(h, slug = 'api', parts = allReady()) {
  setYolo(h.root, { on: true }, NOW);
  const { id } = readinessItem(h, slug);
  updateItem(h.root, slug, id, { state: 'doing' }, NOW);
  recordReadiness(h.root, slug, parts, NOW);
  updateItem(h.root, slug, id, { state: 'merged' }, NOW);
}

const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
const stateOf = (h, { id }, slug = 'api') => itemsOf(h, slug).find(item => item.id === id).state;
const ledger = h => (existsSync(join(h.root, 'work', 'yolo.jsonl')) ? readFileSync(join(h.root, 'work', 'yolo.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []);
const onMain = (h, { head }, slug = 'api') => git(h.checkouts[slug], 'branch', '--contains', head, '--format=%(refname:short)').split('\n').includes('main');

test('with YOLO mode off nothing merges by itself', async t => {
  const h = workspace(t);
  makeReady(h);
  setYolo(h.root, { on: false }, NOW);
  const perfect = finished(h, 'Fix login');
  await survey(h);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.equal(stateOf(h, perfect), 'branch');
  assert.equal(onMain(h, perfect), false);
  assert.deepEqual(ledger(h), []);
});

test('a project that is not ready never merges by itself, even at rate 10', async t => {
  const h = workspace(t, ['api', 'web']);
  setYolo(h.root, { on: true, rate: 6 }, NOW);
  // api: every part is in place, and its readiness work still waits for the user's yes.
  updateItem(h.root, 'api', readinessItem(h, 'api').id, { state: 'doing' }, NOW);
  recordReadiness(h.root, 'api', allReady(), NOW);
  updateItem(h.root, 'api', readinessItem(h, 'api').id, { state: 'branch', branch: 'hobkin/ready' }, NOW);
  // web: its readiness work landed, and its tests pass only on a branch that waits for the user's merge.
  updateItem(h.root, 'web', readinessItem(h, 'web').id, { state: 'doing' }, NOW);
  recordReadiness(h.root, 'web', allReady({ tests: onBranch('hobkin/web-tests', 'bin/test runs again.') }), NOW);
  updateItem(h.root, 'web', readinessItem(h, 'web').id, { state: 'merged' }, NOW);
  const onApi = finished(h, 'Fix login');
  const onWeb = finished(h, 'Fix signup', { slug: 'web' });
  await survey(h);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.deepEqual([stateOf(h, onApi), stateOf(h, onWeb, 'web')], ['branch', 'branch']);
  assert.deepEqual([onMain(h, onApi), onMain(h, onWeb, 'web')], [false, false]);
});

test('on a ready project a small change at the user\'s rate merges by itself at its scored commit', async t => {
  const h = workspace(t);
  makeReady(h);
  const good = finished(h, 'Fix login', { numbers: { coverage: 8, proof: 8, safety: 9, visibility: 8, rollback: 9 } });
  const alsoGood = finished(h, 'Speed up search', { kind: 'performance' });
  const underRate = finished(h, 'Fix logout', { numbers: { coverage: 7, proof: 7, safety: 9, visibility: 7, rollback: 9 } });
  const unsafe = finished(h, 'Fix totals', { numbers: { safety: 7 } });
  await survey(h);

  const [first, ...rest] = await yoloPass(h.root, { now: NOW });

  assert.deepEqual(rest, [], 'one change a project in a pass');
  const merged = [good, alsoGood].filter(change => stateOf(h, change) === 'merged');
  assert.equal(merged.length, 1);
  assert.equal(first.head, merged[0].head);
  assert.equal(itemsOf(h).find(({ id }) => id === merged[0].id).landed.route, 'yolo');
  assert.equal(onMain(h, merged[0]), true);

  await survey(h);
  await yoloPass(h.root, { now: NOW });

  assert.deepEqual([good, alsoGood, underRate, unsafe].map(change => stateOf(h, change)), ['merged', 'merged', 'branch', 'branch']);
  assert.deepEqual([onMain(h, underRate), onMain(h, unsafe)], [false, false]);
});

test('scores for an older commit never count', async t => {
  const h = workspace(t);
  makeReady(h);
  const movedBeforeTheSurvey = finished(h, 'Fix login');
  const movedAfterTheSurvey = finished(h, 'Fix logout');
  const moveOn = ({ branch }) => {
    git(h.checkouts.api, 'switch', '-q', branch);
    commit(h.checkouts.api, `${branch.replaceAll('/', '-')}-more.txt`, 'more\n');
    git(h.checkouts.api, 'switch', '-q', 'main');
  };
  moveOn(movedBeforeTheSurvey);
  await survey(h);
  moveOn(movedAfterTheSurvey);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.deepEqual([stateOf(h, movedBeforeTheSurvey), stateOf(h, movedAfterTheSurvey)], ['branch', 'branch']);
  assert.deepEqual([onMain(h, movedBeforeTheSurvey), onMain(h, movedAfterTheSurvey)], [false, false]);
});

test('a feature or an unclear change never merges by itself', async t => {
  const h = workspace(t);
  makeReady(h);
  const feature = finished(h, 'Add exports', { kind: 'feature' });
  const unclear = finished(h, 'Rework billing', { kind: 'unclear' });
  const filedAsFeature = finished(h, 'Add imports', { kind: 'small-change', item: { kind: 'feature' } });
  await survey(h);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.deepEqual([feature, unclear, filedAsFeature].map(change => stateOf(h, change)), ['branch', 'branch', 'branch']);
});

test('each merge by itself is reported in Chat and in the ledger, and its deploy is handed on', async t => {
  const h = workspace(t, ['api', 'lib']);
  makeReady(h);
  makeReady(h, 'lib', allReady({ deploy: { ready: true, how: 'Nothing deploys: other projects use it from source.', deploys: false } }));
  const onApi = finished(h, 'Fix login', { numbers: { coverage: 9, proof: 9, safety: 9, visibility: 8, rollback: 9 } });
  const onLib = finished(h, 'Bump parser', { slug: 'lib', kind: 'package-update' });
  await survey(h);
  const handed = [];

  const reports = await yoloPass(h.root, { now: NOW, handOff: job => handed.push(job) });

  assert.deepEqual(reports.map(({ slug, title, kind, rate, deploy }) => [slug, title, kind, rate, deploy]).sort(), [
    ['api', 'Fix login', 'bug-fix', 8.8, 'handed on'],
    ['lib', 'Bump parser', 'package-update', 10, 'nothing deploys'],
  ]);
  assert.deepEqual(ledger(h), reports);
  const api = reports.find(({ slug }) => slug === 'api');
  assert.deepEqual([api.item, api.head, api.at, api.scores.safety], [onApi.id, onApi.head, new Date(NOW).toISOString(), 9]);
  assert.equal(api.target, git(h.checkouts.api, 'rev-parse', 'main'));

  const lines = clientNoticesToPost(h.root).map(({ line }) => line);
  assert.ok(lines.includes(`YOLO mode merged "Fix login" on api by itself: a bug fix rated 8.8, at ${onApi.head.slice(0, 7)}. Its deploy is with the main agent.`), lines.join('\n'));
  assert.ok(lines.includes(`YOLO mode merged "Bump parser" on lib by itself: a package update rated 10, at ${onLib.head.slice(0, 7)}. Nothing deploys on this project.`), lines.join('\n'));

  assert.equal(handed.length, 1);
  const [job] = handed;
  assert.deepEqual([job.project, job.item, job.title, job.commit], ['api', onApi.id, 'Fix login', api.target]);
  assert.match(job.asked, /Deploy exactly that commit by the project's recorded path: bin\/deploy from main, undone by bin\/deploy rollback\./);
});

/** The description a run saves for its branch. Without one the survey sends an agent to write it, and the branch waits for that. */
function describe(h, { slug = 'api', id }) {
  mkdirSync(dirname(prFile(h.root, slug, id)), { recursive: true });
  writeFileSync(prFile(h.root, slug, id), 'What changed and why.\n');
}

test('with YOLO mode on, a finished branch on a ready project gets its review by itself', async t => {
  const h = workspace(t, ['api', 'web']);
  makeReady(h);
  // Described and proved, with no scores yet, so a review is all each one lacks.
  const unscored = ({ slug, id }) => {
    describe(h, { slug, id });
    updateItem(h.root, slug, id, { review: null }, NOW);
  };
  const onReady = { slug: 'api', ...finished(h, 'Fix login') };
  const onUnready = { slug: 'web', ...finished(h, 'Fix signup', { slug: 'web' }) };
  [onReady, onUnready].forEach(unscored);

  await surveyAndClose(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

  const asked = ({ slug, id }) => Boolean(itemsOf(h, slug).find(item => item.id === id).reviewAsked);
  assert.deepEqual([asked(onReady), asked(onUnready)], [true, false]);
});

test('the director runs the pass after its own survey, and hands the deploy on', async t => {
  const h = workspace(t);
  // The survey's own reader of review grades looks in Pi's folder, and a test has none.
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(h.base, 'pi');
  t.after(() => {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  });
  makeReady(h);
  const first = finished(h, 'Fix login');
  describe(h, first);
  const handed = [];
  let changes = 0;
  const directorAt = now => new WorkDirector({ root: h.root, now: () => now, gh: async () => '[]', onChange: () => { changes += 1; }, onHandOff: job => handed.push(job) });

  const director = directorAt(NOW);
  director.surveyWork();
  await director.surveying;

  assert.equal(stateOf(h, first), 'merged');
  assert.deepEqual(handed.map(({ item, why }) => [item, why]), [[first.id, 'YOLO mode is on and this project is ready for it']]);
  assert.ok(changes > 0, 'the window hears of a merge at once');

  // The same survey with the switch off merges nothing.
  setYolo(h.root, { on: false }, NOW);
  const second = finished(h, 'Fix logout');
  describe(h, second);
  const later = directorAt(NOW + 3600000);
  later.surveyWork();
  await later.surveying;

  assert.equal(stateOf(h, second), 'branch');
  assert.equal(handed.length, 1);

  // And on again, the next survey takes it: only the switch held it.
  setYolo(h.root, { on: true }, NOW);
  const again = directorAt(NOW + 2 * 3600000);
  again.surveyWork();
  await again.surveying;

  assert.equal(stateOf(h, second), 'merged');
  assert.equal(handed.length, 2);
});

test('monitoring and a deploy path still being set up hold no change back, and with no deploy path nothing is deployed', async t => {
  const h = workspace(t);
  setYolo(h.root, { on: true, rate: 6 }, NOW);
  const { id } = readinessItem(h);
  updateItem(h.root, 'api', id, { state: 'doing' }, NOW);
  const { errors, slowQueries, performance, logs, alerts, ...withoutMonitoring } = allReady();

  // Each part is still said, one way or another.
  assert.throws(() => recordReadiness(h.root, 'api', withoutMonitoring, NOW), /errors needs ready: true with how it works/);
  assert.throws(() => recordReadiness(h.root, 'api', allReady({ slowQueries: { notApplicable: ' ' } }), NOW), /slowQueries needs/);
  assert.throws(() => recordReadiness(h.root, 'api', allReady({ tests: { notApplicable: 'It has none.' } }), NOW), /tests needs/);

  recordReadiness(h.root, 'api', allReady({
    errors: onBranch('hobkin/ready-monitoring', 'Sentry takes every exception.'),
    slowQueries: { notApplicable: 'It has no database.' },
    deploy: { user: { title: 'Say how this project deploys', step: 'Write the deploy command and the one that takes it back in docs/deploy.md.' } },
  }), NOW);
  updateItem(h.root, 'api', id, { state: 'done' }, NOW);
  assert.deepEqual(readinessOf(h.root, 'api').parts.slowQueries, { state: 'done', line: 'It has no database.', needed: false, blocks: false });
  assert.deepEqual(bar(h), [true, []]);

  const perfect = finished(h, 'Fix login');
  await survey(h);
  const handed = [];
  const [merged, ...rest] = await yoloPass(h.root, { now: NOW, handOff: job => handed.push(job) });

  assert.deepEqual([merged.item, merged.deploy, rest, handed], [perfect.id, 'no deploy path', [], []]);
  assert.equal(stateOf(h, perfect), 'merged');
  const lines = clientNoticesToPost(h.root).map(({ line }) => line);
  assert.ok(lines.includes(`YOLO mode merged "Fix login" on api by itself: a bug fix rated 10, at ${perfect.head.slice(0, 7)}. Nothing was deployed: its deploy path is not set up yet.`), lines.join('\n'));
});

test('a change whose regression would not show in the monitoring never merges by itself', async t => {
  const h = workspace(t);
  setYolo(h.root, { on: true, rate: 6 }, NOW);
  makeReady(h);
  const unseen = finished(h, 'Speed up search', { kind: 'performance', numbers: { visibility: 6 } });
  await survey(h);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.equal(stateOf(h, unseen), 'branch');
  assert.equal(readyItems(h.root)[0].review.rate, 9.2, 'the average alone would pass');
  assert.deepEqual(readyItems(h.root)[0].review.floors, [{ criterion: 'visibility', score: 6, needs: 7 }]);
});

test('after a deploy the report says what the monitoring showed, and a regression is a problem at once', async t => {
  const h = workspace(t);
  makeReady(h);
  const quiet = finished(h, 'Fix login');
  await survey(h);
  const handed = [];
  await yoloPass(h.root, { now: NOW, handOff: job => handed.push(job) });
  assert.match(handed[0].asked, /watch its monitoring for 30 minutes/);
  assert.match(handed[0].asked, new RegExp(`hobkin work yolo api ${quiet.id}`));
  const calm = part => ({ regressed: false, saw: `Nothing new in ${part}.` });
  const reading = (change = {}) => ({ minutes: 30, errors: calm('errors'), slowQueries: calm('slow queries'), latency: { regressed: false, saw: 'p95 118 ms against a baseline of 120 ms.' }, ...change });
  const after = (id, sent) => runWorkCommand(h.root, ['yolo', 'api', id], Readable.from([JSON.stringify(sent)]));

  // Only a change YOLO mode merged has a deploy to report on, and a calm reading has to cover the whole window.
  const byHand = finished(h, 'Fix logout');
  await assert.rejects(after(byHand.id, reading()), /YOLO mode did not merge/);
  await assert.rejects(after(quiet.id, reading({ minutes: 5 })), /the whole 30 minutes/);
  await assert.rejects(after(quiet.id, reading({ latency: { regressed: false } })), /latency needs/);

  await after(quiet.id, reading());

  const [, said] = ledger(h);
  assert.deepEqual([said.item, said.after.minutes, said.regressed], [quiet.id, 30, []]);
  const calmLine = clientNoticesToPost(h.root).map(({ line }) => line).find(line => line.startsWith('After its deploy'));
  assert.equal(calmLine, 'After its deploy, "Fix login" on api held for 30 minutes: Nothing new in errors. Nothing new in slow queries. p95 118 ms against a baseline of 120 ms.');
  assert.equal(readinessOf(h.root, 'api').ready, true);

  // A regression is told at once, however short the look, as a problem with its fix filed, and the project stops merging by itself.
  await after(quiet.id, reading({ minutes: 4, slowQueries: { regressed: true, saw: 'orders#index now runs a 900 ms query.' } }));

  const problem = clientNoticesToPost(h.root).find(({ line }) => line.startsWith('Problem after YOLO mode deployed'));
  assert.deepEqual([problem.tone, problem.line], ['critical', 'Problem after YOLO mode deployed "Fix login" on api: orders#index now runs a 900 ms query. Its fix is filed, and api asks you again until its readiness is checked.']);
  assert.deepEqual(ledger(h).at(-1).regressed, ['slowQueries']);
  assert.ok(itemsOf(h).some(({ causedBy }) => causedBy === quiet.id), 'the fix is filed as trouble on that change');
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs], [false, ['A regression showed after "Fix login" deployed. Retry its readiness work once that is fixed.']]);

  const next = finished(h, 'Fix signup');
  await survey(h);
  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);
  assert.equal(stateOf(h, next), 'branch');
});

const SPEC = '_specs/tla/WorkItem.tla';
const specText = '---- MODULE WorkItem ----\n\\* models: app.txt\n====\n';
const specHash = createHash('sha256').update(specText).digest('hex');

function withSpec(h, slug = 'api') {
  mkdirSync(join(h.checkouts[slug], '_specs', 'tla'), { recursive: true });
  commit(h.checkouts[slug], SPEC, specText);
}

/** A run as `hobkin proof check` leaves it, which only that process writes. */
const writeRun = (h, id, change) => writeJson(join(h.root, 'proofs', id, 'result.json'), {
  id,
  project: 'api',
  spec: SPEC,
  specHash,
  outcome: 'holds',
  finished: new Date(NOW).toISOString(),
  stats: { generated: 40, distinct: 12, queue: 0, depth: 4 },
  rules: [{ name: 'MergedAtReviewedHead', kind: 'invariant', status: 'holds' }],
  actions: [{ name: 'Merge', count: 3 }],
  ...change,
});
const brokenRun = { outcome: 'broken', broken: 'MergedAtReviewedHead', traceLength: 5 };

test('a model that breaks at a change\'s head, or has not held there, keeps it asking in a plain line', () => {
  const head = 'c'.repeat(40);
  const review = { kind: 'bug-fix', scores: scored(), head };
  const unit = { sha: head, area: 'app', conflict: false, size: { additions: 1, deletions: 0, files: 1 }, paths: ['app.txt'] };
  // Everything else about this change would let it merge by itself.
  const asks = models => whyItAsks({
    yolo: { on: true, rate: 8 },
    project: {},
    readiness: { ready: true },
    landable: true,
    row: { holds: 0 },
    item: { state: 'branch', kind: 'fix', review },
    unit,
    models,
  });
  const model = change => ({ spec: SPEC, changed: false, ...change });

  assert.equal(asks([]), null, 'a change no model covers goes on its scores');
  assert.equal(asks([model({ state: 'holds', run: 'held' })]), null);
  assert.equal(asks([model({ state: 'unchecked' })]), 'its model WorkItem.tla has not been checked at this commit yet');
  assert.equal(asks([model({ state: 'unproven', run: 'r', why: 'Decline never fired' })]), 'its model WorkItem.tla did not hold at this commit: Decline never fired');
  assert.equal(
    asks([model({ state: 'unchecked' }), model({ spec: '_specs/tla/Queue.tla', state: 'broken', run: 'r', why: 'MergedAtReviewedHead' })]),
    'its model Queue.tla breaks at this commit: MergedAtReviewedHead',
    'a broken model is the reason said, before its proof score of 3',
  );
});

/** Finished work that changes the file the model covers, reviewed at its head with every score at 10. */
function modeledChange(h, title) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts.api, branch, 'app.txt', `${title}\n`);
  const head = git(h.checkouts.api, 'rev-parse', branch);
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores: scored(), head } }, NOW);
  return { id, branch, head };
}

test('on a ready project a change whose model broke at its head never merges by itself, and one whose model held there does', async t => {
  const h = workspace(t);
  withSpec(h);
  writeRun(h, 'on-main', { head: git(h.checkouts.api, 'rev-parse', 'main') });
  makeReady(h);
  const broke = modeledChange(h, 'Fix merge');
  const held = modeledChange(h, 'Fix merge again');
  await survey(h);
  writeRun(h, 'broke', { head: broke.head, item: broke.id, ...brokenRun });
  writeRun(h, 'held', { head: held.head, item: held.id });

  const reports = await yoloPass(h.root, { now: NOW, spawn: () => assert.fail('a commit already checked is not checked again') });

  assert.deepEqual(reports.map(({ item }) => item), [held.id]);
  assert.deepEqual([stateOf(h, broke), stateOf(h, held)], ['branch', 'merged']);
  assert.deepEqual(readyItems(h.root).find(({ item }) => item === broke.id).review.scores.proof, {
    score: 3, evidence: `WorkItem.tla: TLC: MergedAtReviewedHead breaks in 5 steps · at ${broke.head.slice(0, 7)}`, by: 'hobkin', run: 'broke',
  });
});

test('readiness has a models part: each spec on the default branch holds there', async t => {
  const h = workspace(t);
  makeReady(h);
  const models = () => readinessOf(h.root, 'api').parts.models;
  assert.deepEqual(models(), { state: 'done', line: 'Its state machines look found none.', needed: true, blocks: false });
  assert.equal(readinessOf(h.root, 'api').ready, true, 'a project whose look found no machine is ready without one');

  // The look files each machine it modeled with the spec's path, and its path stays inside the project.
  const machine = { key: 'machine:work-item', kind: 'chore', title: 'Commit the work item model', brief: 'Its spec, run and how to prove it.', spec: SPEC };
  fileItem(h.root, 'api', machine, NOW);
  assert.throws(() => fileItem(h.root, 'api', { ...machine, key: 'machine:other', spec: '../outside.tla' }, NOW), /spec is the model's path/);
  const needs = () => [readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs];

  // A model nobody has checked there yet is hobkin's to check, and holds nothing back; only a broken one does.
  withSpec(h);
  await survey(h);
  assert.deepEqual(needs(), [true, []]);
  assert.deepEqual(models(), { state: 'doing', line: 'WorkItem.tla has not been checked on the default branch yet.', needed: true, blocks: false });

  const tip = git(h.checkouts.api, 'rev-parse', 'main');
  writeRun(h, 'main-broke', { head: tip, finished: new Date(NOW).toISOString(), ...brokenRun });
  assert.deepEqual(needs(), [false, ['Models: WorkItem.tla breaks on the default branch: MergedAtReviewedHead.']]);
  assert.deepEqual(yoloView(h.root).projects[0].models.map(({ spec, state, run }) => [spec, state, run]), [[SPEC, 'broken', 'main-broke']]);

  writeRun(h, 'main-held', { head: tip, finished: new Date(NOW + 3600000).toISOString() });
  assert.deepEqual(needs(), [true, []]);
  assert.deepEqual(models(), { state: 'done', line: '1 model holds on the default branch: WorkItem.tla.', needed: true, blocks: false });

  // A machine the look found whose files that model names is modeled, and one it does not name waits for a change to it.
  recordMachines(h.root, 'api', { machines: [{ name: 'Work item', files: ['app.txt'] }, { name: 'Deploy', files: ['deploy.txt'] }] }, { tlc: true, now: NOW });
  assert.deepEqual(models(), {
    state: 'done',
    line: '1 model holds on the default branch: WorkItem.tla. 1 machine has no model on the default branch yet, so a change to it gets its model first.',
    needed: true,
    blocks: false,
  });
});

const HOUR = 3600000;
const checks = h => yoloView(h.root).projects.map(({ slug, work, checkedAt }) => [slug, work, checkedAt]);

/** A project made ready by its own readiness run alone, with YOLO mode never turned on. */
function checkedAlone(h, slug) {
  runReadiness(h.root, slug, NOW);
  const { id } = readinessItem(h, slug);
  updateItem(h.root, slug, id, { state: 'doing' }, NOW);
  recordReadiness(h.root, slug, allReady(), NOW);
  updateItem(h.root, slug, id, { state: 'merged' }, NOW);
}

test('one project\'s readiness runs on its own with YOLO mode off, and running it merges nothing', t => {
  const h = workspace(t, ['api', 'web']);
  checkedAlone(h, 'web');
  assert.equal(readinessOf(h.root, 'web').ready, true, 'a project can be got ready before the switch is turned on');
  const waiting = finished(h, 'Fix signup', { slug: 'web' });
  assert.deepEqual(checks(h), [['api', 'none', null], ['web', 'landed', new Date(NOW).toISOString()]]);

  const { message } = runReadiness(h.root, 'api', NOW);

  const { id, kind, title, state, brief } = readinessItem(h);
  assert.deepEqual([kind, title, state], ['feature', 'Get api ready for YOLO mode', 'open']);
  assert.doesNotMatch(brief, /YOLO mode is on/, 'the run is not told YOLO mode is on when it is off');
  assert.match(message, /^Queued "Get api ready for YOLO mode" on api to start at once\./);
  assert.deepEqual(readMode(h.root).queueNext[0], `item:api:${id}`, 'it starts the way Start now starts a queue row');
  assert.ok(readMode(h.root).queueNow.includes(`item:api:${id}`));
  assert.deepEqual(checks(h), [['api', 'queued', null], ['web', 'landed', new Date(NOW).toISOString()]]);
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs], [false, ['Its readiness has not been checked yet.']]);
  assert.equal(readYolo(h.root).on, false, 'the switch stays the user\'s');
  assert.equal(stateOf(h, waiting, 'web'), 'branch');
  assert.equal(onMain(h, waiting, 'web'), false);
  assert.deepEqual(ledger(h), []);
});

test('checking again opens landed readiness work on a fresh branch, and its new record lifts a hold', t => {
  const h = workspace(t);
  makeReady(h);
  const before = readinessItem(h);
  updateItem(h.root, 'api', before.id, { branch: 'hobkin/ready-before', attempts: 2, lastError: 'An earlier run failed.' }, NOW);
  holdProject(h.root, 'api', { item: 'abc123', title: 'Fix login' }, NOW);

  runReadiness(h.root, 'api', NOW + HOUR);

  const again = readinessItem(h);
  assert.equal(again.id, before.id, 'the same readiness work, run again');
  assert.deepEqual([again.state, again.attempts, again.lastError], ['open', 0, null]);
  assert.ok(again.branch.startsWith('hobkin/') && again.branch !== 'hobkin/ready-before', 'a fresh branch, so the run starts from the default branch');
  assert.deepEqual(checks(h), [['api', 'queued', new Date(NOW).toISOString()]], 'the last check stands until the next one records');
  assert.equal(readinessOf(h.root, 'api').ready, false);

  updateItem(h.root, 'api', again.id, { state: 'doing' }, NOW + HOUR);
  recordReadiness(h.root, 'api', allReady(), NOW + 2 * HOUR);
  assert.deepEqual(bar(h), [true, []], 'the new check lifted the hold');
  updateItem(h.root, 'api', again.id, { state: 'done' }, NOW + 2 * HOUR);
  assert.deepEqual([readinessOf(h.root, 'api').ready, checks(h)], [true, [['api', 'landed', new Date(NOW + 2 * HOUR).toISOString()]]]);
});

test('readiness waiting for the user\'s yes or running is not started again, closed readiness opens again, and only a chosen project has any', t => {
  const h = workspace(t, ['api', 'web']);
  runReadiness(h.root, 'api', NOW);
  const { id } = readinessItem(h);

  for (const state of ['branch', 'pr']) {
    updateItem(h.root, 'api', id, { state, branch: 'hobkin/ready' }, NOW);
    assert.throws(() => runReadiness(h.root, 'api', NOW), /waits for your yes/, state);
    assert.deepEqual(checks(h)[0], ['api', 'waiting', null], state);
    assert.equal(yoloView(h.root).projects[0].item, id, 'the window finds the branch to say yes to by its item');
  }

  updateItem(h.root, 'api', id, { state: 'declined' }, NOW);
  assert.deepEqual(checks(h)[0], ['api', 'closed', null]);
  runReadiness(h.root, 'api', NOW);
  assert.deepEqual([readinessItem(h).state, checks(h)[0]], ['open', ['api', 'queued', null]]);

  // An open owner says what runs.
  updateItem(h.root, 'api', id, { state: 'doing' }, NOW);
  mkdirSync(join(h.root, 'runtime.lock'));
  writeOwnerView(h.root, { running: [{ id: 'run-1', slug: 'api', item: id, lane: 'do', title: 'api: Get api ready for YOLO mode' }] });
  assert.deepEqual(checks(h)[0], ['api', 'running', null]);
  assert.throws(() => runReadiness(h.root, 'api', NOW), /already running/);

  skipProject(h.root, 'web', NOW);
  assert.throws(() => runReadiness(h.root, 'web', NOW), /not a project work mode works on/);
  assert.throws(() => runReadiness(h.root, 'nowhere', NOW), /not a project work mode works on/);
  assert.equal(readinessItem(h, 'web'), undefined);
});

test('the window\'s Run readiness is hobkin\'s own work action, and its run starts at once', async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-yolo-app-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const config = initialize(root, { cwd: base, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const at = new Date().toISOString();
  chooseProject(root, repository(base, 'api'), 'important');
  mkdirSync(paths(root, 'api').directory, { recursive: true });
  writeFileSync(paths(root, 'api').project, '# What it is\n');
  writeState(root, 'api', { lastLookAt: at, lastLensAt: at, lastIdeasAt: at, lastSignalsAt: at });
  atomicJson(join(root, 'work', 'unmerged.json'), { at, projects: {} });
  writeMode(root, { enabled: true, startGapMs: 0, lastDiscoveryAt: at });

  const started = [];
  const runHarness = request => {
    started.push(JSON.parse(request.prompt).work?.item?.key ?? 'something else');
    return new Promise(resolve => {
      const stop = () => resolve({ status: 'interrupted', error: 'Harness cancelled.' });
      if (request.signal.aborted) stop();
      else request.signal.addEventListener('abort', stop, { once: true });
    });
  };
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, runHarness, intervalMs: 60000 });
  try {
    const { message } = await app.workAction('ready', 'api');
    while (!started.includes(READY_KEY)) await new Promise(resolve => setTimeout(resolve, 10));

    assert.match(message, /^Queued "Get api ready for YOLO mode" on api to start at once\. It starts now/);
    assert.equal(yoloView(root).projects[0].work, 'running');
    assert.equal(readYolo(root).on, false);
  } finally {
    await app.close();
  }
});
