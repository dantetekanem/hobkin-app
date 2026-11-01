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

const AREA = { x: 0, y: 0, width: 200, height: 60 };

// A tab's layout as Herdr keeps it: a tree of splits, where a closed pane's sibling takes its space.
const rectsOf = (node, rect) => {
  if (node.pane) return [{ pane_id: node.pane, rect }];
  const [first, second] = node.direction === 'right'
    ? [{ ...rect, width: Math.ceil(rect.width * node.ratio) }, { ...rect, x: rect.x + Math.ceil(rect.width * node.ratio), width: rect.width - Math.ceil(rect.width * node.ratio) }]
    : [{ ...rect, height: Math.ceil(rect.height * node.ratio) }, { ...rect, y: rect.y + Math.ceil(rect.height * node.ratio), height: rect.height - Math.ceil(rect.height * node.ratio) }];
  return [...rectsOf(node.first, first), ...rectsOf(node.second, second)];
};
const splitNode = (node, target, split) => {
  if (node.pane) return node.pane === target ? { ...split, first: node } : node;
  return { ...node, first: splitNode(node.first, target, split), second: splitNode(node.second, target, split) };
};
const closeNode = (node, target) => {
  if (node.pane) return node.pane === target ? null : node;
  const [first, second] = [closeNode(node.first, target), closeNode(node.second, target)];
  if (!first || !second) return first ?? second;
  return { ...node, first, second };
};

// Answers like the real herdr CLI, with shapes taken from a live session.
function fakeHerdr({ onPrompt = () => {}, statuses = () => 'working' } = {}) {
  const calls = [];
  const state = { tabs: [], panes: [], agents: new Map(), nextPane: 1, nextTab: 2, layouts: new Map(), lines: 'last line from the agent' };
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
    const notFound = code => Object.assign(Error(code), { stderr: `{"error":{"code":"${code}","message":"${code}"}}` });
    const tabOf = id => state.panes.find(pane => pane.pane_id === id)?.tab_id;
    if (group === 'tab' && action === 'list') {
      return respond({ tabs: state.tabs.map(tab => ({ ...tab, pane_count: state.panes.filter(pane => pane.tab_id === tab.tab_id).length })) });
    }
    if (group === 'tab' && action === 'create') {
      const tab = { tab_id: `w1:t${state.nextTab++}`, label: flag('--label') };
      state.tabs.push(tab);
      const pane = addPane(tab.tab_id);
      state.layouts.set(tab.tab_id, { pane: pane.pane_id });
      return respond({ tab, root_pane: pane });
    }
    if (group === 'pane' && action === 'list') return respond({ panes: state.panes });
    if (group === 'pane' && action === 'get') {
      if (!tabOf(target)) throw notFound('pane_not_found');
      return respond({ pane: state.panes.find(pane => pane.pane_id === target) });
    }
    if (group === 'pane' && action === 'read') {
      if (!tabOf(target)) throw notFound('pane_not_found');
      return `${state.lines}\n`;
    }
    if (group === 'pane' && action === 'layout') {
      const tabId = tabOf(flag('--pane'));
      return respond({ layout: { area: AREA, panes: rectsOf(state.layouts.get(tabId), AREA), tab_id: tabId } });
    }
    if (group === 'pane' && action === 'split') {
      const tabId = tabOf(target);
      const pane = addPane(tabId);
      const split = { direction: flag('--direction'), ratio: Number(flag('--ratio')), second: { pane: pane.pane_id } };
      state.layouts.set(tabId, splitNode(state.layouts.get(tabId), target, split));
      return respond({ pane });
    }
    if (group === 'pane' && action === 'close') {
      const tabId = tabOf(target);
      if (!tabId) throw notFound('pane_not_found');
      state.panes = state.panes.filter(pane => pane.pane_id !== target);
      const layout = closeNode(state.layouts.get(tabId), target);
      state.layouts.set(tabId, layout);
      // A tab goes when its last pane does.
      if (!layout) state.tabs = state.tabs.filter(tab => tab.tab_id !== tabId);
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

test('a Claude pane gets a session Hobkin can read, and a bound run its model and effort, and never a permission flag', async t => {
  const base = folder(t);
  const options = run(base, { kind: 'claude', model: 'claude-opus-5-5', effort: 'max', claudeSession: 'session-1', bound: true });
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });

  await panesWith(herdr).run(options);

  const [start] = called(herdr, 'agent', 'start');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--session-id', 'session-1', '--model', 'claude-opus-5-5', '--effort', 'max']);
});

test('a Claude pane the user chose keeps their own model and effort', async t => {
  const base = folder(t);
  const options = run(base, { kind: 'claude', claudeSession: 'session-1' });
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });

  await panesWith(herdr).run(options);

  const [start] = called(herdr, 'agent', 'start');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--session-id', 'session-1']);
});

test('what an agent is doing is passed along, so a pane waiting on an approval can be shown', async t => {
  const base = folder(t);
  const options = run(base);
  const seen = [];
  const herdr = fakeHerdr({
    statuses: count => {
      if (count === 2) writeFileSync(options.report, 'Useful: Done.');
      return 'blocked';
    },
  });

  await panesWith(herdr).run({ ...options, onStatus: status => seen.push(status) });

  assert.ok(seen.includes('blocked'));
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

test('an agent that never starts leaves no empty pane, and the failure reads as Herdr\'s reason', async t => {
  const base = folder(t);
  const herdr = fakeHerdr();
  const exec = async (command, args) => {
    if (args[1] === 'start') {
      throw Object.assign(Error('Command failed: herdr agent start with thousands of bytes of extensions'), {
        stderr: '{"error":{"code":"agent_not_ready","message":"Pi did not come up in time"},"id":"cli:agent:start"}',
      });
    }
    return herdr.exec(command, args);
  };
  const panes = new WorkPanes({ workspace: 'w1', exec, pollMs: 1, idleGraceMs: 0 });

  const result = await panes.run(run(base));

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Pi did not come up in time');
  assert.equal(called(herdr, 'pane', 'close').length, 1);
});

test('an agent that stops without a report is asked once, then the run fails, keeps its last lines and leaves no pane', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({ statuses: () => 'idle' });
  herdr.state.lines = 'The last thing the agent said.';

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /without writing its report/);
  assert.match(result.error, /The last thing the agent said\./);
  assert.equal(called(herdr, 'agent', 'prompt').length, 2);
  assert.deepEqual(herdr.state.panes, [], 'a failed run leaves nothing behind');
  assert.deepEqual(herdr.state.tabs, []);
});

test('a pane closed by hand ends the run, and is not a failure', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({
    statuses: (seen, name) => {
      if (seen === 2) {
        herdr.state.panes = [];
        herdr.state.agents.delete(name);
      }
      return 'working';
    },
  });

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'interrupted');
  assert.equal(result.paneClosed, true);
  assert.deepEqual(called(herdr, 'pane', 'close'), [], 'there is nothing left to close');
});

test('an agent that exits with its pane still open is a failed run, and the pane still closes', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({ onPrompt: (_text, state) => { state.agents.clear(); } });

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.equal(result.paneClosed, undefined);
  assert.deepEqual(herdr.state.panes, []);
});

const opened = async (herdr, panes, count) => {
  const made = [];
  for (let index = 0; index < count; index++) made.push(await panes.openPane('/tmp'));
  return made;
};
const shares = (herdr, tabId) => {
  const panes = rectsOf(herdr.state.layouts.get(tabId), AREA);
  return panes.map(({ rect }) => Math.round(100 * rect.width * rect.height / (AREA.width * AREA.height)));
};
const labels = herdr => herdr.state.tabs.map(tab => tab.label);

test('four panes make a true grid, each a quarter of the tab', async () => {
  const herdr = fakeHerdr();
  const panes = panesWith(herdr);

  await opened(herdr, panes, 4);

  assert.deepEqual(labels(herdr), ['Work Mode']);
  assert.deepEqual(shares(herdr, 'w1:t2'), [25, 25, 25, 25]);
  for (const split of called(herdr, 'pane', 'split')) assert.equal(split[split.indexOf('--ratio') + 1], '0.5');
});

test('a pane closed in the middle leaves a gap the next agent fills, so the grid stays even', async () => {
  for (const position of [0, 1, 2, 3]) {
    const herdr = fakeHerdr();
    const panes = panesWith(herdr);
    const made = await opened(herdr, panes, 4);

    await panes.closePane(made[position]);
    assert.equal(shares(herdr, 'w1:t2').length, 3);

    await panes.openPane('/tmp');
    assert.deepEqual(shares(herdr, 'w1:t2'), [25, 25, 25, 25], `after closing pane ${position}`);
  }
});

test('two panes closed from a grid still rebuild into one', async () => {
  for (const [first, second] of [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]) {
    const herdr = fakeHerdr();
    const panes = panesWith(herdr);
    const made = await opened(herdr, panes, 4);
    await panes.closePane(made[first]);
    await panes.closePane(made[second]);

    await opened(herdr, panes, 2);

    assert.deepEqual(shares(herdr, 'w1:t2'), [25, 25, 25, 25], `after closing ${first} and ${second}`);
  }
});

test('a full tab opens the next one, and the fifth agent gets a tab of its own', async () => {
  const herdr = fakeHerdr();
  const panes = panesWith(herdr);

  await opened(herdr, panes, 9);

  assert.deepEqual(labels(herdr), ['Work Mode', 'Work Mode 2', 'Work Mode 3']);
  assert.deepEqual(herdr.state.tabs.map(({ tab_id }) => herdr.state.panes.filter(pane => pane.tab_id === tab_id).length), [4, 4, 1]);
});

test('the lowest tab with room is always used first', async () => {
  const herdr = fakeHerdr();
  const panes = panesWith(herdr);
  const made = await opened(herdr, panes, 8);

  await panes.closePane(made[1]);
  await panes.openPane('/tmp');

  assert.deepEqual(labels(herdr), ['Work Mode', 'Work Mode 2']);
  assert.equal(herdr.state.panes.filter(pane => pane.tab_id === 'w1:t2').length, 4);
});

test('an empty tab closes, and the next agent brings back the lowest number instead of a third tab', async () => {
  const herdr = fakeHerdr();
  const panes = panesWith(herdr);
  const made = await opened(herdr, panes, 8);

  for (const pane of made.slice(0, 4)) await panes.closePane(pane);
  assert.deepEqual(labels(herdr), ['Work Mode 2']);

  await panes.openPane('/tmp');

  assert.deepEqual(labels(herdr).toSorted(), ['Work Mode', 'Work Mode 2']);
});

test('agents starting together never overfill a tab or make a tab too many', async () => {
  const herdr = fakeHerdr();
  const panes = panesWith(herdr);

  await Promise.all(Array.from({ length: 8 }, () => panes.openPane('/tmp')));

  assert.deepEqual(labels(herdr), ['Work Mode', 'Work Mode 2']);
  assert.deepEqual(herdr.state.tabs.map(({ tab_id }) => shares(herdr, tab_id)), [[25, 25, 25, 25], [25, 25, 25, 25]]);
});

test('a pane closing while another opens cannot pull the tab out from under it', async () => {
  const herdr = fakeHerdr();
  const panes = panesWith(herdr);
  const [only] = await opened(herdr, panes, 1);

  const [opening] = await Promise.all([panes.openPane('/tmp'), panes.closePane(only)]);

  assert.ok(herdr.state.panes.some(pane => pane.pane_id === opening));
  assert.deepEqual(labels(herdr), ['Work Mode']);
});

test('a tab the user named something else is left alone', async () => {
  const herdr = fakeHerdr();
  herdr.state.tabs.push({ tab_id: 'w1:t9', label: 'Work Mode notes' });

  await panesWith(herdr).openPane('/tmp');

  assert.deepEqual(labels(herdr), ['Work Mode notes', 'Work Mode']);
});

test('a hobkin session stays open for the user, however its agent ends', async t => {
  const base = folder(t);
  const herdr = fakeHerdr();

  const { pane } = await panesWith(herdr).startSession({ name: 'hobkin-big-job', cwd: base, brief: join(base, 'brief.md') });

  assert.ok(herdr.state.panes.some(entry => entry.pane_id === pane));
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
