import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { createDashboard } from '../src/cli/ui.mjs';

const base = {
  config: { main: {}, background: { harness: 'pi', model: null, effort: 'medium' } },
  counts: { daily: 1, weekly: 0, monthly: 0 },
  schedules: [],
  reports: [],
  messages: [],
  connection: 'connected',
  runs: [],
  usage: null,
};
const proposed = { slug: 'api', name: 'finboard-api', state: 'proposed', level: 'critical', summary: 'Rails app with real money.', found: 'CI red on main.', first: [{ title: 'Fix the job spec' }] };
const chosen = { slug: 'site', name: 'website', state: 'chosen', level: 'casual', open: 2, prs: 1 };
const running = { id: 'work:site:do:1', title: 'website: Update Astro', state: 'running', kind: 'background', scheduleId: 'work.site.do', effort: 'medium', startedAt: new Date().toISOString(), work: { slug: 'site', lane: 'do' } };
const attention = { slug: 'site', id: 'abc123', title: 'Rotate the leaked token' };
const on = { enabled: true, projects: [proposed, chosen], attention: [attention] };

const screen = (ui, width = 100, height = 40) => stripTerminalSequences(ui.render(width, height).join('\n'));

test('a dashboard with no work data has no Work tab', () => {
  const ui = createDashboard(base);

  assert.doesNotMatch(screen(ui), /Work/);
  for (const view of ['reports', 'schedules', 'conversation']) {
    ui.input('\x1b[C');
    assert.equal(ui.state().view, view);
  }
  ui.stop();
});

test('the Work tab is there with the mode off, and the arrows reach it', () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } });

  assert.match(screen(ui).split('\n')[0], /Work Mode/);
  for (const view of ['reports', 'schedules', 'work', 'conversation']) {
    ui.input('\x1b[C');
    assert.equal(ui.state().view, view);
  }
  ui.stop();
});

test('Work reads offline until the mode is on, then active', () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /WORK MODE\s+● offline/);

  ui.update({ ...base, work: { enabled: true, projects: [], attention: [] } });
  assert.match(screen(ui), /WORK MODE\s+● active/);
  ui.stop();
});

test('/work asks for a folder first, and the answer starts it without moving the user', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } }, {
    send() {},
    workAction: async (...args) => { actions.push(args); },
  });

  ui.input('/work');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(actions, []);
  assert.equal(ui.state().draft, '');
  assert.match(screen(ui), /Which folder should work mode start from/);

  ui.input('/Users/me/projects');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(actions, [['start', '/Users/me/projects']]);
  assert.deepEqual([ui.state().view, ui.state().focus, ui.state().draft], ['conversation', 'composer', '']);
  assert.doesNotMatch(screen(ui), /Which folder/);
  ui.stop();
});

test('/work can name the folder directly', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } }, {
    send() {},
    workAction: async (...args) => { actions.push(args); },
  });

  ui.input('/work ~/Poetry');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(actions, [['start', '~/Poetry']]);
  ui.stop();
});

test('a folder that fails keeps the question open and shows why', async () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } }, {
    send() {},
    workAction: async () => { throw Error('Not a folder: /nope'); },
  });
  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  ui.input('/nope');
  ui.input('\r');
  await ui.pending();

  assert.equal(ui.state().draft, '/nope');
  assert.match(screen(ui), /Not a folder/);
  assert.match(screen(ui), /Which folder/);
  ui.stop();
});

test('Escape drops the folder question', async () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } }, {
    send() {},
    workAction: async () => {},
  });
  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  ui.input('\x1b');

  assert.doesNotMatch(screen(ui), /Which folder/);
  ui.stop();
});

test('Enter in the Work Mode tab asks for a folder there, and stays in the tab', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } }, {
    workAction: async (...args) => { actions.push(args); },
  });
  ui.input('\x1b[D');

  ui.input('\r');
  assert.deepEqual([ui.state().view, ui.state().focus], ['work', 'composer']);
  assert.match(screen(ui), /Which folder/);

  ui.input('~/Poetry');
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'work', 'the arrows edit the answer');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(actions, [['start', '~/Poetry']]);
  assert.deepEqual([ui.state().view, ui.state().focus], ['work', 'work']);
  ui.stop();
});

test('/work turns the mode on and stays where the user is once a folder is known', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: false, folder: '/repos', projects: [], attention: [] } }, {
    send() {},
    workAction: async (...args) => {
      actions.push(args);
      return { enabled: true };
    },
  });

  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(actions, [['toggle']]);
  assert.deepEqual([ui.state().view, ui.state().focus, ui.state().draft], ['conversation', 'composer', '']);
  assert.match(screen(ui), /Work mode on/);
  ui.stop();
});

test('Enter in the Work Mode tab starts the mode when a folder is known', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: false, folder: '/repos', projects: [chosen], attention: [] } }, {
    workAction: async (...args) => { actions.push(args); },
  });
  ui.input('\x1b[D');
  assert.match(screen(ui), /enter\s+start/);

  ui.input('\r');
  await ui.pending();

  assert.deepEqual(actions, [['toggle']]);
  ui.stop();
});

test('/work turning it off stays in Chat and says so', async () => {
  const ui = createDashboard({ ...base, work: { ...on, folder: '/repos' } }, { send() {}, workAction: async () => ({ enabled: false }) });

  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  assert.equal(ui.state().view, 'conversation');
  assert.match(screen(ui), /Work mode off/);
  ui.stop();
});

test('a failed /work keeps the draft and shows why', async () => {
  const ui = createDashboard({ ...base, work: { enabled: false, folder: '/repos', projects: [], attention: [] } }, { send() {}, workAction: async () => { throw Error('still connecting'); } });

  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  assert.equal(ui.state().draft, '/work');
  assert.match(screen(ui), /still connecting/);
  ui.stop();
});

test('Work shows what needs the user, what is running, projects and proposals', () => {
  const ui = createDashboard({ ...base, work: { ...on, discovering: true }, runs: [running] });
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'work');

  const text = screen(ui);

  assert.match(text, /FINDING PROJECTS/);
  assert.match(text, /NEEDS ATTENTION/);
  assert.match(text, /Rotate the leaked token/);
  assert.match(text, /RUNNING/);
  assert.match(text, /website: Update Astro/);
  assert.match(text, /PROJECTS/);
  assert.match(text, /website\s+casual/);
  assert.match(text, /PROPOSED/);
  assert.match(text, /finboard-api\s+critical/);
  assert.match(text, /CI red on main/);
  assert.match(text, /First: Fix the job spec/);
  ui.stop();
});

test('work runs stay out of the tabs and stay in the running count', () => {
  const ui = createDashboard({ ...base, work: on, runs: [running] });

  const [header] = screen(ui, 120).split('\n');

  assert.match(header, /Work/);
  assert.doesNotMatch(header, /Update Astro/);
  assert.match(header, /1 running/);
  ui.stop();
});

test('a proposal is answered with a key', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [proposed], attention: [] } }, {
    workAction: async (...args) => { actions.push(args); },
  });
  ui.input('\x1b[D');

  ui.input('y');
  ui.input('2');
  ui.input('n');
  await ui.pending();

  assert.deepEqual(actions, [['choose', 'api'], ['choose', 'api', 'important'], ['skip', 'api']]);
  ui.stop();
});

test('the arrows move between rows, and each row has its own keys', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: on }, { workAction: async (...args) => { actions.push(args); } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /x\s+done/);

  ui.input('x');
  ui.input('\x1b[B');
  assert.match(screen(ui), /1 2 3\s+level/);
  ui.input('3');
  ui.input('\x1b[B');
  assert.match(screen(ui), /y\s+take/);
  await ui.pending();

  assert.deepEqual(actions, [['done', 'site', 'abc123'], ['level', 'site', 'casual']]);
  ui.stop();
});

test('Enter on a running row opens its live view, and Escape comes back to Work', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], attention: [] }, runs: [running], jobActivity: {} });
  ui.input('\x1b[D');

  ui.input('\r');
  assert.equal(ui.state().view, 'job:work:site:do:1');

  ui.input('\x1b');
  assert.equal(ui.state().view, 'work');
  ui.stop();
});

test('with the mode off, Work says how to start and keeps showing saved projects', () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [chosen], attention: [] } });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.match(text, /Work mode is off\. Press enter to start\./);
  assert.match(text, /website/);
  ui.stop();
});

test('the footer says work mode is on and how many are running', () => {
  const ui = createDashboard({ ...base, work: on, runs: [running], memoryBytes: 2048 });

  assert.match(screen(ui, 120), /next check.*work 1 running.*memory 2kb/);
  ui.stop();
});

test('Work fits every supported size', () => {
  const ui = createDashboard({ ...base, work: { ...on, discovering: true }, runs: [running] });
  ui.input('\x1b[D');

  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    const lines = ui.render(width, height);
    assert.ok(lines.length <= height);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
  ui.stop();
});
