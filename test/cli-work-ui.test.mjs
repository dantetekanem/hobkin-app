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
const leak = { key: 'item:site:abc123', slug: 'site', project: 'website', item: 'abc123', title: 'Rotate the leaked token', grade: 'P0', why: 'high impact, medium' };
const on = { enabled: true, projects: [proposed, chosen], plan: [leak], queued: 1 };

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
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [chosen] } });
  assert.doesNotMatch(screen(ui).split('\n')[0], /Work Mode/);
  for (const view of ['reports', 'schedules', 'conversation']) {
    ui.input('\x1b[C');
    assert.equal(ui.state().view, view);
  }

  ui.update({ ...base, work: { enabled: true, projects: [] } });

  assert.match(screen(ui).split('\n')[0], /Work Mode/);
  for (const view of ['reports', 'schedules', 'work', 'conversation']) {
    ui.input('\x1b[C');
    assert.equal(ui.state().view, view);
  }
  assert.equal(ui.state().view, 'conversation', 'it appeared without moving the user');
  ui.stop();
});

test('Work reads active, then paused, and turning it off from anywhere lands in Chat', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [] } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /WORK MODE\s+● active/);

  ui.update({ ...base, work: { enabled: true, paused: true, projects: [] } });
  assert.match(screen(ui), /WORK MODE\s+● paused/);

  ui.update({ ...base, work: { enabled: false, projects: [] } });

  assert.deepEqual([ui.state().view, ui.state().focus], ['conversation', 'composer']);
  ui.stop();
});

test('going on or off says so, whoever did it, and says where to look', () => {
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [] } });

  ui.update({ ...base, work: { enabled: true, projects: [] } });
  assert.match(ui.state().notice, /Work mode on.*Work Mode tab/);

  ui.update({ ...base, work: { enabled: false, projects: [] } });
  assert.match(ui.state().notice, /Work mode off.*Work Mode tab/);
  ui.stop();
});

test('leaving an agent that outlived the mode goes to Chat, not to a tab that is gone', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [] }, runs: [running], jobActivity: {} });
  ui.input('\x1b[D');
  ui.input('\r');
  assert.equal(ui.state().view, 'job:work:site:do:1');

  ui.update({ ...base, work: { enabled: false, projects: [] }, runs: [running], jobActivity: {} });
  ui.input('\x1b');

  assert.equal(ui.state().view, 'conversation');
  ui.stop();
});

test('/work asks for a folder first, and the answer starts it without moving the user', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [] } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [] } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [] } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: false, projects: [] } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: false, folder: '/repos', projects: [] } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: false, folder: '/repos', projects: [] } }, { send() {}, workAction: async () => { throw Error('still connecting'); } });

  ui.input('/work');
  ui.input('\r');
  await ui.pending();

  assert.equal(ui.state().draft, '/work');
  assert.match(screen(ui), /still connecting/);
  ui.stop();
});

test('Work shows what is running, the queue with P0 on top, projects and proposals', () => {
  const ui = createDashboard({ ...base, work: { ...on, discovering: true }, runs: [running] });
  ui.input('\x1b[D');
  assert.equal(ui.state().view, 'work');

  const text = screen(ui);

  assert.match(text, /FINDING PROJECTS/);
  assert.match(text, /QUEUE\s+1 P0 · 1 queued/);
  assert.match(text, /P0 {2}website: Rotate the leaked token/);
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
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [proposed] } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: true, projects } });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.ok(text.indexOf('first') < text.indexOf('second'));
  assert.ok(text.indexOf('second') < text.indexOf('third'));
  ui.stop();
});

test('the day\'s tokens show against the limit, and reaching it says what happens', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, harness: 'pi', tokensToday: 120000, dailyTokens: 1000000, projects: [] } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /120k\/1m tokens/);

  const pause = { kind: 'day', line: 'Paused for today: 1m of the 1m daily limit used. Resumes tomorrow.' };
  ui.update({ ...base, work: { enabled: true, paused: true, pause, harness: 'pi', tokensToday: 1000000, dailyTokens: 1000000, projects: [] } });

  assert.match(screen(ui), /Paused for today: 1m of the 1m daily limit used\. Resumes tomorrow\./);
  ui.stop();
});

test('a paused mode reads paused, and the request is answered with a key', async () => {
  const actions = [];
  const allowanceRequest = { proposed: 200000000, reason: 'Work mode paused: it has used 100m of today\'s 100m tokens.' };
  const ui = createDashboard({ ...base, work: { enabled: true, paused: true, allowanceRequest, projects: [] } }, {
    workAction: async (...args) => { actions.push(args); },
  });
  ui.input('\x1b[D');

  const text = screen(ui);
  assert.match(text, /WORK MODE\s+● paused/);
  assert.match(text, /QUEUE\s+1 P0 · 0 queued/);
  assert.match(text, /P0 {2}Raise today's tokens to 200m\?/);
  assert.match(text, /it has used 100m of today's 100m tokens/);
  assert.match(text, /y\s+raise/);

  ui.input('y');
  ui.input('n');
  await ui.pending();

  assert.deepEqual(actions, [['allow'], ['keep']]);
  ui.stop();
});

test('an hourly pause shows the limit it hit, with its numbers beside the day\'s', () => {
  const line = 'Paused for the hour: 8.4m of the 8.3m hourly share used. Today 9.8m of 100m. Resumes around 13:05 today.';
  const ui = createDashboard({ ...base, work: { enabled: true, paused: true, pacing: true, pause: { kind: 'hour', line }, tokensToday: 9800000, dailyTokens: 100000000, projects: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui, 130), /Paused for the hour: 8\.4m of the 8\.3m hourly share used\. Today 9\.8m of 100m\. Resumes around 13:05 today\./);
  ui.stop();
});

const queueEntry = (key, details = {}) => ({ key, slug: 'api', item: key.split(':')[2] ?? null, project: 'finboard-api', title: 'Fix the job spec', level: 'critical', grade: 'P1', why: 'critical, high impact, small', estimate: { fresh: 220000 }, waiting: null, ...details });
const queueWork = { enabled: true, harness: 'pi', agents: 2, autoPick: true, queued: 2, projects: [] };

test('the tab shows fresh and cached tokens apart, what is left, and running and queued counts', () => {
  const ui = createDashboard({
    ...base,
    runs: [running],
    work: { ...queueWork, dailyTokens: 500000000, tokensToday: 6000000, tokensCached: 49000000, hourShare: 41700000, tokensThisHour: 1200000, plan: [queueEntry('item:api:1')] },
  });
  ui.input('\x1b[D');

  const text = screen(ui, 90);

  assert.match(text, /1\/2 agents · 2 queued · 6m\/500m tokens · 49m cached/);
  assert.match(text, /Today: 6m used, 494m left\. This hour: 1\.2m of 41\.7m\./);
  ui.stop();
});

test('the subscription shows when it is known, and says so plainly when it is not', () => {
  const windows = [{ label: '5h', usedPercent: 42 }, { label: 'week', usedPercent: 18 }];
  const ui = createDashboard({ ...base, work: { ...queueWork, subscription: { known: true, windows } } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /Subscription: 5h 42% used, week 18% used\./);

  ui.update({ ...base, work: { ...queueWork, subscription: { known: false, windows: [] } } });
  assert.match(screen(ui), /Subscription: not known yet, so one agent runs at a time\./);

  ui.update({ ...base, work: { ...queueWork, harness: 'codex', subscription: { known: false, windows: [] } } });
  assert.match(screen(ui), /codex panes cannot be measured: each counts as its estimate, one at a time\./);
  ui.stop();
});

test('the last watch shows in a few words', () => {
  const at = new Date().toISOString();
  const ui = createDashboard({ ...base, work: { ...queueWork, watch: { at, proposed: 2, changed: 1, removed: 0, added: 3 } } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Last watch: \d\d:\d\d today, 2 new, 1 changed\./);
  ui.stop();
});

test('the queue shows what is next in order, its grade, why and what it waits for, readably at 90 columns', () => {
  const plan = [
    queueEntry('item:api:1'),
    queueEntry('item:site:2', { project: 'website', title: 'Update Astro', grade: 'P2', waiting: 'over this hour\'s share' }),
    queueEntry('look:tool', { project: 'tool', title: 'security look', grade: 'P3', waiting: 'a free worker' }),
  ];
  const ui = createDashboard({ ...base, work: { ...queueWork, queued: 12, plan } });
  ui.input('\x1b[D');

  const lines = ui.render(90, 40).map(value => stripTerminalSequences(value));
  const text = lines.join('\n');

  assert.match(text, /QUEUE\s+12 queued/);
  assert.match(text, /P1 {2}finboard-api: Fix the job spec\s+critical, high impact, small · ~220k/);
  assert.match(text, /P2 {2}website: Update Astro\s+waiting: over this hour's share · ~220k/);
  assert.match(text, /P3 {2}tool: security look\s+waiting: a free worker/);
  assert.match(text, /and 9 more/);
  assert.ok(ui.render(90, 40).every(value => visibleWidth(value) <= 90));
  ui.stop();
});

test('every P0 row stays in sight past the row cap, and the rest fill what is left', () => {
  const urgent = Array.from({ length: 10 }, (_, index) => queueEntry(`item:api:p${index}`, { grade: 'P0', title: `Urgent ${index}` }));
  const later = queueEntry('item:api:later', { grade: 'P2', title: 'Later work' });
  const ui = createDashboard({ ...base, work: { ...queueWork, queued: 11, plan: [...urgent, later] } });
  ui.input('\x1b[D');

  const text = screen(ui, 90, 60);

  assert.match(text, /QUEUE\s+10 P0 · 11 queued/);
  assert.match(text, /Urgent 9/);
  assert.doesNotMatch(text, /Later work/);
  assert.match(text, /and 1 more/);
  ui.stop();
});

test('a queue row with an item takes a grade and can be marked done, and a look row takes neither', async () => {
  const actions = [];
  const plan = [queueEntry('item:api:one', { grade: 'P3' }), queueEntry('look:api', { title: 'security look', grade: 'P2' })];
  const ui = createDashboard({ ...base, work: { ...queueWork, plan } }, { workAction: async (...args) => { actions.push(args); } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /enter\s+run now\s+·\s+p\s+grade\s+·\s+x\s+done\s+·\s+s\s+skip/);

  ui.input('p');
  ui.input('x');
  ui.input('\x1b[B');
  assert.match(screen(ui), /enter\s+run now\s+·\s+s\s+skip/);
  ui.input('p');
  ui.input('x');
  await ui.pending();

  assert.deepEqual(actions, [['grade', 'api', 'one', 'P0'], ['done', 'api', 'one']]);
  ui.stop();
});

test('projects sort by priority and show it with their PR setting, and keys change both', async () => {
  const actions = [];
  const projects = [
    { ...chosen, slug: 'low', name: 'low-one', priority: 'P2', prMode: 'off' },
    { ...chosen, slug: 'top', name: 'top-one', priority: 'P0', prMode: 'draft', branches: 3, left: 1 },
  ];
  const ui = createDashboard({ ...base, work: { enabled: true, projects } }, { workAction: async (...args) => { actions.push(args); } });
  ui.input('\x1b[D');

  const text = screen(ui, 110);
  assert.ok(text.indexOf('top-one') < text.indexOf('low-one'));
  assert.match(text, /top-one\s+P0\s+casual\s+draft PRs · 2 items · 1 PR · 3 branches · 1 left for you/);
  assert.match(text, /low-one\s+P2\s+casual\s+no PRs/);
  assert.match(text, /p\s+priority\s+·\s+r\s+PRs\s+·\s+1 2 3 4\s+level/);

  ui.input('p');
  ui.input('r');
  ui.input('\x1b[B');
  ui.input('p');
  ui.input('r');
  await ui.pending();

  assert.deepEqual(actions, [['priority', 'top', 'P1'], ['prs', 'top', 'published'], ['priority', 'low', 'P3'], ['prs', 'low', 'draft']]);
  ui.stop();
});

const toDone = ui => {
  ui.input('\x1b[D');
  ui.input('\x1b[A');
  ui.input('\x1b[C');
  ui.input('\x1b[B');
};
const landing = (item, details = {}) => ({ slug: 'site', project: 'website', item, title: `Work ${item}`, branch: `hobkin/${item}`, gap: 'land', described: true, proved: true, ...details });
const nothingRead = { read: 'none', readMs: 0 };
const acting = () => {
  const actions = [];
  return { actions, workAction: async (...args) => { actions.push(args); return args[0] === 'pr' ? { description: 'Moves the site.\n\nProof: it passed.' } : { ok: true, message: `${args[0]} ok` }; } };
};

test('Now and Done are subtabs, the arrows move between them and Done counts what waits', () => {
  const ready = [landing('one'), landing('two', { gap: 'stacked' }), landing('three', { gap: 'closing' })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [chosen], ready } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /Now\s+Done 1/);
  assert.match(screen(ui), /website/);

  ui.input('\x1b[A');
  assert.equal(ui.state().focus, 'workTabs');
  assert.match(screen(ui), /subtabs/);

  ui.input('\x1b[C');
  ui.input('\x1b[B');

  assert.equal(ui.state().focus, 'work');
  assert.match(screen(ui), /TO APPROVE\s+1/);
  assert.match(screen(ui), /website: Work one/);
  assert.doesNotMatch(screen(ui), /Work two|Work three/);
  ui.stop();
});

test('Done shows five rows and how many more, each with its grade, size and what is missing', () => {
  const ready = [
    landing('a', { safety: { grade: 'safe', rating: 'A' }, size: { additions: 40, deletions: 5, files: 2 }, conflict: false, behind: 0 }),
    landing('b', { safety: { grade: 'risky', rating: 'D' } }),
    landing('c', { safety: { grade: 'safe', rating: 'B', stale: true } }),
    landing('d', { described: false, proved: false }),
    landing('e', { onlyDocs: true, holds: 2 }),
    landing('f'),
    landing('g'),
  ];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } });
  toDone(ui);

  const text = screen(ui, 110, 60);

  assert.match(text, /safe A · ready to merge · 45 lines · 2 files/);
  assert.match(text, /risky D/);
  assert.match(text, /safe B on an older commit/);
  assert.match(text, /not graded · no description · no proof/);
  assert.match(text, /docs only · holds 2 earlier branches/);
  assert.match(text, /and 2 more/);
  assert.doesNotMatch(text, /Work f/);
  ui.stop();
});

test('agents at work, steps only the user can take and work already elsewhere sit apart', async () => {
  const { actions, workAction } = acting();
  const ready = [
    landing('turn', { gap: 'yours', title: 'Turn on HTTPS', summary: 'Settings, Pages.' }),
    landing('kept', { gap: 'elsewhere', landedOn: 'release/now' }),
  ];
  const closing = [{ slug: 'site', project: 'website', item: 'fix', title: 'Rebase it', doing: 'getting it ready to merge' }];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready, closing } }, { workAction });
  toDone(ui);

  const text = screen(ui, 110, 40);
  assert.match(text, /AGENT ON IT\s+1/);
  assert.match(text, /website: Rebase it\s+getting it ready to merge/);
  assert.match(text, /YOUR TURN\s+1/);
  assert.match(text, /ALREADY ELSEWHERE\s+1/);
  assert.match(text, /also on release\/now/);
  assert.match(text, /x\s+done/);
  assert.doesNotMatch(text, /m\s+merge/);

  ui.input('m');
  ui.input('x');
  await ui.pending();

  assert.deepEqual(actions, [['done', 'site', 'turn']]);
  ui.stop();
});

const safeA = { safety: { grade: 'safe', rating: 'A' } };

test('m merges, x cancels and r asks for a review, each on a key named on screen, and the walk moves to the next row', async () => {
  const { actions, workAction } = acting();
  const ready = [landing('one', safeA), landing('two', safeA), landing('three', safeA)];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);
  assert.match(screen(ui), /m\s+merge\s+·\s+c\s+changes\s+·\s+x\s+cancel\s+·\s+r\s+review\s+·\s+d\s+diff\s+·\s+enter\s+read/);

  ui.input('m');
  await ui.pending();
  ui.input('x');
  await ui.pending();
  ui.input('r');
  await ui.pending();

  assert.deepEqual(actions, [['merge', 'site', 'one', nothingRead], ['decline', 'site', 'two'], ['review', 'site', 'three']]);
  ui.stop();
});

test('a merge passes on how the row was read: not at all, its page, or its diff, with the time spent', async () => {
  const { actions, workAction } = acting();
  const clock = { at: 1000 };
  const ready = [landing('one', safeA), landing('two', safeA), landing('three', safeA)];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction }, { now: () => clock.at });
  toDone(ui);

  ui.input('\r');
  await ui.pending();
  clock.at += 2000;
  ui.input('\x1b');
  ui.input('\r');
  await ui.pending();
  clock.at += 500;
  ui.input('m');
  await ui.pending();
  await ui.pending();

  clock.at += 3000;
  ui.input('d');
  await ui.pending();
  ui.input('m');
  await ui.pending();
  await ui.pending();
  ui.input('\x1b');
  ui.input('m');
  await ui.pending();

  assert.deepEqual(actions.filter(([action]) => action === 'merge'), [
    ['merge', 'site', 'one', { read: 'page', readMs: 2500 }],
    ['merge', 'site', 'two', { read: 'diff', readMs: 3000 }],
    ['merge', 'site', 'three', { read: 'page', readMs: 0 }],
  ]);
  ui.stop();
});

test('a done item with work on its branch shows under not landed, where m merges and x closes it', async () => {
  const { actions, workAction } = acting();
  const ready = [landing('one', { ...safeA, gap: 'unlanded' }), landing('two', { ...safeA, gap: 'unlanded' })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction }, { now: () => 1000 });
  toDone(ui);

  const text = screen(ui, 110, 40);
  assert.match(text, /NOT LANDED\s+2/);
  assert.match(text, /m\s+merge\s+·\s+x\s+close\s+·\s+enter\s+read/);

  ui.input('\r');
  await ui.pending();
  const page = screen(ui, 110, 40);
  assert.match(page, /m\s+merge\s+·\s+x\s+close\s+·\s+d\s+diff/);
  assert.doesNotMatch(page, /r\s+review/);
  ui.input('\x1b');

  ui.input('m');
  await ui.pending();
  ui.input('x');
  await ui.pending();

  assert.deepEqual(actions.filter(([action]) => action !== 'pr'), [['merge', 'site', 'one', { read: 'page', readMs: 0 }], ['done', 'site', 'two']]);
  ui.stop();
});

test('showDone can open straight on one row\'s page, and a row that has gone leaves the list open', async () => {
  const { workAction } = acting();
  const ready = [landing('one'), landing('two')];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });

  ui.showDone({ slug: 'site', item: 'two' });
  await ui.pending();

  assert.equal(ui.state().view, 'work');
  assert.equal(ui.state().focus, 'doneReading');
  assert.match(screen(ui), /website: Work two/);

  ui.input('\x1b');
  ui.showDone({ slug: 'site', item: 'gone' });

  assert.equal(ui.state().focus, 'work');
  ui.stop();
});

test('a row with a precedent says so in a few words, and where it came from', () => {
  const ready = [
    landing('one', { like: { merged: 3, watching: 0 } }),
    landing('two', { like: { merged: 1, watching: 1 } }),
    landing('three', { like: { merged: 4, watching: 2, from: 'finboard' } }),
  ];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } });
  toDone(ui);

  const text = screen(ui, 110, 40);

  assert.match(text, /like 3 merged(?!,| on)/);
  assert.match(text, /like 1 merged, still in its watch/);
  assert.match(text, /like 4 merged on finboard, 2 still in a watch/);
  ui.stop();
});

test('a risky row takes a second m', async () => {
  const { actions, workAction } = acting();
  const ready = [landing('one', { safety: { grade: 'risky', rating: 'D' } })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);

  ui.input('m');
  await ui.pending();
  assert.deepEqual(actions, []);
  assert.match(screen(ui), /Press m again/);

  ui.input('m');
  await ui.pending();
  assert.deepEqual(actions, [['merge', 'site', 'one', nothingRead]]);
  ui.stop();
});

test('a row with no grade at its commit takes a second m too, and says r reviews it', async () => {
  const { actions, workAction } = acting();
  const ready = [landing('one'), landing('two', { safety: { grade: 'safe', rating: 'A', stale: true } })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);

  ui.input('m');
  await ui.pending();
  assert.deepEqual(actions, []);
  assert.match(screen(ui), /No grade at this commit\. Press m again to merge Work one, or r for a review\./);

  ui.input('m');
  await ui.pending();
  ui.input('m');
  ui.input('m');
  await ui.pending();

  assert.deepEqual(actions, [['merge', 'site', 'one', nothingRead], ['merge', 'site', 'two', nothingRead]]);
  ui.stop();
});

test('a merge names the commit the row showed, so a branch that moved since is read again first', async () => {
  const { actions, workAction } = acting();
  const ready = [landing('one', { ...safeA, head: 'abc1234' })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);

  ui.input('m');
  await ui.pending();

  assert.deepEqual(actions, [['merge', 'site', 'one', { ...nothingRead, head: 'abc1234' }]]);
  ui.stop();
});

test('c sends an agent back with the changes the user asks for, and Esc leaves the row alone', async () => {
  const { actions, workAction } = acting();
  const ready = [landing('one'), landing('two')];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);

  ui.input('c');
  assert.match(screen(ui), /What should it change/);
  ui.input('\x1b');
  assert.equal(ui.state().focus, 'work');
  assert.deepEqual(actions, []);

  ui.input('c');
  for (const letter of 'Rebase') ui.input(letter);
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(actions, [['ask', 'site', 'one', 'Rebase']]);
  assert.equal(ui.state().focus, 'work');
  ui.stop();
});

test('Enter reads a row with its description, every key still works there, and the walk carries on to the next page', async () => {
  const { actions, workAction } = acting();
  const ready = [landing('one', { safety: { grade: 'safe', rating: 'A', reason: 'No accepted issue remains.' }, left: 'Deploy it.' }), landing('two')];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);

  ui.input('\r');
  await ui.pending();

  const text = screen(ui, 100, 40);
  assert.match(text, /Why: No accepted issue remains\./);
  assert.match(text, /Left for you: Deploy it\./);
  assert.match(text, /Proof: it passed\./);
  assert.match(text, /d\s+diff/);
  assert.match(text, /r\s+review/);

  ui.input('d');
  ui.input('r');
  await ui.pending();
  ui.input('m');
  await ui.pending();

  const [[merge, site, one, { read }], ...others] = actions.filter(([action]) => action === 'merge');
  assert.deepEqual([merge, site, one, read, others], ['merge', 'site', 'one', 'diff', []]);
  assert.deepEqual(actions.filter(([action]) => ['diff', 'review'].includes(action)), [['diff', 'site', 'one'], ['review', 'site', 'one']]);
  assert.match(screen(ui), /website: Work two/);
  assert.equal(ui.state().focus, 'doneReading');

  ui.input('\x1b');
  assert.equal(ui.state().focus, 'work');
  ui.stop();
});

test('quality sits beside safety on a row, and its page says why and who notices', async () => {
  const { workAction } = acting();
  const quality = { rating: 'B', reason: 'A hung save has no test.', stale: false };
  const ready = [landing('one', { safety: { grade: 'safe', rating: 'A' }, quality, notices: 'Authors see a failed save.' }), landing('two', { quality: { ...quality, stale: true } })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);

  assert.match(screen(ui, 110, 40), /safe A · quality B/);
  assert.match(screen(ui, 110, 40), /quality B on an older commit/);

  ui.input('\r');
  await ui.pending();

  const page = screen(ui, 110, 40);
  assert.match(page, /Quality: A hung save has no test\./);
  assert.match(page, /Who notices: Authors see a failed save\./);
  ui.stop();
});

test('Done fits every supported size, and so does the page Enter opens', async () => {
  const { workAction } = acting();
  const long = 'Update Astro to the latest release of the framework and everything that depends on it';
  const ready = [landing('one', { title: long, safety: { grade: 'safe', rating: 'A', reason: long }, size: { additions: 4000, deletions: 900, files: 120 }, conflict: false, behind: 30, left: long, holds: 3 })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } }, { workAction });
  toDone(ui);

  for (const pressed of [null, '\r']) {
    if (pressed) ui.input(pressed);
    await ui.pending();
    for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
      const lines = ui.render(width, height);
      assert.ok(lines.length <= height);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
  }
  ui.stop();
});

const asked = (id, details = {}) => ({ id, from: 'Routine mail', tldr: `Decide ${id}`, question: `Should ${id} go ahead, given what the bank said?`, choices: [{ value: 'yes', label: 'Go ahead' }, { value: 'no', label: 'Hold it' }], at: new Date().toISOString(), ...details });

test('Decisions appears with what waits, one summary a line, and a number answers the selected one', async () => {
  const { actions, workAction } = acting();
  const ui = createDashboard({ ...base, decisions: [asked('one'), asked('two')] }, { workAction });
  assert.match(screen(ui), /Decisions 2/);

  for (const view of ['reports', 'schedules', 'decisions']) ui.input('\x1b[C');
  assert.equal(ui.state().view, 'decisions');

  const text = screen(ui, 110, 30);
  assert.match(text, /Decide one\s+Routine mail/);
  assert.match(text, /Should one go ahead/);
  assert.match(text, /1 Go ahead/);
  assert.match(text, /2 Hold it/);
  assert.match(text, /Decide two/);
  assert.doesNotMatch(text, /Should two go ahead/, 'only the selected one opens');
  assert.match(text, /1-2\s+answer/);

  ui.input('\x1b[B');
  assert.match(screen(ui, 110, 30), /Should two go ahead/);

  ui.input('2');
  await ui.pending();

  assert.deepEqual(actions, [['decide', 'two', 'no']]);
  ui.stop();
});

test('the tab marks what the asker recommends and says why, and the choices keep their order', () => {
  const ui = createDashboard({ ...base, decisions: [asked('one', { recommended: 'no', why: 'Only you know the bank.', changed: 'They wrote again.' })] });
  for (const view of ['reports', 'schedules', 'decisions']) ui.input('\x1b[C');

  const text = screen(ui, 110, 30);

  assert.match(text, /1 Go ahead\s*\n/);
  assert.match(text, /2 Hold it\s+recommended/);
  assert.match(text, /Only you know the bank\./);
  assert.match(text, /They wrote again\./);
  ui.stop();
});

test('with nothing to decide the tab goes away, and an empty one never opens', () => {
  const ui = createDashboard({ ...base, decisions: [asked('one')] });
  for (const view of ['reports', 'schedules', 'decisions']) ui.input('\x1b[C');

  ui.update({ ...base, decisions: [] });

  assert.equal(ui.state().view, 'conversation');
  assert.doesNotMatch(screen(ui), /Decisions/);
  ui.stop();
});

const waiting = (rows = {}) => ({ wrong: [], asks: [], proposals: [], branches: [], yours: [], reports: [], ...rows });
const toDecisions = ui => {
  for (const view of ['reports', 'schedules', 'decisions']) ui.input('\x1b[C');
};
const step = { kind: 'item', project: 'finboard', slug: 'finboard', item: 'oauth', title: 'Rotate the OAuth secret', reason: 'Rotate it at Google.' };

test('Decisions lists everything waiting in groups, with work mode off, and the tab counts all of it', () => {
  const ui = createDashboard({ ...base, decisions: [asked('one')], waiting: waiting({
    wrong: [{ key: 'launch:site:abc', tab: 'work', fact: 'website, new error since 14:02' }],
    proposals: [{ id: 'abc123', title: 'Digest', question: 'Digest: blocked 6 of the last 8, over 8 days. Rethink it?', at: new Date().toISOString() }],
    asks: [{ kind: 'proposal', slug: 'api', title: 'finboard-api', reason: 'Rails app with real money.' }],
    branches: [landing('ship', { safety: { grade: 'safe', rating: 'A' } }), landing('said', { gap: 'unlanded' }), landing('kept', { gap: 'elsewhere', landedOn: 'release/now' })],
    yours: [landing('turn', { gap: 'yours', title: 'Turn on HTTPS', summary: 'Settings, Pages.' }), step],
    reports: [{ id: 'mail', title: 'Mail', at: new Date().toISOString(), level: 'useful', next: 'Reply by Friday.' }],
  }) });
  assert.match(screen(ui), /Decisions 10/);

  toDecisions(ui);

  const text = screen(ui, 110, 70);
  const groups = [['WENT WRONG', 1], ['QUESTIONS', 3], ['TO APPROVE', 1], ['NOT LANDED', 1], ['YOUR TURN', 2], ['ALREADY ELSEWHERE', 1], ['TO READ', 1]];
  for (const [heading, count] of groups) assert.match(text, new RegExp(`${heading} +${count}\\n`));
  assert.match(text, /website, new error since 14:02/);
  assert.match(text, /Decide one\s+Routine mail/);
  assert.match(text, /Digest\s+Learning/);
  assert.match(text, /finboard-api\n\s+Rails app with real money\./);
  assert.match(text, /website: Work ship\n\s+safe A/);
  assert.match(text, /website: Turn on HTTPS\n\s+Settings, Pages\./);
  assert.match(text, /finboard: Rotate the OAuth secret\n\s+Rotate it at Google\./);
  assert.match(text, /Mail\n\s+Reply by Friday\./);
  ui.stop();
});

test('a branch in Decisions opens its page and takes the keys it takes in Done, and Esc comes back to the list', async () => {
  const { actions, workAction } = acting();
  const ui = createDashboard({ ...base, waiting: waiting({ branches: [landing('one', safeA), landing('two', safeA), landing('three', safeA)] }) }, { workAction });
  toDecisions(ui);
  assert.match(screen(ui), /m\s+merge\s+·\s+c\s+changes\s+·\s+x\s+cancel\s+·\s+r\s+review/);

  ui.input('\r');
  await ui.pending();
  assert.match(screen(ui), /Moves the site\./);
  ui.input('m');
  await ui.pending();
  const next = screen(ui, 110, 30);
  assert.match(next, /website: Work two/, 'the walk carries on to the next page');
  assert.doesNotMatch(next, /TO APPROVE/);

  ui.input('\x1b');
  assert.equal(ui.state().focus, 'decisions');
  ui.input('x');
  await ui.pending();

  const [merge, ...rest] = actions.filter(([action]) => action !== 'pr');
  assert.deepEqual(merge.slice(0, 3), ['merge', 'site', 'one']);
  assert.equal(merge[3].read, 'page');
  assert.deepEqual(rest, [['decline', 'site', 'two']]);
  ui.stop();
});

test('Decisions lists what to approve by priority, and the selected card says what was done, its proof, its PR and when it finished', () => {
  const finished = new Date(Date.now() - 3 * 3600000).toISOString();
  const pr = 'https://github.com/o/site/pull/9';
  const ui = createDashboard({ ...base, waiting: waiting({ branches: [
    landing('low', { ...safeA, grade: 'P3' }),
    landing('urgent', { grade: 'P0', about: 'Stops the double charge on retries.', proof: 'The retry spec passes.', at: finished }),
    landing('middle', { ...safeA, grade: 'P1', pr }),
  ] }) });
  toDecisions(ui);

  const text = screen(ui, 110, 50);
  const places = ['P0 website: Work urgent', 'P1 website: Work middle', 'P3 website: Work low'].map(title => text.indexOf(title));
  assert.ok(places.every(place => place >= 0));
  assert.deepEqual(places, places.toSorted((first, second) => first - second));
  assert.match(text, /Done: Stops the double charge on retries\./);
  assert.match(text, /Proof: The retry spec passes\./);
  assert.match(text, /finished 3 hours ago/);
  assert.doesNotMatch(text, /PR https/, 'only the selected card opens');

  ui.input('\x1b[B');

  assert.match(screen(ui, 110, 50), /PR https:\/\/github\.com\/o\/site\/pull\/9/);
  ui.stop();
});

test('a PR card merges on GitHub after a second m, at the head it showed, o opens it, and c asks for changes', async () => {
  const { actions, workAction } = acting();
  const pr = 'https://github.com/o/site/pull/9';
  const ui = createDashboard({ ...base, waiting: waiting({ branches: [landing('one', { ...safeA, pr, head: 'abc1234' }), landing('two', { ...safeA, pr })] }) }, { workAction });
  toDecisions(ui);
  assert.match(screen(ui), /m m\s+merge PR\s+·\s+c\s+changes\s+·\s+x\s+cancel\s+·\s+o\s+open/);

  ui.input('o');
  await ui.pending();
  ui.input('m');
  await ui.pending();
  assert.deepEqual(actions, [['open', 'site', 'one']]);
  assert.match(screen(ui), /Press m again to merge the PR for Work one on GitHub\./);

  ui.input('m');
  await ui.pending();
  ui.input('c');
  for (const letter of 'Rename it') ui.input(letter);
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(actions, [['open', 'site', 'one'], ['mergePr', 'site', 'one', { head: 'abc1234' }], ['ask', 'site', 'two', 'Rename it']]);
  ui.stop();
});

test('with work waiting on more than one project, Decisions says how much waits on each, the biggest pile first', () => {
  const other = (item, details = {}) => landing(item, { slug: 'api', project: 'finboard-api', ...details });
  const ui = createDashboard({ ...base, waiting: waiting({
    branches: [landing('one', safeA), other('two'), other('three', { grade: 'P0' }), other('four', { gap: 'unlanded' })],
    yours: [{ ...step, slug: 'api', project: 'finboard-api' }],
  }) });
  toDecisions(ui);

  const text = screen(ui, 110, 60);

  assert.match(text, /BY PROJECT\s+2\s*\n\s*finboard-api\s+2 to approve · 1 not landed · 1 yours · 1 P0\n\s*website\s+1 to approve\n/);
  ui.stop();
});

test('one project waiting needs no tally, and a question says how long it has waited in plain words', () => {
  const at = new Date(Date.now() - 18 * 3600000).toISOString();
  const ui = createDashboard({ ...base, decisions: [asked('one', { at })], waiting: waiting({ branches: [landing('one', safeA)] }) });
  toDecisions(ui);

  const text = screen(ui, 110, 40);

  assert.doesNotMatch(text, /BY PROJECT/);
  assert.match(text, /Decide one\s+Routine mail · 18 hours ago/);
  ui.stop();
});

test('Done puts what matters most first, and each row says its priority', () => {
  const ready = [landing('low', { ...safeA, grade: 'P3' }), landing('urgent', { ...safeA, grade: 'P0' })];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready } });
  toDone(ui);

  const text = screen(ui, 110, 40);

  const [urgent, low] = ['P0 website: Work urgent', 'P3 website: Work low'].map(title => text.indexOf(title));
  assert.ok(urgent >= 0 && urgent < low);
  ui.stop();
});

test('a step only the user can take opens in place, and x marks it done once it is sorted', async () => {
  const { actions, workAction } = acting();
  const reason = 'Rotate the secret at Google, then check that the old one no longer signs in anywhere, and remove it from every host.';
  const ui = createDashboard({ ...base, waiting: waiting({ yours: [{ ...step, reason }] }) }, { workAction });
  toDecisions(ui);

  const text = screen(ui, 60, 30);
  assert.match(text, /every host\./, 'the whole step shows when selected, not one cut line');
  assert.match(text, /x\s+done/);

  ui.input('x');
  await ui.pending();

  assert.deepEqual(actions, [['done', 'finboard', 'oauth']]);
  ui.stop();
});

test('a learning proposal takes a number, and a report with a call opens on Enter', async () => {
  const { actions, workAction } = acting();
  const at = new Date().toISOString();
  const report = { id: 'mail', title: 'Mail', at, outcome: 'completed', body: 'Useful: The bank wrote.\n\nNext: Reply by Friday.' };
  const ui = createDashboard({ ...base, reports: [report], waiting: waiting({
    proposals: [{ id: 'abc123', title: 'Digest', question: 'Digest: blocked 6 of the last 8, over 8 days. Rethink it?', at }],
    reports: [{ id: 'mail', title: 'Mail', at, level: 'useful', next: 'Reply by Friday.' }],
  }) }, { workAction });
  toDecisions(ui);
  const text = screen(ui, 110, 30);
  assert.match(text, /Rethink it\?/);
  assert.match(text, /1 Yes, plan it/);
  assert.match(text, /2 No, and never ask again/);

  ui.input('1');
  await ui.pending();
  ui.input('\r');

  assert.deepEqual(actions, [['learning', 'abc123', 'yes']]);
  assert.deepEqual([ui.state().view, ui.state().focus], ['reports', 'detail']);
  ui.stop();
});

test('with work mode off, hobkin opening Done walks in Decisions, straight on the row it names', async () => {
  const { workAction } = acting();
  const ui = createDashboard({ ...base, waiting: waiting({ branches: [landing('one'), landing('two')] }) }, { workAction });

  ui.showDone({ slug: 'site', item: 'two' });
  await ui.pending();

  assert.equal(ui.state().view, 'decisions');
  assert.match(screen(ui), /website: Work two/);
  assert.match(screen(ui), /Moves the site\./);
  ui.input('\x1b');
  assert.equal(ui.state().focus, 'decisions');
  ui.stop();
});

test('a background question leaves the screen by itself, and a question someone is waiting on takes its place', async () => {
  const ui = createDashboard(base);
  const choices = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

  assert.equal(await ui.askQuestion({ question: 'Left alone?', choices, whenQuiet: true, waitMs: 5 }), null);

  const background = ui.askQuestion({ question: 'Quiet one?', choices, whenQuiet: true, waitMs: 60000 });
  const waited = ui.askQuestion({ question: 'Urgent one?', choices });

  assert.equal(await background, null);
  assert.match(screen(ui), /Urgent one/);
  ui.input('\r');
  assert.equal(await waited, 'yes');
  ui.stop();
});

test('hobkin can open Done by itself', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [], ready: [landing('one')] } });

  ui.showDone();

  assert.equal(ui.state().view, 'work');
  assert.match(screen(ui), /TO APPROVE/);
  ui.stop();
});

test('Enter on a queue row runs it now, s skips it, and s on a skipped row puts it back', async () => {
  const actions = [];
  const plan = [queueEntry('item:api:1'), queueEntry('item:api:2', { skipped: true, waiting: 'skipped', title: 'Not now' })];
  const ui = createDashboard({ ...base, work: { ...queueWork, plan } }, { workAction: async (...args) => { actions.push(args); } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /enter\s+run now/);

  ui.input('\r');
  ui.input('s');
  ui.input('\x1b[B');
  assert.match(screen(ui), /s\s+put back/);
  assert.match(screen(ui), /finboard-api: Not now/);
  ui.input('\r');
  ui.input('s');
  await ui.pending();

  assert.deepEqual(actions, [['run', 'item:api:1'], ['later', 'item:api:1'], ['back', 'item:api:2']]);
  ui.stop();
});

test('auto-pick off says so, and the tab offers no way to turn work mode off', () => {
  const ui = createDashboard({ ...base, work: { ...queueWork, autoPick: false } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Auto-pick is off: only what is picked in the queue runs\./);
  ui.stop();
});

test('max takes a second press, because it is the dearest thing a key can do', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [chosen] } }, { workAction: async (...args) => { actions.push(args); } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /1 2 3 4\s+level/);

  ui.input('4');
  assert.match(ui.state().notice, /Press 4 again for max/);
  assert.deepEqual(actions, []);

  ui.input('4');
  await ui.pending();
  assert.deepEqual(actions, [['level', 'site', 'max']]);
  ui.stop();
});

test('max work shows its count', () => {
  const inPane = { ...running, title: 'website: Fix it' };
  const ui = createDashboard({
    ...base,
    runs: [inPane],
    work: { enabled: true, projects: [{ ...chosen, level: 'max' }], maxRuns: { running: 1, today: 2, atOnce: 1, perDay: 6 }, running: [{ id: inPane.id }] },
  });
  ui.input('\x1b[D');

  const text = screen(ui, 110);

  assert.match(text, /Max: 1 of 1 running, 2 of 6 today\./);
  ui.stop();
});

test('a folder left as it was says so on its project', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [{ ...chosen, folderNote: 'It stays on hobkin/abc-fix, because it has uncommitted changes.' }] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Its folder: It stays on hobkin\/abc-fix/);
  ui.stop();
});

test('the Work Mode tab shows the harness', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, harness: 'claude', projects: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /WORK MODE\s+● active · claude/);
  ui.stop();
});

test('the arrows move between rows, and each row has its own keys', async () => {
  const actions = [];
  const ui = createDashboard({ ...base, work: on }, { workAction: async (...args) => { actions.push(args); } });
  ui.input('\x1b[D');
  assert.match(screen(ui), /y\s+take/);

  ui.input('\x1b[A');
  assert.match(screen(ui), /1 2 3 4\s+level/);
  ui.input('3');
  ui.input('\x1b[A');
  assert.match(screen(ui), /x\s+done/);
  ui.input('x');
  await ui.pending();

  assert.deepEqual(actions, [['level', 'site', 'casual'], ['done', 'site', 'abc123']]);
  ui.stop();
});

test('Enter on a running row opens its live view, and Escape comes back to Work', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [] }, runs: [running], jobActivity: {} });
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
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', projects: [] } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', projects: [chosen] }, runs: [running] }, {
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
const discovering = { enabled: true, discovering: true, folder: '/repos', projects: [] };

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
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt, discovery: finished, projects: [] } });
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
    const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt, discovery, projects: [] } });
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
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt: later, projects: [project] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Next: A look at website at/);
  ui.stop();
});

test('with a look due now the tab does not claim to be waiting for one', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', nextDiscoveryAt: null, projects: [] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Next: It looks in \/repos now\./);
  ui.stop();
});

test('with work in the queue the tab says what starts next, never a look hours away', () => {
  const later = new Date(Date.now() + 13 * 3600000).toISOString();
  const ready = queueEntry('item:api:1');
  const ui = createDashboard({ ...base, work: { ...queueWork, folder: '/repos', nextDiscoveryAt: later, plan: [ready] } });
  ui.input('\x1b[D');

  assert.match(screen(ui), /Next: finboard-api: Fix the job spec starts now\./);
  assert.doesNotMatch(screen(ui), /in 13h/);

  ui.update({ ...base, work: { ...queueWork, folder: '/repos', nextDiscoveryAt: later, plan: [ready], nextStartAt: new Date(Date.now() + 40000).toISOString() } });
  assert.match(screen(ui), /Next: finboard-api: Fix the job spec starts in 1m\./);

  ui.update({ ...base, work: { ...queueWork, folder: '/repos', nextDiscoveryAt: later, plan: [{ ...ready, waiting: 'a free worker' }] } });
  assert.match(screen(ui), /Next: finboard-api: Fix the job spec starts when a worker is free\./);
  ui.stop();
});

test('a folder already looked through is not looked through again, and the tab says what comes instead', () => {
  const ui = createDashboard({ ...base, work: { enabled: true, folder: '/repos', discovery: { status: 'finished', offered: 3 }, nextDiscoveryAt: null, projects: [] } });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.match(text, /Next: New repositories are proposed as they appear\./);
  assert.doesNotMatch(text, /It looks in/);
  ui.stop();
});

test('a proposal shows all it has to say, however narrow the screen', () => {
  const found = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [{ ...proposed, found, reason: 'Real users rely on it.' }] } });
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

  assert.match(text, /y\s+take\s+·\s+1\s+critical\s+·\s+2\s+important\s+·\s+3\s+casual\s+·\s+4\s+max\s+·\s+n\s+skip/);
  ui.stop();
});

test('answering a proposal moves on to the next one, so a list goes quickly', async () => {
  const actions = [];
  const ranked = (slug, rank) => ({ ...proposed, slug, name: slug, rank });
  const projects = [ranked('first', 1), ranked('second', 2), ranked('third', 3)];
  const ui = createDashboard({ ...base, work: { enabled: true, projects } }, {
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
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [proposed] } });

  assert.match(screen(ui, 120).split('\n')[0], /Work Mode 1/);
  ui.stop();
});

test('a project shows when it is next looked at, and why its last look failed', () => {
  const nextLookAt = new Date(Date.now() + 3 * 3600000).toISOString();
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [{ ...chosen, nextLookAt, lookError: 'The clone is gone.' }] } });
  ui.input('\x1b[D');

  const text = screen(ui);

  assert.match(text, /next look in 3h/);
  assert.match(text, /The clone is gone/);
  ui.stop();
});

test('an agent running in a pane says where to watch it', () => {
  const inPane = { ...running, work: { ...running.work, pane: 'work-do-site' } };
  const ui = createDashboard({ ...base, work: { enabled: true, projects: [] }, runs: [inPane], jobActivity: {} });
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
  const ready = [{ slug: 'site', project: 'website', item: 'abc123', title: 'Update Astro to the latest release of the framework', branch: 'hobkin/abc123-update-astro-to-the-latest-release', summary: 'Moves the site to Astro 5.14.', left: 'Publish the release.' }];
  const projects = [{ ...chosen, priority: 'P0', prMode: 'published', branches: 12, left: 3 }];
  const ui = createDashboard({ ...base, work: { ...on, projects, ready, allowanceRequest: { proposed: 200000000, reason: 'Paused for today.' }, discovering: true }, runs: [running] });
  ui.input('\x1b[D');

  for (const [width, height] of [[120, 40], [80, 24], [60, 18]]) {
    const lines = ui.render(width, height);
    assert.ok(lines.length <= height);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
  ui.stop();
});
