import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentName, insideHerdr, WorkPanes } from '../src/cli/work/panes.mjs';

function folder(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-panes-')));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

// Answers like the real herdr CLI, with shapes taken from a live session.
function fakeHerdr({ onPrompt = () => {}, statuses = () => 'working' } = {}) {
  const calls = [];
  const state = { tabs: [], panes: [], agents: new Map(), nextPane: 1 };
  const exec = async (command, args) => {
    assert.equal(command, 'herdr');
    calls.push(args);
    const [group, action, target] = args;
    const flag = name => args[args.indexOf(name) + 1];
    const addPane = tabId => {
      const pane = { pane_id: `w1:p${state.nextPane++}`, tab_id: tabId };
      state.panes.push(pane);
      return pane;
    };
    const respond = result => JSON.stringify({ id: `cli:${group}:${action}`, result });
    if (group === 'tab' && action === 'list') return respond({ tabs: state.tabs });
    if (group === 'tab' && action === 'create') {
      const tab = { tab_id: `w1:t${state.tabs.length + 2}`, label: flag('--label') };
      state.tabs.push(tab);
      return respond({ tab, root_pane: addPane(tab.tab_id) });
    }
    if (group === 'pane' && action === 'list') return respond({ panes: state.panes });
    if (group === 'pane' && action === 'split') {
      const source = state.panes.find(pane => pane.pane_id === target);
      return respond({ pane: addPane(source.tab_id) });
    }
    if (group === 'pane' && action === 'close') {
      state.panes = state.panes.filter(pane => pane.pane_id !== target);
      return respond({ type: 'ok' });
    }
    if (group === 'agent' && action === 'start') {
      state.agents.set(target, 0);
      return respond({ agent: { agent_status: 'idle' } });
    }
    if (group === 'agent' && action === 'prompt') {
      await onPrompt(args[3], state);
      return respond({ agent: { agent_status: 'working' } });
    }
    if (group === 'agent' && action === 'get') {
      if (!state.agents.has(target)) throw Object.assign(Error('agent_not_found'), { stderr: '{"error":{"code":"agent_not_found"}}' });
      const seen = state.agents.get(target);
      state.agents.set(target, seen + 1);
      return respond({ agent: { agent_status: statuses(seen, target) } });
    }
    if (group === 'agent' && action === 'send-keys') return respond({ type: 'ok' });
    throw Error(`Unexpected herdr call: ${args.join(' ')}`);
  };
  return { calls, state, exec };
}

const panesWith = herdr => new WorkPanes({ workspace: 'w1', exec: herdr.exec, pollMs: 1, idleGraceMs: 0 });
const run = (base, overrides = {}) => ({
  name: 'work-do-api',
  kind: 'pi',
  cwd: base,
  model: 'fixture/model',
  effort: 'high',
  sessionFile: join(base, 'job.jsonl'),
  brief: join(base, 'brief.md'),
  report: join(base, 'report.md'),
  ...overrides,
});
const called = (herdr, group, action) => herdr.calls.filter(args => args[0] === group && args[1] === action);

test('work mode only uses panes when Hobkin runs inside Herdr', () => {
  assert.equal(insideHerdr({ HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w1' }), true);
  assert.equal(insideHerdr({ HERDR_ENV: '1' }), false);
  assert.equal(insideHerdr({}), false);
});

test('agent names fit what Herdr allows and stay unique per project and lane', () => {
  assert.equal(agentName('do', 'finboard-api'), 'work-do-finboard-api');
  assert.match(agentName('look', '9-lives.app'), /^[a-z][a-z0-9_-]{0,31}$/);
  assert.equal(agentName('look', 'x'.repeat(60)).length, 32);
});

test('a run opens a Work Mode tab without taking focus, gives the agent its brief, and finishes on its report', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.\n') });

  const result = await panesWith(herdr).run(options);

  assert.deepEqual([result.status, result.text], ['completed', 'Useful: Done.']);
  const [create] = called(herdr, 'tab', 'create');
  assert.equal(create[create.indexOf('--label') + 1], 'Work Mode');
  assert.equal(create[create.indexOf('--cwd') + 1], base);
  assert.ok(create.includes('--no-focus'));
  const [start] = called(herdr, 'agent', 'start');
  assert.deepEqual(start.slice(2, 7), ['work-do-api', '--kind', 'pi', '--pane', 'w1:p1']);
  assert.match(called(herdr, 'agent', 'prompt')[0][3], /brief\.md/);
  assert.deepEqual(called(herdr, 'pane', 'close'), [['pane', 'close', 'w1:p1']]);
});

test('later runs split the same tab, and two starting together never make two tabs', async t => {
  const base = folder(t);
  const first = run(base, { name: 'work-do-one', report: join(base, 'one.md') });
  const second = run(base, { name: 'work-do-two', report: join(base, 'two.md') });
  const herdr = fakeHerdr({
    onPrompt: () => {
      writeFileSync(first.report, 'Useful: One.');
      writeFileSync(second.report, 'Useful: Two.');
    },
  });
  const panes = panesWith(herdr);

  await Promise.all([panes.run(first), panes.run(second)]);

  assert.equal(called(herdr, 'tab', 'create').length, 1);
  const [split] = called(herdr, 'pane', 'split');
  assert.ok(split.includes('--no-focus'));
  assert.equal(split[split.indexOf('--cwd') + 1], base);
});

test('Pi gets its binding, and other harnesses start on the user\'s own settings', async t => {
  const base = folder(t);
  const starts = {};
  for (const kind of ['pi', 'claude', 'codex']) {
    const options = run(base, { kind, report: join(base, `${kind}.md`) });
    const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });
    await panesWith(herdr).run(options);
    const [start] = called(herdr, 'agent', 'start');
    starts[kind] = start.slice(start.indexOf('--') + 1);
  }

  assert.deepEqual(starts.pi, ['--session', join(base, 'job.jsonl'), '--thinking', 'high', '--approve', '--model', 'fixture/model']);
  assert.deepEqual(starts.claude, []);
  assert.deepEqual(starts.codex, []);
});

test('a Pi pane loads the extensions it was given, and other harnesses are left alone', async t => {
  const base = folder(t);
  const starts = {};
  for (const kind of ['pi', 'claude']) {
    const options = run(base, { kind, report: join(base, `${kind}.md`) });
    const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });
    const panes = new WorkPanes({
      workspace: 'w1', exec: herdr.exec, pollMs: 1, idleGraceMs: 0, extensionsFor: async () => ['/chrome/index.ts'],
    });
    await panes.run(options);
    const [start] = called(herdr, 'agent', 'start');
    starts[kind] = start.slice(start.indexOf('--') + 1);
  }

  assert.deepEqual(starts.pi.slice(-3), ['--no-extensions', '--extension', '/chrome/index.ts']);
  assert.deepEqual(starts.claude, []);
});

test('an agent that stops without a report is asked once, then the run fails and its pane stays to read', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({ statuses: () => 'idle' });

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /without writing its report/);
  assert.equal(called(herdr, 'agent', 'prompt').length, 2);
  assert.deepEqual(called(herdr, 'pane', 'close'), []);
});

test('an agent that writes its report after being asked still finishes', async t => {
  const base = folder(t);
  const options = run(base);
  let prompts = 0;
  const herdr = fakeHerdr({
    statuses: () => 'idle',
    onPrompt: () => {
      prompts += 1;
      if (prompts === 2) writeFileSync(options.report, 'Useful: Late.');
    },
  });

  const result = await panesWith(herdr).run(options);

  assert.deepEqual([result.status, result.text], ['completed', 'Useful: Late.']);
});

test('a blocked agent keeps waiting rather than being treated as finished', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: seen => {
      if (seen === 3) writeFileSync(options.report, 'Useful: Unblocked.');
      return 'blocked';
    },
  });

  const result = await panesWith(herdr).run(options);

  assert.equal(result.status, 'completed');
  assert.equal(called(herdr, 'agent', 'prompt').length, 1);
});

test('an agent that exits without a report fails the run', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({
    onPrompt: (_text, state) => { state.agents.clear(); },
  });

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /exited/);
});

test('cancelling stops the agent and closes its pane', async t => {
  const base = folder(t);
  const controller = new AbortController();
  const herdr = fakeHerdr({ onPrompt: () => controller.abort() });

  const result = await panesWith(herdr).run(run(base, { signal: controller.signal }));

  assert.equal(result.status, 'interrupted');
  assert.deepEqual(called(herdr, 'pane', 'close'), [['pane', 'close', 'w1:p1']]);
});

test('Herdr failing to start the agent fails the run with the reason', async t => {
  const base = folder(t);
  const herdr = fakeHerdr();
  const exec = async (command, args) => {
    if (args[0] === 'agent' && args[1] === 'start') throw Error('agent_start_timeout');
    return herdr.exec(command, args);
  };

  const result = await new WorkPanes({ workspace: 'w1', exec, pollMs: 1, idleGraceMs: 0 }).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /agent_start_timeout/);
});
