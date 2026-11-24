import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { initialize } from '../src/cli/config.mjs';
import { surveyAndClose } from '../src/cli/work/closing.mjs';
import { workStatus } from '../src/cli/work/commands.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import { recordMachines } from '../src/cli/work/machines.mjs';
import { mergePullRequest } from '../src/cli/work/controls.mjs';
import { chooseProject, fileItem, prFile, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { whyItAsks, yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { pullRequestsMergeForTests } from '../src/cli/work/yolo-pulls.mjs';
import { recordReadiness, setYolo, setYoloProject } from '../src/cli/work/yolo.mjs';
import { branched, git, pull, repository } from './helpers/work-fixture.mjs';

// These tests are of YOLO mode taking pull requests, which is off in the code until the user says so (cli-work-yolo-pr-off.test.mjs).
pullRequestsMergeForTests(true);

const NOW = Date.parse('2026-06-01T12:00:00Z');
const READY_KEY = 'yolo:ready';
const MERGE_COMMIT = 'f'.repeat(40);
const USER = 'the-user';

const scored = () => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: 10, evidence: `What the review saw of ${name}.` }]));

const allReady = () => ({
  ...Object.fromEntries(['tests', 'errors', 'slowQueries', 'performance', 'logs', 'alerts'].map(name => [name, { ready: true, how: `${name} is in place.` }])),
  rollback: { ready: true, how: 'bin/deploy rollback takes the last release back.' },
  deploy: { ready: true, how: 'bin/deploy from main, undone by bin/deploy rollback.' },
});

/**
 * The code host as a test plays it, for one pull request of hobkin's own: what the survey lists, what a fresh read of it says, its required
 * checks, the signed-in user, and a merge that records how it was asked for. Nothing reaches a real host.
 */
function codeHost({ number, branch, head }) {
  const url = `https://github.invalid/the-user/api/pull/${number}`;
  const host = {
    url,
    calls: [],
    merged: false,
    login: USER,
    view: {
      url,
      state: 'OPEN',
      isDraft: false,
      author: { login: USER },
      headRefName: branch,
      headRefOid: head,
      baseRefName: 'main',
      isCrossRepository: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: '',
      statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    },
    required: [{ name: 'test', bucket: 'pass' }],
    checksError: null,
    mergeError: null,
    // A merge call that ends well and leaves the pull request open with auto-merge on, as gh does on a branch that asks for a merge queue.
    queues: false,
    undoError: null,
    // The checks the default branch requires, by its protection and by its rulesets, or null when the host will not say.
    protection: ['test'],
    rules: [],
    // Whether the default branch merges through a queue, by a ruleset or as the pull request itself says, and whether that can be read.
    queueRule: false,
    mergeQueue: false,
    graphqlError: false,
    // Required checks pinned to an app, as `{ context, app_id }`, and the check runs at the head each app reported, by name.
    pinned: [],
    checkRuns: {},
  };
  host.gh = async args => {
    host.calls.push(args);
    const [group, verb] = args;
    if (group === 'api' && verb === 'user') return `${host.login}\n`;
    if (group === 'api' && args.includes('graphql')) {
      if (host.graphqlError) throw Object.assign(Error('failed'), { stderr: 'GraphQL: Field isMergeQueueEnabled does not exist' });
      return JSON.stringify({ data: { repository: { pullRequest: { isMergeQueueEnabled: host.mergeQueue, isInMergeQueue: false } } } });
    }
    if (group === 'api' && args.at(-1) === 'repos/the-user/api/branches/main') {
      if (!host.protection) throw Object.assign(Error('failed'), { stderr: 'HTTP 403: Resource not accessible' });
      return JSON.stringify({ name: 'main', protected: true, protection: { required_status_checks: { contexts: host.protection, checks: host.pinned } } });
    }
    if (group === 'api' && args.at(-1) === 'repos/the-user/api/rules/branches/main') {
      if (!host.rules) throw Object.assign(Error('failed'), { stderr: 'HTTP 403: Resource not accessible' });
      const required = host.rules.length ? [{ type: 'required_status_checks', parameters: { required_status_checks: host.rules.map(context => ({ context })) } }] : [];
      const rules = [...required, ...(host.queueRule ? [{ type: 'merge_queue', parameters: {} }] : [])];
      // Read with --paginate --slurp, each page an array of its own.
      return JSON.stringify(args.includes('--slurp') ? [rules] : rules);
    }
    if (group === 'api' && /\/check-runs\?check_name=/.test(args.at(-1))) {
      const name = decodeURIComponent(args.at(-1).split('check_name=')[1].split('&')[0]);
      return JSON.stringify([{ total_count: 0, check_runs: host.checkRuns[name] ?? [] }]);
    }
    if (group === 'pr' && verb === 'list') {
      const { headRefOid, isDraft, reviewDecision, statusCheckRollup, mergeable } = host.view;
      const merged = host.merged ? { state: 'MERGED', mergedAt: new Date(NOW).toISOString(), mergeCommit: { oid: MERGE_COMMIT } } : {};
      return JSON.stringify([pull(number, { url, headRefName: branch, headRefOid, isDraft, reviewDecision, statusCheckRollup, mergeable, ...merged })]);
    }
    if (group === 'pr' && verb === 'view') {
      // Any other address is a pull request of another repository on a branch of the same name, at the same head, and clean.
      if (args[2] !== url) return JSON.stringify({ ...host.view, url: args[2] });
      return JSON.stringify(host.merged ? { ...host.view, state: 'MERGED', mergedAt: new Date(NOW).toISOString(), mergeCommit: { oid: MERGE_COMMIT } } : host.view);
    }
    if (group === 'pr' && verb === 'checks') {
      if (host.checksError) throw host.checksError;
      return JSON.stringify(host.required);
    }
    if (group === 'pr' && verb === 'merge' && args.includes('--disable-auto')) {
      if (host.undoError) throw host.undoError;
      host.view.autoMergeRequest = null;
      return '';
    }
    if (group === 'pr' && verb === 'merge') {
      if (host.mergeError) throw host.mergeError;
      if (host.queues) {
        host.view.autoMergeRequest = { enabledAt: new Date(NOW).toISOString() };
        return '';
      }
      host.merged = true;
      // gh killed by its timeout after the host merged.
      if (host.killedAfterMerge) throw Object.assign(Error('Command failed: gh pr merge'), { killed: true, signal: 'SIGTERM', stderr: '' });
      return '';
    }
    return '[]';
  };
  host.merges = () => host.calls.filter(args => args[0] === 'pr' && args[1] === 'merge' && !args.includes('--disable-auto'));
  host.undos = () => host.calls.filter(args => args[0] === 'pr' && args[1] === 'merge' && args.includes('--disable-auto'));
  return host;
}

function workspace(t, projects = ['api']) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-yolo-pr-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const h = { base, root, checkouts: {} };
  for (const name of projects) {
    h.checkouts[name] = repository(base, name);
    chooseProject(root, h.checkouts[name], 'important', NOW);
    recordMachines(root, name, { machines: [] }, { tlc: true, now: NOW });
  }
  writeMode(root, { enabled: true });
  setYolo(root, { on: true }, NOW);
  for (const name of projects) {
    const { id } = readItems(root, name).find(({ key }) => key === READY_KEY);
    updateItem(root, name, id, { state: 'doing' }, NOW);
    recordReadiness(root, name, allReady(), NOW);
    updateItem(root, name, id, { state: 'merged' }, NOW);
  }
  return h;
}

/** Finished work hobkin opened a pull request for, reviewed at its head, or with no review yet when `review` is null. */
function openedAsPull(h, title, { slug = 'api', number = 7, review = 'scored' } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts[slug], branch);
  const head = git(h.checkouts[slug], 'rev-parse', branch);
  const host = codeHost({ number, branch, head });
  const { id } = fileItem(h.root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  const scores = review === 'scored' ? { review: { kind: 'bug-fix', scores: scored(), head } } : {};
  updateItem(h.root, slug, id, { state: 'pr', pr: host.url, branch, proof: 'The spec passes.', ...scores }, NOW);
  return { slug, id, branch, head, host };
}

const survey = (h, gh) => surveyUnmerged(h.root, { now: NOW, gh, reviews: join(h.base, 'no-reviews') });
const itemOf = (h, { slug, id }) => readItems(h.root, slug).find(item => item.id === id);
const whyOf = (h, { slug, id }) => workStatus(h.root).yolo.projects.find(project => project.slug === slug).changes.find(change => change.item === id)?.why;
const ledger = h => (existsSync(join(h.root, 'work', 'yolo.jsonl')) ? readFileSync(join(h.root, 'work', 'yolo.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []);

test('a pull request of hobkin\'s own that meets every rule merges by itself on the code host, pinned to its scored commit, and its deploy is handed on', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  await survey(h, change.host.gh);
  const handed = [];

  const reports = await yoloPass(h.root, { now: NOW, gh: change.host.gh, handOff: job => handed.push(job) });

  assert.deepEqual(change.host.merges(), [['pr', 'merge', change.host.url, '--merge', '--match-head-commit', change.head]]);
  assert.ok(change.host.calls.every(args => !args.includes('--admin') && !args.includes('--auto')), 'it never bypasses a protection');
  const asked = change.host.calls.map(([group, verb]) => `${group} ${verb}`);
  assert.ok(asked.indexOf('pr checks') < asked.indexOf('pr merge'), 'its checks are read before the merge');
  const merged = itemOf(h, change);
  assert.deepEqual([merged.state, merged.landed.route, merged.landed.sha], ['merged', 'yolo', MERGE_COMMIT]);

  assert.deepEqual(reports.map(({ slug, item, head, target, pr, deploy }) => [slug, item, head, target, pr, deploy]), [['api', change.id, change.head, MERGE_COMMIT, change.host.url, 'handed on']]);
  assert.deepEqual(ledger(h), reports);
  const lines = clientNoticesToPost(h.root).map(({ line }) => line);
  assert.ok(lines.includes(`YOLO mode merged "Fix login" on api by itself, through its pull request ${change.host.url} on the code host: a bug fix rated 10, at ${change.head.slice(0, 7)}. Its deploy is with the main agent.`), lines.join('\n'));
  assert.equal(handed.length, 1);
  assert.equal(handed[0].commit, MERGE_COMMIT);
  assert.match(handed[0].asked, /^YOLO mode merged its pull request https:\/\/github\.invalid\/the-user\/api\/pull\/7 by itself on the code host, so the default branch there is at f{40}\. Fetch it first\./);
  assert.match(handed[0].asked, /Deploy exactly that commit by the project's recorded path: bin\/deploy from main/);
});

test('a pull request whose checks have not all passed at its commit keeps asking and says which, and one that cannot be read keeps asking too', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  host.view.statusCheckRollup = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  for (const [bucket, word] of [['pending', 'pending'], ['fail', 'failed'], ['skipping', 'skipped'], ['cancel', 'cancelled']]) {
    host.required = [{ name: 'test', bucket }, { name: 'lint', bucket: 'pass' }];
    assert.deepEqual(await pass(), [], bucket);
    assert.equal(whyOf(h, change), `its pull request's checks have not all passed at this commit: test (${word})`, bucket);
  }

  // With no check marked required, every check counts, and a skipped one is no pass.
  host.required = [];
  host.protection = [];
  host.checksError = Object.assign(Error('Command failed'), { stderr: "no required checks reported on the 'hobkin/fix-login' branch" });
  host.view.statusCheckRollup = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' }];
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request\'s checks have not all passed at this commit: deploy (skipped)');

  // A check that is not required and failed still holds it.
  host.checksError = null;
  host.required = [{ name: 'test', bucket: 'pass' }];
  host.view.statusCheckRollup = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'audit', status: 'COMPLETED', conclusion: 'FAILURE' }];
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request\'s checks have not all passed at this commit: audit (failed)');

  host.view.statusCheckRollup = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  host.checksError = Object.assign(Error('Command failed'), { stderr: 'HTTP 502' });
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request\'s checks could not be read, so nothing merges');

  host.checksError = null;
  host.view.mergeStateStatus = 'BLOCKED';
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'branch protection blocks its pull request');

  // A pull request with no checks at all says so from the survey, and nothing is read from the host for it.
  host.view.mergeStateStatus = 'CLEAN';
  host.view.statusCheckRollup = [];
  await survey(h, host.gh);
  const before = host.calls.length;
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request has no checks at this commit');
  assert.ok(host.calls.slice(before).every(([group, verb]) => `${group} ${verb}` !== 'pr view'));

  assert.deepEqual(host.merges(), [], 'nothing merged');
  assert.equal(itemOf(h, change).state, 'pr');
});

test('a pull request that moved, is a draft, needs an approval, conflicts or will not merge keeps asking with that reason', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });
  const holds = async (change_, why) => {
    Object.assign(host.view, change_);
    assert.deepEqual(await pass(), [], why);
    assert.equal(whyOf(h, change), why);
    for (const key of Object.keys(change_)) host.view[key] = codeHost({ number: 7, branch: change.branch, head: change.head }).view[key];
  };

  await holds({ headRefOid: 'a'.repeat(40) }, 'its pull request moved to aaaaaaa since its review scored it');
  await holds({ isDraft: true }, 'its pull request is a draft');
  await holds({ reviewDecision: 'REVIEW_REQUIRED' }, 'its pull request needs a review approval');
  await holds({ reviewDecision: 'CHANGES_REQUESTED' }, 'changes were requested on its pull request');
  await holds({ mergeable: 'CONFLICTING' }, 'its pull request conflicts with its base branch');
  await holds({ mergeable: 'UNKNOWN' }, 'the code host has not worked out yet whether its pull request can merge');
  await holds({ baseRefName: 'release' }, 'its pull request goes into release, not main');
  await holds({ state: 'CLOSED' }, 'its pull request is closed');
  assert.deepEqual(host.merges(), []);

  // The host refuses a merge whose head moved at the last moment, and nothing is recorded as merged.
  host.mergeError = Object.assign(Error('Command failed'), { stderr: 'Head branch was modified. Review and try the merge again.' });
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request did not merge: Head branch was modified. Review and try the merge again.');
  assert.deepEqual([itemOf(h, change).state, ledger(h)], ['pr', []]);
});

test('a pull request someone else opened, or from another repository, is never merged by YOLO mode', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  host.view.author = { login: 'someone-else' };
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request was opened by someone-else, so it is theirs to merge');

  host.view.author = { login: USER };
  host.view.isCrossRepository = true;
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request comes from another repository');

  host.view.isCrossRepository = false;
  host.view.headRefName = 'feature/theirs';
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request is on feature/theirs, not on its own branch');

  host.view.headRefName = change.branch;
  host.login = '';
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'who is signed in to the code host could not be read, so nothing merges');
  assert.deepEqual(host.merges(), []);
});

test('a project YOLO mode is off on never has its pull request merged, and a local branch still merges as before', async t => {
  const h = workspace(t, ['api', 'web']);
  const change = openedAsPull(h, 'Fix login');
  const branch = 'hobkin/fix-signup';
  branched(h.checkouts.web, branch);
  const head = git(h.checkouts.web, 'rev-parse', branch);
  const { id } = fileItem(h.root, 'web', { key: 'Fix signup', kind: 'fix', title: 'Fix signup', brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'web', id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores: scored(), head } }, NOW);
  setYoloProject(h.root, 'api', false, NOW);
  await survey(h, change.host.gh);

  const reports = await yoloPass(h.root, { now: NOW, gh: change.host.gh, handOff: () => {} });

  assert.deepEqual(reports.map(({ slug, pr }) => [slug, pr ?? null]), [['web', null]]);
  assert.deepEqual(change.host.calls.filter(([group, verb]) => group === 'pr' && ['view', 'checks', 'merge'].includes(verb)), [], 'nothing is read or merged for it');
  assert.equal(whyOf(h, change), 'YOLO mode is off on its project');
  assert.deepEqual([itemOf(h, change).state, itemOf(h, { slug: 'web', id }).state, itemOf(h, { slug: 'web', id }).landed.route], ['pr', 'merged', 'yolo']);
});

test('a finished change waiting on its pull request gets its scored review by itself on a ready project, and merges once it meets the rules', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login', { review: null });
  mkdirSync(dirname(prFile(h.root, 'api', change.id)), { recursive: true });
  writeFileSync(prFile(h.root, 'api', change.id), 'What changed and why.\n');
  assert.equal(whyItAsks({ yolo: { on: true, rate: 8 }, on: true, project: {}, readiness: { ready: true }, landable: true, row: { holds: 0 }, item: itemOf(h, change) }), 'no review has scored it');

  await surveyAndClose(h.root, { now: NOW, gh: change.host.gh, reviews: join(h.base, 'no-reviews') });

  const asked = itemOf(h, change);
  assert.deepEqual([asked.reviewAsked, asked.reviewAskedFor, asked.state], [true, change.head, 'open']);

  // Its review ran, scored the commit its pull request holds and recorded it waiting on that pull request again.
  updateItem(h.root, 'api', change.id, { state: 'pr', reviewAsked: false, review: { kind: 'bug-fix', scores: scored(), head: change.head } }, NOW);
  await survey(h, change.host.gh);
  assert.deepEqual((await yoloPass(h.root, { now: NOW, gh: change.host.gh, handOff: () => {} })).map(({ item }) => item), [change.id]);
});

test('a run that ends with its change waiting on a pull request earns the same review a finished branch does', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login', { review: null });
  const director = new WorkDirector({ root: h.root, now: () => NOW, gh: change.host.gh, onChange: () => {} });

  await director.itemFinished('api', itemOf(h, change));

  assert.deepEqual([itemOf(h, change).reviewAsked, itemOf(h, change).state], [true, 'open']);
});

test('a merge the host queued or set to merge by itself is never recorded: hobkin turns auto-merge off, says so in Chat, and does not ask again at that commit', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  host.queues = true;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  assert.deepEqual(await pass(), []);

  assert.deepEqual([itemOf(h, change).state, ledger(h)], ['pr', []]);
  assert.deepEqual(host.undos(), [['pr', 'merge', host.url, '--disable-auto']]);
  assert.equal(host.view.autoMergeRequest, null);
  const lines = clientNoticesToPost(h.root).map(({ line }) => line);
  assert.ok(!lines.some(line => line.startsWith('YOLO mode merged')), lines.join('\n'));
  assert.ok(lines.includes('YOLO mode asked to merge "Fix login" on api, and its host queued the pull request or set it to merge by itself instead. hobkin turned that off, and it asks you.'), lines.join('\n'));
  assert.match(whyOf(h, change), /^its host queued its pull request or set it to merge by itself instead of merging it, so hobkin turned that off/);

  await survey(h, host.gh);
  assert.deepEqual(await pass(), []);
  assert.equal(host.merges().length, 1, 'not asked again at the same commit');

  // When the host will not turn it off, Chat says so as a problem.
  const other = openedAsPull(h, 'Fix logout', { number: 8 });
  other.host.queues = true;
  other.host.undoError = Object.assign(Error('failed'), { stderr: 'auto-merge is not allowed for this repository' });
  await survey(h, other.host.gh);
  await yoloPass(h.root, { now: NOW, gh: other.host.gh, handOff: () => {} });
  const problem = clientNoticesToPost(h.root).find(({ line }) => line.includes('"Fix logout"'));
  assert.equal(problem.tone, 'critical');
  assert.match(problem.line, /could not turn that off \(auto-merge is not allowed for this repository\), so it may still merge there/);
  assert.equal(itemOf(h, other).state, 'pr');
});

test('a change waiting on its pull request gets a review by itself only where YOLO mode may merge it, not because scoring finished changes is on', async t => {
  const h = workspace(t, ['api', 'web']);
  writeMode(h.root, { reviewOnFinish: true });
  const onWeb = openedAsPull(h, 'Fix signup', { slug: 'web', review: null });
  const onApi = openedAsPull(h, 'Fix login', { review: null });
  setYoloProject(h.root, 'web', false, NOW);
  const asked = change => [itemOf(h, change).state, Boolean(itemOf(h, change).reviewAsked)];

  // The project YOLO mode is off on: not from the survey, and not as a run ends.
  await surveyAndClose(h.root, { now: NOW, gh: onWeb.host.gh, reviews: join(h.base, 'no-reviews') });
  const director = new WorkDirector({ root: h.root, now: () => NOW, gh: onWeb.host.gh, onChange: () => {} });
  await director.itemFinished('web', itemOf(h, onWeb));
  assert.deepEqual(asked(onWeb), ['pr', false]);

  // With YOLO mode off everywhere, the same on api.
  setYolo(h.root, { on: false }, NOW);
  await surveyAndClose(h.root, { now: NOW, gh: onApi.host.gh, reviews: join(h.base, 'no-reviews') });
  await director.itemFinished('api', itemOf(h, onApi));
  assert.deepEqual(asked(onApi), ['pr', false]);
});

test('YOLO mode merges only the pull request the survey found for the change\'s branch in the project\'s own repository, whatever address its item holds', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  // A run's outcome can name a pull request, so an item can hold one in another repository, on a branch of the same name and at the same head.
  const elsewhere = 'https://example.com/other-repo/pull/7';
  updateItem(h.root, 'api', change.id, { pr: elsewhere }, NOW);

  assert.deepEqual(await yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} }), []);

  assert.deepEqual(host.merges(), []);
  assert.ok(host.calls.every(args => !args.includes(elsewhere)), 'nothing is read or merged at that address');
  assert.equal(whyOf(h, change), `its item names ${elsewhere}, not the pull request the survey found on its branch in this repository`);
});

test('the change rules read the commit the pull request holds, not a local branch of the same name, and a head this repository lacks keeps asking', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  // The commit the host holds, and the review scored, turns CI off; the local branch of the same name still points at the harmless one.
  const repo = h.checkouts.api;
  git(repo, 'switch', '-q', '-c', 'side', 'main');
  mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'turn CI off');
  const sensitive = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'switch', '-q', 'main');
  host.view.headRefOid = sensitive;
  updateItem(h.root, 'api', change.id, { review: { kind: 'bug-fix', scores: scored(), head: sensitive } }, NOW);
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'touches .github/workflows/ci.yml');

  // A head the host has and this repository does not: nothing is fetched, and it asks.
  const elsewhere = 'a'.repeat(40);
  host.view.headRefOid = elsewhere;
  updateItem(h.root, 'api', change.id, { review: { kind: 'bug-fix', scores: scored(), head: elsewhere } }, NOW);
  await survey(h, host.gh);
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request\'s head aaaaaaa is not in this repository, so its files cannot be read, and hobkin fetches nothing');
  assert.deepEqual(host.merges(), []);
});

test('a required check that never reported, or that ended neutral, is no pass, even when the host calls the pull request clean to merge', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  // Required by a ruleset gh pr checks --required does not see, and never reported at this head.
  host.rules = ['deploy-preview'];
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request\'s checks have not all passed at this commit: deploy-preview (missing)');

  host.rules = [];
  host.view.statusCheckRollup = [{ name: 'test', status: 'COMPLETED', conclusion: 'NEUTRAL' }];
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request\'s checks have not all passed at this commit: test (neutral)');
  assert.deepEqual(host.merges(), []);
});

test('when the host will not list the required checks, YOLO mode merges only on its own clean state and says it relied on it', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  host.protection = null;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  host.view.mergeStateStatus = 'BLOCKED';
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'branch protection blocks its pull request. hobkin could not list the checks its branch requires, so it relied on the host\'s own state');

  // Said while it waits, a pass before it merges, so the page shows it on a change about to merge.
  host.view.mergeStateStatus = 'CLEAN';
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'hobkin cannot list this branch\'s required checks, so it goes by GitHub\'s own state');
  const [merged] = await pass();
  assert.equal(merged.checks, 'not listed');
  const line = clientNoticesToPost(h.root).map(({ line: said }) => said).find(said => said.startsWith('YOLO mode merged'));
  assert.match(line, /hobkin could not list the checks its branch requires, so it relied on the host's own state\./);
});

test('nothing pushes a review\'s commits to a pull request, so a review that changed the change leaves it asking, and says which commit each side holds', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  // The review committed a fix on the local branch, scored it there, and nothing took it to the pull request.
  git(h.checkouts.api, 'switch', '-q', change.branch);
  git(h.checkouts.api, 'commit', '-q', '--allow-empty', '-m', 'review fix');
  const reviewed = git(h.checkouts.api, 'rev-parse', 'HEAD');
  git(h.checkouts.api, 'switch', '-q', 'main');
  updateItem(h.root, 'api', change.id, { review: { kind: 'bug-fix', scores: scored(), head: reviewed } }, NOW);
  await survey(h, host.gh);

  assert.deepEqual(await yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} }), []);

  assert.equal(whyOf(h, change), `its review scored ${reviewed.slice(0, 7)}, and its pull request is at ${change.head.slice(0, 7)}`);
  assert.ok(host.calls.every(([group]) => group !== 'push'));
  assert.deepEqual(host.merges(), []);
});

test('a merge the host made while gh was killed is read back in the same pass and recorded as YOLO mode\'s own, and one it cannot read back is not', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  host.killedAfterMerge = true;
  await survey(h, host.gh);

  const [merged] = await yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  assert.deepEqual([itemOf(h, change).state, itemOf(h, change).landed.route], ['merged', 'yolo']);
  assert.deepEqual([merged.item, merged.target, merged.pr], [change.id, MERGE_COMMIT, host.url]);
  assert.deepEqual(ledger(h).map(({ item }) => item), [change.id]);
  assert.equal(host.merges().length, 1);

  // When the pull request cannot be read back either, it is not YOLO mode's to record: Chat says it may have merged, and the survey records it.
  const other = openedAsPull(h, 'Fix logout', { number: 8 });
  other.host.killedAfterMerge = true;
  await survey(h, other.host.gh);
  const unread = async args => (args[1] === 'view' && other.host.merged ? Promise.reject(Error('HTTP 502')) : other.host.gh(args));
  assert.deepEqual(await yoloPass(h.root, { now: NOW, gh: unread, handOff: () => {} }), []);
  await survey(h, other.host.gh);
  await yoloPass(h.root, { now: NOW + 60000, gh: other.host.gh, handOff: () => {} });
  assert.deepEqual([itemOf(h, other).state, itemOf(h, other).landed.route], ['merged', 'remote']);
  assert.deepEqual(ledger(h).map(({ item }) => item), [change.id]);
  const said = clientNoticesToPost(h.root).find(({ line }) => line.includes('"Fix logout"'));
  assert.match(said.line, /^YOLO mode asked to merge "Fix logout" on api, and gh was cut short before it said whether it merged/);
});

test('the user\'s own merge from the card, after a merge YOLO mode tried and the host refused, is recorded as the user\'s', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  host.mergeError = Object.assign(Error('Command failed'), { stderr: 'GraphQL: Merge commits are not allowed on this repository.' });
  await survey(h, host.gh);
  await yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  host.mergeError = null;
  await mergePullRequest(h.root, 'api', change.id, { head: change.head, gh: host.gh, now: NOW + 300000 });
  await survey(h, host.gh);
  await yoloPass(h.root, { now: NOW + 360000, gh: host.gh, handOff: () => {} });

  assert.deepEqual([itemOf(h, change).state, itemOf(h, change).landed.route], ['merged', 'remote']);
  assert.deepEqual(ledger(h), []);
  assert.ok(!clientNoticesToPost(h.root).some(({ line }) => line.startsWith('YOLO mode merged')));
});

test('a host that refuses the merge is asked once at a commit, and again only once the pull request moves or a day has passed', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  host.mergeError = Object.assign(Error('Command failed'), { stderr: 'GraphQL: Merge commits are not allowed on this repository. (mergePullRequest)' });
  await survey(h, host.gh);
  const pass = at => yoloPass(h.root, { now: at, gh: host.gh, handOff: () => {} });

  for (const at of [NOW, NOW + 60000, NOW + 3600000]) await pass(at);
  assert.equal(host.merges().length, 1);
  assert.match(whyOf(h, change), /Merge commits are not allowed on this repository/);

  await pass(NOW + 25 * 3600000);
  assert.equal(host.merges().length, 2, 'a day later, in case its settings changed');
});

test('a pull request whose branch merges through a queue is never asked to merge, and one where that cannot be told keeps asking too', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });
  const QUEUE = 'its branch merges through a queue, which YOLO mode does not use';

  host.mergeQueue = true;
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), QUEUE);

  host.mergeQueue = false;
  host.queueRule = true;
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), QUEUE, 'a ruleset that asks for one');

  host.queueRule = false;
  host.graphqlError = true;
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'hobkin cannot tell whether its branch merges through a queue, so nothing merges');
  assert.deepEqual(host.merges(), []);
});

test('the merge goes to the pull request that was checked, whatever its item says by the time of the call, and Chat and the ledger name that one', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  const elsewhere = 'https://github.invalid/the-user/other-repo/pull/7';
  const checkedThen = async args => {
    // Something writes another address on the item while the pass reads the checks.
    if (args[0] === 'pr' && args[1] === 'checks') updateItem(h.root, 'api', change.id, { pr: elsewhere }, NOW);
    return host.gh(args);
  };

  const [merged] = await yoloPass(h.root, { now: NOW, gh: checkedThen, handOff: () => {} });

  assert.deepEqual(host.merges().map(args => args[2]), [host.url]);
  assert.equal(merged.pr, host.url);
  assert.equal(ledger(h)[0].pr, host.url);
  assert.ok(clientNoticesToPost(h.root).some(({ line }) => line.includes(`through its pull request ${host.url} on the code host`)));
});

test('a required check pinned to an app passes only on that app\'s own check run, read on every page', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  host.pinned = [{ context: 'test', app_id: 15368 }];
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  // A check of that name succeeded, from another app, and the host says it is clean.
  host.checkRuns.test = [{ name: 'test', app: { id: 999 }, conclusion: 'success' }];
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change), 'its pull request\'s checks have not all passed at this commit: test (not reported by app 15368)');

  host.checkRuns.test = [{ name: 'test', app: { id: 999 }, conclusion: 'success' }, { name: 'test', app: { id: 15368 }, conclusion: 'success' }];
  assert.equal((await pass()).length, 1);
  assert.ok(host.calls.some(args => args.includes('--paginate') && args.at(-1).includes('/check-runs?check_name=test')));
  assert.ok(host.calls.some(args => args.includes('--paginate') && args.at(-1).endsWith('/rules/branches/main')));
});
