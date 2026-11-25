import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buildInvocation } from '../src/cli/harnesses.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { readRunGuide, requestRunGuide } from '../src/cli/work/run-guide.mjs';
import { chooseProject, fileItem, paths, proposeProject, readMode, readState, writeMode } from '../src/cli/work/store.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { commit, git, repository } from './helpers/work-fixture.mjs';

const piped = value => Readable.from([JSON.stringify(value)]);
const guide = (h, slug = 'api') => paths(h.root, slug).runGuide;
const GOAL_REFUSAL = /A goal has no app to run, so it has no run guide/;

/** A studied code project with nothing due by itself, so only what a test asks for runs. */
function quietProject(h, name = 'api') {
  writeMode(h.root, { machinesLook: false });
  return studied(h, name);
}

function takeGoal(h, name = 'novel') {
  const folder = join(h.base, name);
  mkdirSync(folder);
  proposeProject(h.root, { name, path: folder, level: 'important', kind: 'goal' });
  chooseProject(h.root, name);
  return folder;
}

const recordRun = (h, run, slug = 'api', ...words) => runWorkCommand(h.root, ['guide', slug, ...words], piped(run));

test('a code project with no guide reads as none: no text, no run, nothing waiting', t => {
  const h = director(t);
  quietProject(h);

  assert.deepEqual(readRunGuide(h.root, 'api'), {
    slug: 'api', text: null, writtenAt: null, commit: null, sources: [], lastRun: null, pending: null, refused: null,
  });
});

test('a guide reads with its text, when it was written, the commit, its sources and its last run', async t => {
  const h = director(t);
  const checkout = quietProject(h);
  writeFileSync(guide(h), '# What you need\nRuby 3.3.\n');

  await recordRun(h, { worked: false, reached: 'Set up once', note: 'db:create needs Postgres running.', sources: ['README.md', 'bin/setup'] });

  const read = readRunGuide(h.root, 'api');
  assert.equal(read.text, '# What you need\nRuby 3.3.\n');
  assert.equal(read.commit, git(checkout, 'rev-parse', 'main'));
  assert.deepEqual(read.sources, ['README.md', 'bin/setup']);
  assert.ok(Date.parse(read.writtenAt));
  assert.deepEqual({ ...read.lastRun, at: undefined }, {
    at: undefined, by: 'guide', item: null, worked: false, reached: 'Set up once', note: 'db:create needs Postgres running.',
  });
  assert.equal(read.refused, null);
});

test('a goal reads as hobkin\'s refusal with no text', t => {
  const h = director(t);
  takeGoal(h);

  const read = readRunGuide(h.root, 'novel');

  assert.match(read.refused, GOAL_REFUSAL);
  assert.deepEqual([read.text, read.lastRun, read.pending], [null, null, null]);
});

test('the press files one guide look at the front of the project\'s queue, and a second press files no second one', t => {
  const h = director(t);
  quietProject(h);
  writeMode(h.root, { queueNext: ['item:api:abc123'] });

  const first = requestRunGuide(h.root, 'api');
  const second = requestRunGuide(h.root, 'api');

  assert.deepEqual(readMode(h.root).queueNext, ['item:api:abc123', 'guide:api']);
  assert.match(first.message, /run guide for api/);
  assert.match(second.message, /already queued/);
  assert.deepEqual(Object.keys(first), ['message']);
  assert.equal(readRunGuide(h.root, 'api').pending, 'queued');
});

test('an unknown project, a project not taken and a goal are refused in hobkin\'s words, with nothing filed', t => {
  const h = director(t);
  proposeProject(h.root, { name: 'web', path: '/repos/web', level: 'casual' });
  takeGoal(h);
  const before = readMode(h.root).queueNext;

  assert.throws(() => requestRunGuide(h.root, 'ghost'), /Unknown project: ghost/);
  assert.throws(() => requestRunGuide(h.root, 'web'), /web is proposed, so nothing runs on it until it is taken/);
  assert.throws(() => requestRunGuide(h.root, 'novel'), GOAL_REFUSAL);
  assert.deepEqual(readMode(h.root).queueNext, before);
});

test('the guide command records a run as it is given, by the guide look, a study or a change\'s run', async t => {
  const h = director(t);
  quietProject(h);
  const { id } = fileItem(h.root, 'api', { key: 'fix:a', kind: 'fix', title: 'Fix it', brief: 'Fix it.' });

  await recordRun(h, { worked: true, reached: null, note: 'It answered at localhost:3000.' });
  assert.deepEqual([readRunGuide(h.root, 'api').lastRun.by, readRunGuide(h.root, 'api').lastRun.item], ['guide', null]);
  await recordRun(h, { worked: true, reached: null, note: 'Studied.' }, 'api', 'study');
  assert.equal(readRunGuide(h.root, 'api').lastRun.by, 'study');
  const told = await recordRun(h, { worked: false, reached: 'Database', note: 'The seed step is wrong.', item: id.slice(0, 4) });

  assert.equal(told.ok, true);
  const { lastRun } = readRunGuide(h.root, 'api');
  assert.deepEqual([lastRun.by, lastRun.item, lastRun.worked, lastRun.reached, lastRun.note], ['item', id, false, 'Database', 'The seed step is wrong.']);
});

test('the guide command refuses a wrong field in plain words and records nothing', async t => {
  const h = director(t);
  quietProject(h);
  takeGoal(h);

  await assert.rejects(recordRun(h, { worked: true, by: 'user' }), /Not a field of a run: by\. A run takes worked, reached, note, sources and item\./);
  await assert.rejects(recordRun(h, { worked: 'yes' }), /worked is true or false/);
  await assert.rejects(recordRun(h, { reached: 'Database' }), /worked is true or false/);
  await assert.rejects(recordRun(h, { worked: false, reached: 3 }), /reached is the last step that worked/);
  await assert.rejects(recordRun(h, { worked: true, sources: 'README.md' }), /sources is a list of the project's files/);
  await assert.rejects(recordRun(h, { worked: true, item: 'zzzzzz' }), /Unknown item: zzzzzz/);
  await assert.rejects(recordRun(h, { worked: true }, 'api', 'someone'), /Say guide <project>, or guide <project> study/);
  await assert.rejects(recordRun(h, { worked: true }, 'novel'), GOAL_REFUSAL);
  assert.equal(readRunGuide(h.root, 'api').lastRun, null);
  assert.equal(existsSync(paths(h.root, 'api').runGuideLog), false);
});

test('the guide is recorded as written only when its file changed since the last time', async t => {
  const h = director(t);
  const checkout = quietProject(h);
  const written = () => readRunGuide(h.root, 'api').writtenAt;
  const run = { worked: true, reached: null, note: 'It answered.', sources: ['README.md'] };

  await recordRun(h, run);
  assert.equal(written(), null, 'no file, nothing written');

  writeFileSync(guide(h), '# Run it\nbin/dev\n');
  await recordRun(h, run);
  const first = written();
  assert.ok(first);

  h.clock += 60000;
  commit(checkout, 'README.md', 'Run bin/dev.\n');
  await recordRun(h, { ...run, sources: ['README.md', 'Procfile.dev'] });
  assert.equal(written(), first, 'the same text is not written again');
  assert.deepEqual(readRunGuide(h.root, 'api').sources, ['README.md']);

  writeFileSync(guide(h), '# Run it\nbin/dev, then open localhost:3000.\n');
  await recordRun(h, { worked: true, reached: null, note: 'No sources given.' });
  assert.deepEqual(readRunGuide(h.root, 'api').sources, ['README.md'], 'a run with no sources writes nothing');

  await recordRun(h, { ...run, sources: ['README.md', 'Procfile.dev'] });
  const read = readRunGuide(h.root, 'api');
  assert.deepEqual(read.sources, ['README.md', 'Procfile.dev']);
  assert.equal(read.commit, git(checkout, 'rev-parse', 'main'));
});

test('a guide look is never due by itself, and the press starts one in a worktree of its own that leaves the lenses as they were', async t => {
  const h = director(t);
  const checkout = quietProject(h);
  const lensBefore = readState(h.root, 'api').lastLensAt;

  await h.ticks(3);
  assert.deepEqual(h.calls.map(call => h.work(call).focus), []);

  requestRunGuide(h.root, 'api');
  await h.ticks(2);

  const looks = h.calls.filter(call => call.purpose === 'work-look');
  assert.deepEqual(looks.map(call => h.work(call).focus), ['guide']);
  assert.equal(h.work(looks[0]).place, 'tree');
  assert.equal(looks[0].cwd, paths(h.root, 'api').lookTree);
  assert.notEqual(looks[0].cwd, checkout);
  assert.deepEqual(readMode(h.root).queueNext, []);
  assert.equal(readState(h.root, 'api').lastLensAt, lensBefore);
});

test('while the guide look runs the guide reads as being written, and the button\'s next press files nothing', async t => {
  const h = director(t);
  quietProject(h);
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  h.agent = () => gate.promise;
  // The owner's lock, as an open host holds it, so its view of what runs counts.
  mkdirSync(join(h.root, 'runtime.lock'));
  requestRunGuide(h.root, 'api');

  await h.startedRun();

  assert.equal(readRunGuide(h.root, 'api').pending, 'writing');
  assert.match(requestRunGuide(h.root, 'api').message, /writing the run guide for api now/);
  assert.deepEqual(readMode(h.root).queueNext, []);
  gate.resolve();
  await h.settled();
  assert.equal(readRunGuide(h.root, 'api').pending, null);
});

test('a code project\'s study and its guide look are given the guide\'s file and command, and a goal\'s study neither', async t => {
  const h = director(t);
  writeMode(h.root, { machinesLook: false });
  chooseProject(h.root, repository(h.base, 'api'), 'important', h.clock);
  takeGoal(h);
  h.agent = request => {
    const { project, focus } = h.work(request);
    if (focus === 'study') writeFileSync(paths(h.root, project.slug).project, '# What it is\n');
  };

  const run = (slug, focus) => h.calls.map(call => h.work(call)).find(work => work.project.slug === slug && work.focus === focus);
  for (let tick = 0; tick < 6 && !(run('api', 'study') && run('novel', 'study')); tick++) await h.tick();
  requestRunGuide(h.root, 'api');
  await h.tick();

  const [study, guideLook, goalStudy] = [run('api', 'study'), run('api', 'guide'), run('novel', 'study')];
  for (const work of [study, guideLook]) assert.equal(work.runGuideFile, paths(h.root, 'api').runGuide);
  assert.match(study.commands.guide, / work guide api study --home /);
  assert.match(guideLook.commands.guide, / work guide api --home /);
  assert.equal('runGuideFile' in goalStudy, false);
  assert.equal('guide' in goalStudy.commands, false);
});

test('a change\'s run is given the guide\'s file and command, and a goal\'s step is not', async t => {
  const h = director(t);
  quietProject(h);
  takeGoal(h);
  writeMode(h.root, { agents: 2 });
  mkdirSync(paths(h.root, 'novel').directory, { recursive: true });
  writeFileSync(paths(h.root, 'novel').project, '# Where it stands\n');
  fileItem(h.root, 'api', { key: 'fix:a', kind: 'fix', title: 'Fix it', brief: 'Fix it.' });
  fileItem(h.root, 'novel', { key: 'draft', kind: 'chore', title: 'Draft chapter three', brief: 'Write it.' });
  const doRuns = () => h.calls.filter(call => call.purpose === 'work-do');

  for (let tick = 0; tick < 6 && doRuns().length < 2; tick++) await h.tick();

  const runs = doRuns().map(call => h.work(call));
  const code = runs.find(work => work.project.slug === 'api');
  const goal = runs.find(work => work.project.slug === 'novel');
  assert.equal(code.runGuideFile, paths(h.root, 'api').runGuide);
  assert.match(code.commands.guide, / work guide api --home /);
  assert.equal('runGuideFile' in goal, false);
  assert.equal('guide' in goal.commands, false);
});

test('the look and do prompts name the guide\'s file and command the runs are given', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'hobkin-guide-prompt-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const promptOf = purpose => {
    const { args } = buildInvocation({ id: 'f094b0ba-036c-4abc-9198-745fd1226765', harness: 'pi', cwd, model: null, effort: 'medium', prompt: 'x', sessionFile: join(cwd, 'job.jsonl'), purpose });
    return args.flatMap((arg, index) => (arg === '--append-system-prompt' ? [args[index + 1]] : []))[1];
  };

  const look = promptOf('work-look');
  assert.match(look, /## When the focus is `guide`/);
  assert.match(look, /`work\.runGuideFile`/);
  assert.match(look, /`work\.commands\.guide`/);
  assert.match(promptOf('work-do'), /`work\.commands\.guide`/);
});
