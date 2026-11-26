import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { carryOutAnswer } from '../src/cli/answer.mjs';
import { clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { initialize } from '../src/cli/config.mjs';
import { openDecisions } from '../src/cli/decisions.mjs';
import { afterMerges } from '../src/cli/work/after-merge.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { mergeItem, publishItem } from '../src/cli/work/controls.mjs';
import { chooseProject, fileItem, paths, prFile, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { prepareProjects, recordReadiness, setYolo } from '../src/cli/work/yolo.mjs';
import { recordMachines } from '../src/cli/work/machines.mjs';
import { branched, git, repository, withOrigin } from './helpers/work-fixture.mjs';

// A merge is not the end of the work on a project that deploys. hobkin asks "Deploy now?" once a project, with what merged since its last
// deploy, and keeps that one question up to date as more merges land. A yes hands the main agent the deploy, its live check and 30 minutes of
// watching, and an issue closes once the deploy that carried it held. A project that does not deploy closes its issues at merge, as before.
// Nothing here reaches GitHub or deploys anything: gh is always the test's, and every address is on .invalid.

const NOW = Date.parse('2026-06-01T12:00:00Z');
const MINUTE = 60000;
const PATH = 'bin/deploy from main, undone by bin/deploy rollback.';
const BACK = 'bin/deploy rollback takes the last release back.';

const allReady = (deploy = { ready: true, how: PATH }) => ({
  tests: { ready: true, how: 'node --test runs 40 tests in 3 s.' },
  errors: { ready: true, how: 'Exceptions reach the error tracker, which mails the user.' },
  slowQueries: { ready: true, how: 'The database logs queries over 200 ms.' },
  performance: { ready: true, how: 'Request timings are kept, with last week as the baseline.' },
  logs: { ready: true, how: 'bin/logs search finds any request by id.' },
  alerts: { ready: true, how: 'An alert goes to the user by mail within 5 minutes.' },
  rollback: { ready: true, how: BACK },
  deploy,
});

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-deploys-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  recordMachines(root, 'api', { machines: [] }, { tlc: true, now: NOW });
  return { base, root, checkout };
}

/** The project's readiness, recorded by its readiness run and landed: how it deploys, and how a deploy is taken back. YOLO mode stays off. */
function deploysBy(h, deploy) {
  prepareProjects(h.root, NOW);
  const { id } = readItems(h.root, 'api').find(({ key }) => key === 'yolo:ready');
  updateItem(h.root, 'api', id, { state: 'doing' }, NOW);
  recordReadiness(h.root, 'api', allReady(deploy), NOW);
  updateItem(h.root, 'api', id, { state: 'merged' }, NOW);
}

/** Finished work on its own branch, filed for issue acme/api#`number` when it has one. */
function finished(h, title, { number, kind = 'fix' } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkout, branch);
  const issue = number ? { issue: { repo: 'acme/api', number, url: `https://github.invalid/acme/api/issues/${number}` } } : {};
  const { id } = fileItem(h.root, 'api', { key: title, kind, title, brief: 'What goes wrong.', ...issue }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'It failed, then it passed.' }, NOW);
  return { id, title, branch };
}

const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
const lines = h => clientNoticesToPost(h.root).map(({ line }) => line);
const deployAsks = h => openDecisions(h.root).filter(({ answerTo }) => answerTo?.kind === 'deploy');
const tip = h => git(h.checkout, 'rev-parse', 'main');

/** gh as the test plays it: every issue is open until closed, and what it was asked is written down. Anything but an issue is refused. */
function fakeGh() {
  const asked = [];
  const gh = async args => {
    asked.push(args);
    if (args[0] !== 'issue') throw Error(`Not an issue command: ${args.join(' ')}`);
    return args[1] === 'view' ? JSON.stringify({ state: 'OPEN' }) : '';
  };
  return { gh, asked, closed: () => asked.filter(args => args[1] === 'close') };
}

const calm = part => ({ regressed: false, saw: `Nothing new in ${part}.` });
const reading = (change = {}) => ({
  live: 'The live revision is the deployed commit, and a login works.',
  minutes: 30,
  errors: calm('errors'),
  slowQueries: calm('slow queries'),
  latency: { regressed: false, saw: 'p95 118 ms against a baseline of 120 ms.' },
  ...change,
});
const deployed = (h, commit, sent) => runWorkCommand(h.root, ['deployed', 'api', commit], Readable.from([JSON.stringify(sent)]));

test('a merge on a project that deploys keeps its issue open and asks Deploy now? once, updated as more merges land', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  const exports = finished(h, 'Add exports', { kind: 'feature' });
  const logout = finished(h, 'Fix logout', { number: 13 });
  const { gh, asked } = fakeGh();

  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });
  const [first] = deployAsks(h);

  assert.deepEqual(asked, [], 'no issue closes at merge on a project that deploys');
  assert.deepEqual(read(h, login).deploy.state, 'waiting');
  assert.ok(lines(h).includes('Merged "Fix login" on api. acme/api#12 closes once the deploy that carries it is verified live.'), lines(h).join('\n'));
  assert.deepEqual([first.tldr, first.choices.map(({ value }) => value), first.recommended], ['Deploy now? 1 change merged on api', ['later', 'deploy'], 'deploy']);

  await mergeItem(h.root, 'api', exports.id, { now: NOW + MINUTE });
  await mergeItem(h.root, 'api', logout.id, { now: NOW + 2 * MINUTE });
  await afterMerges(h.root, { now: NOW + 3 * MINUTE, gh });
  await afterMerges(h.root, { now: NOW + 4 * MINUTE, gh });
  const asks = deployAsks(h);

  assert.equal(asks.length, 1, 'one question a project');
  assert.equal(asks[0].id, first.id, 'the same question, brought up to date');
  assert.equal(asks[0].tldr, 'Deploy now? 3 changes merged on api');
  assert.deepEqual(asks[0].answerTo, { kind: 'deploy', slug: 'api', items: [logout.id, exports.id, login.id] });
  assert.equal(asks[0].question, [
    'api has 3 changes merged since its last deploy, newest first.',
    'Fixes: "Fix logout" (acme/api#13), "Fix login" (acme/api#12).',
    'Features: "Add exports".',
    `Deploy now hands the deploy to the main agent: ${PATH} It checks it live, watches the monitoring for 30 minutes, and then closes their issues. Not now keeps them open.`,
  ].join('\n'));
  assert.deepEqual(asked, []);
});

test('a project that does not deploy, or whose deploy path is not known, closes its issues at merge and asks nothing', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: 'Nothing deploys: other projects use it from source.', deploys: false });
  const login = finished(h, 'Fix login', { number: 12 });
  const { gh, closed } = fakeGh();

  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.equal(closed().length, 1);
  assert.equal(read(h, login).deploy, undefined);
  assert.deepEqual(deployAsks(h), []);
});

test('Not now keeps the merges and their issues open, and the question comes back only once another merge lands', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  const logout = finished(h, 'Fix logout');
  const { gh, asked } = fakeGh();
  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });

  const answered = await carryOutAnswer(h.root, deployAsks(h)[0].id, { value: 'later' }, NOW + 2000);
  await afterMerges(h.root, { now: NOW + 3000, gh });

  assert.match(answered.message, /stay merged and waiting for a deploy, and their issues stay open/);
  assert.deepEqual([deployAsks(h), read(h, login).deploy.state, asked], [[], 'waiting', []]);

  await mergeItem(h.root, 'api', logout.id, { now: NOW + 4000 });
  await afterMerges(h.root, { now: NOW + 5000, gh });

  assert.deepEqual(deployAsks(h).map(({ answerTo }) => answerTo.items), [[logout.id, login.id]], 'it lists everything since the last deploy');
});

test('Deploy now hands the main agent one deploy of exactly what was listed, at the default branch\'s tip', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  const logout = finished(h, 'Fix logout');
  const { gh } = fakeGh();
  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await mergeItem(h.root, 'api', logout.id, { now: NOW + 1000 });
  await afterMerges(h.root, { now: NOW + 2000, gh });
  const commit = tip(h);

  const answered = await carryOutAnswer(h.root, deployAsks(h)[0].id, { value: 'deploy' }, NOW + 3000);
  const handed = [];
  await afterMerges(h.root, { now: NOW + 4000, gh, handOff: job => handed.push(job) });
  await afterMerges(h.root, { now: NOW + 5000, gh, handOff: job => handed.push(job) });

  assert.equal(answered.message, `The main agent deploys 2 changes on api at ${commit.slice(0, 7)} next. Their issues close once it is verified live.`);
  assert.deepEqual(deployAsks(h), []);
  assert.equal(handed.length, 1, 'a deploy is handed on once');
  const [job] = handed;
  assert.deepEqual([job.project, job.commit, job.items.map(({ item }) => item), job.why], ['api', commit, [logout.id, login.id], 'The user said yes to Deploy now? for exactly these changes']);
  assert.match(job.asked, new RegExp(`Deploy the default branch at exactly ${commit}, pushing it first if the deploy needs it there, by the project's recorded path: bin/deploy from main, undone by bin/deploy rollback\\. Its way back: ${BACK.replaceAll('.', '\\.')}`));
  assert.match(job.asked, new RegExp(`watch its monitoring for 30 minutes .* to hobkin work deployed api ${commit}\\.`));
  assert.deepEqual([read(h, login).deploy.state, read(h, login).deploy.commit], ['deploying', commit]);
});

test('an issue closes once the deploy that carried it held, naming what landed it, and a short calm reading is refused', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  const { gh, closed } = fakeGh();
  await mergeItem(h.root, 'api', login.id, { now: NOW });
  const { sha } = read(h, login).landed;
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await carryOutAnswer(h.root, deployAsks(h)[0].id, { value: 'deploy' }, NOW + 2000);
  const commit = tip(h);

  await assert.rejects(deployed(h, 'abc1234', reading()), /No deploy at abc1234 is with the main agent on api/);
  await assert.rejects(deployed(h, commit, reading({ minutes: 5 })), /the whole 30 minutes/);
  await assert.rejects(deployed(h, commit, reading({ live: undefined })), /live/);
  assert.deepEqual(closed(), [], 'nothing closes before the reading');

  const recorded = await deployed(h, commit.slice(0, 7), reading());
  await afterMerges(h.root, { now: NOW + 40 * MINUTE, gh });
  await afterMerges(h.root, { now: NOW + 41 * MINUTE, gh });

  assert.equal(recorded.message, `The deploy of "Fix login" on api at ${commit.slice(0, 7)} held for 30 minutes: Nothing new in errors. Nothing new in slow queries. p95 118 ms against a baseline of 120 ms.`);
  assert.deepEqual(closed(), [['issue', 'close', '12', '--repo', 'acme/api', '--reason', 'completed', '--comment',
    `Fixed by ${sha}, merged by hobkin and live since its deploy of ${commit.slice(0, 7)}. Its monitoring held for 30 minutes.`]]);
  assert.ok(lines(h).includes('"Fix login" is live on api. Closed acme/api#12 on GitHub.'), lines(h).join('\n'));
  assert.deepEqual([read(h, login).deploy.state, read(h, login).deploy.issue], ['live', 'closed']);
});

test('a project with no monitoring to watch closes its issues as soon as the deploy is live, and says so', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  const { gh, closed } = fakeGh();
  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await carryOutAnswer(h.root, deployAsks(h)[0].id, { value: 'deploy' }, NOW + 2000);
  const none = { notApplicable: 'It has no monitoring yet.' };

  const recorded = await deployed(h, tip(h), reading({ minutes: 0, errors: none, slowQueries: none, latency: none }));
  await afterMerges(h.root, { now: NOW + 3000, gh });

  assert.equal(recorded.message, `The deploy of "Fix login" on api at ${tip(h).slice(0, 7)} is live, with no monitoring to watch: The live revision is the deployed commit, and a login works.`);
  assert.match(closed()[0].at(-1), /live since its deploy of [0-9a-f]{7}\. It has no monitoring to watch\.$/);
});

test('a regression keeps the issues open and says why, and those changes ride along with the next deploy', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  const logout = finished(h, 'Fix logout', { number: 13 });
  const { gh, closed } = fakeGh();
  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await carryOutAnswer(h.root, deployAsks(h)[0].id, { value: 'deploy' }, NOW + 2000);
  const commit = tip(h);

  const recorded = await deployed(h, commit, reading({ minutes: 4, slowQueries: { regressed: true, saw: 'orders#index now runs a 900 ms query.' } }));
  await afterMerges(h.root, { now: NOW + 5 * MINUTE, gh });

  const problem = clientNoticesToPost(h.root).find(({ line }) => line.startsWith('Problem after deploying'));
  assert.deepEqual([problem.tone, problem.line], ['critical', `Problem after deploying "Fix login" on api at ${commit.slice(0, 7)}: orders#index now runs a 900 ms query. acme/api#12 stays open. The way back: ${BACK}`]);
  assert.deepEqual(recorded.regressed, ['slowQueries']);
  assert.deepEqual([closed(), read(h, login).deploy.state, deployAsks(h)], [[], 'regressed', []], 'a regression alone asks nothing again');

  await mergeItem(h.root, 'api', logout.id, { now: NOW + 6 * MINUTE });
  await afterMerges(h.root, { now: NOW + 7 * MINUTE, gh });

  assert.deepEqual(deployAsks(h).map(({ answerTo }) => answerTo.items), [[logout.id, login.id]]);
});

test('the user\'s ask in Chat deploys what waits, merged long since or a moment ago, and answers the open Deploy now? for them', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  const logout = finished(h, 'Fix logout', { number: 13 });
  const { gh, closed } = fakeGh();
  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });
  await mergeItem(h.root, 'api', logout.id, { now: NOW + 2000 });

  const asked = await runWorkCommand(h.root, ['deploy', 'api']);
  const handed = [];
  await afterMerges(h.root, { now: NOW + 3000, gh, handOff: job => handed.push(job) });

  assert.deepEqual([asked.handOff.commit, asked.handOff.items.map(({ item }) => item)], [tip(h), [logout.id, login.id]]);
  assert.match(asked.message, /^Deploy 2 changes on api at [0-9a-f]{7}: hand the job in handOff to one session\./);
  assert.deepEqual([deployAsks(h), handed, closed()], [[], [], []], 'the job is the main agent\'s already, and nothing closes before its reading');
  assert.deepEqual([read(h, login).deploy.state, read(h, logout).deploy.state], ['deploying', 'deploying']);
  await assert.rejects(runWorkCommand(h.root, ['deploy', 'api']), /Nothing on api waits for a deploy/);
});

test('a project that does not deploy has nothing to deploy on the user\'s ask', async t => {
  const h = workspace(t);
  await assert.rejects(runWorkCommand(h.root, ['deploy', 'api']), /api has no deploy path recorded/);
});

test('a PR on a project that deploys only refers to its issue, so GitHub leaves it open until the deploy that carries it held', async t => {
  const h = workspace(t);
  withOrigin(h.base, h.checkout);
  deploysBy(h, { ready: true, how: PATH });
  const described = finished(h, 'Fix login', { number: 12 });
  const plain = finished(h, 'Fix logout', { number: 13 });
  mkdirSync(paths(h.root, 'api').prs, { recursive: true });
  writeFileSync(prFile(h.root, 'api', described.id), '# Fix login\n\nIt signs in after a reset.\n\nFixes acme/api#12\n');
  const created = [];
  const gh = async args => {
    if (args[1] === 'list') return '[]';
    created.push(args.slice(-2));
    return 'https://github.invalid/acme/api/pull/1\n';
  };

  await publishItem(h.root, 'api', described.id, { gh, now: NOW });
  await publishItem(h.root, 'api', plain.id, { gh, now: NOW });

  assert.deepEqual(created, [['--body-file', prFile(h.root, 'api', described.id)], ['--body', 'What goes wrong.\n\nRefs acme/api#13']]);
  assert.equal(readFileSync(prFile(h.root, 'api', described.id), 'utf8'), '# Fix login\n\nIt signs in after a reset.\n\nRefs acme/api#12\n');
});

// YOLO mode hands on the deploy of its own merge. That merge is not asked about again, and its issue waits for its reading too.

const scored = () => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback'].map(name => [name, { score: 10, evidence: `What the review saw of ${name}.` }]));

function yoloReady(h) {
  writeMode(h.root, { enabled: true });
  setYolo(h.root, { on: true }, NOW);
  deploysBy(h, { ready: true, how: PATH });
}

function reviewed(h, title, number) {
  const change = finished(h, title, { number });
  updateItem(h.root, 'api', change.id, { review: { kind: 'bug-fix', scores: scored(), head: git(h.checkout, 'rev-parse', change.branch), by: 'change-review' } }, NOW);
  return change;
}

const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

test('a merge YOLO mode handed on is not asked about, and its issue closes after its own calm reading', async t => {
  const h = workspace(t);
  yoloReady(h);
  const login = reviewed(h, 'Fix login', 12);
  await survey(h);
  const { gh, closed } = fakeGh();

  await yoloPass(h.root, { now: NOW, handOff: () => {} });
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.deepEqual([read(h, login).state, read(h, login).deploy.state, read(h, login).deploy.by], ['merged', 'deploying', 'yolo']);
  assert.deepEqual([deployAsks(h), closed()], [[], []]);

  await runWorkCommand(h.root, ['yolo', 'api', login.id], Readable.from([JSON.stringify(reading())]));
  await afterMerges(h.root, { now: NOW + 40 * MINUTE, gh });

  assert.equal(closed().length, 1);
  assert.equal(read(h, login).deploy.issue, 'closed');
});

test('a merge YOLO mode could not hand on is asked about like any other', async t => {
  const h = workspace(t);
  yoloReady(h);
  const login = reviewed(h, 'Fix login', 12);
  await survey(h);
  const { gh } = fakeGh();

  await yoloPass(h.root, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh });

  assert.deepEqual(deployAsks(h).map(({ answerTo }) => answerTo.items), [[login.id]]);
});

test('an agent cannot say a deploy went live', async t => {
  const h = workspace(t);
  deploysBy(h, { ready: true, how: PATH });
  const login = finished(h, 'Fix login', { number: 12 });
  await mergeItem(h.root, 'api', login.id, { now: NOW });
  await afterMerges(h.root, { now: NOW + 1000, gh: fakeGh().gh });

  await runWorkCommand(h.root, ['item', 'api'], Readable.from([JSON.stringify({ id: login.id, deploy: { state: 'live' } })]));

  assert.equal(read(h, login).deploy.state, 'waiting');
});
