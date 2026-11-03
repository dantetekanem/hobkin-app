import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  answerAllowance, chooseProject, currentRequest, dailyLimit, declinedToday, dropProject, fileItem, followUsage, foldersLeft, hasWorkToShow, landing, nextDiscoveryAt, noteDiscovery,
  paths, prFile, priorityOf, proposeProject, readDiscovery, readItems, readLaunches, readMode, readProject, readProjects, recordDiscovery, recordLaunch, recordTokens, retryItem, sessionError, sessionUsage, setAgents,
  setDailyTokens, setHarness, setProjectPrMode, setProjectPriority, skipProject, startWork, tokensLastHour, tokensToday, updateItem, writeMode,
} from '../src/cli/work/store.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-work-')));
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
});

test('few agents run by default, and eight is the ceiling whatever is asked for', t => {
  const root = dataRoot(t);
  assert.equal(readMode(root).agents, 2);

  assert.equal(setAgents(root, 8).agents, 8);

  assert.equal(readMode(root).agents, 8);
  for (const wrong of [0, 9, 2.5, Number('lots')]) assert.throws(() => setAgents(root, wrong), /between 1 and 8/);
});

test('a pool saved by an older version never comes back, because the machine chose it and the user did not', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, 'work', 'mode.json'), JSON.stringify({ version: 1, enabled: true, pool: 9, folder: '/repos', harness: 'pi', dailyTokens: 100000000 }));

  assert.equal(readMode(root).agents, 2);
  assert.equal(writeMode(root, { enabled: false }).pool, undefined);
  assert.equal(readMode(root).pool, undefined);
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

test('naming a folder always runs discovery, and resuming does only with nothing to show', t => {
  const root = dataRoot(t);
  const lookedToday = { lastDiscoveryAt: '2026-01-01T00:00:00.000Z' };
  startWork(root, root);
  writeMode(root, lookedToday);

  assert.equal(startWork(root).lastDiscoveryAt, null, 'an empty tab with a day to wait tells the user nothing');

  writeMode(root, lookedToday);
  proposeProject(root, proposal);
  assert.equal(startWork(root).lastDiscoveryAt, lookedToday.lastDiscoveryAt, 'the proposals are there to answer');
  assert.equal(startWork(root, root).lastDiscoveryAt, null);
});

test('a project already taken also keeps the clock when work mode resumes', t => {
  const root = dataRoot(t);
  const lookedToday = { lastDiscoveryAt: '2026-01-01T00:00:00.000Z' };
  startWork(root, root);
  chooseProject(root, '/repos/api');
  writeMode(root, lookedToday);

  assert.equal(startWork(root).lastDiscoveryAt, lookedToday.lastDiscoveryAt);
});

test('only a proposal or a taken project counts as something to show', t => {
  const root = dataRoot(t);
  assert.equal(hasWorkToShow(root), false);

  proposeProject(root, proposal);
  assert.equal(hasWorkToShow(root), true);

  skipProject(root, 'finboard-api');
  assert.equal(hasWorkToShow(root), false);

  chooseProject(root, '/repos/api');
  assert.equal(hasWorkToShow(root), true);

  dropProject(root, 'api');
  assert.equal(hasWorkToShow(root), false);
});

test('the next discovery is a day after the last one, or due now if there was none', t => {
  const root = dataRoot(t);

  assert.equal(nextDiscoveryAt(readMode(root)), null);

  writeMode(root, { lastDiscoveryAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(nextDiscoveryAt(readMode(root)), '2026-01-02T00:00:00.000Z');
});

test('a discovery adds up what its agent reports, and the next one starts clean', t => {
  const root = dataRoot(t);
  assert.deepEqual(readDiscovery(root), {});

  recordDiscovery(root, { status: 'running', folder: '/repos', startedAt: '2026-01-01T00:00:00.000Z' });
  noteDiscovery(root, { folder: '/repos/api', doing: 'Reading its history', repositories: ['api'], rootFolders: ['api', 'site'] });
  noteDiscovery(root, { folder: '/repos/site', repositories: ['site', 'api'], finishedFolders: ['/repos/api'] });

  assert.deepEqual(readDiscovery(root), {
    status: 'running',
    folder: '/repos',
    startedAt: '2026-01-01T00:00:00.000Z',
    current: '/repos/site',
    doing: 'Reading its history',
    repositories: ['api', 'site'],
    rootFolders: ['api', 'site'],
    finishedFolders: ['api'],
  });

  recordDiscovery(root, { status: 'running', folder: '/other', startedAt: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual(readDiscovery(root), { status: 'running', folder: '/other', startedAt: '2026-01-02T00:00:00.000Z' });
});

test('only a list with nothing left on it is a finished look', () => {
  assert.equal(foldersLeft({}), null, 'with no list there is nothing to say it finished');
  assert.deepEqual(foldersLeft({ rootFolders: ['api', 'site'], finishedFolders: ['api'] }), ['site']);
  assert.deepEqual(foldersLeft({ rootFolders: ['api'], finishedFolders: ['api'] }), []);
  assert.deepEqual(foldersLeft({ rootFolders: [] }), []);
});

test('a proposal whose first work could not be filed is refused, so taking it never half fails', t => {
  const root = dataRoot(t);

  assert.throws(() => proposeProject(root, { ...proposal, first: [{ title: 'No key', kind: 'fix', brief: 'Evidence.' }] }), /stable key/);
  assert.throws(() => proposeProject(root, { ...proposal, first: [{ ...item, kind: 'someday' }] }), /kind must be/);

  assert.deepEqual(readProjects(root), []);
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
    { type: 'message', message: { role: 'assistant', usage: { input: 300, output: 100, cacheRead: 60000, cacheWrite: 4000, cost: { total: 0.25 } } } },
  ].map(entry => JSON.stringify(entry)).join('\n'));

  assert.deepEqual(sessionUsage(file), { tokens: 5600, cached: 110000, usd: 0.75, sessionId: 'session-1' });
  assert.deepEqual(sessionUsage(join(root, 'missing.jsonl')), { tokens: 0, cached: 0, usd: 0, sessionId: null });
});

test('a running session is followed from where it was, and a line still being written waits for the next look', t => {
  const root = dataRoot(t);
  const file = join(root, 'job.jsonl');
  const turn = (input, cacheRead) => `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input, output: 10, cacheRead } } })}\n`;
  assert.deepEqual(followUsage(file), { offset: 0, tokens: 0, cached: 0 }, 'a run that has not written anything yet has spent nothing');

  writeFileSync(file, `${JSON.stringify({ type: 'session', id: 'one' })}\n${turn(100, 1000)}`);
  const first = followUsage(file);
  assert.deepEqual([first.tokens, first.cached], [110, 1000]);

  const next = turn(200, 2000);
  appendFileSync(file, next.slice(0, 20));
  assert.deepEqual(followUsage(file, first), first, 'half a line counts for nothing');

  appendFileSync(file, next.slice(20));
  const second = followUsage(file, first);
  assert.deepEqual([second.tokens, second.cached], [320, 3000]);
  assert.deepEqual(followUsage(file, second), second);
  assert.equal(second.tokens, sessionUsage(file).tokens, 'it adds up to what the finished run reports');
});

test('a run that ended on a provider error leaves the words Pi was given, and one that recovered leaves nothing', t => {
  const root = dataRoot(t);
  const file = join(root, 'job.jsonl');
  const entries = (...messages) => writeFileSync(file, messages.map(message => JSON.stringify({ type: 'message', message })).join('\n'));

  entries({ role: 'assistant', stopReason: 'error', errorMessage: 'You have hit your ChatGPT usage limit (pro plan). Try again in ~40 min.' });
  assert.match(sessionError(file), /usage limit/);

  entries({ role: 'assistant', stopReason: 'error', errorMessage: 'Too many requests.' }, { role: 'assistant', stopReason: 'stop' });
  assert.equal(sessionError(file), null);

  assert.equal(sessionError(join(root, 'missing.jsonl')), null);
});

test('tokens count toward the day they were used, and a new day starts clean', t => {
  const root = dataRoot(t);
  const noon = new Date(2026, 5, 1, 12).getTime();

  recordTokens(root, { slug: 'api', lane: 'do', tokens: 1000 }, noon);
  recordTokens(root, { slug: 'site', lane: 'look', tokens: 500 }, noon + 3600000);

  assert.equal(tokensToday(root, noon + 7200000), 1500);
  assert.equal(tokensToday(root, new Date(2026, 5, 2, 1).getTime()), 0);
});

test('the last hour of tokens is a rolling window', t => {
  const root = dataRoot(t);
  const noon = new Date(2026, 5, 1, 12).getTime();

  recordTokens(root, { slug: 'api', lane: 'do', tokens: 1000 }, noon);
  recordTokens(root, { slug: 'api', lane: 'do', tokens: 500 }, noon + 3000000);

  assert.equal(tokensLastHour(root, noon + 3100000), 1500);
  assert.equal(tokensLastHour(root, noon + 3700000), 500);
});

test('a raised allowance lasts for today and the usual limit comes back tomorrow', t => {
  const root = dataRoot(t);
  const today = new Date(2026, 5, 1, 12).getTime();
  writeMode(root, { allowanceRequest: { day: new Date(today).toDateString(), limit: 100, proposed: 200 } });

  answerAllowance(root, true, today);

  const mode = readMode(root);
  assert.equal(dailyLimit(mode, today), 200);
  assert.equal(dailyLimit(mode, today + 86400000), 100000000);
  assert.equal(mode.allowanceRequest, null);
});

test('the user can name their own allowance, or keep it paused for the day', t => {
  const root = dataRoot(t);
  const today = new Date(2026, 5, 1, 12).getTime();

  answerAllowance(root, 500, today);
  assert.equal(dailyLimit(readMode(root), today), 500);

  answerAllowance(root, false, today);
  assert.equal(readMode(root).declinedOn, new Date(today).toDateString());
});

test('naming a figure after saying no takes the no back', t => {
  const root = dataRoot(t);
  const today = new Date(2026, 5, 1, 12).getTime();
  answerAllowance(root, false, today);

  const mode = answerAllowance(root, 500, today);

  assert.equal(declinedToday(mode, today), false);
});

test('there is nothing to accept when nothing was asked', t => {
  assert.throws(() => answerAllowance(dataRoot(t), true), /Nothing is waiting/);
});

test('a figure that is not a positive number is refused as one', t => {
  assert.throws(() => answerAllowance(dataRoot(t), Number('lots')), /positive number/);
});

test('an unanswered request from yesterday no longer stands', t => {
  const today = new Date(2026, 5, 1, 12).getTime();
  const mode = { allowanceRequest: { day: new Date(today).toDateString(), limit: 100, proposed: 200 } };

  assert.equal(currentRequest(mode, today).proposed, 200);
  assert.equal(currentRequest(mode, today + 86400000), null);
});

test('the daily token limit has a default and can be changed', t => {
  const root = dataRoot(t);
  assert.equal(readMode(root).dailyTokens, 100000000);

  assert.equal(setDailyTokens(root, 250000).dailyTokens, 250000);
  assert.throws(() => setDailyTokens(root, -1), /positive number/);
});

test('a new daily limit applies today, and a proposal made before it cannot lower it', t => {
  const root = dataRoot(t);
  const today = new Date(2026, 5, 1, 12).getTime();
  answerAllowance(root, 500, today);
  writeMode(root, { allowanceRequest: { day: new Date(today).toDateString(), limit: 500, proposed: 1000 } });

  const mode = setDailyTokens(root, 3000);

  assert.equal(dailyLimit(mode, today), 3000);
  assert.equal(currentRequest(mode, today), null);
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

test('only the watcher brings a skipped project back, and never a chosen or dropped one', t => {
  const root = dataRoot(t);
  proposeProject(root, proposal);
  skipProject(root, 'finboard-api');

  assert.equal(proposeProject(root, proposal, Date.now(), { reoffer: true }).state, 'proposed');

  chooseProject(root, 'finboard-api');
  assert.equal(proposeProject(root, proposal, Date.now(), { reoffer: true }).state, 'chosen');

  dropProject(root, 'finboard-api');
  assert.equal(proposeProject(root, proposal, Date.now(), { reoffer: true }).state, 'dropped');
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

test('an item keeps the impact and effort it was filed with, and a word it does not know is refused', t => {
  const root = dataRoot(t);

  const filed = fileItem(root, 'api', { ...item, impact: 'high', effort: 'small' });

  assert.deepEqual([filed.impact, filed.effort], ['high', 'small']);
  assert.throws(() => fileItem(root, 'api', { ...item, key: 'b', impact: 'huge' }), /impact must be/);
  assert.throws(() => fileItem(root, 'api', { ...item, key: 'c', effort: 'tiny' }), /effort must be/);
  assert.throws(() => updateItem(root, 'api', filed.id, { effort: 'tiny' }), /effort must be/);
  assert.equal(updateItem(root, 'api', filed.id, { effort: 'medium' }).effort, 'medium');
});

test('a grade on an item is the user\'s to set and to clear, and a word it does not know is refused', t => {
  const root = dataRoot(t);
  const filed = fileItem(root, 'api', item);

  assert.equal(updateItem(root, 'api', filed.id, { grade: 'P1' }).grade, 'P1');
  assert.throws(() => updateItem(root, 'api', filed.id, { grade: 'P4' }), /grade must be one of: P0, P1, P2, P3/);
  assert.equal(readItems(root, 'api')[0].grade, 'P1');
  assert.equal(updateItem(root, 'api', filed.id, { grade: null }).grade, null);
});

test('an attention item files like any other, so an agent can still say what goes first', t => {
  const root = dataRoot(t);

  const filed = fileItem(root, 'api', { ...item, kind: 'attention' });

  assert.deepEqual([filed.kind, filed.state], ['attention', 'open']);
});

test('a retry forgets the last failure and starts its tries again', t => {
  const root = dataRoot(t);
  const filed = fileItem(root, 'api', item);
  updateItem(root, 'api', filed.id, { attempts: 3, lastError: 'The tests would not start.' });

  retryItem(root, 'api', filed.id);

  const [retried] = readItems(root, 'api');
  assert.deepEqual([retried.state, retried.attempts, retried.lastError], ['open', 0, null]);
  assert.deepEqual(readMode(root).queueNext, []);
});

test('a project\'s priority comes from its level until the user sets one', () => {
  assert.deepEqual(['max', 'critical', 'important', 'casual'].map(level => priorityOf({ level })), ['P0', 'P0', 'P1', 'P2']);
  assert.equal(priorityOf({ level: 'casual', priority: 'P1' }), 'P1');
});

test('a priority is saved on the project and changes nothing else about it', t => {
  const root = dataRoot(t);
  chooseProject(root, '/repos/api', 'casual');

  const project = setProjectPriority(root, 'api', 'P0');

  assert.deepEqual([project.priority, project.level, project.state], ['P0', 'casual', 'chosen']);
  assert.throws(() => setProjectPriority(root, 'api', 'P9'), /priority must be one of: P0, P1, P2, P3/);
  assert.equal(readProject(root, 'api').priority, 'P0');
});

test('a project lands as a local branch until the user says otherwise', t => {
  const root = dataRoot(t);
  assert.equal(landing(chooseProject(root, '/repos/api', 'critical')), 'off');

  const project = setProjectPrMode(root, 'api', 'draft');

  assert.equal(project.prMode, 'draft');
  assert.equal(landing(project), 'draft');
  assert.throws(() => setProjectPrMode(root, 'api', 'loud'), /PR mode must be one of: off, draft, published/);
  assert.equal(landing(setProjectPrMode(root, 'api', 'published')), 'published');
});

test('a local PR\'s description sits with the project, named after its item', t => {
  const root = dataRoot(t);

  assert.equal(prFile(root, 'api', 'abc123'), join(paths(root, 'api').directory, 'prs', 'abc123.md'));
});

test('a broken line loses one event, not the file', t => {
  const root = dataRoot(t);
  fileItem(root, 'api', item);
  appendFileSync(paths(root, 'api').items, '{"id":"half\nnull\n');
  fileItem(root, 'api', { ...item, key: 'other' });

  assert.equal(readItems(root, 'api').length, 2);
});

test('project folders are created when work is filed', t => {
  const root = dataRoot(t);
  mkdirSync(join(root, 'work'), { recursive: true });

  fileItem(root, 'api', item);

  assert.equal(readItems(root, 'api').length, 1);
});

test('a launch folds by its item, so a later change keeps what came before', t => {
  const root = dataRoot(t);

  recordLaunch(root, 'api', { item: 'abc', sha: 'f00', stage: 'merged' }, Date.parse('2026-06-01T12:00:00Z'));
  recordLaunch(root, 'api', { item: 'abc', stage: 'pushed' }, Date.parse('2026-06-01T13:00:00Z'));
  recordLaunch(root, 'api', { item: 'def', sha: 'b42', stage: 'merged' });

  const [first, second] = readLaunches(root, 'api');
  assert.deepEqual([first.item, first.sha, first.stage], ['abc', 'f00', 'pushed']);
  assert.equal(second.item, 'def');
  assert.deepEqual(readLaunches(root, 'quiet-project'), []);
});
