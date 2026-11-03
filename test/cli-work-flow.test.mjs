import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exec, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { openDecisions } from '../src/cli/decisions.mjs';
import { main } from '../src/cli/main.mjs';
import { setProfile } from '../src/cli/profile.mjs';
import { startDashboard } from '../src/cli/ui.mjs';
import { fileItem, chooseProject, paths, proposeProject, readItems, readMode, readProjects, readState, recordTokens, writeMode, writeState } from '../src/cli/work/store.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const HOUR = 3600000;
const LEFT = '\x1b[D';
const DOWN = '\x1b[B';
const ENTER = '\r';
const ESCAPE = '\x1b';
const shell = promisify(exec);
const quoted = value => `'${String(value).replaceAll("'", "'\\''")}'`;
// An agent reaches Hobkin only through the commands it is given, so these run them the same way.
const pipeTo = (command, value) => shell(`printf %s ${quoted(JSON.stringify(value))} | ${command}`);
const request = run => JSON.parse(run.prompt);
const billing = {
  name: 'billing',
  rank: 1,
  level: 'critical',
  summary: 'Takes payments.',
  found: 'CI is red on main.',
  reason: 'Real money.',
  first: [{ key: 'ci:main', kind: 'fix', title: 'Fix the job spec', brief: 'Evidence, who benefits, the first change, the proof.' }],
};
const site = { name: 'site', rank: 2, level: 'casual', summary: 'A personal site.', found: 'Last commit in March.', reason: 'Little depends on it.' };

class FakeTerminal {
  columns = 100;
  rows = 40;
  start(input, resize) {
    this.input = input;
    this.resize = resize;
  }
  stop() {}
  drainInput() { return Promise.resolve(); }
  write() {}
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  get kittyProtocolActive() { return false; }
}

// This runs the real app, and inside Herdr that would open real panes.
function outsideHerdr(t) {
  const saved = process.env.HERDR_ENV;
  delete process.env.HERDR_ENV;
  t.after(() => {
    if (saved !== undefined) process.env.HERDR_ENV = saved;
  });
}

function fixture(t) {
  outsideHerdr(t);
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-flow-')));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }));
  const root = join(base, 'home');
  mkdirSync(root);
  const config = initialize(root, { cwd: base });
  // A returning user, so setup does not start by itself and take the first turn.
  setProfile(root, 'call', 'Ada');
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  writeMode(root, { startGapMs: 0 });
  const folder = join(base, 'projects');
  mkdirSync(folder);
  return { base, root, folder };
}

function repository(folder, name) {
  const checkout = join(folder, name);
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args]);
  execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(checkout, 'app.txt'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  return checkout;
}

/** The real `main()` on a fake terminal. `agent` plays every background agent and `chat` the main agent. */
async function openHobkin(h, { agent = async () => 'Useful: Done.', chat = async () => 'OK.' } = {}) {
  const signals = new EventEmitter();
  const terminal = new FakeTerminal();
  const fake = fakePi(h.root);
  let ui;
  const finished = main(['--home', h.root], { isTTY: true, write() {} }, {
    signals,
    input: { isTTY: true },
    startDashboard: (view, handlers, options) => {
      ui = startDashboard(view, handlers, { ...options, terminal, agentDir: h.root, theme: undefined });
      return ui;
    },
    openApplication: (home, options) => HobkinApplication.open(home, {
      ...options,
      memoryIndex: null,
      intervalMs: 100,
      sessionDependencies: fake.dependencies,
      createMain: async parameters => {
        const session = await fake.createMain(parameters);
        const prompt = session.prompt.bind(session);
        session.prompt = async (text, settings) => {
          fake.controls.get(session.sessionId).reply = await chat(text);
          return prompt(text, settings);
        };
        return session;
      },
      runHarness: async (run, options) => {
        const said = await agent(run, options);
        return said?.status ? said : { status: 'completed', text: said };
      },
    }),
  });
  // Wide enough that a temporary folder's long path does not wrap what these tests read.
  const screen = (width = 200, height = 50) => stripTerminalSequences(ui.render(width, height).join('\n'));
  const hobkin = {
    screen,
    async until(expected, { timeout = 8000 } = {}) {
      const deadline = Date.now() + timeout;
      while (!expected.test(screen())) {
        if (Date.now() > deadline) assert.fail(`Never saw ${expected} on this screen:\n${screen()}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    async settled(check, { timeout = 8000 } = {}) {
      const deadline = Date.now() + timeout;
      while (!check()) {
        if (Date.now() > deadline) assert.fail(`Never settled. The screen:\n${screen()}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    state: () => ui.state(),
    press: data => terminal.input(data),
    send(text) {
      for (const character of text) terminal.input(character);
      terminal.input(ENTER);
    },
    async close() {
      signals.emit('SIGTERM');
      await finished;
    },
  };
  await hobkin.until(/connected/);
  return hobkin;
}

const tabRow = text => text.split('\n')[0];

/** `/work` starts nothing by itself and asks what to pick up, so a test that watches the work happen lets the whole queue run, the last choice, as the user would. */
async function letTheQueueRun(h, hobkin) {
  await hobkin.until(/nothing new starts by itself/);
  const { choices } = openDecisions(h.root).find(({ key }) => key === 'pickup');
  for (let step = 1; step < choices.length; step++) hobkin.press(DOWN);
  hobkin.press(ENTER);
  await hobkin.settled(() => readMode(h.root).autoPick);
}

const gated = () => {
  const gate = Promise.withResolvers();
  return { ...gate, reached: Promise.withResolvers() };
};

test('the user\'s real state: work mode on, a day-old clock from an import and nothing found looks as Hobkin opens', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: true, folder: h.folder, lastDiscoveryAt: new Date(Date.now() - 22.6 * HOUR).toISOString() });
  const finish = gated();
  const hobkin = await openHobkin(h, {
    agent: async run => {
      finish.reached.resolve(run);
      await finish.promise;
      return 'Nothing new.';
    },
  });
  t.after(async () => {
    finish.resolve();
    await hobkin.close();
  });

  assert.match(tabRow(hobkin.screen()), /Work Mode/);
  assert.equal((await finish.reached.promise).purpose, 'work-discover');

  hobkin.press(LEFT);
  await hobkin.until(/FINDING PROJECTS/);
});

test('from /work to a PR: told what it looks at, asked in Chat, answered in Chat, then the work happens', async t => {
  const h = fixture(t);
  const billingPath = repository(h.folder, 'billing');
  const sitePath = repository(h.folder, 'site');
  writeMode(h.root, { folder: h.folder, lastDiscoveryAt: new Date(Date.now() - 22.6 * HOUR).toISOString() });

  const looked = gated();
  const finish = gated();
  const told = [];
  const agent = async run => {
    const { work } = request(run);
    if (run.purpose === 'work-discover') {
      await pipeTo(work.commands.progress, { rootFolders: ['billing', 'site'], folder: billingPath, doing: 'Reading its git history', repositories: ['billing', 'site'] });
      await pipeTo(work.commands.propose, { ...billing, path: billingPath });
      looked.resolve();
      await finish.promise;
      await pipeTo(work.commands.propose, { ...site, path: sitePath });
      await pipeTo(work.commands.progress, { finishedFolders: ['billing', 'site'] });
      return 'Useful: Looked through 2 repositories and offers 2.';
    }
    if (run.purpose === 'work-look' && work.focus === 'study') {
      writeFileSync(work.projectFile, '# What it is\n\nPayments.\n');
      return 'Useful: Studied it.';
    }
    if (run.purpose === 'work-do') {
      await pipeTo(work.commands.item, { id: work.item.id, state: 'pr', pr: 'local branch' });
      return 'Useful: Opened a PR.';
    }
    return 'Nothing new.';
  };
  const chat = async text => {
    told.push(text);
    const note = text.match(/^<hobkin-work>\n(.*)\n<\/hobkin-work>\n\n/);
    if (!note) return 'Nothing is waiting.';
    const { proposals, commands } = JSON.parse(note[1]);
    await shell(commands.choose.replace('<slug> [max|critical|important|casual]', `${proposals[0].slug} important`));
    await shell(commands.skip.replace('<slug>', proposals[1].slug));
    return `Took ${proposals[0].name} and skipped ${proposals[1].name}.`;
  };
  const hobkin = await openHobkin(h, { agent, chat });
  t.after(async () => {
    finish.resolve();
    await hobkin.close();
  });
  assert.doesNotMatch(tabRow(hobkin.screen()), /Work Mode/, 'no tab before the mode is on');

  // Start: Chat stays put, and says what happened and where to look.
  hobkin.send('/work');
  await hobkin.until(/Work mode on\. The Work Mode tab has appeared/);
  assert.equal(hobkin.state().view, 'conversation');
  assert.match(tabRow(hobkin.screen()), /Work Mode/);
  assert.equal(readMode(h.root).enabled, true);
  await letTheQueueRun(h, hobkin);

  // Looking: the tab says where it is and what it found, and a proposal shows as soon as it exists.
  await looked.promise;
  hobkin.press(LEFT);
  await hobkin.until(/1 proposed so far/);
  const looking = hobkin.screen();
  assert.match(looking, /WORK MODE\s+● active/);
  assert.match(looking, /Now: Looking through .* \(0 of 2 folders done\)/);
  assert.match(looking, /Reading its git history/);
  assert.match(looking, /Found 2 repositories/);
  assert.match(looking, /PROPOSED/);
  assert.match(looking, /Next: .*A look at /);
  assert.deepEqual(readProjects(h.root).map(({ slug, state }) => [slug, state]), [['billing', 'proposed']]);

  // Told: Chat names each one, and the tab lists the same ones with their keys.
  finish.resolve();
  await hobkin.until(/site\s+casual/);
  assert.match(hobkin.screen(), /y take\s+·\s+1 critical\s+·\s+2 important\s+·\s+3 casual\s+·\s+4 max\s+·\s+n skip/);
  assert.match(hobkin.screen(), /Work Mode 2/, 'the tab counts what is waiting');
  hobkin.press(ESCAPE);
  await hobkin.until(/proposes 2 projects/);
  const asked = hobkin.screen();
  for (const text of ['billing', 'critical', 'CI is red on main', 'site', 'casual', 'Last commit in March', 'Which ones should it take']) {
    assert.ok(asked.includes(text), `Chat should say ${text}:\n${asked}`);
  }
  assert.equal(readItems(h.root, 'billing').length, 0, 'nothing has started on a project nobody picked');

  // Answered in Chat: the main agent really has what it needs, and the user never sees the block.
  hobkin.send('take the first one and skip the other');
  await hobkin.until(/Took billing and skipped site/);
  assert.match(told[0], /<hobkin-work>/);
  assert.doesNotMatch(hobkin.screen(), /hobkin-work/);
  assert.match(hobkin.screen(), /take the first one and skip the other/);
  assert.deepEqual(readProjects(h.root).map(({ slug, state, level }) => [slug, state, level]), [['billing', 'chosen', 'important'], ['site', 'skipped', 'casual']]);

  // Looking and doing: taking it is what lets work start, and the first item ends in a PR.
  await hobkin.settled(() => readItems(h.root, 'billing').some(item => item.state === 'pr'), { timeout: 15000 });

  // Finished: work with an open PR is reviewed there, so it waits in Action Items to land, and no question opens for it.
  await hobkin.until(/Action Items \d/);
  assert.doesNotMatch(hobkin.screen(), /can land|hobkin asks/);
  assert.ok(readItems(h.root, 'billing').every(item => !item.reviewAsked));

  hobkin.press(LEFT);
  await hobkin.until(/billing\s+P1\s+important\s+no PRs · 1 PR/);
  assert.doesNotMatch(hobkin.screen(), /PROPOSED/);

  // Stop: only from Chat, and the tab goes.
  hobkin.press(ESCAPE);
  hobkin.send('/work');
  await hobkin.until(/Work mode off\. The Work Mode tab is hidden/);
  await hobkin.until(/branches stay/);
  assert.equal(readMode(h.root).enabled, false);
  assert.doesNotMatch(tabRow(hobkin.screen()), /Work Mode/);

  // Start again: the tab comes back, and it does not pay for another look with a project waiting.
  const looks = readMode(h.root).lastDiscoveryAt;
  hobkin.send('/work');
  await hobkin.until(/Work mode on\. The Work Mode tab has appeared/);
  assert.equal(readMode(h.root).enabled, true);
  assert.equal(readMode(h.root).lastDiscoveryAt, looks);
  assert.match(tabRow(hobkin.screen()), /Work Mode/);
});

test('the folder question comes from /work, and Hobkin stays in Chat', async t => {
  const h = fixture(t);
  const hobkin = await openHobkin(h, {
    agent: async run => {
      await pipeTo(request(run).work.commands.progress, { rootFolders: [] });
      return 'Useful: Looked through nothing, because the folder is empty.';
    },
  });
  t.after(() => hobkin.close());

  hobkin.send('/work');
  await hobkin.until(/Which folder should work mode start from/);
  assert.equal(readMode(h.root).enabled, false);

  hobkin.send(h.folder);
  await letTheQueueRun(h, hobkin);
  await hobkin.until(/nothing to propose: Looked through nothing, because the folder is empty/);

  assert.equal(readMode(h.root).folder, h.folder);
  assert.equal(hobkin.state().view, 'conversation');
});

test('a look that finds nothing says so with the reason in Chat and in the tab, and promises no other', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: h.folder });
  const hobkin = await openHobkin(h, {
    agent: async run => {
      await pipeTo(request(run).work.commands.progress, { rootFolders: ['old'], finishedFolders: ['old'] });
      return 'Useful: Looked through 1 repository and offers none, because it is an unchanged fork.';
    },
  });
  t.after(() => hobkin.close());

  hobkin.send('/work');
  await letTheQueueRun(h, hobkin);
  await hobkin.until(/nothing to propose: Looked through 1 repository/);
  assert.doesNotMatch(hobkin.screen(), /looks again/);
  hobkin.press(LEFT);
  await hobkin.until(/The last look proposed nothing: Looked through 1 repository/);
  assert.doesNotMatch(hobkin.screen(), /A look at /);
});

test('a look that fails says so with the reason in Chat and in the tab, with the next look', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: h.folder });
  const hobkin = await openHobkin(h, { agent: async () => { throw Error('Provider is down.'); } });
  t.after(() => hobkin.close());

  hobkin.send('/work');
  await letTheQueueRun(h, hobkin);
  await hobkin.until(/could not finish looking in .*Provider is down/);
  hobkin.press(LEFT);
  await hobkin.until(/The last look failed: Provider is down/);
  assert.match(hobkin.screen(), /Next: A look at .* at \d\d:\d\d (today|tomorrow) \(in 1[45]m\)/);
});

test('a run that stops early is carried on, and giving up reaches Chat with its reason and any proposals', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'billing');
  writeMode(h.root, { enabled: false, folder: h.folder });
  let runs = 0;
  const hobkin = await openHobkin(h, {
    agent: async run => {
      runs++;
      await pipeTo(request(run).work.commands.propose, { ...billing, path });
      return 'Continuing read-only project discovery.';
    },
  });
  t.after(() => hobkin.close());

  hobkin.send('/work');
  await letTheQueueRun(h, hobkin);
  await hobkin.until(/before it finished: Continuing read-only project discovery/, { timeout: 15000 });

  assert.equal(runs, 3);
  assert.match(hobkin.screen(), /billing/);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(runs, 3, 'it stops there');
});

test('a pause is answered in Chat too, and work carries on', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'billing');
  writeMode(h.root, { enabled: true, folder: h.folder, dailyTokens: 12000000, lastDiscoveryAt: new Date().toISOString() });
  chooseProject(h.root, path);
  fileItem(h.root, 'billing', { key: 'ci:main', kind: 'fix', title: 'Fix the job spec', brief: 'Evidence.' });
  recordTokens(h.root, { slug: 'billing', lane: 'do', tokens: 12000000 }, new Date(new Date().setHours(0, 0, 1)).getTime());
  const hobkin = await openHobkin(h, {
    agent: async run => {
      if (run.purpose === 'work-look') writeFileSync(request(run).work.projectFile, '# What it is\n');
      return 'Nothing new.';
    },
    chat: async text => {
      const note = JSON.parse(text.match(/^<hobkin-work>\n(.*)\n<\/hobkin-work>\n\n/)[1]);
      await shell(note.commands.allow.replace('[tokens | no]', ''));
      return `Raised it to ${note.allowance.proposed}.`;
    },
  });
  t.after(() => hobkin.close());

  await hobkin.until(/Paused for today: 12m of the 12m daily limit used/);
  hobkin.press(LEFT);
  await hobkin.until(/WORK MODE\s+● paused/);
  hobkin.press(ESCAPE);

  hobkin.send('yes, raise it');
  await hobkin.until(/Raised it to 24000000/);

  await hobkin.settled(() => readMode(h.root).raisedTo === 24000000);
  hobkin.press(LEFT);
  await hobkin.until(/WORK MODE\s+● active/);
});

test('a usage limit stops work at once and says so in Chat once, with nothing counted against the project', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'billing');
  writeMode(h.root, { enabled: true, folder: h.folder, lastDiscoveryAt: new Date().toISOString() });
  chooseProject(h.root, path);
  fileItem(h.root, 'billing', { key: 'ci:main', kind: 'fix', title: 'Fix the job spec', brief: 'Evidence.' });
  let runs = 0;
  const hobkin = await openHobkin(h, {
    agent: async run => {
      runs++;
      writeFileSync(run.sessionFile, `${JSON.stringify({ type: 'message', message: { role: 'assistant', stopReason: 'error', errorMessage: 'You have hit your ChatGPT usage limit (pro plan). Try again in ~40 min.' } })}\n`);
      return { status: 'failed', cost: null, error: 'Pi did not finish a response (error).' };
    },
  });
  t.after(() => hobkin.close());

  await hobkin.until(/Paused by a usage limit: You have hit your ChatGPT usage limit/);
  await new Promise(resolve => setTimeout(resolve, 400));

  assert.equal(runs, 1, 'nothing retried and nothing else started');
  assert.equal(hobkin.screen().match(/Paused by a usage limit/g).length, 1, 'Chat hears it once');
  assert.equal(readState(h.root, 'billing').lookError ?? null, null, 'nothing is counted against the project');
  hobkin.press(LEFT);
  await hobkin.until(/WORK MODE\s+● paused/);
});

test('reopening Hobkin keeps what was asked, what was picked and the mode, and asks nothing twice', async t => {
  const h = fixture(t);
  const path = repository(h.folder, 'billing');
  writeMode(h.root, { enabled: false, folder: h.folder });
  const agent = async run => {
    await pipeTo(request(run).work.commands.propose, { ...billing, path });
    await pipeTo(request(run).work.commands.progress, { rootFolders: ['billing'], finishedFolders: ['billing'] });
    return 'Useful: Looked through 1 repository and offers 1.';
  };
  let hobkin = await openHobkin(h, { agent });
  hobkin.send('/work');
  await letTheQueueRun(h, hobkin);
  await hobkin.until(/proposes 1 project/);
  await hobkin.close();

  let looks = 0;
  hobkin = await openHobkin(h, { agent: async () => { looks++; return 'Nothing new.'; } });
  t.after(() => hobkin.close());

  assert.equal(readMode(h.root).enabled, true);
  assert.equal(hobkin.screen().match(/proposes 1 project/g)?.length, 1, 'the question is still there, once');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(looks, 0, 'the proposal is still waiting, so there is nothing to look for yet');

  hobkin.press(LEFT);
  await hobkin.until(/billing\s+critical/);
  assert.match(hobkin.screen(), /CI is red on main/);
});

test('a proposal left from before this version is told when Hobkin opens', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: h.folder, lastDiscoveryAt: new Date().toISOString() });
  proposeProject(h.root, { ...billing, path: repository(h.folder, 'billing') });

  const hobkin = await openHobkin(h);
  t.after(() => hobkin.close());

  await hobkin.until(/Work mode proposes 1 project/);
  assert.match(hobkin.screen(), /CI is red on main/);
});

test('another process sees a real run and cancels it through the owner, and knows when the owner has gone', async t => {
  const h = fixture(t);
  const now = new Date().toISOString();
  chooseProject(h.root, repository(h.folder, 'billing'), 'critical');
  mkdirSync(paths(h.root, 'billing').directory, { recursive: true });
  writeFileSync(paths(h.root, 'billing').project, '# What it is\n');
  writeState(h.root, 'billing', { lastLookAt: now, lastLensAt: now, lastIdeasAt: now, lastSignalsAt: now });
  const filed = fileItem(h.root, 'billing', billing.first[0]);
  writeMode(h.root, { enabled: true, folder: h.folder, lastDiscoveryAt: now });
  const started = Promise.withResolvers();
  const hobkin = await openHobkin(h, {
    agent: async run => {
      started.resolve();
      await new Promise(resolve => { run.signal.addEventListener('abort', resolve, { once: true }); });
      return { status: 'interrupted', cost: null, error: 'Harness cancelled.' };
    },
  });
  t.after(() => hobkin.close());
  const hobkinWork = async (...args) => {
    const script = join(process.cwd(), 'src/cli/main.mjs');
    const { stdout } = await shell(`${quoted(process.execPath)} ${quoted(script)} work ${args.join(' ')} --home ${quoted(h.root)}`);
    return JSON.parse(stdout);
  };
  await started.promise;
  await hobkin.settled(() => readItems(h.root, 'billing')[0].state === 'doing');

  let running = [];
  while (!running.length) running = await hobkinWork('running');

  assert.deepEqual(running.map(run => [run.project, run.item, run.lane, run.level, run.harness, run.pane]), [['billing', filed.id, 'do', 'critical', 'pi', null]]);
  assert.equal((await hobkinWork('status')).owner, true);

  const { ok, message } = await hobkinWork('cancel', 'billing');

  assert.equal(ok, true);
  assert.match(message, /requested/i);
  await hobkin.settled(() => readMode(h.root).queueSkipped.includes(`item:billing:${filed.id}`));
  assert.equal(readItems(h.root, 'billing')[0].state, 'open');

  await hobkin.close();

  assert.equal((await hobkinWork('status')).owner, false);
});

test('the main agent changes the harness when asked, and the tab shows it', async t => {
  const h = fixture(t);
  chooseProject(h.root, '/repos/none');
  writeMode(h.root, { enabled: true, folder: h.folder, lastDiscoveryAt: new Date().toISOString() });
  const script = join(process.cwd(), 'src/cli/main.mjs');
  const hobkin = await openHobkin(h, {
    agent: async () => 'Nothing new.',
    chat: async () => {
      await shell(`${quoted(process.execPath)} ${quoted(script)} work harness claude --home ${quoted(h.root)}`);
      return 'It now runs on claude.';
    },
  });
  t.after(() => hobkin.close());

  hobkin.send('use claude for work mode');
  await hobkin.until(/It now runs on claude/);
  hobkin.press(LEFT);

  await hobkin.until(/● (active|paused) · claude/);
});
