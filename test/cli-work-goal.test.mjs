import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../src/cli/main.mjs';
import { newProject } from '../src/cli/work/controls.mjs';
import { runWorkCommand, workStatus } from '../src/cli/work/commands.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { chooseProject, isGoal, paths, fileItem, proposeProject, readItems, readProjects, updateItem, readProject, setProjectIssues, setProjectPrMode, writeDirections, writeMode } from '../src/cli/work/store.mjs';
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

const words = 'Keep the household papers in order and file what arrives.';

test('newProject takes a goal in a plain folder, with its words as the directions', async t => {
  const h = director(t);
  const folder = goalFolder(h, 'papers');

  const result = await newProject(h.root, { path: folder, kind: 'goal', wants: words, level: 'casual' });

  assert.deepEqual([result.ok, result.slug, result.name, result.kind], [true, 'papers', 'papers', 'goal']);
  assert.match(result.message, /goal/);
  const project = readProject(h.root, 'papers');
  assert.deepEqual([project.kind, project.state, project.path, project.level], ['goal', 'chosen', folder, 'casual']);
  assert.equal(readFileSync(paths(h.root, 'papers').directions, 'utf8'), `${words}\n`);
});

test('newProject takes code from a repository, keeps its words, and never reads a goal\'s parent as the project', async t => {
  const h = director(t);
  const checkout = repository(h.base, 'api');
  const inside = join(checkout, 'notes');
  mkdirSync(inside);

  const code = await newProject(h.root, { path: checkout, wants: 'Leave auth alone.' });
  const goal = await newProject(h.root, { path: inside, kind: 'goal', wants: words });

  assert.deepEqual([code.kind, goal.kind], ['code', 'goal']);
  assert.equal(readProject(h.root, 'api').kind, undefined);
  assert.equal(readProject(h.root, 'notes').path, inside);
  assert.match(readFileSync(paths(h.root, 'api').directions, 'utf8'), /Leave auth alone/);
});

test('newProject refuses in plain words and changes nothing', async t => {
  const h = director(t);
  const folder = goalFolder(h, 'papers');
  const file = join(h.base, 'a-file');
  writeFileSync(file, 'x');
  const other = join(h.base, 'elsewhere');
  mkdirSync(other);
  mkdirSync(join(other, 'papers'));
  await newProject(h.root, { path: folder, kind: 'goal', wants: words });

  const refuse = (details, message) => assert.rejects(newProject(h.root, details), message);
  await refuse({ path: join(h.base, 'missing'), kind: 'goal', wants: words }, /Not a folder/);
  await refuse({ path: file, kind: 'goal', wants: words }, /Not a folder/);
  await refuse({ path: goalFolder(h, 'bare'), kind: 'goal', wants: '  ' }, /A goal needs your words/);
  await refuse({ path: folder, kind: 'goal', wants: words }, /papers is already a project/);
  await refuse({ path: join(other, 'papers'), kind: 'goal', wants: words }, /papers is already a project/);
  await refuse({ path: folder, kind: 'mansion', wants: words }, /code or a goal/);
  await refuse({ kind: 'goal', wants: words }, /Say which folder/);
  await refuse({ path: goalFolder(h, 'later'), kind: 'goal', wants: words, level: 'huge' }, /level must be one of/);
  assert.deepEqual(readProjects(h.root).map(({ slug }) => slug), ['papers']);
});

const started = folder => git(folder, 'log', '--format=%an|%s', '-1');
const files = folder => git(folder, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');

test('every project has a repository of its own: a plain folder gets one whose first commit holds its files, with no remote', async t => {
  const h = director(t);
  const goal = goalFolder(h, 'papers');
  writeFileSync(join(goal, 'lease.txt'), 'rent\n');
  const code = goalFolder(h, 'tool');
  writeFileSync(join(code, 'main.rb'), 'puts 1\n');

  const first = await newProject(h.root, { path: goal, kind: 'goal', wants: words });
  const second = await newProject(h.root, { path: code, wants: 'Keep it small.' });

  assert.equal(first.gitStarted, true);
  assert.match(first.message, /hobkin started a git repository there/);
  assert.equal(second.gitStarted, true);
  for (const folder of [goal, code]) {
    assert.equal(git(folder, 'rev-parse', '--show-toplevel'), folder);
    assert.equal(git(folder, 'status', '--porcelain'), '');
    assert.equal(git(folder, 'remote'), '');
    assert.equal(git(folder, 'rev-list', '--count', 'HEAD'), '1');
  }
  assert.deepEqual(files(goal), ['lease.txt']);
  assert.equal(started(goal), 'Hobkin|Start tracking papers with hobkin');
  assert.equal(readProject(h.root, 'tool').kind, undefined);
});

test('an empty folder gets a repository with an empty first commit', async t => {
  const h = director(t);
  const folder = goalFolder(h, 'empty');

  const result = await newProject(h.root, { path: folder, kind: 'goal', wants: words });

  assert.equal(result.gitStarted, true);
  assert.equal(git(folder, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(folder, 'ls-tree', '-r', 'HEAD'), '');
});

test('a folder that already holds a repository is left exactly as it is', async t => {
  const h = director(t);
  const checkout = repository(h.base, 'api');
  writeFileSync(join(checkout, 'draft.txt'), 'not yet\n');
  const head = git(checkout, 'rev-parse', 'HEAD');

  const result = await newProject(h.root, { path: checkout, wants: 'Leave auth alone.' });

  assert.equal('gitStarted' in result, false);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), head);
  assert.equal(git(checkout, 'status', '--porcelain'), '?? draft.txt');
});

test('a goal\'s folder inside another repository gets a repository of its own', async t => {
  const h = director(t);
  const outer = repository(h.base, 'outer');
  const outerHead = git(outer, 'rev-parse', 'HEAD');
  const inside = join(outer, 'notes');
  mkdirSync(inside);
  writeFileSync(join(inside, 'a.txt'), 'a\n');

  await newProject(h.root, { path: inside, kind: 'goal', wants: words });

  assert.equal(git(inside, 'rev-parse', '--show-toplevel'), inside);
  assert.deepEqual(files(inside), ['a.txt']);
  assert.equal(git(outer, 'rev-parse', 'HEAD'), outerHead);
});

test('when git fails the add is refused with its reason, no project is written and no repository is left', async t => {
  const h = director(t);
  const folder = goalFolder(h, 'papers');
  writeFileSync(join(folder, 'locked.txt'), 'a\n');
  chmodSync(join(folder, 'locked.txt'), 0o000);

  await assert.rejects(newProject(h.root, { path: folder, kind: 'goal', wants: words }), /could not start a git repository/);

  assert.equal(existsSync(join(folder, '.git')), false);
  assert.deepEqual(readProjects(h.root).map(({ slug }) => slug), []);
});

/** A goal in a plain folder added the way the user adds it, with one tracked file and one the user has changed since. */
async function addedGoal(h) {
  const folder = goalFolder(h, 'novel');
  writeFileSync(join(folder, 'notes.md'), 'one\n');
  writeFileSync(join(folder, 'mine.md'), 'mine\n');
  await newProject(h.root, { path: folder, kind: 'goal', wants: 'Finish chapter three.' });
  writeMode(h.root, { enabled: true, machinesLook: true, lastDiscoveryAt: new Date(h.clock).toISOString() });
  writeFileSync(join(folder, 'mine.md'), 'mine, edited by the user\n');
  return folder;
}

const doneWith = h => request => {
  const { project, item: filed } = h.work(request);
  if (!filed) return;
  writeFileSync(join(request.cwd, 'notes.md'), 'one\ntwo\n');
  writeFileSync(join(request.cwd, 'chapter3.md'), 'It rained.\n');
  updateItem(h.root, project.slug, filed.id, { state: 'done', summary: 'Wrote chapter3.md.', proof: 'The file is there.' });
};

test('a step\'s run ends with one commit of exactly what it changed, recorded on the item, and the user\'s own edit stays uncommitted', async t => {
  const h = director(t);
  const folder = await addedGoal(h);
  h.agent = doneWith(h);
  const { id } = fileItem(h.root, 'novel', step);

  await h.ticks(4);

  const [item] = readItems(h.root, 'novel');
  assert.equal(item.state, 'done');
  assert.equal(git(folder, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(item.commit, git(folder, 'rev-parse', 'HEAD'));
  assert.equal(git(folder, 'log', '-1', '--format=%an|%s', 'HEAD'), 'Hobkin|Draft chapter three');
  assert.match(git(folder, 'log', '-1', '--format=%b', 'HEAD'), new RegExp(id));
  assert.deepEqual(git(folder, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['chapter3.md', 'notes.md']);
  assert.equal(git(folder, 'status', '--porcelain'), 'M mine.md');
});

test('a run that changes nothing makes no commit', async t => {
  const h = director(t);
  const folder = await addedGoal(h);
  h.agent = (request) => {
    const { project, item: filed } = h.work(request);
    if (filed) updateItem(h.root, project.slug, filed.id, { state: 'done', summary: 'Looked.', proof: 'Nothing to change.' });
  };
  fileItem(h.root, 'novel', step);

  await h.ticks(4);

  const [item] = readItems(h.root, 'novel');
  assert.equal(item.state, 'done');
  assert.equal(item.commit, undefined);
  assert.equal(git(folder, 'rev-list', '--count', 'HEAD'), '1');
});

test('a run that ends without an outcome still has its changes committed', async t => {
  const h = director(t);
  const folder = await addedGoal(h);
  h.agent = request => {
    const { project, item: filed } = h.work(request);
    if (filed) writeFileSync(join(request.cwd, 'chapter3.md'), 'Half.\n');
  };
  fileItem(h.root, 'novel', step);

  await h.ticks(4);

  assert.equal(git(folder, 'log', '-1', '--format=%s'), 'Draft chapter three');
  assert.deepEqual(files(folder).sort(), ['chapter3.md', 'mine.md', 'notes.md']);
});

test('the command line takes a goal with its words on stdin, and a proposal can never carry a kind', async t => {
  const h = director(t);
  const folder = goalFolder(h, 'papers');
  const run = async (input, ...args) => {
    let text = '';
    const code = await main(['work', ...args, '--home', h.root], { write: chunk => { text += chunk; } }, { input: Readable.from(input) });
    return { code, json: JSON.parse(text) };
  };

  const added = await run([words], 'add', 'project', folder, 'casual', '--goal');
  const bare = await run([], 'add', 'project', goalFolder(h, 'bare'), '--goal');
  const plainFolder = goalFolder(h, 'plain');
  const plain = await run([], 'add', 'project', plainFolder);
  const proposed = await run([JSON.stringify({ name: 'sneaky', path: '/repos/sneaky', level: 'casual', kind: 'goal' })], 'propose');

  assert.deepEqual([added.code, added.json.kind, added.json.slug], [0, 'goal', 'papers']);
  assert.equal(readFileSync(paths(h.root, 'papers').directions, 'utf8'), `${words}\n`);
  assert.match(bare.json.message, /A goal needs your words/);
  assert.equal(plain.json.slug, 'plain');
  assert.equal(git(plainFolder, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(proposed.code, 0);
  assert.equal(readProject(h.root, 'sneaky').kind, undefined);
});
