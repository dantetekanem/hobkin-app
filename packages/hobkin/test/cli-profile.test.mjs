import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCheck } from '../src/cli/checks.mjs';
import { initialize } from '../src/cli/config.mjs';
import { readDirections } from '../src/cli/directions.mjs';
import { main } from '../src/cli/main.mjs';
import { aboutUser, callName, readProfile, setProfile, updateProfile } from '../src/cli/profile.mjs';
import { readLocalView } from '../src/cli/view.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-profile-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const run = async (root, ...args) => {
  let written = '';
  const output = { write: text => { written += text; } };
  const status = await main(['profile', ...args, '--home', root], output);
  return { status, written };
};

test('hobkin profile saves what it is told, keeps the rest, and prints it back', async t => {
  const root = dataRoot(t);

  await run(root, 'name', 'Ada', 'Lovelace');
  await run(root, 'call', 'Ada');
  const { status, written } = await run(root, 'email', 'ada@example.com');

  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(written), { name: 'Ada Lovelace', callMe: 'Ada', email: 'ada@example.com' });
  assert.deepEqual(JSON.parse((await run(root)).written), readProfile(root));
});

test('the profile is private to the user', async t => {
  const root = dataRoot(t);

  await run(root, 'email', 'ada@example.com');

  assert.equal(lstatSync(join(root, 'profile.json')).mode & 0o077, 0);
});

test('hobkin profile clear forgets one field, or all of them', async t => {
  const root = dataRoot(t);
  await run(root, 'name', 'Ada');
  await run(root, 'email', 'ada@example.com');

  await run(root, 'clear', 'email');
  assert.deepEqual(readProfile(root), { name: 'Ada' });

  await run(root, 'clear');
  assert.deepEqual(readProfile(root), {});
});

test('a bad value or a bad command changes nothing', async t => {
  const root = dataRoot(t);
  await run(root, 'email', 'ada@example.com');

  for (const args of [['email', 'not an email'], ['name', 'two\nlines'], ['name', 'x'.repeat(121)], ['name'], ['age', '36'], ['clear', 'age']]) {
    await assert.rejects(run(root, ...args), /hobkin profile|Use one line|real email/, args.join(' '));
  }

  assert.deepEqual(readProfile(root), { email: 'ada@example.com' });
});

test('a broken profile reads as empty, so it never stops a start or a check', t => {
  const root = dataRoot(t);
  assert.deepEqual(readProfile(root), {});

  writeFileSync(join(root, 'profile.json'), 'not json');
  assert.deepEqual(readProfile(root), {});

  writeFileSync(join(root, 'profile.json'), JSON.stringify({ name: 7, email: 'ada@example.com', other: 'x' }));
  assert.deepEqual(readProfile(root), { email: 'ada@example.com' });
});

test('hobkin profile keeps whose computer this is, personal or work and nothing else', async t => {
  const root = dataRoot(t);
  await run(root, 'name', 'Ada');

  const { written } = await run(root, 'computer', 'work');
  assert.deepEqual(JSON.parse(written), { name: 'Ada', computer: 'work' });

  await assert.rejects(run(root, 'computer', 'laptop'), /personal or work/);
  assert.deepEqual(readProfile(root), { name: 'Ada', computer: 'work' });

  await run(root, 'clear', 'computer');
  assert.deepEqual(readProfile(root), { name: 'Ada' });
});

test('several fields save in one write, or none of them when one is refused', t => {
  const root = dataRoot(t);
  setProfile(root, 'name', 'Ada');

  assert.deepEqual(updateProfile(root, { email: 'ada@example.com', computer: 'work' }), { name: 'Ada', email: 'ada@example.com', computer: 'work' });

  assert.throws(() => updateProfile(root, { name: 'Grace', email: 'not an email' }), /real email/);
  assert.throws(() => updateProfile(root, { name: 'Grace', age: '36' }), /hobkin profile/);
  assert.deepEqual(readProfile(root), { name: 'Ada', email: 'ada@example.com', computer: 'work' });
});

test('a computer the profile does not know reads as not said', t => {
  const root = dataRoot(t);

  writeFileSync(join(root, 'profile.json'), JSON.stringify({ name: 'Ada', computer: 'laptop' }));
  assert.deepEqual(readProfile(root), { name: 'Ada' });

  writeFileSync(join(root, 'profile.json'), JSON.stringify({ computer: 'personal' }));
  assert.deepEqual(readProfile(root), { computer: 'personal' });
});

test('the usage line names the computer', async t => {
  await assert.rejects(run(dataRoot(t), 'age', '36'), /computer personal\|work .*clear \[name \| call \| email \| computer\]/);
});

test('every agent learns whose computer this is', () => {
  assert.equal(aboutUser({ name: 'Ada', computer: 'work' }), "The user's name is Ada. This is their work computer.");
  assert.equal(aboutUser({ computer: 'personal' }), 'This is their personal computer.');
  assert.equal(aboutUser({ name: 'Ada' }), "The user's name is Ada.");
});

test('the name to call someone is what they asked for, then their name', () => {
  assert.equal(callName({ name: 'Ada Lovelace', callMe: 'Ada' }), 'Ada');
  assert.equal(callName({ name: 'Ada Lovelace' }), 'Ada Lovelace');
  assert.equal(callName({ email: 'ada@example.com' }), null);
});

test('every agent learns who the user is along with the directions', t => {
  const root = dataRoot(t);
  writeFileSync(join(root, 'AGENTS.md'), 'Always answer in Portuguese.\n');
  setProfile(root, 'name', 'Ada Lovelace');
  setProfile(root, 'call', 'Ada');
  setProfile(root, 'email', 'ada@example.com');

  const directions = readDirections(root);

  assert.match(directions, /Ada Lovelace/);
  assert.match(directions, /Call them Ada\./);
  assert.match(directions, /ada@example\.com/);
  assert.match(directions, /Always answer in Portuguese\./);
  assert.match(openCheck(root, 'recap').directions, /Call them Ada\./);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), 'Always answer in Portuguese.\n');
});

test('the dashboard gets the name to call them and not their email', t => {
  const root = dataRoot(t);
  initialize(root, { cwd: root });
  setProfile(root, 'name', 'Ada Lovelace');
  setProfile(root, 'email', 'ada@example.com');

  const view = readLocalView(root);

  assert.equal(view.userName, 'Ada Lovelace');
  assert.equal(JSON.stringify({ ...view, config: null }).includes('ada@example.com'), false);
});
