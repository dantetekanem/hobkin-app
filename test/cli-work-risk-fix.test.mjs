import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { openDecisions } from '../src/cli/decisions.mjs';
import { RISK_NOTE, fixRisk, riskStays, whyProjectWaits } from '../src/cli/work/controls.mjs';
import { chooseProject, fileItem, readItems, readMode, readProject, setProjectPaused, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { branched, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const FINDINGS = '1 part can break.\n\n1. `total` rounds 2.675 down to 2.67.';

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-risk-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  writeMode(root, { enabled: true });
  return { root, checkout };
}

function finished(h, branch, change = {}) {
  branched(h.checkout, branch);
  const { id } = fileItem(h.root, 'api', { key: branch, kind: 'fix', title: `Fix ${branch}`, brief: 'Round the total.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch, ...change }, NOW);
  return { id, head: git(h.checkout, 'rev-parse', branch) };
}

const read = (h, id) => readItems(h.root, 'api').find(item => item.id === id);

test("hobkin's AI review sends an agent back to its own risky change with the findings, in hobkin's words and first in the queue", async t => {
  const h = workspace(t);
  const { id, head } = finished(h, 'hobkin/4c9e21-round');

  const answer = await fixRisk(h.root, 'api', id, { head, findings: FINDINGS }, NOW);

  const item = read(h, id);
  assert.equal(item.state, 'open', 'it goes round again from its branch');
  assert.equal(item.branch, 'hobkin/4c9e21-round');
  assert.ok(item.workNote.startsWith(RISK_NOTE), 'the note opens with the words work mode reads as hobkin\'s own');
  assert.match(item.workNote, new RegExp(`at ${head.slice(0, 7)}\\b`));
  assert.match(item.workNote, /not the user's words/);
  assert.match(item.workNote, /a test that fails/);
  assert.match(item.workNote, /`left`/);
  assert.ok(item.workNote.endsWith(FINDINGS));
  assert.deepEqual(readMode(h.root).queueNext, [`item:api:${id}`], 'it goes ahead of new work, as a note does');
  // The user said nothing: nothing counts against its pattern, and nothing is told as their doing.
  assert.equal(item.pushbacks, undefined);
  assert.equal(answer.told, undefined);
  assert.equal(answer.handOff, undefined);
  assert.match(answer.message, /An agent goes back to "Fix hobkin\/4c9e21-round" on api next, to make it safe to deploy\./);
});

test('no agent goes back to a branch that moved since its review, one an agent is already going back to, or one that is not finished', async t => {
  const h = workspace(t);
  const moved = finished(h, 'hobkin/moved');
  git(h.checkout, 'switch', '-q', 'hobkin/moved');
  git(h.checkout, 'commit', '-q', '--allow-empty', '-m', 'later');
  git(h.checkout, 'switch', '-q', 'main');
  await assert.rejects(fixRisk(h.root, 'api', moved.id, { head: moved.head, findings: FINDINGS }, NOW), /moved since the review of/);

  const noted = finished(h, 'hobkin/noted', { workNote: 'Rename the flag.' });
  await assert.rejects(fixRisk(h.root, 'api', noted.id, { head: noted.head, findings: FINDINGS }, NOW), /An agent is already going back/);
  assert.equal(read(h, noted.id).workNote, 'Rename the flag.', 'the user\'s own note stays');

  const merged = finished(h, 'hobkin/merged', { state: 'merged' });
  await assert.rejects(fixRisk(h.root, 'api', merged.id, { head: merged.head, findings: FINDINGS }, NOW), /is merged, so there is no finished branch to fix/);
  assert.deepEqual(readMode(h.root).queueNext, []);
});

test('with work mode off or paused, everywhere or on the project, nothing is sent and nothing goes to the main agent', async t => {
  const h = workspace(t);
  const { id, head } = finished(h, 'hobkin/held');
  const project = () => readProject(h.root, 'api');

  assert.equal(whyProjectWaits(h.root, project(), NOW), null);
  setProjectPaused(h.root, 'api', true);
  assert.equal(whyProjectWaits(h.root, project(), NOW), 'api is paused');
  await assert.rejects(fixRisk(h.root, 'api', id, { head, findings: FINDINGS }, NOW), /Nothing starts while api is paused/);
  setProjectPaused(h.root, 'api', false);
  writeMode(h.root, { pausedAt: new Date(NOW).toISOString() });
  assert.equal(whyProjectWaits(h.root, project(), NOW), 'work mode is paused');
  writeMode(h.root, { enabled: false, pausedAt: null });
  assert.equal(whyProjectWaits(h.root, project(), NOW), 'work mode is off');
  await assert.rejects(fixRisk(h.root, 'api', id, { head, findings: FINDINGS }, NOW), /Nothing starts while work mode is off/);

  const item = read(h, id);
  assert.equal(item.state, 'branch');
  assert.equal(item.workNote, undefined);
  assert.equal(item.withMainAgent, undefined, 'no session is handed it');
  assert.deepEqual(readMode(h.root).queueNext, []);
});

test('a change still risky after its rounds is the user\'s: one Action Item for it, with what remains, the same one when asked again', t => {
  const h = workspace(t);
  const { id, head } = finished(h, 'hobkin/still');

  const first = riskStays(h.root, 'api', id, { head, rounds: 2, why: 'rounds', findings: FINDINGS }, NOW);
  const again = riskStays(h.root, 'api', id, { head, rounds: 2, why: 'rounds', findings: FINDINGS }, NOW + 1000);

  const items = openDecisions(h.root).filter(({ key }) => key === `risk:api:${id}`);
  assert.equal(items.length, 1);
  const [filed] = items;
  assert.equal(first.action, filed.id);
  assert.equal(again.action, filed.id, 'asked again, it is the one still open');
  assert.equal(filed.tldr, 'Still risky to deploy: Fix hobkin/still');
  assert.match(filed.question, /still finds "Fix hobkin\/still" on api risky to deploy at [0-9a-f]{7}, after 2 rounds of fixes\./);
  assert.match(filed.question, /What remains: 1 part can break\./);
  assert.deepEqual(filed.answerTo, { kind: 'action', risk: { slug: 'api', item: id } });
  assert.deepEqual(filed.choices.map(({ value }) => value), ['done', 'hobkin', 'drop']);
  assert.equal(read(h, id).state, 'branch', 'the change stays where it is');

  const { id: other, head: otherHead } = finished(h, 'hobkin/unchanged');
  riskStays(h.root, 'api', other, { head: otherHead, rounds: 1, why: 'unchanged', findings: FINDINGS }, NOW);
  const unchanged = openDecisions(h.root).find(({ key }) => key === `risk:api:${other}`);
  assert.match(unchanged.question, /its agent went back to it and left it as it was\./);
});
