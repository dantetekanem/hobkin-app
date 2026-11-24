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
import { chooseProject, fileItem, prFile, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { whyItAsks, yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { recordReadiness, setYolo, setYoloProject } from '../src/cli/work/yolo.mjs';
import { branched, git, pull, repository } from './helpers/work-fixture.mjs';

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
  const url = `https://example.com/pull/${number}`;
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
  };
  host.gh = async args => {
    host.calls.push(args);
    const [group, verb] = args;
    if (group === 'api' && verb === 'user') return `${host.login}\n`;
    if (group === 'pr' && verb === 'list') {
      const { headRefOid, isDraft, reviewDecision, statusCheckRollup, mergeable } = host.view;
      return JSON.stringify([pull(number, { url, headRefName: branch, headRefOid, isDraft, reviewDecision, statusCheckRollup, mergeable })]);
    }
    if (group === 'pr' && verb === 'view') {
      return JSON.stringify(host.merged ? { ...host.view, state: 'MERGED', mergedAt: new Date(NOW).toISOString(), mergeCommit: { oid: MERGE_COMMIT } } : host.view);
    }
    if (group === 'pr' && verb === 'checks') {
      if (host.checksError) throw host.checksError;
      return JSON.stringify(host.required);
    }
    if (group === 'pr' && verb === 'merge') {
      if (host.mergeError) throw host.mergeError;
      host.merged = true;
      return '';
    }
    return '[]';
  };
  host.merges = () => host.calls.filter(([group, verb]) => group === 'pr' && verb === 'merge');
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
  assert.match(handed[0].asked, /^YOLO mode merged its pull request https:\/\/example\.com\/pull\/7 by itself on the code host, so the default branch there is at f{40}\. Fetch it first\./);
  assert.match(handed[0].asked, /Deploy exactly that commit by the project's recorded path: bin\/deploy from main/);
});

test('a pull request whose checks have not all passed at its commit keeps asking and says which, and one that cannot be read keeps asking too', async t => {
  const h = workspace(t);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await survey(h, host.gh);
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  for (const [bucket, word] of [['pending', 'pending'], ['fail', 'failed'], ['skipping', 'skipped'], ['cancel', 'cancelled']]) {
    host.required = [{ name: 'test', bucket }, { name: 'lint', bucket: 'pass' }];
    assert.deepEqual(await pass(), [], bucket);
    assert.equal(whyOf(h, change), `its pull request's checks have not all passed at this commit: test (${word})`, bucket);
  }

  // With no check marked required, every check counts, and a skipped one is no pass.
  host.required = [];
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
