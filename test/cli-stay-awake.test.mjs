import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { stayAwake } from '../src/cli/stay-awake.mjs';

const fakeSpawn = () => {
  const started = [];
  const run = (command, args, options) => {
    started.push({ command, args, options });
    return Object.assign(new EventEmitter(), { unref() { started.at(-1).unrefed = true; } });
  };
  return { started, run };
};

test('on a Mac it keeps the system awake for as long as this process lives, and leaves the display alone', () => {
  const { started, run } = fakeSpawn();

  stayAwake({ platform: 'darwin', pid: 4242, run });

  const [{ command, args, unrefed }] = started;
  assert.equal(command, 'caffeinate');
  assert.deepEqual(args, ['-i', '-s', '-w', '4242']);
  assert.ok(!args.includes('-d'), 'the display can still dim and sleep');
  assert.equal(unrefed, true, 'it never keeps Hobkin from exiting');
});

test('anywhere else it starts nothing', () => {
  const { started, run } = fakeSpawn();

  stayAwake({ platform: 'linux', pid: 4242, run });

  assert.deepEqual(started, []);
});

test('a Mac without caffeinate carries on', () => {
  const child = new EventEmitter();
  child.unref = () => {};

  stayAwake({ platform: 'darwin', pid: 4242, run: () => child });

  assert.doesNotThrow(() => child.emit('error', Error('spawn caffeinate ENOENT')));
});
