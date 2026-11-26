import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize, setLearning } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { DISMISSALS_FILE } from '../src/cli/action-dismissal.mjs';
import { readEvents } from '../src/cli/events.mjs';
import { fakePi } from './helpers/pi-session.mjs';
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

async function openApp(root) {
  const config = initialize(root, { cwd: root });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  return HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 3600000 });
}

const actionOption = { actionItem: true };
const failureNotices = (app, id) => app.snapshot.messages.filter(message => message.id === `notice:action-answer:${id}`);

test('a desktop answer whose Chat delivery fails saves the exact choice, without claiming success', async t => {
  const root = home(t);
  const app = await openApp(root);
  try {
    const { id } = fileDecision(root, { ...question, answerTo: { kind: 'chat' } }, NOW);
    let sends = 0;
    app.send = async () => { sends++; throw Error('Private transport details'); };
    const result = await app.workAction('decide', id, 'ship', actionOption);
    assert.equal(result.ok, false);
    assert.equal((await app.workAction('decide', id, 'wait', actionOption)).ok, false);
    assert.equal(sends, 1);
    assert.equal(openDecisions(root).some(decision => decision.id === id), true);
    assert.equal(readEvents(root).some(event => event.type === 'decision_answered' && event.id === id), false);
    const [notice] = failureNotices(app, id);
    assert.match(notice.content, /Approve shipping\?.*Ship.*outcome is unknown/);
    assert.doesNotMatch(notice.content, /Private transport details/);
    assert.equal(readActionDecisions(root).some(decision => decision.id === id), false);
  } finally {
    await app.close();
  }
});

test('generated cards save failed choices without dismissing another offer or recording a learning answer', async t => {
  const root = home(t);
  const app = await openApp(root);
  try {
    setLearning(root, true);
    const learner = new Learner({ root, telemetry: {}, now: () => NOW });
    const lesson = { scope: 'repo-spec-rollout', title: 'Spec rollout', conclusion: 'rethink', code: 'blocked', seen: 5, runs: 6, days: 3, latest: new Date(NOW).toISOString() };
    const saved = { proposals: [], lessons: [lesson], pullRequests: {} };
    const [proposal] = learner.proposalsFrom([lesson], saved, readActions(root));
    saveState(root, { ...saved, proposals: [proposal] });
    const candidate = { name: 'Candidate', path: root, level: 'casual', summary: 'Try this project' };
    proposeProject(root, candidate, NOW);
    const cards = listActionItems(root).items;
    const learning = cards.find(card => card.group === 'learning');
    const project = cards.find(card => card.group === 'project');
    app.send = async () => { throw Error('Unavailable main chat'); };
    assert.equal((await app.workAction('actionItem', learning.id, 'yes')).ok, false);
    assert.deepEqual(listActionItems(root).items.map(card => card.id), [project.id]);
    assert.deepEqual(learningState(root).proposals.map(entry => entry.id), [proposal.id]);
    assert.equal(failureNotices(app, learning.id).length, 1);
    assert.match(failureNotices(app, learning.id)[0].content, /Spec rollout.*Yes, plan it/);
    // The underlying project store refuses an append. Its offer is still on record, but the selected card leaves the list.
    const projects = join(root, 'work', 'projects.jsonl');
    chmodSync(projects, 0o400);
    try {
      assert.equal((await app.workAction('actionItem', project.id, 'take')).ok, false);
    } finally {
      chmodSync(projects, 0o600);
    }
    assert.equal(readProject(root, 'candidate').state, 'proposed');
    assert.equal(failureNotices(app, project.id).length, 1);
    assert.deepEqual(listActionItems(root).items, []);
    proposeProject(root, candidate, NOW + 1000);
    const [newOffer] = listActionItems(root).items;
    assert.notEqual(newOffer.id, project.id);
    await app.workAction('actionItem', newOffer.id, 'skip');
    assert.equal(readProject(root, 'candidate').state, 'skipped');
    assert.equal(failureNotices(app, newOffer.id).length, 0);
  } finally {
    await app.close();
  }
});

test('an interrupted selection and a failed view write preserve one failure notice across reopen', async t => {
  const root = home(t);
  let app = await openApp(root);
  try {
    const { id } = fileDecision(root, { ...question, answerTo: { kind: 'chat' } }, NOW);
    const pending = Promise.withResolvers();
    let dispatched = 0;
    const dispatch = () => { dispatched++; return pending.promise; };
    const answer = app.answerActionItem('words', id, 'Not today; fixture only.', dispatch);
    assert.equal((await app.answerActionItem('words', id, 'Something else', dispatch)).ok, false);
    assert.equal(dispatched, 1, 'double click did not dispatch twice');
    // The attempt was saved before dispatch, but its final receipt cannot be written.
    const receipt = join(root, 'runtime', DISMISSALS_FILE);
    chmodSync(receipt, 0o400);
    try {
      pending.resolve({ ok: false });
      assert.equal((await answer).ok, false);
    } finally {
      chmodSync(receipt, 0o600);
    }
    await app.refreshing?.catch(() => {});
    const view = join(root, 'runtime', 'view.json');
    const saved = `${view}.saved`;
    renameSync(view, saved);
    mkdirSync(view);
    try {
      await assert.rejects(app.refresh());
    } finally {
      rmSync(view, { recursive: true });
      renameSync(saved, view);
    }
    await app.close();
    app = await openApp(root);
    await app.refresh();
    assert.deepEqual(readActionDecisions(root), []);
    assert.equal(failureNotices(app, id).length, 1);
    assert.match(failureNotices(app, id)[0].content, /Not today; fixture only\..*outcome is unknown/);
    assert.equal((await app.answerActionItem('words', id, 'Do not replay', dispatch)).ok, false);
    assert.equal(dispatched, 1, 'reloading cannot replay the underlying action');
  } finally {
    await app.close();
  }
});
