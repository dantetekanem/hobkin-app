import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chooseProject, isGoal, paths, proposeProject, readItems, readProject, setProjectIssues, setProjectPrMode, writeDirections } from '../src/cli/work/store.mjs';
import { prepareProjects, runReadiness, setYolo, setYoloProject, yoloView } from '../src/cli/work/yolo.mjs';
import { director } from './helpers/work-director.mjs';

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
