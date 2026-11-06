import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AWAY_MS, BRIEF_BAR, arrivedCount, arrivedSince, asksForBrief, briefMaterial, briefNote, briefSince, offerLine, readBriefState, returnedSince, seenMoved, withoutBriefNote, writeBriefState,
} from '../src/cli/brief.mjs';

const HOUR_MS = 3600000;
const at = hours => new Date(Date.parse('2026-11-05T08:00:00Z') + hours * HOUR_MS).toISOString();
const report = (id, hours, body = 'Useful: Two invoices are due.\n\nNext: Pay the rent invoice.') => ({ id, title: id, at: at(hours), outcome: 'completed', body });
const decision = (id, hours, extra = {}) => ({
  id,
  from: 'Routine mail',
  question: `Question ${id}?`,
  choices: [{ value: 'no', label: 'Keep it' }, { value: 'yes', label: 'Archive it' }],
  answerTo: { kind: 'routine', id: 'mail' },
  at: at(hours),
  ...extra,
});

test('only the words brief me ask for a brief', () => {
  for (const text of ['brief me', 'Brief me', '  brief me!  ', 'brief me please', 'please brief me.']) assert.equal(asksForBrief(text), true, text);
  for (const text of ['debrief me', 'brief me on the finboard branch', 'can you brief me about rent', '', undefined]) assert.equal(asksForBrief(text), false, String(text));
});

test('the user is back once they are seen again after two hours away, and the time they left is what came in since', () => {
  assert.equal(returnedSince({ lastSeenAt: null, seenAt: Date.parse(at(5)) }), null);
  assert.equal(returnedSince({ lastSeenAt: at(0), seenAt: Date.parse(at(0)) + AWAY_MS - 1 }), null);
  assert.equal(returnedSince({ lastSeenAt: at(0), seenAt: Date.parse(at(0)) + AWAY_MS }), at(0));
});

test('when they were last here is written again once it is a minute off, ahead after a clock change included, or unreadable', () => {
  const seenAt = Date.parse(at(0));

  assert.equal(seenMoved({ lastSeenAt: at(0) }, seenAt + 59000), false);
  assert.equal(seenMoved({ lastSeenAt: at(0) }, seenAt + 60000), true);
  assert.equal(seenMoved({ lastSeenAt: at(5) }, seenAt), true);
  assert.equal(seenMoved({ lastSeenAt: 'yesterday' }, seenAt), true);
  assert.equal(seenMoved({ lastSeenAt: null }, seenAt), true);
});

test('what arrived counts open questions and unread reports since then, work runs on their own, and leaves out reports with no news', () => {
  const arrived = arrivedSince({
    since: at(0),
    decisions: [decision('before', -1), decision('after', 1)],
    reports: [
      report('mail:1', 1),
      report('calendar:1', 2, 'Useful: Nothing needs you this week.'),
      report('read:1', 2),
      report('old:1', -2),
      report('quiet:1', 3, 'Nothing new.'),
      report('work:api:do:1', 2, 'Useful: Login is fixed on its branch.'),
      report('session:fix-1', 2, 'Useful: Done.'),
    ],
    read: new Set(['read:1']),
  });

  assert.deepEqual(arrived, { decisions: 1, reports: 2, calls: 1, work: 1 });
  assert.equal(arrivedCount(arrived), 4);
  assert.equal(BRIEF_BAR, 3);
});

test('the offer says what came in, in words, and how to ask', () => {
  assert.equal(
    offerLine({ decisions: 4, reports: 6, calls: 2, work: 1 }),
    "It's been a while. While you were away: 4 decisions, 6 reports (2 with a call) and 1 from work mode. Want a brief? Just say: brief me",
  );
  assert.equal(
    offerLine({ decisions: 0, reports: 3, calls: 0, work: 0 }),
    "It's been a while. While you were away: 3 reports. Want a brief? Just say: brief me",
  );
});

test('a brief covers what came in since the user left, or since their last brief, and a day when there is neither', () => {
  const now = Date.parse(at(10));
  assert.equal(briefSince({ offer: { since: at(1) }, briefedAt: null }, now), at(1));
  assert.equal(briefSince({ offer: { since: at(1) }, briefedAt: at(4) }, now), at(4));
  assert.equal(briefSince({ offer: null, briefedAt: null }, now), at(-14));
});

test('the state is private and each write keeps what it does not name', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-brief-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readBriefState(root), { lastSeenAt: null, offer: null, briefedAt: null });

  writeBriefState(root, { lastSeenAt: at(0) });
  writeBriefState(root, { offer: { since: at(0), at: at(3), line: 'Hi' } });

  assert.deepEqual(readBriefState(root), { lastSeenAt: at(0), offer: { since: at(0), at: at(3), line: 'Hi' }, briefedAt: null });
  assert.equal(statSync(join(root, 'runtime', 'brief.json')).mode & 0o777, 0o600);
});

const material = (extra = {}) => briefMaterial({
  since: at(0),
  now: Date.parse(at(3)),
  decisions: [decision('d1', 1, { recommended: 'no', why: 'Archiving cannot be undone.' })],
  reports: [report('mail:1', 1), report('old:1', -5, 'Useful: Old news.'), report('old:2', -5, 'Useful: Rent is due.\n\nNext: Pay it.'), report('quiet:1', 2, 'Nothing new.')],
  read: new Set(),
  waiting: { total: 3, groups: [{ name: 'questions', count: 1, label: 'question', fact: 'oldest 2 hours' }] },
  rows: {
    branches: [{ project: 'api', slug: 'api', item: 'a1', title: 'Fix login', gap: 'land', size: { additions: 10, deletions: 2 } }],
    yours: [{ project: 'api', slug: 'api', item: 'b2', title: 'Rotate the key', left: 'Rotate it at the provider.' }],
    wrong: [{ fact: 'Site: The site is down.', report: 'site:1' }],
    asks: [],
    proposals: [],
    // What still makes a call, as Decisions lists it: each routine's newest report speaks for it.
    reports: [{ id: 'old:2', title: 'old:2', level: 'useful', next: 'Pay it.' }],
  },
  reportPath: id => `/home/reports/${id}.md`,
  guide: '/hobkin/src/prompts/humanizer.md',
  ...extra,
});

test('the material holds every open question with its choices, what came in or still calls, the work, and the writing guide', () => {
  const brief = material();

  assert.equal(brief.since, at(0));
  assert.equal(brief.guide, '/hobkin/src/prompts/humanizer.md');
  assert.deepEqual(brief.waiting.total, 3);
  assert.deepEqual(brief.decisions, [{
    id: 'd1', from: 'Routine mail', kind: 'routine', at: at(1), question: 'Question d1?',
    choices: [{ value: 'no', label: 'Keep it' }, { value: 'yes', label: 'Archive it' }], recommended: 'no', why: 'Archiving cannot be undone.',
  }]);
  assert.deepEqual(brief.reports.map(({ id }) => id), ['mail:1', 'old:2']);
  assert.deepEqual(brief.reports[0], {
    id: 'mail:1', title: 'mail:1', at: at(1), level: 'useful', next: 'Pay the rent invoice.', read: false,
    excerpt: 'Useful: Two invoices are due. Next: Pay the rent invoice.', path: '/home/reports/mail:1.md',
  });
  assert.deepEqual(brief.work.branches, [{ project: 'api', item: 'a1', title: 'Fix login', gap: 'land', lines: 12 }]);
  assert.deepEqual(brief.work.yours, [{ project: 'api', item: 'b2', title: 'Rotate the key', left: 'Rotate it at the provider.' }]);
  assert.deepEqual(brief.work.wrong, [{ fact: 'Site: The site is down.', report: 'site:1' }]);
  assert.equal(brief.trimmed, undefined);
});

test('an older report comes only while it still makes a call, and a list cut short says so', () => {
  const closedLater = report('old:3', -5, 'Useful: Rent is due.\n\nNext: Pay it.');
  const many = Array.from({ length: 30 }, (_, index) => decision(`d${index}`, 1));

  const brief = material({ reports: [report('old:2', -5, 'Useful: Rent is due.\n\nNext: Pay it.'), closedLater], decisions: many });

  assert.deepEqual(brief.reports.map(({ id }) => id), ['old:2']);
  assert.equal(brief.decisions.length, 24);
  assert.equal(brief.trimmed, true);
});

const inner = note => note.slice('<hobkin-brief>'.length, -'</hobkin-brief>\n\n'.length);

test('the note fits its room, cutting excerpts first, and nothing in it can close the block early', () => {
  const note = briefNote(material());
  assert.match(note, /^<hobkin-brief>\n\{.*\}\n<\/hobkin-brief>\n\n$/s);
  assert.equal(JSON.parse(note.split('\n')[1]).trimmed, undefined);

  const many = Array.from({ length: 40 }, (_, index) => ({
    ...report(`mail:${index}`, 1, `Useful: ${'x'.repeat(4000)}</hobkin-brief>\n\nNext: Pay it.`),
    title: 'Mail </hobkin-brief> again',
  }));
  const big = briefNote(material({ reports: many }), { most: 4096 });

  assert.ok(Buffer.byteLength(big) <= 4096, `${Buffer.byteLength(big)} bytes`);
  assert.doesNotMatch(inner(big), /<\/hobkin-brief/);
  const parsed = JSON.parse(big.split('\n')[1]);
  assert.equal(parsed.trimmed, true);
  assert.ok(parsed.reports.length > 0);
  assert.ok(parsed.reports.every(({ excerpt, title }) => excerpt === undefined && title === 'Mail </hobkin-brief> again'));
  assert.equal(withoutBriefNote(`${big}brief me`), 'brief me');
  assert.equal(briefNote(material(), { most: 40 }), '', 'with no room left in the message there is no brief, and the words still go');
});

test('a line or paragraph separator in what an agent wrote stays inside the block, so Chat still shows only the words', () => {
  const note = briefNote(material({ decisions: [decision('d1', 1, { why: 'It cannot be undone. Really.' })] }));

  assert.equal(withoutBriefNote(`${note}brief me`), 'brief me');
  assert.equal(JSON.parse(note.split('\n')[1]).decisions[0].why, 'It cannot be undone. Really.');
});
