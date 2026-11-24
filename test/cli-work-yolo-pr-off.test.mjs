import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { surveyAndClose } from '../src/cli/work/closing.mjs';
import { workStatus } from '../src/cli/work/commands.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import { recordMachines } from '../src/cli/work/machines.mjs';
import { chooseProject, fileItem, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { pullRequestsMerge, PULLS_OFF } from '../src/cli/work/yolo-pulls.mjs';
import { recordReadiness, setYolo } from '../src/cli/work/yolo.mjs';
import { branched, git, pull, repository } from './helpers/work-fixture.mjs';

// What the code ships with: YOLO mode does not take pull requests until the user says so. Nothing here turns it on.
const NOW = Date.parse('2026-06-01T12:00:00Z');

const scored = () => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: 10, evidence: `What the review saw of ${name}.` }]));

function home(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-yolo-pr-off-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  recordMachines(root, 'api', { machines: [] }, { tlc: true, now: NOW });
  return { base, root, checkout };
}

/** Finished work waiting on a pull request the user opened, as hobkin records it. */
function waitingOnPull(h, title, number, change = {}) {
  const branch = `hobkin/${title}`;
  branched(h.checkout, branch);
  const head = git(h.checkout, 'rev-parse', branch);
  const url = `https://github.invalid/the-user/api/pull/${number}`;
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'pr', pr: url, branch, proof: 'The spec passes.', ...change(head) }, NOW);
  return { id, branch, head, url, number };
}

/** A code host that lists the pull requests open and counts every call. */
function codeHost(pulls) {
  const calls = [];
  const gh = async args => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[0] === 'pr' && args[1] === 'list') {
      return JSON.stringify(pulls.map(({ number, url, branch, head }) => pull(number, { url, headRefName: branch, headRefOid: head, reviewDecision: '', statusCheckRollup: [{ conclusion: 'SUCCESS' }] })));
    }
    return '[]';
  };
  return { gh, calls };
}

const stateOf = (h, { id }) => {
  const { state, reviewAsked = false } = readItems(h.root, 'api').find(item => item.id === id);
  return { state, reviewAsked };
};

test('the code ships with YOLO mode taking no pull request', () => {
  assert.equal(pullRequestsMerge(), false);
});

test('with YOLO mode off and reviews on, a change waiting on its pull request gets no review by itself, from the survey or as its run ends, as before', async t => {
  const h = home(t);
  writeMode(h.root, { enabled: true, reviewOnFinish: true });
  const one = waitingOnPull(h, 'fix-login', 7, () => ({}));
  const two = waitingOnPull(h, 'fix-signup', 8, () => ({}));
  const host = codeHost([one, two]);

  await surveyAndClose(h.root, { now: NOW, gh: host.gh, reviews: join(h.base, 'no-reviews') });
  const director = new WorkDirector({ root: h.root, now: () => NOW, gh: host.gh, onChange: () => {} });
  await director.itemFinished('api', readItems(h.root, 'api').find(({ id }) => id === two.id));

  assert.deepEqual([stateOf(h, one), stateOf(h, two)], [{ state: 'pr', reviewAsked: false }, { state: 'pr', reviewAsked: false }]);
  assert.deepEqual([...new Set(host.calls)], ['pr list']);
});

test('with YOLO mode on, a scored change waiting on its pull request on a ready project keeps asking, and nothing is read from the host for it', async t => {
  const h = home(t);
  writeMode(h.root, { enabled: true });
  setYolo(h.root, { on: true }, NOW);
  const { id: readiness } = readItems(h.root, 'api').find(({ key }) => key === 'yolo:ready');
  updateItem(h.root, 'api', readiness, { state: 'doing' }, NOW);
  const parts = Object.fromEntries(['tests', 'errors', 'slowQueries', 'performance', 'logs', 'alerts', 'rollback', 'deploy'].map(name => [name, { ready: true, how: `${name} is in place.` }]));
  recordReadiness(h.root, 'api', parts, NOW);
  updateItem(h.root, 'api', readiness, { state: 'merged' }, NOW);
  const change = waitingOnPull(h, 'fix-login', 7, head => ({ review: { kind: 'bug-fix', scores: scored(), head } }));
  const unscored = waitingOnPull(h, 'fix-signup', 8, () => ({}));
  const host = codeHost([change, unscored]);
  await surveyAndClose(h.root, { now: NOW, gh: host.gh, reviews: join(h.base, 'no-reviews') });

  assert.deepEqual(await yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} }), []);

  const api = workStatus(h.root).yolo.projects.find(({ slug }) => slug === 'api');
  assert.equal(api.changes.find(({ item }) => item === change.id).why, PULLS_OFF);
  assert.deepEqual([stateOf(h, change), stateOf(h, unscored)], [{ state: 'pr', reviewAsked: false }, { state: 'pr', reviewAsked: false }]);
  assert.deepEqual([...new Set(host.calls)], ['pr list']);
});
