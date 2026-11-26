import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CODE_BRANCH_WORK,
  LEVELS,
  PROMOTION_STREAK,
  SEEDED_LEVELS,
  autonomyPath,
  declinePromotion,
  levelFor,
  needsStandingRule,
  promote,
  promotionDue,
  readAutonomy,
  recordOutcome,
} from '../src/cli/autonomy.mjs';
import { OUTWARD_KINDS } from '../src/cli/outward.mjs';
import { telemetryView } from '../src/cli/telemetry/views.mjs';

const NOW = Date.parse('2026-11-26T20:00:00Z');

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-autonomy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const cleanRuns = (root, taskClass, count, extra = {}) => {
  for (let run = 0; run < count; run += 1) recordOutcome(root, taskClass, { clean: true, checksPassed: true, ...extra }, NOW);
};
const saved = root => JSON.parse(readFileSync(autonomyPath(root), 'utf8'));

test('the five levels, from most watched to least', () => {
  assert.deepEqual(LEVELS, ['draft', 'recommend', 'deadline', 'report', 'log']);
  assert.equal(PROMOTION_STREAK, 5);
});

test('a new class starts at recommend, and reading it writes nothing', t => {
  const root = home(t);

  assert.equal(levelFor(root, 'code-fix'), 'recommend');
  assert.equal(levelFor(root, 'code-fix:hobkin'), 'recommend');
  assert.equal(existsSync(join(root, 'runtime')), false);
});

test('code branch work starts where the user put it on 2026-11-26, in every project', t => {
  const root = home(t);

  assert.equal(SEEDED_LEVELS[CODE_BRANCH_WORK], 'report');
  assert.equal(levelFor(root, CODE_BRANCH_WORK), 'report');
  assert.equal(levelFor(root, `${CODE_BRANCH_WORK}:hobkin`), 'report');
});

test('a run counts its checks, its clean streak and the review minutes', t => {
  const root = home(t);

  recordOutcome(root, 'code-fix', { clean: true, checksPassed: true, reviewMinutes: 4 }, NOW);
  recordOutcome(root, 'code-fix', { clean: true, checksPassed: true, reviewMinutes: 10 }, NOW);
  recordOutcome(root, 'code-fix', { clean: true }, NOW);

  const row = saved(root).classes['code-fix'];
  assert.equal(saved(root).version, 1);
  assert.equal(row.level, 'recommend');
  assert.equal(row.runs, 3);
  assert.equal(row.cleanStreak, 3);
  assert.deepEqual(row.checks, { passed: 2, failed: 0 });
  assert.deepEqual([row.overrides, row.undos], [0, 0]);
  assert.equal(row.reviewMinutes.sum, 14);
  assert.equal(row.reviewMinutes.count, 2);
});

test('a run that is not clean, or whose checks failed, starts the streak again', t => {
  const root = home(t);

  cleanRuns(root, 'code-fix', 3);
  recordOutcome(root, 'code-fix', { clean: false }, NOW);
  assert.equal(readAutonomy(root)['code-fix'].cleanStreak, 0);

  cleanRuns(root, 'code-fix', 2);
  recordOutcome(root, 'code-fix', { clean: true, checksPassed: false }, NOW);

  const row = readAutonomy(root)['code-fix'];
  assert.equal(row.cleanStreak, 0);
  assert.deepEqual(row.checks, { passed: 5, failed: 1 });
  assert.equal(row.runs, 7);
});

test('an override or an undo moves the class one level back at once, with no question', t => {
  const root = home(t);

  recordOutcome(root, CODE_BRANCH_WORK, { clean: true, override: true }, NOW);
  assert.equal(levelFor(root, CODE_BRANCH_WORK), 'deadline');

  cleanRuns(root, CODE_BRANCH_WORK, 2);
  recordOutcome(root, CODE_BRANCH_WORK, { undo: true }, NOW);
  assert.equal(levelFor(root, CODE_BRANCH_WORK), 'recommend');

  const row = readAutonomy(root)[CODE_BRANCH_WORK];
  assert.equal(row.cleanStreak, 0);
  assert.deepEqual([row.overrides, row.undos], [1, 1]);
  assert.equal(row.runs, 3, 'an undo that comes after its run is no run of its own');
  assert.equal(promotionDue(root, CODE_BRANCH_WORK), null);
});

test('a class at draft stays at draft after another override', t => {
  const root = home(t);

  recordOutcome(root, 'code-fix', { clean: false, override: true }, NOW);
  recordOutcome(root, 'code-fix', { clean: false, override: true }, NOW);
  assert.equal(levelFor(root, 'code-fix'), 'draft');

  recordOutcome(root, 'code-fix', { clean: false, override: true }, NOW);
  assert.equal(levelFor(root, 'code-fix'), 'draft');
  assert.equal(readAutonomy(root)['code-fix'].overrides, 3);
});

test('after five clean runs in a row, the one question to file, as a plain decide card that keeps no rule', t => {
  const root = home(t);

  cleanRuns(root, 'code-fix', PROMOTION_STREAK - 1, { reviewMinutes: 3 });
  assert.equal(promotionDue(root, 'code-fix'), null);

  cleanRuns(root, 'code-fix', 1, { reviewMinutes: 5 });
  const card = promotionDue(root, 'code-fix');

  assert.equal(card.kind, 'autonomy');
  assert.deepEqual([card.learn, card.rule], [undefined, undefined], 'a yes moves this class once, and never answers a later promotion');
  assert.equal(card.taskClass, 'code-fix');
  assert.equal(card.key, 'autonomy:code-fix:deadline');
  assert.deepEqual(card.choices.map(({ value }) => value), ['yes', 'no']);
  assert.ok(card.choices.every(({ label }) => label.length <= 80));
  assert.equal(card.recommended, 'yes');
  assert.match(card.question, /code-fix/);
  assert.match(card.why, /5 clean runs in a row/);
  assert.match(card.why, /3 minutes/, 'the median review time, measured');
  assert.equal(card.choices[0].label, 'Yes, it acts at a deadline unless you object');
  assert.equal(levelFor(root, 'code-fix'), 'recommend', 'asking changes nothing');
});

test('only the user\'s yes moves a class on, one level, and its streak starts again', t => {
  const root = home(t);
  cleanRuns(root, 'code-fix', PROMOTION_STREAK);

  assert.equal(promote(root, 'code-fix', NOW).level, 'deadline');
  assert.equal(levelFor(root, 'code-fix'), 'deadline');
  assert.equal(readAutonomy(root)['code-fix'].cleanStreak, 0);
  assert.equal(promotionDue(root, 'code-fix'), null);

  cleanRuns(root, 'code-fix', PROMOTION_STREAK);
  assert.match(promotionDue(root, 'code-fix').question, /Should it act and report in the digest from now on\?/);
});

test('the user\'s no keeps the level and asks again only after another full streak', t => {
  const root = home(t);
  cleanRuns(root, 'code-fix', PROMOTION_STREAK);

  declinePromotion(root, 'code-fix');

  assert.equal(levelFor(root, 'code-fix'), 'recommend');
  assert.equal(promotionDue(root, 'code-fix'), null);
  cleanRuns(root, 'code-fix', PROMOTION_STREAK - 1);
  assert.equal(promotionDue(root, 'code-fix'), null);
  cleanRuns(root, 'code-fix', 1);
  assert.equal(promotionDue(root, 'code-fix').key, 'autonomy:code-fix:deadline');
});

test('a class at log has nowhere further to go', t => {
  const root = home(t);
  cleanRuns(root, CODE_BRANCH_WORK, PROMOTION_STREAK);
  assert.equal(promote(root, CODE_BRANCH_WORK, NOW).level, 'log');

  cleanRuns(root, CODE_BRANCH_WORK, PROMOTION_STREAK);
  assert.equal(promotionDue(root, CODE_BRANCH_WORK), null);
  assert.throws(() => promote(root, CODE_BRANCH_WORK, NOW), /already acts and logs/);
});

test('sending, posting, the calendar, spending, deleting, the user\'s time, the irreversible, health, money and law never go past recommend', t => {
  const root = home(t);

  for (const kind of OUTWARD_KINDS) assert.equal(needsStandingRule(kind), true, `the outward guard's ${kind}`);
  for (const kind of ['send-email', 'spend:hobkin', 'delete-files', 'commit-time', 'irreversible', 'health', 'money-transfer', 'law', 'code-branch:delete']) {
    assert.equal(needsStandingRule(kind), true, kind);
  }
  for (const kind of ['calendar-write:hobkin', 'email-reply', 'pay-invoice', 'reply', 'publish-post', 'tax-filing', 'send-mail', 'team-message', 'invite']) {
    cleanRuns(root, kind, PROMOTION_STREAK);
    assert.equal(promotionDue(root, kind), null, kind);
    assert.throws(() => promote(root, kind, NOW), /standing rule/, kind);
  }
  for (const kind of ['code-fix', 'sender-check', 'lawn-care', 'postgres-upgrade', 'calendar-read', 'write-docs']) assert.equal(needsStandingRule(kind), false, kind);

  cleanRuns(root, 'send-email', PROMOTION_STREAK);
  assert.equal(promotionDue(root, 'send-email'), null);
  assert.throws(() => promote(root, 'send-email', NOW), /standing rule/);
  assert.equal(levelFor(root, 'send-email'), 'recommend');

  recordOutcome(root, 'money', { clean: false, undo: true }, NOW);
  assert.equal(levelFor(root, 'money'), 'draft');
  assert.equal(promote(root, 'money', NOW).level, 'recommend', 'back to recommend is still recommend or above');
});

test('a ledger edited by hand past recommend still reads as recommend for a guarded class', t => {
  const root = home(t);
  mkdirSync(join(root, 'runtime'), { recursive: true });
  writeFileSync(autonomyPath(root), JSON.stringify({ version: 1, classes: { spend: { level: 'log' }, 'code-fix': { level: 'sideways' } } }));

  assert.equal(levelFor(root, 'spend'), 'recommend');
  assert.equal(levelFor(root, 'code-fix'), 'recommend', 'a level hobkin does not know is a new class');
});

test('a ledger that cannot be read is a fresh start', t => {
  const root = home(t);
  mkdirSync(join(root, 'runtime'), { recursive: true });
  writeFileSync(autonomyPath(root), '{ not json');

  assert.equal(levelFor(root, 'code-fix'), 'recommend');
  recordOutcome(root, 'code-fix', { clean: true }, NOW);
  assert.equal(saved(root).classes['code-fix'].runs, 1);
});

test('a task class is a short kind, with a project slug after a colon or none', t => {
  const root = home(t);

  for (const bad of ['', 'Code-Fix', 'code fix', 'code-fix:', ':hobkin', 'code-fix:hob:kin', 'x'.repeat(61), 42, null]) {
    assert.throws(() => levelFor(root, bad), /task class/, String(bad));
    assert.throws(() => recordOutcome(root, bad, { clean: true }, NOW), /task class/, String(bad));
  }
  assert.throws(() => recordOutcome(root, 'code-fix', { clean: true, reviewMinutes: -1 }, NOW), /reviewMinutes/);
  assert.equal(existsSync(autonomyPath(root)), false);
});

test('hobkin telemetry autonomy: each class\'s level, streak, overrides, undos, median review minutes and whether a promotion is due', t => {
  const root = home(t);
  cleanRuns(root, 'code-fix', PROMOTION_STREAK, { reviewMinutes: 2 });
  recordOutcome(root, 'code-fix', { clean: true, reviewMinutes: 9 }, NOW);
  recordOutcome(root, 'code-fix:hobkin', { clean: false, override: true, reviewMinutes: 12 }, NOW);

  const view = telemetryView(root, 'autonomy', { days: 30, now: NOW });

  assert.equal(view.view, 'autonomy');
  assert.deepEqual(view.classes, {
    [CODE_BRANCH_WORK]: { level: 'report', cleanStreak: 0, overrides: 0, undos: 0, medianReviewMinutes: null, promotionDue: false },
    'code-fix': { level: 'recommend', cleanStreak: 6, overrides: 0, undos: 0, medianReviewMinutes: 2, promotionDue: true },
    'code-fix:hobkin': { level: 'draft', cleanStreak: 0, overrides: 1, undos: 0, medianReviewMinutes: 12, promotionDue: false },
  });
});
