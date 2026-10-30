import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseProject, dropProject, fileItem, landing, nextItem, paths, proposeProject, readItems, readMode, readProjects,
  recordTokens, sessionUsage, setDailyTokens, setHarness, skipProject, startWork, tokensToday, updateItem, writeMode,
} from '../src/cli/work/store.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'companion-work-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const proposal = {
  name: 'Finboard API',
  path: '/repos/finboard-api',
  summary: 'Rails app holding the user\'s financial data.',
  level: 'critical',
  reason: 'Real money.',
  found: 'CI red on main.',
  first: [{ key: 'ci:main', kind: 'fix', title: 'Fix the failing job spec', brief: 'Evidence and first change.' }],
};
const item = { key: 'update:rack', kind: 'update', title: 'Update rack', brief: 'Evidence and first change.' };

test('work mode starts off, and a change survives a reread', t => {
  const root = dataRoot(t);
  assert.equal(readMode(root).enabled, false);

  writeMode(root, { enabled: true });

  assert.equal(readMode(root).enabled, true);
  assert.ok(readMode(root).pool >= 2);
});

test('work mode starts from a real folder the user named, and remembers it', t => {
  const root = dataRoot(t);

  assert.throws(() => startWork(root), /Say which folder/);
  assert.throws(() => startWork(root, join(root, 'missing')), /Not a folder/);
  assert.equal(readMode(root).enabled, false);

  assert.equal(startWork(root, root).folder, root);
  writeMode(root, { enabled: false });

  const resumed = startWork(root);
  assert.deepEqual([resumed.enabled, resumed.folder], [true, root]);
});

test('a home-relative folder is expanded', t => {
  const root = dataRoot(t);

  assert.equal(startWork(root, '~').folder, realpathSync(homedir()));
});

test('naming a folder always runs discovery, and resuming does not', t => {
  const root = dataRoot(t);
  const lookedToday = { lastDiscoveryAt: '2026-01-01T00:00:00.000Z' };
  startWork(root, root);
  writeMode(root, lookedToday);

  assert.equal(startWork(root).lastDiscoveryAt, lookedToday.lastDiscoveryAt);
  assert.equal(startWork(root, root).lastDiscoveryAt, null);
});

test('Pi is the default harness, and the user can pick another that Herdr knows', t => {
  const root = dataRoot(t);
  assert.equal(readMode(root).harness, 'pi');

  assert.equal(setHarness(root, 'claude').harness, 'claude');

  assert.equal(readMode(root).harness, 'claude');
  assert.throws(() => setHarness(root, 'notepad'), /harness must be one of/);
});

test('a session\'s fresh tokens are counted without the cache reads that repeat earlier context', t => {
  const root = dataRoot(t);
  const file = join(root, 'job.jsonl');
  writeFileSync(file, [
    { type: 'session', id: 'session-1' },
    { type: 'message', message: { role: 'user', content: 'Go.' } },
    { type: 'message', message: { role: 'assistant', usage: { input: 1000, output: 200, cacheRead: 50000, cost: { total: 0.5 } } } },
    { type: 'message', message: { role: 'assistant', usage: { input: 300, output: 100, cacheRead: 60000, cost: { total: 0.25 } } } },
  ].map(entry => JSON.stringify(entry)).join('\n'));

  assert.deepEqual(sessionUsage(file), { tokens: 1600, usd: 0.75, sessionId: 'session-1' });
  assert.deepEqual(sessionUsage(join(root, 'missing.jsonl')), { tokens: 0, usd: 0, sessionId: null });
});

test('tokens count toward the day they were used, and a new day starts clean', t => {
  const root = dataRoot(t);
  const noon = new Date(2026, 5, 1, 12).getTime();

  recordTokens(root, { slug: 'api', lane: 'do', tokens: 1000 }, noon);
  recordTokens(root, { slug: 'site', lane: 'look', tokens: 500 }, noon + 3600000);

  assert.equal(tokensToday(root, noon + 7200000), 1500);
  assert.equal(tokensToday(root, new Date(2026, 5, 2, 1).getTime()), 0);
});

test('the daily token limit has a default and can be changed', t => {
  const root = dataRoot(t);
  assert.equal(readMode(root).dailyTokens, 100000000);

  assert.equal(setDailyTokens(root, 250000).dailyTokens, 250000);
  assert.throws(() => setDailyTokens(root, -1), /positive number/);
});

test('a proposal updates in place until the user answers it', t => {
  const root = dataRoot(t);

  proposeProject(root, proposal);
  proposeProject(root, { ...proposal, found: 'CI green.' });

  const projects = readProjects(root);
  assert.deepEqual(projects.map(({ slug, state, found }) => [slug, state, found]), [['finboard-api', 'proposed', 'CI green.']]);
});

test('a project the user already answered is not proposed again', t => {
  const root = dataRoot(t);
  proposeProject(root, proposal);
  skipProject(root, 'finboard-api');

  proposeProject(root, proposal);

  assert.equal(readProjects(root)[0].state, 'skipped');
});

test('taking a project keeps the suggested level unless the user picks one, and files its first items', t => {
  const root = dataRoot(t);
  proposeProject(root, proposal);

  const taken = chooseProject(root, 'finboard-api');

  assert.deepEqual([taken.state, taken.level], ['chosen', 'critical']);
  assert.deepEqual(readItems(root, 'finboard-api').map(({ key, state }) => [key, state]), [['ci:main', 'open']]);

  assert.equal(chooseProject(root, 'finboard-api', 'casual').level, 'casual');
  assert.equal(readItems(root, 'finboard-api').length, 1, 'changing the level files nothing new');
});

test('a project discovery left out can be taken by its path', t => {
  const root = dataRoot(t);

  const taken = chooseProject(root, '/repos/old-api');

  assert.deepEqual([taken.slug, taken.state, taken.level, taken.path], ['old-api', 'chosen', 'important', '/repos/old-api']);
});

test('dropping a project stops work and keeps its items', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/old-api');
  fileItem(root, 'old-api', item);

  dropProject(root, 'old-api');

  assert.equal(readProjects(root)[0].state, 'dropped');
  assert.equal(readItems(root, 'old-api').length, 1);
});

test('an item key files once, and a declined one needs a reason to come back', t => {
  const root = dataRoot(t);
  const first = fileItem(root, 'api', item);

  assert.equal(fileItem(root, 'api', { ...item, title: 'Again' }).id, first.id);
  assert.equal(readItems(root, 'api').length, 1);

  updateItem(root, 'api', first.id, { state: 'declined' });
  assert.equal(fileItem(root, 'api', item).state, 'declined');

  assert.equal(fileItem(root, 'api', { ...item, reopen: 'rack 4 changed this.' }).state, 'open');
});

test('an item needs a title and a brief', t => {
  const root = dataRoot(t);

  assert.throws(() => fileItem(root, 'api', { key: 'x', kind: 'fix', title: 'Only a title' }), /brief/);
  assert.throws(() => fileItem(root, 'api', { ...item, kind: 'wish' }), /kind/);
});

test('the next item follows urgency, then kind, then age, and skips what only the user can do', t => {
  const root = dataRoot(t);
  fileItem(root, 'api', { ...item, key: 'a', kind: 'attention' });
  fileItem(root, 'api', { ...item, key: 'b', kind: 'feature' });
  const chore = fileItem(root, 'api', { ...item, key: 'c', kind: 'chore' });
  const security = fileItem(root, 'api', { ...item, key: 'd', kind: 'security' });

  assert.equal(nextItem(root, 'api').id, security.id);

  updateItem(root, 'api', security.id, { state: 'pr' });
  const urgent = fileItem(root, 'api', { ...item, key: 'e', kind: 'feature', urgent: true });
  assert.equal(nextItem(root, 'api').id, urgent.id);

  updateItem(root, 'api', urgent.id, { state: 'stuck' });
  assert.equal(nextItem(root, 'api').id, chore.id);
});

test('a broken line loses one event, not the file', t => {
  const root = dataRoot(t);
  fileItem(root, 'api', item);
  appendFileSync(paths(root, 'api').items, '{"id":"half\nnull\n');
  fileItem(root, 'api', { ...item, key: 'other' });

  assert.equal(readItems(root, 'api').length, 2);
});

test('changes stay in draft where they should not reach anyone yet', () => {
  assert.equal(landing('critical', 'fix'), 'draft');
  assert.equal(landing('important', 'feature'), 'draft');
  assert.equal(landing('important', 'fix'), 'pr');
  assert.equal(landing('casual', 'feature'), 'pr');
});

test('project folders are created when work is filed', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'work'), { recursive: true });

  fileItem(root, 'api', item);

  assert.equal(readItems(root, 'api').length, 1);
});
