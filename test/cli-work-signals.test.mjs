import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { main } from '../src/cli/main.mjs';
import { workStatus } from '../src/cli/work/commands.mjs';
import { itemGrade, planWork } from '../src/cli/work/plan.mjs';
import { readSignals, recordSignals, signalGaps } from '../src/cli/work/signals.mjs';
import { chooseProject, fileItem, paths, pickNext, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const now = new Date(2026, 5, 1, 12).getTime();
const brief = 'Evidence, who benefits, the first change, the proof.';
const proof = { command: 'kamal app version', saw: 'abc1234' };
const page = { url: 'https://example.com/pricing', status: 200, page: true };
const errors = { ...proof, grouped: true, release: true };

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-signals-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root });
  writeMode(root, { enabled: true });
  writeJson(join(root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: now + 3 * DAY } });
  return root;
}

function project(root, slug = 'api', level = 'important', { studied = true } = {}) {
  chooseProject(root, `/repos/${slug}`, level, now);
  mkdirSync(paths(root, slug).directory, { recursive: true });
  if (studied) writeFileSync(paths(root, slug).project, '# What it is\n');
  const at = new Date(now).toISOString();
  writeState(root, slug, { lastLookAt: at, lastLensAt: at, lastIdeasAt: at });
}

const looksOf = (root, options = {}) => planWork(root, { now, ...options }).entries.filter(entry => entry.focus === 'signals');
const item = (key, details = {}) => ({ key, kind: 'feature', title: key, brief, impact: 'high', effort: 'small', ...details });

async function work(root, args, input) {
  let text = '';
  const code = await main(['work', ...args, '--home', root], { write: chunk => { text += chunk; } }, {
    input: Readable.from(input === undefined ? [] : [JSON.stringify(input)]),
  });
  return { code, result: JSON.parse(text) };
}

test('the number comes from what was proved, step by step, and a run\'s own number counts for nothing', t => {
  const root = home(t);
  project(root);
  const signalOf = report => recordSignals(root, 'api', { type: 'service', signal: 4, wants: 0, ...report }, now).signal;

  assert.equal(signalOf({}), 0);
  assert.equal(signalOf({ deploy: proof }), 1);
  assert.equal(signalOf({ deploy: proof, logs: proof }), 2);
  assert.equal(signalOf({ deploy: proof, logs: proof, health: page }), 3);
  assert.equal(signalOf({ deploy: proof, logs: proof, health: page, errors }), 4);
  assert.equal(signalOf({ logs: proof, health: page, errors }), 0, 'what cannot say when a change went live proves nothing about that change');
});

test('/up alone proves nothing past request outcomes, and a real page or a smoke test does', t => {
  const root = home(t);
  project(root);
  const signalOf = health => recordSignals(root, 'api', { type: 'service', deploy: proof, logs: proof, health }, now).signal;

  assert.equal(signalOf({ url: 'https://example.com/up', status: 200, page: true }), 2);
  assert.equal(signalOf({ url: 'https://example.com/pricing', status: 200 }), 2, 'nobody said it read the page');
  assert.equal(signalOf(page), 3);
  assert.equal(signalOf({ url: 'https://example.com/up', status: 200, smoke: proof }), 3);
  assert.equal(signalOf({ smoke: proof }), 3);
});

test('errors reach signal 4 only when they are grouped and tagged by release', t => {
  const root = home(t);
  project(root);
  const signalOf = found => recordSignals(root, 'api', { type: 'service', deploy: proof, logs: proof, health: page, errors: found }, now).signal;

  assert.equal(signalOf(proof), 3);
  assert.equal(signalOf({ ...proof, grouped: true }), 3);
  assert.equal(signalOf(errors), 4);
});

test('each type wants its own number, and what is missing comes back as the keys to file', t => {
  const root = home(t);
  project(root);
  const wanted = type => recordSignals(root, 'api', { type }, now).wants;

  assert.deepEqual(['service', 'app', 'site', 'package', 'tool'].map(wanted), [4, 4, 3, 1, 1]);
  assert.deepEqual(signalGaps(recordSignals(root, 'api', { type: 'service', deploy: proof, health: page }, now)), ['signal:logs', 'signal:errors']);
  assert.deepEqual(signalGaps(recordSignals(root, 'api', { type: 'site' }, now)), ['signal:deploy', 'signal:logs', 'signal:probe']);
  assert.deepEqual(signalGaps(recordSignals(root, 'api', { type: 'package', deploy: proof }, now)), []);
});

test('only what ran is recorded: a proof needs its command and what it printed, and nothing is written when one has neither', t => {
  const root = home(t);
  project(root);

  assert.throws(() => recordSignals(root, 'api', { type: 'robot' }, now), /type must be one of/);
  assert.throws(() => recordSignals(root, 'api', { type: 'site', logs: { command: 'kamal app logs' } }, now), /logs needs/);
  assert.throws(() => recordSignals(root, 'api', { type: 'site', deploy: 'kamal deploy' }, now), /deploy needs/);
  assert.throws(() => recordSignals(root, 'api', { type: 'site', errors: { saw: 'something' } }, now), /errors needs/);
  assert.throws(() => recordSignals(root, 'api', { type: 'site', health: { url: 'file:///etc/passwd', status: 200 } }, now), /health needs/);
  assert.throws(() => recordSignals(root, 'api', { type: 'site', health: { url: 'https://example.com/' } }, now), /health needs/);
  assert.throws(() => recordSignals(root, 'api', { type: 'site', health: { url: 'https://example.com/', status: 500 } }, now), /health needs/);
  assert.equal(existsSync(paths(root, 'api').signals), false);
});

test('how to roll back and which flags exist are kept as words, because no look ever runs them', t => {
  const root = home(t);
  project(root);

  const { rollback, flags } = recordSignals(root, 'api', { type: 'service', rollback: 'kamal rollback', flags: 'Flipper' }, now);

  assert.deepEqual([rollback, flags], ['kamal rollback', 'Flipper']);
});

test('hobkin work signals prints what is known, and records JSON from a run with the date it was checked', async t => {
  const root = home(t);
  project(root);

  assert.deepEqual((await work(root, ['signals', 'api'])).result, { signal: null, wants: null, checkedAt: null });

  const before = Date.now();
  const { code, result } = await work(root, ['signals', 'api'], { type: 'package', deploy: proof, checkedAt: '2020-01-01T00:00:00Z' });
  assert.deepEqual([code, result.ok, result.gaps], [0, true, []]);
  assert.match(result.message, /signal 1/);

  const { signal, wants, checkedAt } = (await work(root, ['signals', 'api'])).result;
  assert.deepEqual([signal, wants], [1, 1]);
  assert.ok(Date.parse(checkedAt) >= before, 'the date is hobkin\'s, never a run\'s');
  assert.equal(readSignals(root, 'api').deploy.command, proof.command);
});

test('a bad report fails out loud and leaves the last one standing', async t => {
  const root = home(t);
  project(root);
  recordSignals(root, 'api', { type: 'package', deploy: proof }, now);

  const { code, result } = await work(root, ['signals', 'api'], { type: 'robot' });

  assert.deepEqual([code, result.ok], [1, false]);
  assert.equal(readSignals(root, 'api').type, 'package');
});

test('a studied project with no signals gets one look at its priority, and an unstudied one waits for its study', t => {
  const root = home(t);
  project(root, 'api', 'critical');
  project(root, 'new', 'important', { studied: false });

  const looks = looksOf(root);

  assert.deepEqual(looks.map(({ slug, key, kind, lane, grade }) => [slug, key, kind, lane, grade]), [['api', 'signals:api', 'signals', 'look', 'P0']]);
});

test('a signals look comes once, then again when its record is 30 days old', t => {
  const root = home(t);
  project(root);
  const checked = new Date(now - 29 * DAY).toISOString();

  writeState(root, 'api', { lastSignalsAt: new Date(now - HOUR).toISOString() });
  assert.deepEqual(looksOf(root), [], 'a look that just started is not due again, whether or not it records anything');

  writeJson(paths(root, 'api').signals, { type: 'site', signal: 1, wants: 3, checkedAt: checked });
  writeState(root, 'api', { lastSignalsAt: checked });
  assert.deepEqual(looksOf(root), []);

  writeJson(paths(root, 'api').signals, { type: 'site', signal: 1, wants: 3, checkedAt: new Date(now - 30 * DAY).toISOString() });
  assert.equal(looksOf(root).length, 1);
});

test('asking for a signals look brings it forward', t => {
  const root = home(t);
  project(root);
  writeState(root, 'api', { lastSignalsAt: new Date(now).toISOString() });
  writeJson(paths(root, 'api').signals, { type: 'site', signal: 1, wants: 3, checkedAt: new Date(now).toISOString() });

  pickNext(root, 'signals:api');

  assert.deepEqual(looksOf(root).map(({ picked }) => picked), [true]);
});

test('work that closes a signal gap ranks as closing work does, at P1 or better', () => {
  const casual = { level: 'casual' };

  assert.equal(itemGrade(casual, { key: 'signal:logs', kind: 'chore', impact: 'low' }), 'P1');
  assert.equal(itemGrade({ level: 'critical' }, { key: 'signal:logs', kind: 'chore', impact: 'high' }), 'P0');
  assert.equal(itemGrade(casual, { key: 'signal:logs', kind: 'chore', impact: 'low', grade: 'P3' }), 'P3');
  assert.equal(itemGrade(casual, { key: 'signal:logs', kind: 'chore', impact: 'low', attempts: 1 }), 'P2');
});

test('new work steps down one grade on a project under what it wants, as it does for shipping first', () => {
  const short = { level: 'important', underSignal: true };
  const fine = { level: 'important', underSignal: false };

  assert.equal(itemGrade(fine, { kind: 'feature', impact: 'high' }), 'P1');
  assert.equal(itemGrade(short, { kind: 'feature', impact: 'high' }), 'P2');
  assert.equal(itemGrade(short, { kind: 'improvement', impact: 'high' }), 'P2');
  assert.equal(itemGrade(short, { kind: 'fix', impact: 'high' }), 'P1');
  assert.equal(itemGrade(short, { kind: 'feature', impact: 'high', grade: 'P1' }), 'P1', 'a grade set by hand stays');
  assert.equal(itemGrade(short, { kind: 'feature', impact: 'high', urgent: true }), 'P0');
  assert.equal(itemGrade(short, { kind: 'feature', impact: 'high', max: true }), 'P0');
});

test('what the plan knows about a project\'s signals only moves a row: nothing waits on it', t => {
  const root = home(t);
  project(root);
  writeState(root, 'api', { lastSignalsAt: new Date(now).toISOString() });
  recordSignals(root, 'api', { type: 'service' }, now);
  const { id } = fileItem(root, 'api', item('New page'), now);

  const { next, entries } = planWork(root, { now });

  assert.deepEqual([next.key, next.grade, next.waiting], [`item:api:${id}`, 'P2', null]);
  assert.match(entries[0].why, /seeing first/);

  updateItem(root, 'api', id, { grade: 'P1' }, now);
  assert.equal(planWork(root, { now }).next.grade, 'P1');
});

test('a project with no signals yet is not under anything, so nothing moves', t => {
  const root = home(t);
  project(root);
  writeState(root, 'api', { lastSignalsAt: new Date(now).toISOString() });
  fileItem(root, 'api', item('New page'), now);

  assert.equal(planWork(root, { now }).next.grade, 'P1');
});

test('a project row says its signal, and says nothing before one is known', t => {
  const root = home(t);
  project(root);
  assert.equal(workStatus(root).projects[0].signal, null);

  recordSignals(root, 'api', { type: 'service', deploy: proof, logs: proof }, now);
  assert.equal(workStatus(root).projects[0].signal, 2);
});
