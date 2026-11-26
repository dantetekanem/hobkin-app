import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { mergeItem } from '../src/cli/work/controls.mjs';
import { chooseProject, fileItem, readItems, updateItem } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, git, repository } from './helpers/work-fixture.mjs';

// A branch an agent made outside work mode, such as a `hobkin session`'s, is registered as finished work, so it goes the way hobkin's own work
// does: the survey reads it, it is reviewed and merged on the user's yes, and its issue closes. Nothing here reaches GitHub.

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-adopt-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout };
}

const register = (h, sent) => runWorkCommand(h.root, ['item', 'api'], Readable.from([JSON.stringify(sent)]));
const read = (h, id) => readItems(h.root, 'api').find(item => item.id === id);
const finished = branch => ({ title: 'Fix login after a reset', branch, state: 'branch', summary: 'Login works again after a password reset.', proof: 'test/login.test.mjs failed, then passed.' });

test("a session's branch registered with no id is finished work under its own name, which the survey reads and a yes merges", async t => {
  const h = workspace(t);
  branched(h.checkout, 'fix/login', 'login.txt', 'login\n');
  const head = git(h.checkout, 'rev-parse', 'fix/login');

  const registered = await register(h, finished('fix/login'));
  await surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

  const item = read(h, registered.id);
  assert.deepEqual([item.state, item.branch, item.title, item.summary, item.proof], ['branch', 'fix/login', 'Fix login after a reset', 'Login works again after a password reset.', 'test/login.test.mjs failed, then passed.']);
  assert.equal(git(h.checkout, 'rev-parse', 'fix/login'), head, 'its commits stay as they are');
  assert.ok(readUnmerged(h.root).projects.api.open.some(unit => unit.branch === 'fix/login' && unit.sha === head), 'the survey reads it like any finished branch');
  assert.match(registered.message, /^Registered fix\/login on api as finished work: "Fix login after a reset"\./);

  await mergeItem(h.root, 'api', registered.id, { now: NOW });
  assert.equal(read(h, registered.id).state, 'merged');
});

test('only a real branch holding work the default branch lacks is registered, and only once', async t => {
  const h = workspace(t);
  branched(h.checkout, 'fix/login', 'login.txt', 'login\n');
  git(h.checkout, 'branch', 'empty');
  await register(h, finished('fix/login'));

  await assert.rejects(register(h, finished('fix/nowhere')), /api has no local branch fix\/nowhere/);
  await assert.rejects(register(h, finished('empty')), /empty holds nothing main lacks/);
  await assert.rejects(register(h, finished('main')), /main is the default branch/);
  await assert.rejects(register(h, finished('--force')), /branch is the name of a local branch/);
  await assert.rejects(register(h, finished('fix/login')), /fix\/login is already "Fix login after a reset", item [0-9a-f]{6}/);
  await assert.rejects(register(h, { ...finished('fix/login'), proof: '' }), /title, summary and proof/);
  assert.equal(readItems(h.root, 'api').length, 1);
});

test("an issue the branch is for puts it on hobkin's own item for that issue, and an agent never names an issue on a new item", async t => {
  const h = workspace(t);
  branched(h.checkout, 'fix/login', 'login.txt', 'login\n');
  branched(h.checkout, 'fix/signup', 'signup.txt', 'signup\n');
  const issue = { repo: 'acme/api', number: 12, url: 'https://github.invalid/acme/api/issues/12' };
  const { id } = fileItem(h.root, 'api', { key: 'gh-issue:acme/api#12', kind: 'fix', title: 'Login fails after a reset', brief: 'What goes wrong.', issue }, NOW);

  const onIssue = await register(h, { ...finished('fix/login'), issue: { repo: 'acme/api', number: 12 } });
  const noItem = await register(h, { ...finished('fix/signup'), title: 'Fix signup', issue: { repo: 'acme/api', number: 99 } });

  assert.equal(onIssue.id, id);
  assert.deepEqual([read(h, id).state, read(h, id).branch, read(h, id).issue], ['branch', 'fix/login', issue]);
  assert.equal(read(h, noItem.id).issue, undefined);
  assert.match(noItem.message, /hobkin has no item for acme\/api#99, so it is not linked/);
});

test('an issue item an agent is already working on, or that has a branch of its own, keeps it', async t => {
  const h = workspace(t);
  branched(h.checkout, 'fix/login', 'login.txt', 'login\n');
  const issue = { repo: 'acme/api', number: 12, url: 'https://github.invalid/acme/api/issues/12' };
  const { id } = fileItem(h.root, 'api', { key: 'gh-issue:acme/api#12', kind: 'fix', title: 'Login fails after a reset', brief: 'What goes wrong.', issue }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch: 'hobkin/12-fix' }, NOW);

  await assert.rejects(register(h, { ...finished('fix/login'), issue: { repo: 'acme/api', number: 12 } }), /already has its own branch, hobkin\/12-fix/);
  assert.equal(read(h, id).branch, 'hobkin/12-fix');
});
