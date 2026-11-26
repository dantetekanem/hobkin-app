import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readyItems } from '../src/cli/work/reads.mjs';
import { recordGrades } from '../src/cli/work/review-grades.mjs';
import { updateItem } from '../src/cli/work/store.mjs';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { yoloStatus } from '../src/cli/work/yolo-report.mjs';
import { finished, makeReady, NOW, scored, stateOf, survey, workspace } from './helpers/yolo-fixture.mjs';

const whyOf = (h, { id }) => yoloStatus(h.root, NOW).projects[0].changes.find(change => change.item === id).why;

test('YOLO mode weighs only grades recorded from Change Review at the change\'s commit, and asks for any other', async t => {
  const h = workspace(t);
  makeReady(h);
  const ownRun = finished(h, 'Fix login');
  const otherWay = finished(h, 'Fix logout');
  const rated = finished(h, 'Fix totals');
  const none = finished(h, 'Fix tax');
  updateItem(h.root, 'api', ownRun.id, { review: { kind: 'bug-fix', scores: scored(), head: ownRun.head } }, NOW);
  updateItem(h.root, 'api', otherWay.id, { review: { kind: 'bug-fix', scores: scored(), head: otherWay.head, by: 'an agent' } }, NOW);
  updateItem(h.root, 'api', none.id, { review: null }, NOW);
  await survey(h);
  recordGrades(h.root, 'api', rated.id, { kind: 'bug-fix', scores: scored(), head: rated.head }, NOW);

  assert.equal(whyOf(h, ownRun), 'its review has not rated it', 'hobkin\'s own scored run is not read');
  assert.equal(whyOf(h, otherWay), 'its review has not rated it', 'a record written any other way is not read');
  assert.equal(whyOf(h, none), 'its review has not rated it');
  assert.equal(whyOf(h, rated), null);
  assert.equal(readyItems(h.root).find(({ item }) => item === ownRun.id).review.rate, 10, 'the card still shows hobkin\'s own scores');

  const reports = await yoloPass(h.root, { now: NOW });

  assert.deepEqual(reports.map(({ item }) => item), [rated.id]);
  assert.deepEqual([ownRun, otherWay, rated, none].map(change => stateOf(h, change)), ['branch', 'branch', 'merged', 'branch']);
});

test('ratings recorded for an older commit are not read once the change moved', async t => {
  const h = workspace(t);
  makeReady(h);
  const change = finished(h, 'Fix login');
  updateItem(h.root, 'api', change.id, { review: { kind: 'bug-fix', scores: scored(), head: 'c'.repeat(40), by: 'change-review' } }, NOW);
  await survey(h);

  assert.equal(whyOf(h, change), 'its scores are for an older commit');
});
