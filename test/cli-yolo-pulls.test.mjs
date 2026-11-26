import assert from 'node:assert/strict';
import { test } from 'node:test';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { yoloStatus } from '../src/cli/work/yolo-report.mjs';
import { pullRequirements } from '../src/cli/work/yolo-pulls.mjs';
import { fileItem, updateItem } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { setYoloRules } from '../src/cli/work/yolo-rules.mjs';
import { branched, git } from './helpers/work-fixture.mjs';
import { codeHost } from './helpers/code-host.mjs';
import { makeReady, NOW, scored, workspace } from './helpers/yolo-fixture.mjs';

/** Finished work hobkin opened a pull request for, rated by Change Review at its head. */
function openedAsPull(h, title) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts.api, branch);
  const head = git(h.checkouts.api, 'rev-parse', branch);
  const host = codeHost({ number: 7, branch, head });
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'pr', pr: host.url, branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores: scored(), head, by: 'change-review' } }, NOW);
  return { id, head, host };
}
const whyOf = (h, { id }) => yoloStatus(h.root, NOW).projects[0].changes.find(change => change.item === id);

test('pull requests ask while the switch is off, and with it on the unmet GitHub condition is named and keeps asking, and required checks that cannot be listed ask unless the user allowed it', async t => {
  const h = workspace(t);
  makeReady(h);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await surveyUnmerged(h.root, { now: NOW, gh: host.gh, reviews: `${h.base}/no-reviews` });
  const pass = () => yoloPass(h.root, { now: NOW, gh: host.gh, handOff: () => {} });

  // Off, as shipped: it asks and says the switch is off, and nothing reaches the host for a merge.
  assert.deepEqual(await pass(), []);
  assert.deepEqual(whyOf(h, change), { item: change.id, title: 'Fix login', kind: 'a bug fix', rate: 10, why: 'automatic PR merges are off', setting: 'mergePulls' });
  assert.equal(host.merges().length, 0);

  // On for this project, with GitHub unable to list what its branch requires: it asks, and names the setting.
  setYoloRules(h.root, 'api', { mergePulls: true });
  host.protection = null;
  assert.deepEqual(await pass(), []);
  assert.equal(whyOf(h, change).why, 'hobkin cannot list this branch\'s required checks, and merging on GitHub\'s own state alone is turned off');
  assert.deepEqual(await pass(), [], 'a second pass does not merge on the host\'s state alone');
  assert.equal(host.merges().length, 0);

  // An unmet condition on GitHub keeps it asking and names itself.
  host.protection = ['test'];
  host.mergeQueue = true;
  assert.deepEqual(await pass(), []);
  assert.match(whyOf(h, change).why, /merges through a queue/);
  host.mergeQueue = false;

  // Allowed: the host's own clean state is enough, after the one pass that says so.
  setYoloRules(h.root, null, { mergeWhenChecksUnlisted: true });
  host.protection = null;
  assert.deepEqual(await pass(), []);
  const [merged] = await pass();
  assert.equal(merged.checks, 'not listed');
  assert.equal(host.merges().length, 1);
});

test('the page can read what GitHub must have for each project, each met or not', async t => {
  const h = workspace(t);
  makeReady(h);
  const change = openedAsPull(h, 'Fix login');
  const { host } = change;
  await surveyUnmerged(h.root, { now: NOW, gh: host.gh, reviews: `${h.base}/no-reviews` });
  const met = async () => Object.fromEntries((await pullRequirements(h.root, 'api', { gh: host.gh })).requirements.map(({ key, met: value }) => [key, value]));

  assert.deepEqual(await met(), { requiredChecks: true, noMergeQueue: true, noApproval: true, checksAtCommit: true });
  host.protection = [];
  host.rules = [];
  host.mergeQueue = true;
  host.view.reviewDecision = 'REVIEW_REQUIRED';
  host.view.statusCheckRollup = [];
  assert.deepEqual(await met(), { requiredChecks: false, noMergeQueue: false, noApproval: false, checksAtCommit: false });
  host.protection = null;
  assert.equal((await met()).requiredChecks, null, 'what cannot be read is not called met');
  assert.ok(host.calls.every(args => !(args[0] === 'pr' && args[1] === 'merge')), 'nothing is written to GitHub');
  assert.deepEqual(await pullRequirements(h.root, 'nowhere', { gh: host.gh }), { pull: null, requirements: [] });
});
