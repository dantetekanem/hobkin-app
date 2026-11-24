import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, setLearning } from '../src/cli/config.mjs';
import { fileDecision, handDecision, openDecisions } from '../src/cli/decisions.mjs';
import { Learner } from '../src/cli/learning/learner.mjs';
import { learningState, readActions, saveState } from '../src/cli/learning/store.mjs';
import { dismissActionItems, listActionItems, readActionDecisions, readPending, readWaiting } from '../src/cli/pending-read.mjs';
import { chooseProject, fileItem, proposeProject, readItems, readProject, updateItem } from '../src/cli/work/store.mjs';

const question = {
  from: 'Fixture',
  question: 'Approve shipping?',
  choices: [{ value: 'wait', label: 'Wait' }, { value: 'ship', label: 'Ship' }],
};
const NOW = Date.parse('2026-11-10T12:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-dismissal-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root });
  return root;
}

test('an exact snapshot leaves a decision that arrived after it and does not answer old decisions', t => {
  const root = home(t);
  const prior = fileDecision(root, question, NOW);
  const handed = fileDecision(root, { ...question, question: 'Check the project?' }, NOW);
  handDecision(root, handed.id, NOW);
  const snapshot = listActionItems(root);
  assert.deepEqual(snapshot.items.map(({ id }) => id), [prior.id]);

  const fresh = fileDecision(root, { ...question, question: 'Approve a different change?' }, NOW + 1);
  const before = readFileSync(join(root, 'decisions.jsonl'), 'utf8');
  const selector = { ids: snapshot.items.map(({ id }) => id) };
  assert.deepEqual(dismissActionItems(root, selector), { dismissed: 1, remaining: 1 });
  assert.deepEqual(dismissActionItems(root, selector), { dismissed: 0, remaining: 1 });
  assert.deepEqual(readActionDecisions(root).map(({ id }) => id), [fresh.id]);
  assert.deepEqual(openDecisions(root).map(({ id }) => id), [prior.id, handed.id, fresh.id]);
  assert.equal(readFileSync(join(root, 'decisions.jsonl'), 'utf8'), before);
});

test('only answerable proposals are dismissed; work stays pending and a new offer of the same project appears', t => {
  const root = home(t);
  const candidate = { name: 'Candidate', path: root, level: 'casual', summary: 'Try this project' };
  proposeProject(root, candidate, NOW);
  proposeProject(root, { ...candidate, name: 'Existing' }, NOW);
  chooseProject(root, 'existing');
  const work = fileItem(root, 'existing', { key: 'unsettled', kind: 'fix', title: 'Unsettled work', brief: 'Wait for access' });
  updateItem(root, 'existing', work.id, { state: 'done', left: 'Provide access', leftKind: 'personal' });

  setLearning(root, true);
  const learner = new Learner({ root, telemetry: {}, now: () => NOW });
  const lesson = { scope: 'repo-spec-rollout', title: 'Spec rollout', conclusion: 'rethink', code: 'blocked', seen: 5, runs: 6, days: 3, latest: new Date(NOW).toISOString() };
  const saved = { proposals: [], lessons: [lesson], pullRequests: {} };
  const [proposal] = learner.proposalsFrom([lesson], saved, readActions(root));
  saveState(root, { ...saved, proposals: [proposal] });
  assert.deepEqual(listActionItems(root).items.map(({ group }) => group).sort(), ['learning', 'project']);
  assert.equal(readPending(root).total, 3);

  assert.deepEqual(dismissActionItems(root, { all: true }), { dismissed: 2, remaining: 0 });
  assert.deepEqual(readWaiting(root).proposals, []);
  assert.deepEqual(readWaiting(root).asks, []);
  assert.deepEqual(readWaiting(root).yours.map(({ item }) => item), [work.id]);
  assert.equal(readPending(root).total, 1);
  assert.equal(readProject(root, 'candidate').state, 'proposed');
  assert.equal(readItems(root, 'existing')[0].left, 'Provide access');
  assert.deepEqual(learningState(root).proposals.map(({ id }) => id), [proposal.id]);

  proposeProject(root, candidate, NOW + 1000);
  assert.deepEqual(listActionItems(root).items.map(({ group }) => group), ['project']);
});
