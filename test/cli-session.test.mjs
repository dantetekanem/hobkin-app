import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startSession } from '../src/cli/session.mjs';
import { WorkPanes } from '../src/cli/work/panes.mjs';

const herdr = { HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w1' };

const fakeHerdr = (tabs = []) => {
  const calls = [];
  const exec = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'tab' && args[1] === 'list') return JSON.stringify({ result: { tabs } });
    if (args[0] === 'tab' && args[1] === 'create') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } });
    return JSON.stringify({ result: {} });
  };
  return { calls, panes: new WorkPanes({ workspace: 'w1', exec, tab: 'Hobkin' }) };
};

test('a session is a full Pi with every permission, in its own tab, and starts on the brief', async () => {
  const { calls, panes } = fakeHerdr();

  const { name, pane } = await startSession({ title: 'Rebuild the importer!', cwd: '/repos/api', brief: 'Rebuild it all.', env: herdr, panes });

  assert.equal(pane, 'w1:p9');
  assert.match(name, /^hobkin-rebuild-the-importer-[0-9a-f]{4}$/);
  assert.ok(name.length <= 32);
  const [create, start, prompt] = calls.filter(args => args[1] !== 'list');
  assert.deepEqual(create.slice(0, 2), ['tab', 'create']);
  assert.equal(create[create.indexOf('--label') + 1], 'Hobkin');
  assert.equal(create[create.indexOf('--cwd') + 1], '/repos/api');
  assert.ok(create.includes('--no-focus'), 'the user stays where they are');
  assert.deepEqual([start[0], start[1], start[2]], ['agent', 'start', name]);
  assert.equal(start[start.indexOf('--kind') + 1], 'pi');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--approve']);
  assert.deepEqual(prompt.slice(0, 4), ['agent', 'prompt', name, 'Rebuild it all.']);
});

test('outside Herdr there is no pane to open, so the agent is told to do the work itself', async () => {
  const { calls, panes } = fakeHerdr();

  await assert.rejects(startSession({ brief: 'Rebuild it all.', env: {}, panes }), /do this work here/);

  assert.deepEqual(calls, []);
});

test('a session needs a brief, since nobody is there to give it one', async () => {
  const { panes } = fakeHerdr();

  await assert.rejects(startSession({ brief: '  \n', env: herdr, panes }), /brief/);
});
