import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main, parseArguments } from '../src/cli/main.mjs';
import { readBrief, startSession } from '../src/cli/session.mjs';

const dataFolder = t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-session-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

const requestsIn = root => {
  const folder = join(root, 'runtime', 'session-requests');
  return readdirSync(folder).map(file => JSON.parse(readFileSync(join(folder, file), 'utf8')));
};

test('the running hobkin starts the session as a job of its own, and the command returns at once', async t => {
  const root = dataFolder(t);

  const started = await startSession({ root, title: 'Review routines', brief: 'Review my routines.', wake: true, cwd: root });

  assert.match(started.name, /^hobkin-review-routines-[0-9a-f]{4}$/);
  assert.ok(started.name.length <= 32);
  assert.match(started.watch, /agents list/);
  assert.deepEqual(readdirSync(join(root, 'runtime', 'session-requests')), [`${started.name}.json`]);
  assert.deepEqual(requestsIn(root), [{ name: started.name, title: 'Review routines', cwd: root, wake: true }]);
  assert.ok(readFileSync(join(root, 'runtime', 'handoffs', `${started.name}.md`), 'utf8').includes(started.report), 'its brief says where the report goes');
});

test('a brief of any length reaches the agent as a private file', async t => {
  const root = dataFolder(t);
  const brief = 'Everything the conversation established. '.repeat(2000);

  const { name } = await startSession({ root, cwd: root, brief });

  const file = join(root, 'runtime', 'handoffs', `${name}.md`);
  assert.ok(readFileSync(file, 'utf8').startsWith(brief));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(requestsIn(root)).includes('Everything'), false, 'only the name travels in the request');
});

test('a conversation the user means to carry on in is told the job still ends with its work', async t => {
  const root = dataFolder(t);

  const kept = await startSession({ root, brief: 'Carry on from here.', keep: true, cwd: root });

  assert.match(kept.note, /nothing to keep open/);
  assert.equal(requestsIn(root).length, 1);
  assert.equal(parseArguments(['session', '--keep']).keep, true);
});

test('a long brief survives being cut mid-character', async () => {
  const text = Buffer.from('Reforma do módulo de relatórios. ✅');
  const cut = text.indexOf(Buffer.from('✅')) + 1;

  const brief = await readBrief(Readable.from([text.subarray(0, cut), text.subarray(cut)]));

  assert.equal(brief, 'Reforma do módulo de relatórios. ✅');
});

test('a burst of sessions stops at three until the user has said yes to the list', async t => {
  const root = dataFolder(t);
  const start = options => startSession({ root, brief: 'Go.', cwd: root, ...options });
  for (let count = 0; count < 3; count++) await start({ title: `one ${count}` });

  await assert.rejects(start({ title: 'one more' }), /Show the user the exact list/);
  assert.equal(requestsIn(root).length, 3);

  await start({ title: 'one more', approved: true });
  assert.equal(requestsIn(root).length, 4);
});

test('sessions from long ago do not count against a new one', async t => {
  const root = dataFolder(t);
  const start = now => startSession({ root, brief: 'Go.', cwd: root, now });
  const earlier = Date.now() - 3600000;
  for (let count = 0; count < 3; count++) await start(earlier);
  const folder = join(root, 'runtime', 'handoffs');
  for (const name of readdirSync(folder)) utimesSync(join(folder, name), new Date(earlier), new Date(earlier));

  await start(Date.now());
});

test('--approved reaches a session', () => {
  assert.equal(parseArguments(['session', '--approved']).approved, true);
  assert.throws(() => parseArguments(['status', '--approved']), /Unknown or incomplete option/);
});

test('a session carries the tier its work needs, and a tier hobkin does not have is refused', async t => {
  const root = dataFolder(t);
  assert.equal(parseArguments(['session', '--tier', 'high']).tier, 'high');
  assert.throws(() => parseArguments(['status', '--tier', 'high']), /Unknown or incomplete option/);

  const started = await startSession({ root, title: 'Fix totals', brief: 'Fix the totals.', cwd: root, tier: 'high' });
  assert.deepEqual(requestsIn(root), [{ name: started.name, title: 'Fix totals', cwd: root, wake: false, tier: 'high' }]);
  await assert.rejects(startSession({ root, brief: 'Go.', cwd: root, tier: 'huge' }), /tier must be one of fast, mid, high, max/);
  assert.equal(requestsIn(root).length, 1, 'nothing is asked for a tier that does not exist');
});

test('the command asks for a tier by name, with what each is for, so every job is given one on purpose', async t => {
  const root = dataFolder(t);
  const run = args => main(['session', '--home', root, '--title', 'Fix totals', '--cwd', root, ...args], { write() {} }, { input: Readable.from(['Fix the totals.']) });
  await assert.rejects(run([]), error => {
    assert.match(error.message, /^Name the tier this job needs with --tier:/);
    for (const tier of ['fast', 'mid', 'high', 'max']) assert.match(error.message, new RegExp(`\\b${tier}\\b`));
    return true;
  });
  assert.equal(await run(['--tier', 'mid']), 0);
  assert.equal(requestsIn(root)[0].tier, 'mid');
});

test('a session needs a brief, since nobody is there to give it one', async () => {
  await assert.rejects(startSession({ brief: '  \n' }), /brief/);
});
