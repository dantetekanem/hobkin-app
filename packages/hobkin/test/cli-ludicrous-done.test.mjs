import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readRun, runDirectory } from '../src/cli/ludicrous/run.mjs';
import { git } from './helpers/work-fixture.mjs';
import { ludicrousHome, PLAN, roleOf, taskOf, write } from './helpers/ludicrous.mjs';

const DONE_SPEC = '---\n{ "id": "area" }\n---\n# Area\n\n## Steps\n- [x] S1 (A1). First.\n- [x] S2 (A1). Second.\n';

/** A run whose every area says it is done, with a draft pull request open from an earlier stop. */
async function finished(t) {
  const h = ludicrousHome(t);
  const statuses = { foundation: { contracts: true, done: true }, api: { contracts: true, done: true } };
  await h.building(PLAN, { statuses, queues: { api: [{ id: 'api-1', paths: ['src/api/users.ts'] }] } });
  for (const area of ['foundation', 'api']) write(h.folder, `_specs/${area}/spec.md`, DONE_SPEC);
  write(h.folder, '_specs/ludicrous/trails/api/api-1.md', '# api-1 The users route\n\n## Did\nThe route.\n');
  git(h.folder, 'add', '.');
  git(h.folder, 'commit', '-qm', 'api-1: the users route\n\nPacket: api-1');
  const calls = [];
  const gh = async args => {
    calls.push(args);
    if (args[1] === 'list') return JSON.stringify([{ url: 'https://github.invalid/the-user/harbor/pull/12', isDraft: true }]);
    return '';
  };
  return { h, calls, conductor: h.conductor({ gh }) };
}

/** The final check agent's verdict, committed as it would commit it. */
function verdict(h, final) {
  write(h.folder, '_specs/ludicrous/final.json', JSON.stringify(final));
  git(h.folder, 'add', '.');
  git(h.folder, 'commit', '-qm', 'The final check');
}

test('done marks the pull request ready and folds the trails into the area notes', async t => {
  const { h, calls, conductor } = await finished(t);
  await h.ticks(conductor, 2);
  const [final] = h.pis.running();
  assert.equal(roleOf(final), 'final');
  assert.equal(final.args[final.args.indexOf('--model') + 1], 'fixture/high');
  verdict(h, { passed: true });
  final.finish();
  await h.ticks(conductor, 4);

  const compile = h.pis.running().find(agent => roleOf(agent) === 'compile');
  assert.match(taskOf(compile), /It is done: every area passed the final check\./);
  write(runDirectory(h.root, readRun(h.root).id), 'report.md', 'Ludicrous built all of harbor.\n');
  compile.finish();
  await h.ticks(conductor, 2);

  const run = readRun(h.root);
  assert.equal(run.phase, 'done');
  assert.deepEqual(run.pr, { url: 'https://github.invalid/the-user/harbor/pull/12', draft: false });
  assert.ok(calls.some(args => args[1] === 'ready' && args[2] === 'https://github.invalid/the-user/harbor/pull/12'));
  assert.ok(!calls.some(args => args.includes('merge')));
  // The last commit folds the trails into the area's notes and removes the trails.
  assert.match(readFileSync(join(h.folder, '_specs', 'api', 'notes.md'), 'utf8'), /## What the Ludicrous run left\n\n### api-1 The users route\n\n#### Did\nThe route\./);
  assert.equal(existsSync(join(h.folder, '_specs', 'ludicrous', 'trails')), false);
  assert.equal(git(h.folder, 'log', '-1', '--format=%s', 'ludicrous/harbor'), 'Ludicrous: the trails fold into each area\'s notes');
  assert.equal(git(h.folder, 'ls-tree', '-r', '--name-only', 'ludicrous/harbor', '--', '_specs/ludicrous/trails'), '');
});

test('a final check that fails goes back to the leader of the area that owns it', async t => {
  const { h, conductor } = await finished(t);
  await h.ticks(conductor, 2);
  const [final] = h.pis.running();
  verdict(h, { passed: false, failures: [{ area: 'api', what: 'GET /users answers 500', evidence: 'pnpm --filter api test: users.test.ts' }] });
  final.finish();
  await h.ticks(conductor, 3);

  const [leader] = h.pis.running();
  assert.equal(roleOf(leader), 'leader');
  assert.equal(leader.env.LUDICROUS_AREA, 'api');
  assert.match(taskOf(leader), /The final check failed in your area:\n- GET \/users answers 500 \(pnpm --filter api test: users\.test\.ts\)\nSet "done" back to false/);
  // It runs while the area still says done, and nothing else starts until it reopens the area or ends.
  await h.ticks(conductor, 5);
  assert.deepEqual(h.pis.running(), [leader]);
  assert.equal(readRun(h.root).phase, 'building');
});
