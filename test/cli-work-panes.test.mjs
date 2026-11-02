import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { agentName, insideHerdr, WorkPanes } from '../src/cli/work/panes.mjs';
import { usageExtension } from '../src/cli/work/usage.mjs';

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
function fakeHerdr({ onPrompt = () => {}, statuses = () => 'working', focused = () => false, packages = 'npm:pi-coder' } = {}) {
  const calls = [];
  const state = { tabs: [], panes: [], agents: new Map(), listed: [], screens: {}, nextPane: 1, nextTab: 2, layouts: new Map(), lines: 'last line from the agent' };
  const exec = async (command, args) => {
    if (command === 'pi') return `User packages:\n  ${packages}\n`;
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
      if (state.screens[target]) return state.screens[target]();
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
      return respond({ agent: { agent_status: statuses(seen, target), focused: focused(seen) } });
    }
    if (group === 'agent' && action === 'list') return respond({ agents: state.listed });
    if (group === 'agent' && (action === 'send-keys' || action === 'focus')) return respond({ type: 'ok' });
    throw Error(`Unexpected herdr call: ${args.join(' ')}`);
  };
  return { calls, state, exec };
}

const panesWith = (herdr, options = {}) => new WorkPanes({ workspace: 'w1', exec: herdr.exec, pollMs: 1, idleGraceMs: 0, leftAloneMs: 0, helperQuietMs: 0, ...options });
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
const NUDGE = /write your report/;
// What Herdr puts on stderr, with the wording of a real failure.
const stalled = () => Object.assign(Error('Command failed: herdr agent prompt'), {
  stderr: '{"error":{"code":"agent_prompt_stalled","message":"agent prompt produced no observed working or blocked state within 5000 ms; current status is idle"},"id":"cli:agent:prompt"}',
});
const refused = () => Object.assign(Error('Command failed: herdr agent prompt'), {
  stderr: '{"error":{"code":"agent_blocked","message":"agent is waiting at a dialog"},"id":"cli:agent:prompt"}',
});

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

test('Pi gets its binding, and Claude and Codex start with nothing to approve', async t => {
  const base = folder(t);
  const starts = {};
  for (const kind of ['pi', 'claude', 'codex']) {
    const options = run(base, { kind, report: join(base, `${kind}.md`) });
    const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });
    await panesWith(herdr).run(options);
    const [start] = called(herdr, 'agent', 'start');
    starts[kind] = start.slice(start.indexOf('--') + 1);
  }

  assert.deepEqual(starts.pi, [
    '--session', join(base, 'job.jsonl'), '--thinking', 'high', '--approve',
    '--exclude-tools', 'ask_user,ask_user_batch',
    '--append-system-prompt', join(base, 'brief.md'),
    '--extension', usageExtension,
    '--model', 'fixture/model',
  ]);
  assert.deepEqual(starts.claude, ['--dangerously-skip-permissions']);
  assert.deepEqual(starts.codex, ['--dangerously-bypass-approvals-and-sandbox']);
});

test('a Pi run cannot ask anything, and its brief is in its system prompt as well as told to it', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });

  await panesWith(herdr).run(options);

  const [start] = called(herdr, 'agent', 'start');
  assert.equal(start[start.indexOf('--exclude-tools') + 1], 'ask_user,ask_user_batch');
  assert.equal(start[start.indexOf('--append-system-prompt') + 1], options.brief);
  assert.match(called(herdr, 'agent', 'prompt')[0][3], /brief\.md/);
});

test('a Claude pane gets a session Hobkin can read, and a bound run its model and effort', async t => {
  const base = folder(t);
  const options = run(base, { kind: 'claude', model: 'claude-opus-5-5', effort: 'max', claudeSession: 'session-1', bound: true });
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });

  await panesWith(herdr).run(options);

  const [start] = called(herdr, 'agent', 'start');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--dangerously-skip-permissions', '--session-id', 'session-1', '--model', 'claude-opus-5-5', '--effort', 'max']);
});

test('a Claude pane the user chose keeps their own model and effort', async t => {
  const base = folder(t);
  const options = run(base, { kind: 'claude', claudeSession: 'session-1' });
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });

  await panesWith(herdr).run(options);

  const [start] = called(herdr, 'agent', 'start');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--dangerously-skip-permissions', '--session-id', 'session-1']);
});

test('a Pi pane limits no extension: it turns none off, and names only what reads the subscription\'s numbers', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(options.report, 'Useful: Done.') });

  await panesWith(herdr).run(options);

  const [start] = called(herdr, 'agent', 'start');
  assert.equal(start.includes('--no-extensions'), false);
  assert.deepEqual(start.filter((_argument, index) => start[index - 1] === '--extension'), [usageExtension]);
});

test('an agent that never starts leaves no empty pane, and the failure reads as Herdr\'s reason', async t => {
  const base = folder(t);
  const herdr = fakeHerdr();
  const exec = async (command, args) => {
    if (args[1] === 'start') {
      throw Object.assign(Error('Command failed: herdr agent start with a long line of arguments'), {
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

test('an agent that stops without a report is asked three times, then the run fails, keeps its last lines and leaves no pane', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({ statuses: () => 'idle' });
  herdr.state.lines = 'The last thing the agent said.';

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /without writing its report/);
  assert.match(result.error, /The last thing the agent said\./);
  assert.equal(called(herdr, 'agent', 'prompt').length, 4, 'the brief and three nudges');
  assert.deepEqual(herdr.state.panes, [], 'a failed run leaves nothing behind');
  assert.deepEqual(herdr.state.tabs, []);
});

test('a diff opens pi-coder in a Pi of its own, brought forward and left open for the user', async t => {
  const base = folder(t);
  const herdr = fakeHerdr();

  const { name, pane } = await panesWith(herdr).startDiff({ name: 'diff-abc123', cwd: base, range: 'main...hobkin/abc123-fix' });

  assert.equal(name, 'diff-abc123');
  assert.ok(pane);
  const [start] = called(herdr, 'agent', 'start');
  assert.deepEqual(start.slice(start.indexOf('--') + 1), ['--approve'], 'every extension loads, and pi-coder is one of them');
  const [prompt] = called(herdr, 'agent', 'prompt');
  assert.equal(prompt[3], '/diff main...hobkin/abc123-fix');
  assert.ok(!prompt.includes('--wait'), 'a slash command opens a screen and the agent never goes to work');
  assert.deepEqual(called(herdr, 'agent', 'focus').map(args => args[2]), ['diff-abc123']);
  assert.deepEqual(called(herdr, 'pane', 'close'), []);
});

test('without pi-coder no pane opens, because Pi would hand the model a /diff it cannot run', async t => {
  const herdr = fakeHerdr({ packages: 'npm:pi-other' });
  const request = { name: 'diff-abc123', cwd: folder(t), range: 'main...hobkin/abc123-fix' };

  await assert.rejects(panesWith(herdr).startDiff(request), /pi install npm:pi-coder/);

  assert.deepEqual(called(herdr, 'tab', 'create'), []);
});

test('a diff that does not reach Pi leaves no pane behind', async t => {
  const herdr = fakeHerdr({ onPrompt: () => { throw Error('agent_blocked'); } });
  const request = { name: 'diff-abc123', cwd: folder(t), range: 'main...hobkin/abc123-fix' };

  await assert.rejects(panesWith(herdr).startDiff(request), /agent_blocked/);

  assert.equal(called(herdr, 'pane', 'close').length, 1);
});

test('a diff pane closes once the user has left it and its agent is at rest', async t => {
  const herdr = fakeHerdr({ statuses: () => 'idle', focused: looks => looks < 3 });
  const panes = panesWith(herdr);
  const { name, pane } = await panes.startDiff({ name: 'diff-abc123', cwd: folder(t), range: 'main...hobkin/abc123-fix' });

  await panes.followReview({ name, pane });

  assert.ok(called(herdr, 'agent', 'get').length > 3, 'the pane stays for as long as the user is in it');
  assert.deepEqual(called(herdr, 'pane', 'close').map(args => args[2]), [pane]);
});

test('a diff pane stays while its agent works on what the review handed it', async t => {
  const herdr = fakeHerdr({ statuses: looks => (looks < 3 ? 'working' : 'idle') });
  const panes = panesWith(herdr);
  const { name, pane } = await panes.startDiff({ name: 'diff-abc123', cwd: folder(t), range: 'main...hobkin/abc123-fix' });

  await panes.followReview({ name, pane });

  assert.ok(called(herdr, 'agent', 'get').length > 3);
  assert.equal(called(herdr, 'pane', 'close').length, 1);
});

test('a diff pane whose agent has gone closes straight away', async t => {
  const herdr = fakeHerdr();
  const panes = panesWith(herdr);
  const { pane } = await panes.startDiff({ name: 'diff-abc123', cwd: folder(t), range: 'main...hobkin/abc123-fix' });
  herdr.state.agents.delete('diff-abc123');

  await panes.followReview({ name: 'diff-abc123', pane });

  assert.equal(called(herdr, 'pane', 'close').length, 1);
});

const inWorkTab = (name, details = {}) => ({ name, pane_id: `pane-${name}`, tab_id: 'w1:t9', cwd: '/repos/api', agent_status: 'idle', ...details });
const closedPanes = herdr => called(herdr, 'pane', 'close').map(args => args[2]);

function herdrListing(agents, tabs = [{ tab_id: 'w1:t9', label: 'Work Mode' }]) {
  const herdr = fakeHerdr();
  herdr.state.tabs.push(...tabs);
  herdr.state.listed = agents;
  return herdr;
}

test('a tab with no run left loses every agent a tool opened in it, working or not', async () => {
  const herdr = herdrListing([inWorkTab('review-1', { agent_status: 'working' }), inWorkTab('review-2', { agent_status: 'done' })]);

  await panesWith(herdr).closeLeftovers();

  assert.deepEqual(closedPanes(herdr).toSorted(), ['pane-review-1', 'pane-review-2']);
});

test('a run keeps the review beside it, and what has stopped in another folder goes', async () => {
  const herdr = herdrListing([
    inWorkTab('work-do-api', { agent_status: 'working' }),
    inWorkTab('review-mine', { agent_status: 'done' }),
    inWorkTab('review-stopped', { cwd: '/repos/other', agent_status: 'done' }),
    inWorkTab('review-busy', { cwd: '/repos/other', agent_status: 'working' }),
  ]);

  await panesWith(herdr).closeLeftovers();

  assert.deepEqual(closedPanes(herdr), ['pane-review-stopped']);
});

test('nothing outside Hobkin\'s tabs goes, and neither does an agent the user started by hand', async () => {
  const herdr = herdrListing(
    [inWorkTab('review-elsewhere', { tab_id: 'w1:t2' }), inWorkTab(undefined, { pane_id: 'pane-by-hand' })],
    [{ tab_id: 'w1:t2', label: 'Main' }, { tab_id: 'w1:t9', label: 'Work Mode' }],
  );

  await panesWith(herdr).closeLeftovers();

  assert.deepEqual(closedPanes(herdr), []);
});

test('leftovers are only housekeeping: Herdr failing to list them is no failure', async () => {
  const panes = panesWith({ exec: async () => { throw Error('herdr is gone'); } });

  await panes.closeLeftovers();
});

test('a run that ends takes what it left with it, working or not, and another run keeps its own', async t => {
  const base = folder(t);
  const details = run(base);
  const herdr = fakeHerdr({ onPrompt: () => writeFileSync(details.report, 'Useful: done.') });
  herdr.state.tabs.push({ tab_id: 'w1:t9', label: 'Work Mode' });
  herdr.state.panes.push({ pane_id: 'pane-review-mine', tab_id: 'w1:t9' });
  herdr.state.layouts.set('w1:t9', { pane: 'pane-review-mine' });
  herdr.state.listed = [
    inWorkTab('review-mine', { agent_status: 'working', cwd: base }),
    inWorkTab('work-do-other', { agent_status: 'working', cwd: '/repos/other' }),
    inWorkTab('review-theirs', { agent_status: 'working', cwd: '/repos/other' }),
  ];

  const result = await panesWith(herdr).run(details);

  assert.equal(result.status, 'completed');
  assert.ok(closedPanes(herdr).includes('pane-review-mine'));
  assert.ok(!closedPanes(herdr).includes('pane-review-theirs'));
});

/** An idle run. It finishes when nudged, or by itself after `finishesAfter` looks, so a test can show that no nudge was needed. */
function waitingRun(t, { finishesAfter = Infinity } = {}) {
  const report = join(folder(t), 'report.md');
  const finish = () => writeFileSync(report, 'Useful: done.');
  const sent = [];
  const herdr = fakeHerdr({
    statuses: looks => {
      if (looks >= finishesAfter) finish();
      return 'idle';
    },
    onPrompt: text => {
      sent.push(text);
      finish();
    },
  });
  herdr.state.agents.set('work-do-api', 0);
  return { herdr, sent, wait: { name: 'work-do-api', report } };
}

test('a run waiting on a review that is working is left alone, with no turn spent on a nudge', async t => {
  const { herdr, sent, wait } = waitingRun(t, { finishesAfter: 5 });
  herdr.state.listed = [inWorkTab('work-do-api'), inWorkTab('review-1', { agent_status: 'working' })];

  await panesWith(herdr).waitForReport(wait);

  assert.deepEqual(sent, []);
});

test('a review Herdr calls done still counts as working while its screen moves, because its lanes may be running', async t => {
  const { herdr, sent, wait } = waitingRun(t, { finishesAfter: 5 });
  let seconds = 0;
  herdr.state.listed = [inWorkTab('work-do-api'), inWorkTab('review-1', { agent_status: 'done' })];
  herdr.state.screens = {
    'pane-review-1': () => {
      seconds += 1;
      return `read-review · ${seconds}s`;
    },
  };

  await panesWith(herdr, { helperQuietMs: 60000 }).waitForReport(wait);

  assert.deepEqual(sent, []);
});

test('once a review has stopped, the run hears which one and that nothing is running for it', async t => {
  const { herdr, sent, wait } = waitingRun(t);
  herdr.state.listed = [inWorkTab('work-do-api'), inWorkTab('review-1', { agent_status: 'done' })];

  await panesWith(herdr).waitForReport(wait);

  assert.equal(sent.length, 1);
  assert.match(sent[0], /review-1 stopped/);
  assert.match(sent[0], /Do not wait/);
  assert.match(sent[0], new RegExp(wait.report));
});

test('another project\'s review is nothing to wait for', async t => {
  const { herdr, sent, wait } = waitingRun(t);
  herdr.state.listed = [inWorkTab('work-do-api'), inWorkTab('review-1', { agent_status: 'working', cwd: '/repos/other' })];

  await panesWith(herdr).waitForReport(wait);

  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /review-1/);
});

test('after the first nudge an idle agent gets far longer, because it may be waiting on its own code review', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({ statuses: () => 'idle' });
  const finished = panesWith(herdr, { idleGraceMs: 20 }).run(options);

  await delay(120);
  writeFileSync(options.report, 'Useful: The review came back.');
  const result = await finished;

  assert.equal(result.status, 'completed');
  assert.equal(called(herdr, 'agent', 'prompt').length, 2, 'the brief and one nudge');
});

test('an agent that went back to work can be nudged again, however long the run goes on', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: seen => (seen % 2 ? 'working' : 'idle'),
    onPrompt: () => {
      if (called(herdr, 'agent', 'prompt').length === 6) writeFileSync(options.report, 'Useful: Hours later.');
    },
  });

  const result = await panesWith(herdr, { backAtWorkMs: 0 }).run(options);

  assert.deepEqual([result.status, result.text], ['completed', 'Useful: Hours later.']);
});

test('an agent that only answers its nudges has still stopped, or its run would never end', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({ statuses: seen => (seen % 2 ? 'working' : 'idle') });

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /without writing its report/);
  assert.equal(called(herdr, 'agent', 'prompt').length, 4);
});

test('a nudge that stalls counts as a nudge and does not end the run', async t => {
  const base = folder(t);
  const options = run(base);
  let nudges = 0;
  const herdr = fakeHerdr({
    statuses: () => 'idle',
    onPrompt: text => {
      if (!NUDGE.test(text)) return;
      nudges += 1;
      if (nudges === 1) throw stalled();
      writeFileSync(options.report, 'Useful: Second nudge.');
    },
  });

  const result = await panesWith(herdr).run(options);

  assert.deepEqual([result.status, nudges], ['completed', 2]);
});

test('a first prompt that stalls is sent again, and the run goes on', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: () => 'idle',
    onPrompt: () => {
      if (called(herdr, 'agent', 'prompt').length < 3) throw stalled();
      writeFileSync(options.report, 'Useful: Done.');
    },
  });

  const result = await panesWith(herdr).run(options);

  assert.deepEqual([result.status, result.text], ['completed', 'Useful: Done.']);
  assert.equal(called(herdr, 'agent', 'prompt').length, 3);
  for (const prompt of called(herdr, 'agent', 'prompt')) assert.match(prompt[3], /brief\.md/);
});

test('a first prompt that goes on stalling fails the run after three more tries, with Herdr\'s reason', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({
    statuses: () => 'idle',
    onPrompt: () => { throw stalled(); },
  });

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /no observed working or blocked state/);
  assert.equal(called(herdr, 'agent', 'prompt').length, 4);
  assert.deepEqual(herdr.state.panes, []);
});

test('a stalled prompt the agent has since picked up is not sent twice', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: seen => {
      if (seen === 2) writeFileSync(options.report, 'Useful: Done.');
      return 'working';
    },
    onPrompt: () => { throw stalled(); },
  });

  const result = await panesWith(herdr).run(options);

  assert.equal(result.status, 'completed');
  assert.equal(called(herdr, 'agent', 'prompt').length, 1, 'Herdr says a stall does not prove the prompt went nowhere');
});

test('cancelling while the first prompt waits for another try stops the run', async t => {
  const base = folder(t);
  const controller = new AbortController();
  const herdr = fakeHerdr({
    statuses: () => 'idle',
    onPrompt: () => {
      controller.abort();
      throw stalled();
    },
  });

  const result = await panesWith(herdr).run(run(base, { signal: controller.signal }));

  assert.equal(result.status, 'interrupted');
  assert.equal(called(herdr, 'agent', 'prompt').length, 1);
  assert.deepEqual(herdr.state.panes, []);
});

test('only a stall is worth another try at the first prompt', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({ onPrompt: () => { throw refused(); } });

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /waiting at a dialog/);
  assert.equal(called(herdr, 'agent', 'prompt').length, 1);
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

test('nobody answers in a pane, so a blocked agent has its question dismissed and is told to carry on', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: () => (called(herdr, 'agent', 'send-keys').length ? 'idle' : 'blocked'),
    onPrompt: text => {
      if (NUDGE.test(text)) writeFileSync(options.report, 'Useful: Carried on.');
    },
  });

  const result = await panesWith(herdr).run(options);

  assert.deepEqual([result.status, result.text], ['completed', 'Useful: Carried on.']);
  assert.deepEqual(called(herdr, 'agent', 'send-keys'), [['agent', 'send-keys', 'work-do-api', 'esc']]);
  const order = herdr.calls.filter(([group]) => group === 'agent').map(([, action]) => action);
  assert.equal(order[order.indexOf('send-keys') + 1], 'prompt', 'Herdr refuses a prompt to a blocked agent, so the question goes first');
});

test('a blocked agent gets the same grace as an idle one before anything is sent to it', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: seen => {
      if (seen === 3) writeFileSync(options.report, 'Useful: Answered itself.');
      return 'blocked';
    },
  });

  const result = await panesWith(herdr, { idleGraceMs: 60000 }).run(options);

  assert.equal(result.status, 'completed');
  assert.deepEqual(called(herdr, 'agent', 'send-keys'), []);
  assert.equal(called(herdr, 'agent', 'prompt').length, 1);
});

test('Herdr still seeing the question when the nudge goes in is not the end of the run', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: () => 'blocked',
    onPrompt: text => {
      if (!NUDGE.test(text)) return;
      if (called(herdr, 'agent', 'send-keys').length < 2) throw refused();
      writeFileSync(options.report, 'Useful: Second try.');
    },
  });

  const result = await panesWith(herdr).run(options);

  assert.deepEqual([result.status, result.text], ['completed', 'Useful: Second try.']);
  assert.equal(called(herdr, 'agent', 'send-keys').length, 2);
});

test('a blocked agent that will not move fails the run, so the item goes back, and leaves no pane', async t => {
  const base = folder(t);
  const herdr = fakeHerdr({
    statuses: () => 'blocked',
    onPrompt: text => {
      if (NUDGE.test(text)) throw refused();
    },
  });
  herdr.state.lines = 'Which database should I use?';

  const result = await panesWith(herdr).run(run(base));

  assert.equal(result.status, 'failed');
  assert.match(result.error, /without writing its report/);
  assert.match(result.error, /Which database should I use\?/);
  assert.equal(called(herdr, 'agent', 'send-keys').length, 3);
  assert.deepEqual(herdr.state.panes, []);
});

test('an agent Herdr cannot read counts as working, so it is left alone', async t => {
  const base = folder(t);
  const options = run(base);
  const herdr = fakeHerdr({
    statuses: seen => {
      if (seen === 3) writeFileSync(options.report, 'Useful: Done.');
      return 'unknown';
    },
  });

  const result = await panesWith(herdr).run(options);

  assert.equal(result.status, 'completed');
  assert.equal(called(herdr, 'agent', 'prompt').length, 1);
  assert.deepEqual(called(herdr, 'agent', 'send-keys'), []);
});

test('a followed session keeps its question for the user, who can answer in that pane', async t => {
  const base = folder(t);
  const report = join(base, 'report.md');
  const herdr = fakeHerdr({
    statuses: seen => {
      if (seen === 3) writeFileSync(report, 'Done.');
      return 'blocked';
    },
  });
  const panes = panesWith(herdr);
  const { name, pane } = await panes.startSession({ name: 'hobkin-big-job', cwd: base, brief: join(base, 'brief.md') });

  await panes.followSession({ name, pane, report });

  assert.deepEqual(called(herdr, 'agent', 'send-keys'), []);
  assert.equal(called(herdr, 'agent', 'prompt').length, 1);
  assert.deepEqual(herdr.state.panes, [], 'the pane still closes on the report');
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

// Herdr's own refusals come as JSON on stderr, and anything else as a plain failure of the command.
const hiccups = {
  'Herdr refusing the call': () => Object.assign(Error('Command failed: herdr agent get'), { stderr: '{"error":{"code":"socket_busy","message":"server busy"},"id":"cli:agent:get"}' }),
  'a command that failed with no reason': () => Object.assign(Error('Command failed: herdr agent get'), { stderr: '' }),
  'a command that never ran': () => Error('spawn herdr EAGAIN'),
};
const failingGets = (herdr, count, failure) => {
  let left = count;
  return async (command, args) => {
    if (args[0] === 'agent' && args[1] === 'get' && left > 0) {
      left -= 1;
      throw failure();
    }
    return herdr.exec(command, args);
  };
};

for (const [name, failure] of Object.entries(hiccups)) {
  test(`${name} says nothing about the agent, so a healthy run carries on`, async t => {
    const base = folder(t);
    const options = run(base);
    const herdr = fakeHerdr({
      statuses: seen => {
        if (seen === 2) writeFileSync(options.report, 'Useful: Done.');
        return 'working';
      },
    });

    const result = await panesWith(herdr, { exec: failingGets(herdr, 3, failure) }).run(options);

    assert.deepEqual([result.status, result.text], ['completed', 'Useful: Done.']);
    assert.equal(called(herdr, 'agent', 'prompt').length, 1, 'nothing was nudged');
  });
}

test('a failed call does not close a session\'s pane while its agent is still there', async t => {
  const base = folder(t);
  const report = join(base, 'report.md');
  const herdr = fakeHerdr({
    statuses: seen => {
      if (seen === 2) writeFileSync(report, 'Done.');
      return 'working';
    },
  });
  const panes = panesWith(herdr, { exec: failingGets(herdr, 3, hiccups['Herdr refusing the call']) });
  const { name, pane } = await panes.startSession({ name: 'hobkin-big-job', cwd: base, brief: join(base, 'brief.md') });

  const following = panes.followSession({ name, pane, report });
  await delay(5);
  assert.deepEqual(called(herdr, 'pane', 'close'), [], 'it waits for the report');
  await following;

  assert.ok(existsSync(report), 'the pane closed on the report and nothing else');
  assert.deepEqual(called(herdr, 'pane', 'close'), [['pane', 'close', pane]]);
});

test('a brief that stalls is sent again after a failed look at the agent, instead of failing the run', async t => {
  const base = folder(t);
  const options = run(base);
  let stalls = 1;
  const herdr = fakeHerdr({
    onPrompt: () => {
      if (stalls-- > 0) throw stalled();
      writeFileSync(options.report, 'Useful: Done.');
    },
    statuses: () => 'idle',
  });
  const exec = failingGets(herdr, 1, hiccups['Herdr refusing the call']);

  const result = await panesWith(herdr, { exec }).run(options);

  assert.equal(result.status, 'completed');
});

test('an agent gone by name still ends the run, whatever else Herdr has said along the way', async t => {
  const base = folder(t);
  let gets = 0;
  const herdr = fakeHerdr({
    onPrompt: (_text, state) => { state.agents.clear(); },
  });
  const exec = async (command, args) => {
    if (args[0] === 'agent' && args[1] === 'get' && gets++ === 0) throw hiccups['Herdr refusing the call']();
    return herdr.exec(command, args);
  };

  const result = await panesWith(herdr, { exec }).run(run(base));

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
