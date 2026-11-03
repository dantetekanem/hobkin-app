import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDecisions } from '../src/cli/decisions.mjs';
import { answerPickUp, filePickUp } from '../src/cli/work/pick-up.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import { chooseProject, fileItem, paths, readMode, recordTokens, writeMode, writeState } from '../src/cli/work/store.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const now = new Date(2026, 5, 1, 12).getTime();
const brief = 'Evidence, who benefits, the first change, the proof.';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-pick-up-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: now + 3 * 24 * HOUR } });
  return root;
}

/** A project past its study, with nothing due but the fixes a test files. */
function projectWithFixes(root, slug, titles) {
  chooseProject(root, `/repos/${slug}`, 'important', now);
  mkdirSync(paths(root, slug).directory, { recursive: true });
  writeFileSync(paths(root, slug).project, '# What it is\n');
  writeState(root, slug, { lastLensAt: new Date(now).toISOString(), lastIdeasAt: new Date(now).toISOString() });
  recordTokens(root, { slug, lane: 'do', tokens: 1 }, now - HOUR);
  return titles.map(title => fileItem(root, slug, { key: title, kind: 'fix', title, brief }, now));
}

const pickUp = root => openDecisions(root).find(({ key }) => key === 'pickup');
const queue = root => planWork(root, { now }).entries.filter(({ kind }) => kind !== 'look');

test('turning on without auto-pick asks what to start, and nothing starts before an answer', t => {
  const root = dataRoot(t);
  projectWithFixes(root, 'api', ['First fix', 'Second fix', 'Third fix', 'Fourth fix', 'Fifth fix']);
  writeMode(root, { enabled: true, autoPick: false });

  const filed = filePickUp(root, now);

  const { question, choices, answerTo } = pickUp(root);
  assert.equal(filed, true);
  assert.equal(answerTo.keys.length, 4);
  assert.match(question, /nothing new starts by itself/);
  assert.match(question, /1\. P\d \S+: First fix/);
  assert.match(question, /more wait behind these/);
  assert.deepEqual(choices.map(({ value }) => value), ['later', 'these', 'first', 'auto']);
  assert.equal(planWork(root, { now }).next, null);
});

test('starting the offered rows picks them, so they start in turn', t => {
  const root = dataRoot(t);
  projectWithFixes(root, 'api', ['First fix', 'Second fix', 'Third fix']);
  writeMode(root, { enabled: true, autoPick: false });
  filePickUp(root, now);
  const { keys } = pickUp(root).answerTo;

  const answer = answerPickUp(root, 'these', keys);

  assert.match(answer.message, /These \d start in turn/);
  assert.deepEqual(readMode(root).queueNext, keys);
  assert.equal(planWork(root, { now }).next.key, keys[0]);
});

test('starting the first one picks only that row', t => {
  const root = dataRoot(t);
  projectWithFixes(root, 'api', ['First fix', 'Second fix']);
  writeMode(root, { enabled: true, autoPick: false });
  filePickUp(root, now);
  const { keys } = pickUp(root).answerTo;

  answerPickUp(root, 'first', keys);

  assert.deepEqual(readMode(root).queueNext, keys.slice(0, 1));
});

test('letting the whole queue run turns auto-pick back on, and not now starts nothing', t => {
  const root = dataRoot(t);
  projectWithFixes(root, 'api', ['First fix']);
  writeMode(root, { enabled: true, autoPick: false });
  filePickUp(root, now);
  const { keys } = pickUp(root).answerTo;

  answerPickUp(root, 'later', keys);
  assert.deepEqual(readMode(root).queueNext, []);
  assert.equal(readMode(root).autoPick, false);

  answerPickUp(root, 'auto', keys);
  assert.equal(readMode(root).autoPick, true);
  assert.equal(planWork(root, { now }).next?.title, queue(root)[0].title);
});

test('with auto-pick on the queue runs as it did, so nothing is asked', t => {
  const root = dataRoot(t);
  projectWithFixes(root, 'api', ['First fix']);
  writeMode(root, { enabled: true, autoPick: true });

  assert.equal(filePickUp(root, now), false);
  assert.equal(pickUp(root), undefined);
});

test('a row picked earlier is not offered again, because it starts anyway', t => {
  const root = dataRoot(t);
  projectWithFixes(root, 'api', ['First fix', 'Second fix']);
  const [first] = queue(root);
  writeMode(root, { enabled: true, autoPick: false, queueNext: [first.key] });

  filePickUp(root, now);

  const { question, answerTo } = pickUp(root);
  assert.equal(answerTo.keys.includes(first.key), false);
  assert.match(question, /1 you picked earlier start first/);
});
