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

test('a kept session asks for a durable hobkin, and says what to tell the user', async t => {
  const root = dataFolder(t);

  const kept = await startSession({ root, title: 'Plan the move', brief: 'Carry on from here.', keep: true, cwd: root, tier: 'high' });

  assert.deepEqual(requestsIn(root), [{ name: kept.name, title: 'Plan the move', cwd: root, wake: false, keep: true, tier: 'high' }]);
  assert.match(kept.note, /durable hobkin/);
  assert.equal('report' in kept, false, 'a durable hobkin writes no report');
  assert.equal(parseArguments(['session', '--keep']).keep, true);
  await assert.rejects(startSession({ root, brief: 'Go.', keep: true, wake: true, cwd: root }), /--wake/);
});

test('a kept brief ends with how to carry on and still files its work, and a job keeps its own ending', async t => {
  const root = dataFolder(t);
  const briefOf = name => readFileSync(join(root, 'runtime', 'handoffs', `${name}.md`), 'utf8');

  const job = await startSession({ root, title: 'Fix totals', brief: 'Fix the totals.', cwd: root });
  const kept = await startSession({ root, title: 'Plan the move', brief: 'Plan the move.', keep: true, cwd: root });

  assert.ok(briefOf(job.name).includes(job.report));
  const keptBrief = briefOf(kept.name);
  assert.ok(keptBrief.startsWith('Plan the move.'));
  assert.ok(keptBrief.includes(`hobkin work item <project> --home ${root}`), 'it files its branches and steps as work');
  assert.equal(keptBrief.includes('.report.md'), false, 'it writes no report');
  assert.notEqual(keptBrief.slice('Plan the move.'.length), briefOf(job.name).slice('Fix the totals.'.length));
});

test('kept sessions count against a burst like any other', async t => {
  const root = dataFolder(t);
  for (let count = 0; count < 3; count++) await startSession({ root, title: `kept ${count}`, brief: 'Go.', keep: true, cwd: root });

  await assert.rejects(startSession({ root, brief: 'Go.', keep: true, cwd: root }), /show the user the exact list/i);
  await startSession({ root, brief: 'Go.', keep: true, cwd: root, approved: true });
  assert.equal(requestsIn(root).length, 4);
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

  await assert.rejects(start({ title: 'one more' }), /show the user the exact list/i);
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
