import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { runWorkCommand, workStatus } from '../src/cli/work/commands.mjs';
import { recordMachines } from '../src/cli/work/machines.mjs';
import { chooseProject, fileItem, readItems, readMode, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { writeYoloReports } from '../src/cli/work/yolo-report.mjs';
import { recordReadiness, reviewsByItself, runReadiness, setYolo, setYoloProject, yoloOnProject, yoloView } from '../src/cli/work/yolo.mjs';
import { branched, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const READY_KEY = 'yolo:ready';

const scored = () => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: 10, evidence: `What the review saw of ${name}.` }]));

const allReady = () => Object.fromEntries(['tests', 'errors', 'slowQueries', 'performance', 'logs', 'alerts', 'rollback']
  .map(name => [name, { ready: true, how: `${name} is in place.` }])
  .concat([['deploy', { ready: true, how: 'Nothing deploys: it runs from source.', deploys: false }]]));

function workspace(t, projects) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-yolo-projects-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const h = { base, root, checkouts: {} };
  for (const name of projects) choose(h, name);
  writeMode(root, { enabled: true });
  return h;
}

/** A project the user takes for work mode, whose state machines look found none. */
function choose(h, name) {
  h.checkouts[name] = repository(h.base, name);
  chooseProject(h.root, h.checkouts[name], 'important', NOW);
  recordMachines(h.root, name, { machines: [] }, { tlc: true, now: NOW });
}

const readinessItem = (h, slug) => readItems(h.root, slug).find(({ key }) => key === READY_KEY);
const switches = h => Object.fromEntries(yoloView(h.root).projects.map(({ slug, on }) => [slug, on]));

/** A project whose readiness run recorded every part in place and whose readiness work landed. */
function ready(h, slug) {
  const { id } = readinessItem(h, slug);
  updateItem(h.root, slug, id, { state: 'doing' }, NOW);
  recordReadiness(h.root, slug, allReady(), NOW);
  updateItem(h.root, slug, id, { state: 'merged' }, NOW);
}

function finished(h, slug, title) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts[slug], branch);
  const head = git(h.checkouts[slug], 'rev-parse', branch);
  const { id } = fileItem(h.root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, slug, id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores: scored(), head } }, NOW);
  return { slug, id };
}

const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
const stateOf = (h, { slug, id }) => readItems(h.root, slug).find(item => item.id === id).state;

test('a home that never set a project\'s switch keeps every project as before, and a project chosen once the switches are set starts off', t => {
  const h = workspace(t, ['api', 'web']);
  assert.deepEqual(switches(h), { api: true, web: true }, 'with YOLO mode never on, every project is as it was');
  assert.equal(readMode(h.root).yoloProjects, undefined, 'reading writes nothing');

  const turned = setYolo(h.root, { on: true }, NOW);

  assert.deepEqual(turned.filed.map(({ slug }) => slug), ['api', 'web'], 'turning it on takes on every project, as before');
  assert.deepEqual(readMode(h.root).yoloProjects, { api: true, web: true });
  choose(h, 'docs');
  assert.deepEqual(switches(h), { api: true, web: true, docs: false }, 'a project chosen since starts off');
  assert.equal(yoloOnProject(h.root, 'docs'), false);
});

test('a home where YOLO mode was on before projects had switches keeps it on where it took a project on, and one chosen since starts off', async t => {
  const h = workspace(t, ['api', 'web']);
  // As the pass before this change left it: the switch on and each chosen project's readiness work filed, with no project switches.
  writeMode(h.root, { yolo: { on: true, rate: 8 } });
  for (const slug of ['api', 'web']) fileItem(h.root, slug, { key: READY_KEY, kind: 'feature', title: `Get ${slug} ready for YOLO mode`, brief: 'Make it ready.' }, NOW);
  choose(h, 'docs');

  assert.deepEqual(switches(h), { api: true, web: true, docs: false });
  await yoloPass(h.root, { now: NOW });

  assert.equal(readinessItem(h, 'docs'), undefined, 'the pass never takes a project on by itself');
  assert.equal(readMode(h.root).yoloProjects, undefined, 'and writes no switch');
});

test('a project turned off is never made ready, reviewed or merged by YOLO mode, and its changes wait for the user', async t => {
  const h = workspace(t, ['api', 'web']);
  setYolo(h.root, { on: true }, NOW);
  ready(h, 'api');
  ready(h, 'web');
  const onApi = finished(h, 'api', 'Fix login');
  const onWeb = finished(h, 'web', 'Fix signup');
  await survey(h);

  assert.deepEqual(setYoloProject(h.root, 'web', false, NOW), { slug: 'web', on: false, filed: [] });

  assert.deepEqual(switches(h), { api: true, web: false });
  assert.deepEqual([reviewsByItself(h.root, 'api'), reviewsByItself(h.root, 'web')], [true, false]);
  assert.throws(() => runReadiness(h.root, 'web', NOW), /YOLO mode is off on web/);
  const reports = await yoloPass(h.root, { now: NOW, handOff: () => {} });
  assert.deepEqual(reports.map(({ slug }) => slug), ['api']);
  assert.deepEqual([stateOf(h, onApi), stateOf(h, onWeb)], ['merged', 'branch']);
  const web = workStatus(h.root).yolo.projects.find(({ slug }) => slug === 'web');
  assert.deepEqual([web.on, web.changes.map(({ why }) => why)], [false, ['YOLO mode is off on its project']]);
  assert.deepEqual(writeYoloReports(h.root, { now: NOW }).map(({ slug }) => slug), ['api'], 'and it has no report');

  // On again, the next pass takes its change. The main switch still decides first.
  setYoloProject(h.root, 'web', true, NOW);
  setYolo(h.root, { on: false }, NOW);
  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);
  setYolo(h.root, { on: true }, NOW);
  await survey(h);
  assert.deepEqual((await yoloPass(h.root, { now: NOW, handOff: () => {} })).map(({ slug }) => slug), ['web']);
});

test('turning a project off sets its queued readiness work aside and on puts it back, and turning one on files its readiness work', async t => {
  const h = workspace(t, ['api']);
  setYolo(h.root, { on: true }, NOW);
  const key = `item:api:${readinessItem(h, 'api').id}`;

  setYoloProject(h.root, 'api', false, NOW);
  assert.ok(readMode(h.root).queueSkipped.includes(key), 'its readiness work does not start by itself');
  setYoloProject(h.root, 'api', true, NOW);
  assert.ok(!readMode(h.root).queueSkipped.includes(key));

  choose(h, 'docs');
  const { filed } = setYoloProject(h.root, 'docs', true, NOW);
  assert.deepEqual([filed.length, readinessItem(h, 'docs')?.title], [1, 'Get docs ready for YOLO mode']);

  // With YOLO mode off, turning a project on files nothing: turning YOLO mode on does that.
  choose(h, 'lib');
  setYolo(h.root, { on: false }, NOW);
  assert.deepEqual(setYoloProject(h.root, 'lib', true, NOW).filed, []);
  assert.equal(readinessItem(h, 'lib'), undefined);

  assert.throws(() => setYoloProject(h.root, 'api', 'yes', NOW), /on or off/);
  assert.throws(() => setYoloProject(h.root, 'nowhere', true, NOW), /not a project work mode works on/);
  await assert.rejects(runWorkCommand(h.root, ['yolo', 'api', 'off']), /Pipe what the monitoring showed/, 'no hobkin work command sets a project\'s switch');
  assert.equal(yoloOnProject(h.root, 'api'), true);
});
