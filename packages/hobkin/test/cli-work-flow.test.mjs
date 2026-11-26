import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exec, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { setProfile } from '../src/cli/profile.mjs';
import { fileItem, chooseProject, foldersLeft, paths, proposeProject, readItems, readMode, readProjects, readState, recordTokens, writeMode, writeState } from '../src/cli/work/store.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const HOUR = 3600000;
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

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-flow-')));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }));
  const root = join(base, 'home');
  mkdirSync(root);
  const config = initialize(root, { cwd: base });
  // A returning user, so setup does not start by itself and take the first turn.
  setProfile(root, 'call', 'Ada');
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  // These flows read their lines in Chat as they come; when the desk delivers them is the desk's own tests (075).
  config.desk = { enabled: false };
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

/**
 * Hobkin's application as the app opens it, with the views it publishes and the questions it asks. A question waits for the test to answer it,
 * one at a time, as the window asks them. `agent` plays every background agent and `chat` the main agent.
 */
async function openHobkin(h, { agent = async () => 'Useful: Done.', chat = async () => 'OK.' } = {}) {
  const fake = fakePi(h.root);
  let view = null;
  let question = null;
  const askQuestion = (asked, signal) => {
    if (question) return Promise.resolve(undefined);
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      const finish = answer => {
        if (question !== open) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', leave);
        question = null;
        resolve(answer);
      };
      const leave = () => finish(null);
      const timer = asked.waitMs ? setTimeout(leave, asked.waitMs) : undefined;
      const open = { ...asked, answer: finish };
      signal?.addEventListener('abort', leave, { once: true });
      question = open;
    });
  };
  const app = await HobkinApplication.open(h.root, {
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
    onChange: next => { view = next; },
    askQuestion,
    // The user is there, as at a window they just opened.
    presence: () => ({ seenAt: Date.now(), away: false, occupied: Boolean(question) }),
  });
  const chatText = () => (view?.messages ?? []).map(({ content }) => content).join('\n---\n');
  const settled = async (check, what = 'that', { timeout = 8000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (!check()) {
      if (Date.now() > deadline) assert.fail(`Never saw ${what}. Chat says:\n${chatText()}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const said = pattern => (view?.messages ?? []).filter(({ content }) => pattern.test(content));
  return {
    app,
    view: () => view,
    work: () => view.work,
    question: () => question,
    said,
    settled,
    /** The first message in Chat that matches, once there is one. */
    async heard(pattern, options) {
      await settled(() => said(pattern).length, pattern, options);
      return said(pattern)[0];
    },
    /** The question open now, once one that matches is. */
    async asked(pattern, options) {
      await settled(() => pattern.test(question?.question ?? ''), `a question like ${pattern}`, options);
      return question;
    },
    send: text => app.send(text),
    // A quit is no answer, so an open question ends as one that could not be asked.
    close() {
      question?.answer(undefined);
      return app.close();
    },
  };
}

/** `/work` starts nothing by itself and asks what to pick up, so a test that watches the work happen lets the whole queue run, the last choice, as the user would. */
async function letTheQueueRun(h, hobkin) {
  const pickUp = await hobkin.asked(/nothing new starts by itself/);
  pickUp.answer(pickUp.choices.at(-1).value);
  await hobkin.settled(() => readMode(h.root).autoPick, 'auto-pick on');
}

const proposed = work => work.projects.filter(project => project.state === 'proposed').map(({ slug }) => slug);
const minutesUntil = at => Math.round((Date.parse(at) - Date.now()) / 60000);

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

  assert.equal(hobkin.work().enabled, true);
  assert.equal((await finish.reached.promise).purpose, 'work-discover');
  await hobkin.settled(() => hobkin.work().discovering, 'the look under way');
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
  assert.equal(hobkin.work().enabled, false, 'off before the mode is on');

  // Start: `/work` in Chat turns it on.
  await hobkin.app.workAction('toggle');
  assert.equal(hobkin.work().enabled, true);
  assert.equal(readMode(h.root).enabled, true);
  await letTheQueueRun(h, hobkin);

  // Looking: Work says where it is and what it found, and a proposal shows as soon as it exists.
  await looked.promise;
  await hobkin.settled(() => hobkin.work().discovering && proposed(hobkin.work()).length === 1, '1 proposed so far');
  const looking = hobkin.work();
  assert.equal(looking.paused, false);
  assert.deepEqual(looking.discovery.rootFolders, ['billing', 'site']);
  assert.deepEqual(foldersLeft(looking.discovery), ['billing', 'site'], '0 of 2 folders done');
  assert.equal(looking.discovery.doing, 'Reading its git history');
  assert.deepEqual(looking.discovery.repositories, ['billing', 'site']);
  assert.deepEqual(proposed(looking), ['billing']);
  assert.ok(Date.parse(looking.nextDiscoveryAt) > Date.now(), 'the next look is ahead');
  assert.deepEqual(readProjects(h.root).map(({ slug, state }) => [slug, state]), [['billing', 'proposed']]);

  // Told: Chat names each one, and Work lists the same ones, both waiting for an answer.
  finish.resolve();
  await hobkin.settled(() => hobkin.work().projects.some(project => project.slug === 'site' && project.state === 'proposed' && project.level === 'casual'), 'site proposed as casual');
  assert.deepEqual(proposed(hobkin.work()), ['billing', 'site']);
  assert.equal(hobkin.work().allowanceRequest, null);
  const asked = (await hobkin.heard(/proposes 2 projects/)).content;
  for (const text of ['billing', 'critical', 'CI is red on main', 'site', 'casual', 'Last commit in March', 'Which ones should it take']) {
    assert.ok(asked.includes(text), `Chat should say ${text}:\n${asked}`);
  }
  assert.equal(readItems(h.root, 'billing').length, 0, 'nothing has started on a project nobody picked');

  // Answered in Chat: the main agent really has what it needs, and the user never sees the block.
  await hobkin.send('take the first one and skip the other');
  await hobkin.heard(/Took billing and skipped site/);
  assert.match(told[0], /<hobkin-work>/);
  assert.deepEqual(hobkin.said(/hobkin-work/), []);
  assert.ok(hobkin.view().messages.some(({ role, content }) => role === 'user' && content === 'take the first one and skip the other'));
  assert.deepEqual(readProjects(h.root).map(({ slug, state, level }) => [slug, state, level]), [['billing', 'chosen', 'important'], ['site', 'skipped', 'casual']]);

  // Looking and doing: taking it is what lets work start, and the first item ends in a PR.
  await hobkin.settled(() => readItems(h.root, 'billing').some(item => item.state === 'pr'), 'a PR on billing', { timeout: 15000 });

  // Finished: work with an open PR is reviewed there, so it waits in Action Items to land, and no question opens for it.
  const actionItems = view => (view.decisions?.length ?? 0) + Object.values(view.waiting ?? {}).filter(Array.isArray).flat().length;
  await hobkin.settled(() => actionItems(hobkin.view()) > 0, 'something in Action Items');
  assert.equal(hobkin.question(), null);
  assert.deepEqual(hobkin.said(/can land/), []);
  assert.ok(readItems(h.root, 'billing').every(item => !item.reviewAsked));

  await hobkin.settled(() => hobkin.work().projects.find(project => project.slug === 'billing')?.prs === 1, 'billing with 1 PR');
  const taken = hobkin.work().projects.find(project => project.slug === 'billing');
  assert.deepEqual([taken.priority, taken.level, taken.prMode], ['P1', 'important', 'off']);
  assert.deepEqual(proposed(hobkin.work()), []);

  // Stop: `/work` in Chat again, and projects, items and branches stay.
  await hobkin.app.workAction('toggle');
  assert.equal(readMode(h.root).enabled, false);
  assert.equal(hobkin.work().enabled, false);
  assert.ok(readItems(h.root, 'billing').some(item => item.state === 'pr'));

  // Start again: it does not pay for another look with a project waiting.
  const looks = readMode(h.root).lastDiscoveryAt;
  await hobkin.app.workAction('toggle');
  assert.equal(readMode(h.root).enabled, true);
  assert.equal(readMode(h.root).lastDiscoveryAt, looks);
  assert.equal(hobkin.work().enabled, true);
});

test('work mode starts from the folder it is given, and Chat says an empty one has nothing to propose', async t => {
  const h = fixture(t);
  const hobkin = await openHobkin(h, {
    agent: async run => {
      await pipeTo(request(run).work.commands.progress, { rootFolders: [] });
      return 'Useful: Looked through nothing, because the folder is empty.';
    },
  });
  t.after(() => hobkin.close());

  // No folder yet, so `/work` has to ask for one first.
  assert.equal(hobkin.work().folder ?? null, null);
  assert.equal(readMode(h.root).enabled, false);

  await hobkin.app.workAction('start', h.folder);
  await letTheQueueRun(h, hobkin);
  await hobkin.heard(/nothing to propose: Looked through nothing, because the folder is empty/);

  assert.equal(readMode(h.root).folder, h.folder);
});

test('a look that finds nothing says so with the reason in Chat and in Work, and promises no other', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: h.folder });
  const hobkin = await openHobkin(h, {
    agent: async run => {
      await pipeTo(request(run).work.commands.progress, { rootFolders: ['old'], finishedFolders: ['old'] });
      return 'Useful: Looked through 1 repository and offers none, because it is an unchanged fork.';
    },
  });
  t.after(() => hobkin.close());

  await hobkin.app.workAction('toggle');
  await letTheQueueRun(h, hobkin);
  await hobkin.heard(/nothing to propose: Looked through 1 repository/);
  assert.deepEqual(hobkin.said(/looks again/), []);
  await hobkin.settled(() => hobkin.work().discovery.status === 'finished', 'the last look finished');
  const { discovery, nextDiscoveryAt, projects } = hobkin.work();
  assert.ok(!discovery.offered);
  assert.match(discovery.reason, /Looked through 1 repository/);
  assert.equal(nextDiscoveryAt, null);
  assert.deepEqual(projects, []);
});

test('a look that fails says so with the reason in Chat and in Work, with the next look', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: h.folder });
  const hobkin = await openHobkin(h, { agent: async () => { throw Error('Provider is down.'); } });
  t.after(() => hobkin.close());

  await hobkin.app.workAction('toggle');
  await letTheQueueRun(h, hobkin);
  await hobkin.heard(/could not finish looking in .*Provider is down/);
  await hobkin.settled(() => hobkin.work().discovery.status === 'failed', 'the last look failed');
  assert.match(hobkin.work().discovery.reason, /Provider is down/);
  assert.ok([14, 15].includes(minutesUntil(hobkin.work().nextDiscoveryAt)), `the next look in 14 or 15 minutes: ${hobkin.work().nextDiscoveryAt}`);
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

  await hobkin.app.workAction('toggle');
  await letTheQueueRun(h, hobkin);
  const gaveUp = await hobkin.heard(/before it finished: Continuing read-only project discovery/, { timeout: 15000 });

  assert.equal(runs, 3);
  assert.match(gaveUp.content, /billing/);
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

  await hobkin.heard(/Paused for today: 12m of the 12m daily limit used/);
  await hobkin.settled(() => hobkin.work().paused, 'work paused');

  await hobkin.send('yes, raise it');
  await hobkin.heard(/Raised it to 24000000/);

  await hobkin.settled(() => readMode(h.root).raisedTo === 24000000, 'the limit raised');
  await hobkin.settled(() => !hobkin.work().paused, 'work active again');
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

  await hobkin.heard(/Paused by a usage limit: You have hit your ChatGPT usage limit/);
  await new Promise(resolve => setTimeout(resolve, 400));

  assert.equal(runs, 1, 'nothing retried and nothing else started');
  const heard = hobkin.view().messages.flatMap(({ content }) => content.match(/Paused by a usage limit/g) ?? []);
  assert.equal(heard.length, 1, 'Chat hears it once');
  assert.equal(readState(h.root, 'billing').lookError ?? null, null, 'nothing is counted against the project');
  assert.equal(hobkin.work().paused, true);
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
  await hobkin.app.workAction('toggle');
  await letTheQueueRun(h, hobkin);
  await hobkin.heard(/proposes 1 project/);
  await hobkin.close();

  let looks = 0;
  hobkin = await openHobkin(h, { agent: async () => { looks++; return 'Nothing new.'; } });
  t.after(() => hobkin.close());

  assert.equal(readMode(h.root).enabled, true);
  assert.equal(hobkin.said(/proposes 1 project/).length, 1, 'the question is still there, once');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(looks, 0, 'the proposal is still waiting, so there is nothing to look for yet');

  const waiting = hobkin.work().projects.find(project => project.slug === 'billing');
  assert.deepEqual([waiting.state, waiting.level, waiting.found], ['proposed', 'critical', 'CI is red on main.']);
});

test('a proposal left from before this version is told when Hobkin opens', async t => {
  const h = fixture(t);
  writeMode(h.root, { enabled: false, folder: h.folder, lastDiscoveryAt: new Date().toISOString() });
  proposeProject(h.root, { ...billing, path: repository(h.folder, 'billing') });

  const hobkin = await openHobkin(h);
  t.after(() => hobkin.close());

  const told = await hobkin.heard(/Work mode proposes 1 project/);
  assert.match(told.content, /CI is red on main/);
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
  await hobkin.settled(() => readItems(h.root, 'billing')[0].state === 'doing', 'the item under way');

  let running = [];
  while (!running.length) running = await hobkinWork('running');

  assert.deepEqual(running.map(run => [run.project, run.item, run.lane, run.level, run.harness]), [['billing', filed.id, 'do', 'critical', 'pi']]);
  assert.equal((await hobkinWork('status')).owner, true);

  const { ok, message } = await hobkinWork('cancel', 'billing');

  assert.equal(ok, true);
  assert.match(message, /requested/i);
  await hobkin.settled(() => readMode(h.root).queueSkipped.includes(`item:billing:${filed.id}`), 'the item put off');
  assert.equal(readItems(h.root, 'billing')[0].state, 'open');

  await hobkin.close();

  assert.equal((await hobkinWork('status')).owner, false);
});

test('the main agent changes the agent limit when asked', async t => {
  const h = fixture(t);
  chooseProject(h.root, '/repos/none');
  writeMode(h.root, { enabled: true, folder: h.folder, lastDiscoveryAt: new Date().toISOString() });
  const script = join(process.cwd(), 'src/cli/main.mjs');
  const hobkin = await openHobkin(h, {
    agent: async () => 'Nothing new.',
    chat: async () => {
      await shell(`${quoted(process.execPath)} ${quoted(script)} work agents 3 --home ${quoted(h.root)}`);
      return 'Work can now run three agents.';
    },
  });
  t.after(() => hobkin.close());

  await hobkin.send('let work mode use three agents');
  await hobkin.heard(/Work can now run three agents/);
  assert.equal(readMode(h.root).agents, 3);
});
