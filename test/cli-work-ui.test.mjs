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

test('the Work tab shows only while the mode is on, and the arrows reach it then', () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [chosen], attention: [] } });
  assert.doesNotMatch(screen(ui).split('\n')[0], /Work Mode/);
  for (const view of ['reports', 'schedules', 'conversation']) {
    ui.input('\x1b[C');
    assert.equal(ui.state().view, view);
  }

  ui.update({ ...base, work: { enabled: true, projects: [], attention: [] } });

  assert.match(screen(ui).split('\n')[0], /Work Mode/);
  for (const view of ['reports', 'schedules', 'work', 'conversation']) {
    ui.input('\x1b[C');
    assert.equal(ui.state().view, view);
  }
  assert.equal(ui.state().view, 'conversation', 'it appeared without moving the user');
  ui.stop();
});

test('Work reads active, then paused, and turning it off from anywhere lands in Chat', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], attention: [] } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /WORK MODE\s+● active/);

  ui.update({ ...base, work: { enabled: true, paused: true, projects: [], attention: [] } });
  assert.match(screen(ui), /WORK MODE\s+● paused/);

  ui.update({ ...base, work: { enabled: false, projects: [], attention: [] } });

  assert.deepEqual([ui.state().view, ui.state().focus], ['conversation', 'composer']);
  ui.stop();
});

test('going on or off says so, whoever did it, and says where to look', () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [], attention: [] } });

  ui.update({ ...base, work: { enabled: true, projects: [], attention: [] } });
  assert.match(ui.state().notice, /Work mode on.*Work Mode tab/);

  ui.update({ ...base, work: { enabled: false, projects: [], attention: [] } });
  assert.match(ui.state().notice, /Work mode off.*Work Mode tab/);
  ui.stop();
});

test('leaving an agent that outlived the mode goes to Chat, not to a tab that is gone', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], attention: [] }, runs: [running], jobActivity: {} });
  ui.input('\x1b[D');
  ui.input('\r');
  assert.equal(ui.state().view, 'job:work:site:do:1');

  ui.update({ ...base, work: { enabled: false, projects: [], attention: [] }, runs: [running], jobActivity: {} });
  ui.input('\x1b');

  assert.equal(ui.state().view, 'conversation');
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

test('proposals are offered main projects first', () => {
  const ranked = (slug, rank) => ({ ...proposed, slug, name: slug, rank });
  const projects = [ranked('third', 3), ranked('first', 1), ranked('second', 2)];
  const ui = createDashboard({ ...base, work: { enabled: true, projects, attention: [] } });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.ok(text.indexOf('first') < text.indexOf('second'));
  assert.ok(text.indexOf('second') < text.indexOf('third'));
  ui.stop();
});

test('the day\'s tokens show against the limit, and reaching it says what happens', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, harness: 'pi', tokensToday: 120000, dailyTokens: 1000000, projects: [], attention: [] } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /120k\/1m tokens/);

  ui.update({ ...base, work: { enabled: true, harness: 'pi', tokensToday: 1000000, dailyTokens: 1000000, projects: [], attention: [] } });

  assert.match(screen(ui), /Token limit reached for today\. Only urgent work runs until tomorrow\./);
  ui.stop();
});

test('a paused mode reads paused, and the request is answered with a key', async () => {
  const actions = [];
  const allowanceRequest = { proposed: 200000000, reason: 'Work mode paused: it has used 100m of today\'s 100m tokens.' };
  const ui = createDashboard({ ...base, work: { enabled: true, paused: true, allowanceRequest, projects: [], attention: [] } }, {
    workAction: async (...args) => { actions.push(args); },
  });
  ui.input('\x1b[D');

  const text = screen(ui);
  assert.match(text, /WORK MODE\s+● paused/);
  assert.match(text, /Raise today's tokens to 200m\?/);
  assert.match(text, /it has used 100m of today's 100m tokens/);
  assert.match(text, /y\s+raise/);

  ui.input('y');
  ui.input('n');
  await ui.pending();

  assert.deepEqual(actions, [['allow'], ['keep']]);
  ui.stop();
});

test('pacing says why new work is waiting', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, pacing: true, tokensToday: 5000000, dailyTokens: 100000000, projects: [], attention: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Spreading tokens across the day\. New work starts as the hour moves on\./);
  ui.stop();
});

test('the Work Mode tab shows the harness', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, harness: 'claude', projects: [], attention: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /WORK MODE\s+● active · claude/);
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
  assert.match(screen(ui), /enter\s+watch/);

  ui.input('\r');
  assert.equal(ui.state().view, 'job:work:site:do:1');

  ui.input('\x1b');
  assert.equal(ui.state().view, 'work');
  ui.stop();
});

test('/work off and /work on say what they mean, and only change what needs changing', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', projects: [], attention: [] } }, {
    send() {},
    workAction: async (...args) => {
      actions.push(args);
      return { enabled: false };
    },
  });

  ui.input('/work on');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(actions, []);

  ui.input('/work off');
  ui.input('\r');
  await ui.pending();
  assert.deepEqual(actions, [['toggle']]);
  assert.equal(ui.state().draft, '');
  ui.stop();
});

test('/work from Chat leaves what stopped and what stays in the conversation', async () => {
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', projects: [chosen], attention: [] }, runs: [running] }, {
    send() {},
    workAction: async () => ({ enabled: false }),
  });

  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  const text = screen(ui, 80, 30);
  assert.match(text, /finishes what it/);
  assert.match(text, /branches stay/);
  ui.stop();
});

const looking = { id: 'work:discover:discover:1', title: 'Finding projects', state: 'running', kind: 'background', scheduleId: 'work.discover', effort: 'medium', startedAt: new Date().toISOString(), work: { lane: 'discover' } };
const discovering = { enabled: true, discovering: true, folder: '/repos', projects: [], attention: [] };

test('while it looks, the tab says which folder it is in, what it is doing and what it has found', () => {
  const discovery = {
    status: 'running',
    folder: '/repos',
    startedAt: new Date().toISOString(),
    current: '/repos/hobkin',
    doing: 'Reading its git history',
    repositories: ['hobkin', 'farol'],
    rootFolders: ['hobkin', 'farol', 'site'],
    finishedFolders: ['farol'],
  };
  const ui = createDashboard({ ...base, work: { ...discovering, discovery }, runs: [looking], jobActivity: {} });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.match(text, /Now: Looking through \/repos \(1 of 3 folders done\)/);
  assert.match(text, /\/repos\/hobkin: Reading its git history/);
  assert.match(text, /hobkin, farol/);
  ui.stop();
});

test('an agent that never reports still shows what it just did, without its reports to Hobkin', () => {
  const block = (name, input) => ({ id: name, kind: 'tool', name, state: 'completed', input: JSON.stringify(input, null, 2) });
  const jobActivity = {
    [looking.id]: [
      block('bash', { command: 'git -C /repos/hobkin log --oneline' }),
      block('report', { command: 'printf x | node main.mjs work progress --home /tmp' }),
    ],
  };
  const ui = createDashboard({ ...base, work: discovering, runs: [looking], jobActivity });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.match(text, /git -C \/repos\/hobkin log --oneline/);
  assert.doesNotMatch(text, /work progress/);
  ui.stop();
});

test('a long list of repositories stays short on screen', () => {
  const repositories = Array.from({ length: 30 }, (_, index) => `repository-${index}`);
  const discovery = { status: 'running', folder: '/repos', repositories };
  const ui = createDashboard({ ...base, work: { ...discovering, discovery }, runs: [looking], jobActivity: {} });
  ui.input('\x1b[D');

  const text = screen(ui, 120);

  assert.match(text, /30 repositories/);
  assert.match(text, /repository-29/);
  assert.doesNotMatch(text, /repository-3\b/);
  ui.stop();
});

test('the tab always says what is happening now and when the next look is', () => {
  const nextDiscoveryAt = new Date(Date.now() + 2 * 3600000).toISOString();
  const time = new Date(nextDiscoveryAt);
  const clock = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const finished = { status: 'finished', folder: '/repos', offered: 0, reason: 'All 12 repositories are forks.' };
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt, discovery: finished, projects: [], attention: [] } });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.match(text, /Now: .*All 12 repositories are forks/);
  assert.match(text, new RegExp(`Next: A look at /repos at ${clock}`));
  ui.stop();
});

test('a look that failed or stopped early shows its reason, and when it tries again', () => {
  const nextDiscoveryAt = new Date(Date.now() + 15 * 60000).toISOString();
  for (const status of ['failed', 'unfinished']) {
    const discovery = { status, folder: '/repos', reason: 'Provider is down.' };
    const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt, discovery, projects: [], attention: [] } });
    ui.input('\x1b[D');

    const text = screen(ui);

    assert.match(text, /Provider is down/);
    assert.match(text, /in 15m/);
    ui.stop();
  }
});

test('the next look is whichever comes first, a project or the folder', () => {
  const soon = new Date(Date.now() + 3600000).toISOString();
  const later = new Date(Date.now() + 5 * 3600000).toISOString();
  const project = { ...chosen, nextLookAt: soon };
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt: later, projects: [project], attention: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Next: A look at website at/);
  ui.stop();
});

test('with a look due now the tab does not claim to be waiting for one', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt: null, projects: [], attention: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Next: It looks in \/repos now\./);
  ui.stop();
});

test('a proposal shows all it has to say, however narrow the screen', () => {
  const found = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [{ ...proposed, found, reason: 'Real users rely on it.' }], attention: [] } });
  ui.input('\x1b[D');

  const text = screen(ui, 60, 40);

  assert.match(text, /word29/);
  assert.match(text, /Real users rely on it/);
  ui.stop();
});

test('the proposals list shows the keys whichever row is selected', () => {
  const ui = createDashboard({ ...base, work: { ...on, projects: [proposed, chosen] } });
  ui.input('\x1b[D');
  ui.input('\x1b[A');

  const text = screen(ui);

  assert.match(text, /y\s+take\s+·\s+1\s+critical\s+·\s+2\s+important\s+·\s+3\s+casual\s+·\s+n\s+skip/);
  ui.stop();
});

test('answering a proposal moves on to the next one, so a list goes quickly', async () => {
  const actions = [];
  const ranked = (slug, rank) => ({ ...proposed, slug, name: slug, rank });
  const projects = [ranked('first', 1), ranked('second', 2), ranked('third', 3)];
  const ui = createDashboard({ ...base, work: { enabled: true, projects, attention: [] } }, {
    workAction: async (...args) => { actions.push(args); },
  });
  ui.input('\x1b[D');

  ui.input('y');
  ui.input('n');
  ui.input('2');
  await ui.pending();

  assert.deepEqual(actions, [['choose', 'first'], ['skip', 'second'], ['choose', 'third', 'important']]);
  ui.stop();
});

test('proposals count on the tab, so they are seen from any view', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [proposed], attention: [] } });

  assert.match(screen(ui, 120).split('\n')[0], /Work Mode 1/);
  ui.stop();
});

test('a project shows when it is next looked at, and why its last look failed', () => {
  const nextLookAt = new Date(Date.now() + 3 * 3600000).toISOString();
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [{ ...chosen, nextLookAt, lookError: 'The clone is gone.' }], attention: [] } });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.match(text, /next look in 3h/);
  assert.match(text, /The clone is gone/);
  ui.stop();
});

test('an agent running in a pane says where to watch it', () => {
  const inPane = { ...running, work: { ...running.work, pane: 'work-do-site' } };
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], attention: [] }, runs: [inPane], jobActivity: {} });
  ui.input('\x1b[D');
  ui.input('\r');

  assert.match(screen(ui), /work-do-site/);
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
