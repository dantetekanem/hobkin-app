import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvent } from '../src/cli/events.mjs';
import { main } from '../src/cli/main.mjs';
import { reviewMessage, reviewView } from '../src/cli/work/review.mjs';
import { landedRecords, scoreboard } from '../src/cli/work/scoreboard.mjs';
import { chooseProject, dropProject, fileItem, updateItem } from '../src/cli/work/store.mjs';

const DAY_MS = 86400000;
const NOW = Date.parse('2026-11-02T12:00:00Z');
const daysAgo = days => NOW - days * DAY_MS;
const iso = time => new Date(time).toISOString();
const event = (type, facts = {}) => ({ at: iso(daysAgo(1)), type, ...facts });
const several = (count, type, facts) => Array.from({ length: count }, () => event(type, facts));

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-scoreboard-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function landOn(root, slug, title, landed) {
  const { id } = fileItem(root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, daysAgo(20));
  updateItem(root, slug, id, { state: 'merged', ...(landed ? { landed } : {}) }, daysAgo(1));
  return id;
}

const printed = () => {
  const chunks = [];
  return { write: text => chunks.push(text), json: () => JSON.parse(chunks.join('')) };
};

test('what hobkin brought counts decisions, reports with a next step and requests, and the card is none of them', () => {
  const { brought } = scoreboard([
    event('decision_filed', { id: 'a', source: 'routine' }),
    event('decision_filed', { id: 'b', source: 'merge' }),
    event('decision_filed', { id: 'c', source: 'pending' }),
    event('run_finished', { id: 'one', status: 'completed', triage: 'useful', next: true }),
    event('run_finished', { id: 'two', status: 'completed', triage: 'useful' }),
    event('notice_posted', { source: 'work-allowance', tone: 'critical' }),
    event('notice_posted', { source: 'learning' }),
    event('notice_posted', { source: 'report', tone: 'useful' }),
  ], []);

  assert.deepEqual(brought, { decisions: 2, reports: 1, requests: 2 });
});

test('what the user acted on leaves out the card and reports that asked nothing', () => {
  const { acted } = scoreboard([
    event('decision_answered', { id: 'a', source: 'routine', ms: 60000 }),
    event('decision_answered', { id: 'c', source: 'pending', ms: 1000 }),
    event('run_finished', { id: 'asked', status: 'completed', next: true }),
    event('run_finished', { id: 'also', status: 'completed', next: true }),
    event('report_read', { id: 'asked', ms: 9000 }),
    event('report_messaged', { id: 'asked' }),
    event('report_read', { id: 'told', ms: 9000 }),
    event('done_declined', { project: 'site', item: 'x' }),
    event('done_sent_back', { project: 'site', item: 'y' }),
  ], [{ slug: 'site', sha: 'abc', route: 'key', read: 'none' }]);

  assert.deepEqual(acted, { answered: 1, opened: 1, merged: 1, declined: 1, sentBack: 1 });
});

test('answers count once they took under 3 seconds, on screen or in the Decisions tab, and an unanswered question is no answer', () => {
  const { answers } = scoreboard([
    event('question_ended', { how: 'answered', choice: 0, ms: 2999 }),
    event('question_ended', { how: 'answered', choice: 1, ms: 3000 }),
    event('question_ended', { how: 'expired', ms: 100 }),
    event('question_ended', { how: 'escaped', ms: 100 }),
    event('decision_read', { id: 'a', ms: 1500 }),
    event('decision_read', { id: 'b', ms: 40000 }),
  ], []);

  assert.deepEqual(answers, { total: 4, under3s: 2 });
});

test('a merge counts once however much it brought along, and one found on the remote says nothing about reading', () => {
  const { merges } = scoreboard([event('app_opened')], [
    { slug: 'site', sha: 'one', route: 'key', read: 'page' },
    { slug: 'site', sha: 'one', route: 'key', read: 'page' },
    { slug: 'site', sha: 'two', route: 'key', read: 'diff' },
    { slug: 'api', sha: 'two', route: 'offer', read: 'none' },
    { slug: 'api', sha: 'three', route: 'remote', read: 'none' },
  ]);

  assert.deepEqual(merges, { total: 3, opened: 2, page: 1, diff: 1, remote: 1 });
});

test('what hobkin settled alone is what never reached the user', () => {
  const { settled } = scoreboard([
    ...several(2, 'decision_recalled', { routine: 'digest' }),
    ...several(3, 'run_finished', { status: 'completed', triage: 'nothing' }),
    event('run_finished', { status: 'completed', triage: 'useful' }),
    event('launch_closed', { project: 'site', item: 'x', outcome: 'held' }),
    event('launch_closed', { project: 'site', item: 'y', outcome: 'quiet' }),
    event('launch_closed', { project: 'site', item: 'z', outcome: 'unexercised' }),
    event('harness_filed', { name: 'error:send', count: 3 }),
  ], []);

  assert.deepEqual(settled, { recalled: 2, nothingNew: 3, watchesClosed: 2, harnessFixes: 1 });
});

test('with no events it says so plainly and claims nothing, whatever landed before they began', () => {
  const { events, lines } = scoreboard([], [{ slug: 'site', sha: 'one', route: 'key', read: 'page' }]);

  assert.equal(events, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /no events yet/i);
});

test('a week with something in it stays a few lines, and what was not measured gets none', () => {
  const quiet = scoreboard([event('app_opened')], []);
  assert.equal(quiet.lines.length, 1);
  assert.doesNotMatch(quiet.lines.join(' '), /seconds|merges|settled/i);

  const full = scoreboard([
    ...several(4, 'decision_filed', { source: 'routine' }),
    ...several(3, 'decision_answered', { source: 'routine' }),
    ...several(2, 'question_ended', { how: 'answered', ms: 500 }),
    ...several(5, 'decision_recalled', { routine: 'digest' }),
  ], [{ slug: 'site', sha: 'one', route: 'key', read: 'page' }]);
  assert.ok(full.lines.length <= 3);
  for (const number of ['4 decisions', '3', '2 of 2', '1 of 1', '5 recalled']) assert.ok(full.lines.join(' ').includes(number), number);
});

test('landed records come from every project, a dropped one too, and only items that carry one', t => {
  const root = dataRoot(t);
  const site = chooseProject(root, '/repos/site', 'important', daysAgo(30)).slug;
  const gone = chooseProject(root, '/repos/gone', 'important', daysAgo(30)).slug;
  landOn(root, site, 'Landed', { sha: 'one', at: iso(daysAgo(1)), route: 'key', read: 'page' });
  landOn(root, site, 'Survey found it', null);
  landOn(root, gone, 'Landed there', { sha: 'two', at: iso(daysAgo(2)), route: 'chat', read: 'none' });
  dropProject(root, gone, daysAgo(1));

  assert.deepEqual(landedRecords(root).map(({ slug, sha }) => [slug, sha]).toSorted(), [['gone', 'two'], ['site', 'one']]);
});

test('the review scores the week before now, and back to back weeks count nothing twice', t => {
  const root = dataRoot(t);
  const site = chooseProject(root, '/repos/site', 'important', daysAgo(30)).slug;
  const edges = [daysAgo(7), daysAgo(7) + 1, NOW, NOW + 1];
  for (const at of edges) recordEvent(root, 'decision_filed', { source: 'routine' }, at);
  edges.forEach((at, index) => landOn(root, site, `Landed ${index}`, { sha: `sha-${index}`, at: iso(at), route: 'key', read: 'page' }));

  const thisWeek = reviewView(root, NOW).scoreboard;
  const lastWeek = reviewView(root, daysAgo(7)).scoreboard;

  assert.deepEqual([thisWeek.brought.decisions, thisWeek.merges.total], [2, 2]);
  assert.deepEqual([lastWeek.brought.decisions, lastWeek.merges.total], [1, 1]);
  assert.ok(reviewMessage(reviewView(root, NOW)).includes(thisWeek.lines[0]));
});

test('with no events the weekly message says so', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/site', 'important', daysAgo(30));

  assert.match(reviewMessage(reviewView(root, NOW)), /no events yet/i);
});

test('hobkin telemetry carries the scoreboard for its days, landed records included', async t => {
  const root = dataRoot(t);
  const site = chooseProject(root, '/repos/site', 'important', Date.now() - 30 * DAY_MS).slug;
  recordEvent(root, 'decision_filed', { source: 'routine' }, Date.now() - 2 * DAY_MS);
  recordEvent(root, 'decision_filed', { source: 'routine' }, Date.now() - 20 * DAY_MS);
  landOn(root, site, 'New', { sha: 'one', at: iso(Date.now() - 2 * DAY_MS), route: 'key', read: 'diff' });
  landOn(root, site, 'Old', { sha: 'two', at: iso(Date.now() - 20 * DAY_MS), route: 'key', read: 'none' });

  const output = printed();
  assert.equal(await main(['telemetry', '--days', '7', '--home', root], output), 0);

  const { scoreboard: board, events } = output.json();
  assert.equal(events, 1);
  assert.equal(board.brought.decisions, 1);
  assert.deepEqual(board.merges, { total: 1, opened: 1, page: 0, diff: 1, remote: 0 });
});

test('hobkin telemetry on a home with no events says so, and still creates nothing', async t => {
  const root = dataRoot(t);
  const output = printed();

  assert.equal(await main(['telemetry', '--home', root], output), 0);

  assert.match(output.json().scoreboard.lines[0], /no events yet/i);
  assert.equal(existsSync(join(root, 'runtime')), false);
});
