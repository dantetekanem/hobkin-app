import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { publishItem } from '../src/cli/work/controls.mjs';
import { chooseProject, fileItem, paths, prFile, readItems, setProjectPrMode, updateItem } from '../src/cli/work/store.mjs';
import { branched, git, repository, withOrigin } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const BRANCH = 'hobkin/9-fix';

/** A project with a finished branch, and an origin of its own on disk, so a push goes nowhere but this test's folder. */
function workspace(t, { origin = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-publish-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  const remote = origin ? withOrigin(base, checkout) : null;
  chooseProject(root, checkout, 'important', NOW);
  branched(checkout, BRANCH, 'nine.txt', 'nine\n');
  const { id } = fileItem(root, 'api', { key: 'charge once', kind: 'fix', title: 'Charge once', brief: 'Retries charged twice.' }, NOW);
  const item = updateItem(root, 'api', id, { state: 'branch', branch: BRANCH }, NOW);
  return { root, checkout, remote, item, tip: git(checkout, 'rev-parse', BRANCH) };
}

/** gh as the test plays it: the open PRs it lists for the branch, and the address a new PR gets. */
function fakeGh(open = []) {
  const calls = [];
  const gh = async (args, cwd) => {
    calls.push({ args, cwd });
    if (args[1] === 'list') return JSON.stringify(open);
    if (args[1] === 'create') return 'Creating pull request...\nhttps://example.com/pull/9\n';
    throw Error(`unexpected gh ${args.join(' ')}`);
  };
  return { gh, calls };
}

const itemOf = (h) => readItems(h.root, 'api').find(({ id }) => id === h.item.id);
/** Where the origin's copy of the branch points, or nothing when it has none. */
function remoteTip(h) {
  try {
    return git(h.remote, 'rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`);
  } catch {
    return '';
  }
}

test('an approved branch is pushed at the commit the user approved and gets its PR, and its item then waits on that PR', async t => {
  const h = workspace(t);
  mkdirSync(paths(h.root, 'api').prs, { recursive: true });
  writeFileSync(prFile(h.root, 'api', h.item.id), '# Charge once\n\nRetries no longer charge twice.\n');
  const { gh, calls } = fakeGh();

  const { message, told } = await publishItem(h.root, 'api', h.item.id, { head: h.tip, gh, now: NOW });

  assert.equal(remoteTip(h), h.tip);
  assert.deepEqual(calls.map(({ args }) => args.slice(0, 2)), [['pr', 'list'], ['pr', 'create']]);
  assert.deepEqual(calls[1].args, ['pr', 'create', '--repo', h.remote, '--head', BRANCH, '--base', 'main', '--title', 'Charge once', '--body-file', prFile(h.root, 'api', h.item.id)]);
  assert.equal(calls[1].cwd, h.checkout);
  assert.deepEqual([itemOf(h).state, itemOf(h).pr], ['pr', 'https://example.com/pull/9']);
  assert.match(message, /^Opened a PR for "Charge once" on api\.$/);
  assert.equal(told.did, 'opened its PR');
  assert.match(told.line, /https:\/\/example\.com\/pull\/9/);
});

test('a branch that already has an open PR keeps that one, and its item waits on it', async t => {
  const h = workspace(t);
  const { gh, calls } = fakeGh([{ url: 'https://example.com/pull/78', headRefOid: 'whatever' }]);

  const { message } = await publishItem(h.root, 'api', h.item.id, { head: h.tip, gh, now: NOW });

  assert.deepEqual(calls.map(({ args }) => args[1]), ['list'], 'no second PR is opened');
  assert.deepEqual([itemOf(h).state, itemOf(h).pr], ['pr', 'https://example.com/pull/78']);
  assert.match(message, /already had a PR open/);
});

test('a project that opens draft PRs gets a draft', async t => {
  const h = workspace(t);
  setProjectPrMode(h.root, 'api', 'draft');
  const { gh, calls } = fakeGh();

  await publishItem(h.root, 'api', h.item.id, { head: h.tip, gh, now: NOW });

  assert.ok(calls[1].args.includes('--draft'));
});

test('a branch that moved since it was approved, or a project with no origin, opens nothing and changes nothing', async t => {
  const moved = workspace(t);
  const { gh, calls } = fakeGh();
  await assert.rejects(publishItem(moved.root, 'api', moved.item.id, { head: 'abc1234', gh, now: NOW }), /moved since it was approved/);
  assert.equal(remoteTip(moved), '');
  assert.deepEqual(calls, []);
  assert.equal(itemOf(moved).state, 'branch');

  const local = workspace(t, { origin: false });
  await assert.rejects(publishItem(local.root, 'api', local.item.id, { head: local.tip, gh, now: NOW }), /no origin to push to/);
  assert.equal(itemOf(local).state, 'branch');
});
