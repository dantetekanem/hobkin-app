import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { workStatus } from '../src/cli/work/commands.mjs';
import { oneRead } from '../src/cli/work/one-read.mjs';
import { fileItem, readItems } from '../src/cli/work/store.mjs';
import { writeJson } from './helpers/work-fixture.mjs';

const SPEC = '_specs/tla/Door.tla';
const HASH = 'a'.repeat(64);

/**
 * A home with many projects, as a real one has: three chosen, the rest skipped or dropped, one with a model on its default branch, and runs
 * of that model. Every read of the survey and every listing of the runs is counted.
 */
function home(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'hobkin-status-reads-'));
  const projects = ['api', 'web', 'cli', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5'].map((slug, index) => (
    { slug, name: slug, path: join(root, 'repos', slug), level: 'important', state: index < 3 ? 'chosen' : 'skipped', at: '2026-11-01T00:00:00Z' }
  ));
  fs.mkdirSync(join(root, 'work'), { recursive: true });
  fs.writeFileSync(join(root, 'work', 'projects.jsonl'), projects.map(project => JSON.stringify(project)).join('\n') + '\n');
  const survey = join(root, 'work', 'unmerged.json');
  writeJson(survey, { at: '2026-11-20T10:00:00Z', projects: { api: { open: [], models: { head: 'b'.repeat(40), specs: [{ spec: SPEC, sha256: HASH, models: ['door.rb'] }] } } } });
  const run = (id, outcome, finished) => writeJson(join(root, 'proofs', id, 'result.json'), {
    id, project: 'api', spec: SPEC, specHash: HASH, outcome, finished, rules: [], actions: [{ name: 'Open', count: 2 }],
  });
  run('older', 'holds', '2026-11-20T09:00:00Z');
  // Finished work waiting on a branch, with the description its run wrote: each ready row reads it.
  fs.mkdirSync(join(root, 'work', 'api', 'prs'), { recursive: true });
  fs.writeFileSync(join(root, 'work', 'api', 'items.jsonl'), `${JSON.stringify({ id: 'abc123', key: 'fix:door', kind: 'fix', title: 'Fix the door', state: 'branch', branch: 'hobkin/abc123-fix-the-door', attempts: 0 })}\n`);
  const described = join(root, 'work', 'api', 'prs', 'abc123.md');
  fs.writeFileSync(described, '# Fix the door\n\nThe door closes again.\n');

  const counted = { survey: 0, runs: 0, ready: 0, items: 0 };
  const items = join(root, 'work', 'api', 'items.jsonl');
  const { readFileSync, readdirSync, lstatSync } = fs;
  // Each read of a project's items looks at its file first, to tell whether the copy it keeps is still true.
  t.mock.method(fs, 'lstatSync', (...args) => {
    if (String(args[0]) === items) counted.items += 1;
    return lstatSync(...args);
  });
  t.mock.method(fs, 'readFileSync', (...args) => {
    if (String(args[0]) === survey) counted.survey += 1;
    if (String(args[0]) === described) counted.ready += 1;
    return readFileSync(...args);
  });
  t.mock.method(fs, 'readdirSync', (...args) => {
    if (String(args[0]) === join(root, 'proofs')) counted.runs += 1;
    return readdirSync(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const reads = () => {
    const now = { ...counted };
    counted.survey = 0;
    counted.runs = 0;
    counted.ready = 0;
    counted.items = 0;
    return now;
  };
  return { root, run, reads };
}

const modelsOf = (status, slug) => status.projects.find(project => project.slug === slug).models?.map(({ spec, state, run }) => [spec, state, run]);

test('one Work status reads the survey, each project\'s items and the proof runs, and works out the finished work, once each', t => {
  const h = home(t);
  // The first read of a file in this process also checks it did not change while it was read.
  workStatus(h.root);
  h.reads();
  const status = workStatus(h.root);

  assert.deepEqual(h.reads(), { survey: 1, runs: 1, ready: 1, items: 1 });
  assert.deepEqual(status.ready.map(({ item, about }) => [item, about]), [['abc123', 'The door closes again.']]);
  assert.deepEqual(modelsOf(status, 'api'), [[SPEC, 'holds', 'older']]);
  assert.deepEqual(status.yolo.projects.find(project => project.slug === 'api').models, status.projects.find(project => project.slug === 'api').models);
  assert.equal(modelsOf(status, 'web'), undefined, 'a project with no model has none');
});

test('the next Work status reads again, so a run that ended since shows', t => {
  const h = home(t);
  workStatus(h.root);
  h.reads();
  h.run('newer', 'broken', '2026-11-20T11:00:00Z');

  assert.deepEqual(modelsOf(workStatus(h.root), 'api'), [[SPEC, 'broken', 'newer']]);
  assert.deepEqual(h.reads(), { survey: 1, runs: 1, ready: 1, items: 1 });
});

test('an item filed during one look at work mode shows in the rest of that look', t => {
  const h = home(t);
  const titles = oneRead(() => {
    const before = readItems(h.root, 'api').map(({ title }) => title);
    fileItem(h.root, 'api', { key: 'fix:hinge', kind: 'fix', title: 'Fix the hinge', brief: 'It squeaks.' });
    return [before, readItems(h.root, 'api').map(({ title }) => title)];
  });
  assert.deepEqual(titles, [['Fix the door'], ['Fix the door', 'Fix the hinge']]);
});
