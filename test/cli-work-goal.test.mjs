import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { runWorkCommand, workStatus } from '../src/cli/work/commands.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { chooseProject, isGoal, paths, fileItem, proposeProject, readItems, updateItem, readProject, setProjectIssues, setProjectPrMode, writeDirections, writeMode } from '../src/cli/work/store.mjs';
import { prepareProjects, runReadiness, setYolo, setYoloProject, yoloView } from '../src/cli/work/yolo.mjs';
import { director } from './helpers/work-director.mjs';
import { branched, git, repository } from './helpers/work-fixture.mjs';

/** A goal's folder is a plain folder: no repository, nothing hobkin wrote. */
function goalFolder(h, name = 'novel') {
  const folder = join(h.base, name);
  mkdirSync(folder);
  return folder;
}

function takeGoal(h, name = 'novel') {
  const folder = goalFolder(h, name);
  proposeProject(h.root, { name, path: folder, level: 'important', kind: 'goal' });
  chooseProject(h.root, name);
  return folder;
}

test('a record with no kind is code, and only kind goal is a goal', t => {
  assert.equal(isGoal({ slug: 'api' }), false);
  assert.equal(isGoal({ kind: 'code' }), false);
  assert.equal(isGoal({ kind: 'goal' }), true);
  assert.equal(isGoal(null), false);
});

test('a goal takes no pull request or issue setting, and code still does', t => {
  const h = director(t);
  takeGoal(h);
  proposeProject(h.root, { name: 'api', path: '/repos/api', level: 'casual' });

  assert.throws(() => setProjectPrMode(h.root, 'novel', 'draft'), /A goal has no pull requests/);
  assert.throws(() => setProjectIssues(h.root, 'novel', 'all'), /A goal has no GitHub issues/);
  assert.equal(readProject(h.root, 'novel').prMode, undefined);
  assert.equal(setProjectPrMode(h.root, 'api', 'draft').prMode, 'draft');
});

test('the user\'s words are written as the directions, and blank words write nothing', t => {
  const h = director(t);
  proposeProject(h.root, { name: 'novel', path: h.base, level: 'casual', kind: 'goal' });

  writeDirections(h.root, 'novel', '   \n');
  assert.equal(existsSync(paths(h.root, 'novel').directions), false);
  writeDirections(h.root, 'novel', 'Finish chapter three.\n');
  assert.equal(readFileSync(paths(h.root, 'novel').directions, 'utf8'), 'Finish chapter three.\n');
});

test('YOLO mode files nothing on a goal, refuses its switch, leaves it out of the view, and still treats code as before', t => {
  const h = director(t);
  takeGoal(h);
  proposeProject(h.root, { name: 'api', path: '/repos/api', level: 'casual' });
  chooseProject(h.root, 'api');
  const { filed } = setYolo(h.root, { on: true });

  assert.deepEqual(filed.map(({ slug }) => slug), ['api']);
  assert.deepEqual(prepareProjects(h.root), []);
  assert.deepEqual(readItems(h.root, 'novel'), []);
  assert.throws(() => setYoloProject(h.root, 'novel', true), /A goal has nothing to merge, so YOLO mode does nothing there/);
  assert.throws(() => runReadiness(h.root, 'novel'), /A goal has nothing to merge/);
  assert.deepEqual(yoloView(h.root).projects.map(({ slug }) => slug), ['api']);
});

const piped = value => Readable.from([JSON.stringify(value)]);
const step = { key: 'draft', kind: 'chore', title: 'Draft chapter three', brief: 'Write it.' };

test('the item command takes a finished step on a goal and refuses a branch, a pull request and an adopted branch there', async t => {
  const h = director(t);
  takeGoal(h);
  const { id } = await runWorkCommand(h.root, ['item', 'novel'], piped(step));

  await assert.rejects(runWorkCommand(h.root, ['item', 'novel'], piped({ id, state: 'branch', branch: 'hobkin/x' })), /A goal has no branches or pull requests/);
  await assert.rejects(runWorkCommand(h.root, ['item', 'novel'], piped({ id, state: 'pr', pr: 'https://example.com/1' })), /A goal has no branches or pull requests/);
  await assert.rejects(runWorkCommand(h.root, ['item', 'novel'], piped({ branch: 'hobkin/stray', title: 'Stray', brief: 'x', kind: 'chore' })), /A goal has no branches or pull requests/);
  await runWorkCommand(h.root, ['item', 'novel'], piped({ id, state: 'done', summary: 'Wrote chapter3.md.', proof: 'The file exists.' }));
  assert.equal(readItems(h.root, 'novel')[0].state, 'done');
});

test('the survey of unmerged branches skips a goal, even one inside a repository with unmerged work', async t => {
  const h = director(t);
  const outer = repository(h.base, 'outer');
  branched(outer, 'hobkin/stray');
  const folder = join(outer, 'novel');
  mkdirSync(folder);
  proposeProject(h.root, { name: 'novel', path: folder, level: 'important', kind: 'goal' });
  chooseProject(h.root, 'novel');

  const survey = await surveyUnmerged(h.root, { now: h.clock });

  assert.deepEqual(Object.keys(survey.projects), []);
  assert.deepEqual(readItems(h.root, 'novel'), []);
});

test('status carries a goal\'s kind and how many steps are done, and gives code no such count', t => {
  const h = director(t);
  takeGoal(h);
  proposeProject(h.root, { name: 'api', path: '/repos/api', level: 'casual' });
  chooseProject(h.root, 'api');
  const { id } = fileItem(h.root, 'novel', step);
  fileItem(h.root, 'novel', { ...step, key: 'second', title: 'Second' });
  updateItem(h.root, 'novel', id, { state: 'done', summary: 'Wrote it.', proof: 'The file.' });

  const { projects } = workStatus(h.root);

  const novel = projects.find(({ slug }) => slug === 'novel');
  assert.deepEqual([novel.kind, novel.done, novel.open], ['goal', 1, 1]);
  assert.equal('done' in projects.find(({ slug }) => slug === 'api'), false);
});

/** Writes what a study writes, and finishes the step a do run was given, the way the prompts ask. */
const works = h => request => {
  const { project, item: filed, focus } = h.work(request);
  if (focus === 'study' && !existsSync(paths(h.root, project.slug).project)) writeFileSync(paths(h.root, project.slug).project, '# Where it stands\n');
  if (filed) updateItem(h.root, project.slug, filed.id, { state: 'done', summary: 'Wrote chapter3.md.', proof: 'The file is there.' });
};

test('a goal is studied and worked in its own folder, with no worktree, branch or code look', async t => {
  const h = director(t);
  h.agent = works(h);
  const outer = repository(h.base, 'outer');
  const folder = join(outer, 'novel');
  mkdirSync(folder);
  writeMode(h.root, { enabled: true, machinesLook: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  proposeProject(h.root, { name: 'novel', path: folder, level: 'important', kind: 'goal' });
  chooseProject(h.root, 'novel');
  writeDirections(h.root, 'novel', 'Finish chapter three by Friday.');
  fileItem(h.root, 'novel', step);

  await h.ticks(4);

  const looks = h.calls.filter(call => call.purpose === 'work-look');
  assert.equal(h.work(looks[0]).focus, 'study');
  assert.deepEqual(looks.map(call => call.workPrompt), looks.map(() => 'work-goal-look'));
  const runs = h.calls.filter(call => call.purpose === 'work-do');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].workPrompt, 'work-goal-do');
  assert.deepEqual(h.calls.map(call => call.cwd), h.calls.map(() => folder));
  assert.match(h.work(runs[0]).directions, /chapter three/);
  assert.equal(h.work(runs[0]).item.branch, undefined);
  assert.deepEqual(readItems(h.root, 'novel').map(({ state, branch }) => [state, branch]), [['done', undefined]]);
  assert.equal(git(outer, 'branch', '--list').includes('hobkin/'), false);
  assert.equal(existsSync(paths(h.root, 'novel').trees), false);
});

test('after its study a goal gets one look of its own and none of the code looks', async t => {
  const h = director(t);
  h.agent = works(h);
  const folder = goalFolder(h);
  writeMode(h.root, { enabled: true, machinesLook: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  proposeProject(h.root, { name: 'novel', path: folder, level: 'important', kind: 'goal' });
  chooseProject(h.root, 'novel');

  await h.ticks(2);
  h.clock += 8 * 24 * 3600000;
  await h.ticks(4);

  const focuses = h.calls.map(call => h.work(call).focus);
  assert.deepEqual([...new Set(focuses)].sort(), ['goal', 'study']);
  assert.equal(focuses.filter(focus => focus === 'study').length, 1);
});

