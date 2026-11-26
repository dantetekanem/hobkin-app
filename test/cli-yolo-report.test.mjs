import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { atomicJson } from '../src/cli/config.mjs';
import { handDecision, openDecisions } from '../src/cli/decisions.mjs';
import { writeYoloReports, yoloReports } from '../src/cli/work/yolo-report.mjs';
import { setYolo, setYoloProject } from '../src/cli/work/yolo.mjs';
import { setYoloRules } from '../src/cli/work/yolo-rules.mjs';
import { updateItem, writeMode } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { codeHost } from './helpers/code-host.mjs';
import { allReady, finished, makeReady, NOW, workspace } from './helpers/yolo-fixture.mjs';

const report = h => yoloReports(h.root, new Set()).find(({ scheduleId }) => scheduleId === 'work.api.yolo');
const write = (h, now = NOW) => writeYoloReports(h.root, { now });

test('reports distinguish enabled and ready from active; unchanged reports are not repeated', t => {
  const h = workspace(t);
  assert.deepEqual(write(h), []);
  setYolo(h.root, { on: true }, NOW);
  write(h);
  assert.match(report(h).body, /YOLO mode is on.*not ready/);
  assert.deepEqual(write(h, NOW + 1), []);

  makeReady(h);
  write(h, NOW + 2);
  assert.match(report(h).body, /YOLO mode is active.*ready/);
  writeMode(h.root, { pausedAt: new Date(NOW).toISOString() });
  write(h, NOW + 3);
  assert.match(report(h).body, /YOLO mode is on.*ready.*work mode is paused/);
  setYoloProject(h.root, 'api', false, NOW + 4);
  write(h, NOW + 4);
  assert.match(report(h).body, /YOLO mode is off on api.*ready/);
  setYolo(h.root, { on: false }, NOW + 5);
  write(h, NOW + 5);
  assert.match(report(h).body, /YOLO mode is off globally.*ready/);
  assert.deepEqual(write(h, NOW + 6), []);
});

test('a low-rated draft PR is ineligible for more than the PR switch', async t => {
  const h = workspace(t);
  makeReady(h);
  const change = finished(h, 'Cleanup worker', { kind: 'performance', numbers: { coverage: 2, proof: 3, safety: 7, visibility: 4, rollback: 9 } });
  const host = codeHost({ number: 7, branch: change.branch, head: change.head });
  host.view.isDraft = true;
  updateItem(h.root, 'api', change.id, { state: 'pr', pr: host.url }, NOW);
  await surveyUnmerged(h.root, { now: NOW, gh: host.gh, reviews: `${h.base}/no-reviews` });

  // Replay a surveyed non-Hobkin branch, as in the Nov 26 report. Its draft status is still known.
  const branch = 'feature/cleanup-worker';
  const surveyed = readUnmerged(h.root);
  surveyed.projects.api.open.find(unit => unit.kind === 'pr' && unit.branch === change.branch).branch = branch;
  atomicJson(join(h.root, 'work', 'unmerged.json'), surveyed);
  updateItem(h.root, 'api', change.id, { branch }, NOW);
  write(h);
  const body = report(h).body;
  assert.match(body, /Cleanup worker.*rated 5/);
  assert.match(body, /automatic PR merges are off/);
  for (const reason of [
    'its pull request is not on a branch of hobkin\'s own',
    'its pull request is a draft',
    'its general rate is 5, under 8',
    'coverage scored 2, under 5',
    'proof scored 3, under 5',
    'safety scored 7, under 8',
    'visibility scored 4, under 7',
  ]) {
    assert.ok(body.includes(reason), reason);
  }
  assert.doesNotMatch(body, /merges by itself once that is turned on/);
  setYoloRules(h.root, 'api', { mergePulls: true });
  write(h, NOW + 1);
  assert.doesNotMatch(report(h).body, /automatic PR merges are off/);
  assert.match(report(h).body, /its pull request is a draft/);
  assert.match(report(h).body, /its general rate is 5, under 8/);
  assert.equal(host.merges().length, 0, 'reporting never merges a PR');
});

test('an otherwise eligible own PR still needs fresh host checks and the project pass limit', async t => {
  const h = workspace(t);
  makeReady(h);
  const change = finished(h, 'Fix login');
  const host = codeHost({ number: 7, branch: change.branch, head: change.head });
  updateItem(h.root, 'api', change.id, { state: 'pr', pr: host.url }, NOW);
  await surveyUnmerged(h.root, { now: NOW, gh: host.gh, reviews: `${h.base}/no-reviews` });
  write(h);
  assert.match(report(h).body, /Fix login.*Not eligible for automatic merge: automatic PR merges are off/);

  setYoloRules(h.root, 'api', { mergePulls: true });
  write(h, NOW + 1);
  assert.match(report(h).body, /Fix login.*Eligible subject to fresh code-host checks and the pass limit/);
  assert.equal(host.merges().length, 0);
});

test('a shared optional setup action appears once and independent gaps are still reported', t => {
  const h = workspace(t);
  const shared = { user: { title: 'Set up error mail', step: 'Set up the email rule.' } };
  makeReady(h, 'api', allReady({ errors: shared, alerts: shared, performance: { user: { title: 'Set up metrics', step: 'Record a latency baseline.' } } }));
  write(h);
  const body = report(h).body;
  assert.match(body, /holding nothing back/);
  assert.match(body, /Error tracking, Alerts: waits on you: Set up error mail/);
  assert.equal(body.split('Set up error mail').length, 2);
  assert.match(body, /Performance metrics: waits on you: Set up metrics/);
  assert.deepEqual(write(h, NOW + 1), []);

  const action = openDecisions(h.root).find(decision => decision.tldr === 'Set up error mail');
  handDecision(h.root, action.id, NOW + 2);
  write(h, NOW + 3);
  const handed = report(h).body;
  assert.match(handed, /Error tracking, Alerts: Set up error mail — handed to hobkin; no resolution recorded/);
  assert.doesNotMatch(handed, /waits on you: Set up error mail/);
  assert.match(handed, /Performance metrics: waits on you: Set up metrics/);
  assert.deepEqual(write(h, NOW + 4), []);
});
