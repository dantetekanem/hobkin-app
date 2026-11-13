import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { runWorkCommand, workStatus } from '../src/cli/work/commands.mjs';
import { publishItem } from '../src/cli/work/controls.mjs';
import { addIssue, filedIssues, githubRepoOf, projectOfRepo } from '../src/cli/work/issues.mjs';
import { projectsView } from '../src/cli/work/reads.mjs';
import {
  chooseProject, prFile, paths, proposeProject, readItems, readMode, readProject, recordTokens, setProjectIssues, setProjectPaused, updateItem, writeMode,
} from '../src/cli/work/store.mjs';
import { fakePi } from './helpers/pi-session.mjs';
import { director, studied } from './helpers/work-director.mjs';
import { branched, git, repository, withOrigin } from './helpers/work-fixture.mjs';

// GitHub issues as work: one the user adds from the GitHub page goes first in the queue, and a project set to pick them up files its new open issues
// by itself. Each issue is filed once for good. Nothing here reaches GitHub: gh is always the test's.

const NOW = Date.parse('2026-06-01T12:00:00Z');
const MINUTE = 60000;

/** An issue as the client sends it from the GitHub page. */
const issue = (number, details = {}) => ({
  repo: 'acme/api', number, title: `Issue ${number}`, body: '', url: `https://github.com/acme/api/issues/${number}`, labels: [], ...details,
});

/** An open issue as `gh issue list --json number,title,body,url,labels` prints one. */
const listed = (number, details = {}) => ({
  number, title: `Issue ${number}`, body: `What goes wrong in ${number}.`, url: `https://github.com/acme/api/issues/${number}`, labels: [], ...details,
});

// gh lists 30 issues unless it is told how many: a project with more open would never have the rest picked up.
const ISSUE_LIST = ['issue', 'list', '--repo', 'acme/api', '--state', 'open', '--limit', '1000', '--json', 'number,title,body,url,labels'];

function home(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-issues-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  mkdirSync(root);
  return { base, root };
}

/** A project taken by its remote on GitHub, which hobkin would clone on its first run. Nothing here clones or fetches it. */
function taken(root, name, remote = `https://github.com/acme/${name}.git`) {
  proposeProject(root, { name, remote, level: 'important' });
  return chooseProject(root, name);
}

test('an issue added from the GitHub page is filed on its project, first in the queue, and adding it again changes nothing', t => {
  const { root } = home(t);
  taken(root, 'api');

  const added = addIssue(root, 'api', issue(12, {
    title: 'Login fails after a password reset',
    body: '  Steps:\r\n\r\n\r\n1. Reset the password <!-- from the issue template -->\n',
    labels: ['bug', 'checkout'],
  }));

  const [item] = readItems(root, 'api');
  assert.equal(added.message, `Added "Login fails after a password reset" from acme/api#12 to api as ${item.id}. It goes first in the queue, after anything picked before it.`);
  assert.deepEqual({ key: item.key, kind: item.kind, title: item.title, brief: item.brief, issue: item.issue, state: item.state }, {
    key: 'gh-issue:acme/api#12',
    kind: 'fix',
    title: 'Login fails after a password reset',
    brief: 'Login fails after a password reset\n\nSteps:\n\n1. Reset the password\n\nhttps://github.com/acme/api/issues/12',
    issue: { repo: 'acme/api', number: 12, url: 'https://github.com/acme/api/issues/12' },
    state: 'open',
  });
  assert.deepEqual(readMode(root).queueNext, [`item:api:${item.id}`]);

  const again = addIssue(root, 'api', issue(12, { title: 'Login fails after a password reset' }));
  assert.equal(again.message, `acme/api#12 is already filed on api as ${item.id}, open. Nothing changed.`);
  addIssue(root, 'api', issue(12, { repo: 'Acme/API' }));
  updateItem(root, 'api', item.id, { state: 'dropped' });
  assert.match(addIssue(root, 'api', issue(12)).message, /already filed on api as [0-9a-f]{6}, dropped\. Nothing changed\.$/);
  assert.deepEqual(readItems(root, 'api').map(({ state }) => state), ['dropped'], 'one item, in whatever case the repository is written');
});

test('the work filed for an issue is found by the issue, in any case, with its project, and a taken project speaks for it first', t => {
  const { root } = home(t);
  proposeProject(root, { name: 'old-api', remote: 'https://github.com/acme/api.git', level: 'casual' });
  addIssue(root, 'old-api', issue(12));
  taken(root, 'api');
  const { id } = addIssue(root, 'api', issue(12));
  addIssue(root, 'api', issue(13));
  updateItem(root, 'api', id, { state: 'pr', pr: 'https://example.invalid/pull/3' });

  const filedFor = filedIssues(root);

  const { project, item } = filedFor({ repo: 'Acme/API', number: 12 });
  assert.deepEqual([project.slug, item.id, item.state, item.pr], ['api', id, 'pr', 'https://example.invalid/pull/3']);
  assert.equal(filedFor({ repo: 'acme/api', number: 13 }).item.state, 'open');
  assert.equal(filedFor({ repo: 'acme/api', number: 14 }), null, 'an issue with nothing filed');
  assert.equal(filedFor({ repo: 'acme/web', number: 12 }), null, 'the same number on another repository');
});

test('an issue is a fix when labeled a bug, security work when labeled security, and an improvement otherwise', t => {
  const { root } = home(t);
  taken(root, 'api');

  for (const [number, labels] of [[1, ['Bug']], [2, ['bug', 'security']], [3, [{ name: 'type: security' }]], [4, ['enhancement']], [5, []]]) {
    addIssue(root, 'api', issue(number, { labels }));
  }

  assert.deepEqual(readItems(root, 'api').map(({ kind }) => kind), ['fix', 'security', 'security', 'improvement', 'improvement']);
});

test('an issue on a project not taken yet is filed, and waits until it is taken', t => {
  const { root } = home(t);
  proposeProject(root, { name: 'api', remote: 'https://github.com/acme/api.git', level: 'important' });

  const { message } = addIssue(root, 'api', issue(7));

  assert.match(message, /^Added "Issue 7" from acme\/api#7 to api as [0-9a-f]{6}\. Nothing runs until api is taken\.$/);
  assert.deepEqual(readMode(root).queueNext, []);
});

test('an issue needs its repository, its number and its title, and a project hobkin knows', t => {
  const { root } = home(t);
  taken(root, 'api');

  for (const wrong of [issue(1, { repo: 'acme' }), issue(0), issue(1, { title: '  ' })]) {
    assert.throws(() => addIssue(root, 'api', wrong), /^Error: An issue needs its repository as owner\/name, its number and its title\.$/);
  }
  assert.throws(() => addIssue(root, 'nowhere', issue(1)), /Unknown project: nowhere/);
  assert.deepEqual(readItems(root, 'api'), []);
});

test("a project is found by its repository on GitHub, from its folder's origin or the remote hobkin clones, in any case", async t => {
  const { base, root } = home(t);
  const checkout = repository(base, 'web');
  git(checkout, 'remote', 'add', 'origin', 'git@github.com:Acme/Web.git');
  chooseProject(root, checkout, 'important');
  taken(root, 'api');
  chooseProject(root, repository(base, 'docs'), 'casual');

  assert.equal((await projectOfRepo(root, 'acme/web'))?.slug, 'web');
  assert.equal((await projectOfRepo(root, 'ACME/api'))?.slug, 'api');
  assert.equal(await projectOfRepo(root, 'acme/docs'), null, 'a folder with no origin is on no repository');

  const remotes = [
    ['https://github.com/acme/api.git', 'acme/api'],
    ['https://github.com/acme/api/', 'acme/api'],
    ['git@github.com:acme/api.git', 'acme/api'],
    ['ssh://git@github.com:22/acme/my.repo.git', 'acme/my.repo'],
    ['https://gitlab.com/acme/api.git', null],
    ['/srv/git/api.git', null],
  ];
  for (const [remote, repo] of remotes) assert.equal(githubRepoOf(remote), repo, remote);
});

test("picking up issues is off until the user sets it, and every read of a project's settings says it", t => {
  const { root } = home(t);
  taken(root, 'api');
  taken(root, 'web');
  const setting = slug => ({
    projects: projectsView(root).find(row => row.slug === slug).issues,
    status: workStatus(root).projects.find(row => row.slug === slug).issues,
  });

  setProjectIssues(root, 'api', 'labeled');

  assert.deepEqual(setting('api'), { projects: 'labeled', status: 'labeled' });
  assert.deepEqual(setting('web'), { projects: 'off', status: 'off' });
  assert.throws(() => setProjectIssues(root, 'api', 'some'), /Issue pickup must be one of: off, labeled, all/);
  assert.throws(() => setProjectIssues(root, 'nowhere', 'all'), /Unknown project: nowhere/);
  assert.equal(readProject(root, 'api').issues, 'labeled');
});

test('an agent cannot file its own work as an issue, and a proposal cannot turn picking up issues on', async t => {
  const { root } = home(t);
  taken(root, 'api');
  const said = (args, value) => runWorkCommand(root, args, Readable.from([JSON.stringify(value)]));

  const filed = await said(['item', 'api'], { key: 'gh-issue:acme/api#9', kind: 'fix', title: 'Close an issue', brief: 'Says it fixes one.', issue: { repo: 'acme/api', number: 9 } });
  await said(['item', 'api'], { id: filed.id, issue: { repo: 'acme/api', number: 10 } });
  await said(['propose'], { name: 'web', path: '/repos/web', level: 'casual', summary: 'About web.', issues: 'all' });

  assert.equal(readItems(root, 'api')[0].issue, undefined);
  assert.equal(readProject(root, 'web').issues, undefined);
});

/** A project with an origin of its own on disk and a finished branch for each issue, so a push goes nowhere but this test's folder. */
function publishing(t) {
  const { base, root } = home(t);
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  withOrigin(base, checkout);
  chooseProject(root, checkout, 'important', NOW);
  const finished = (number, branch) => {
    branched(checkout, branch, `${number}.txt`, `${number}\n`);
    const { id } = addIssue(root, 'api', issue(number));
    return updateItem(root, 'api', id, { state: 'branch', branch }, NOW);
  };
  const calls = [];
  const gh = async args => {
    calls.push(args);
    if (args[1] === 'list') return '[]';
    if (args[1] === 'create') return 'https://example.invalid/pull/1\n';
    throw Error(`unexpected gh ${args.join(' ')}`);
  };
  return { root, checkout, finished, calls, gh };
}

test('a PR opened for an issue says it fixes that issue, so GitHub closes the issue when the PR merges', async t => {
  const h = publishing(t);
  const described = h.finished(12, 'hobkin/12-fix');
  mkdirSync(paths(h.root, 'api').prs, { recursive: true });
  writeFileSync(prFile(h.root, 'api', described.id), '# Login after a reset\n\nIt signs in after a reset.\n');
  const plain = h.finished(13, 'hobkin/13-fix');

  await publishItem(h.root, 'api', described.id, { gh: h.gh, now: NOW });
  await publishItem(h.root, 'api', plain.id, { gh: h.gh, now: NOW });

  const created = h.calls.filter(args => args[1] === 'create').map(args => args.slice(-2));
  assert.deepEqual(created, [
    ['--body-file', prFile(h.root, 'api', described.id)],
    ['--body', `${plain.brief}\n\nFixes acme/api#13`],
  ]);
  assert.equal(readFileSync(prFile(h.root, 'api', described.id), 'utf8'), '# Login after a reset\n\nIt signs in after a reset.\n\nFixes acme/api#12\n');
});

/** The director's own project, whose folder's origin is acme/api on GitHub. Nothing fetches it, and gh is the test's. */
function onGitHub(h, open) {
  const checkout = studied(h, 'api');
  git(checkout, 'remote', 'add', 'origin', 'https://github.com/acme/api.git');
  // Nothing starts by itself, so the queue only fills.
  writeMode(h.root, { autoPick: false });
  const asked = [];
  h.gh = async args => {
    if (args[0] !== 'issue') throw Error('No PRs here.');
    asked.push(args);
    return JSON.stringify(open());
  };
  return asked;
}

const pickedUp = async h => {
  await h.tick();
  await h.director.pickingUp;
};

test('a project files its new open issues by itself, at most every 15 minutes, and never one issue twice', async t => {
  const h = director(t);
  let open = [listed(1, { labels: [{ name: 'bug' }] }), listed(2)];
  const asked = onGitHub(h, () => open);
  setProjectIssues(h.root, 'api', 'all');

  await pickedUp(h);

  assert.deepEqual(asked, [ISSUE_LIST]);
  assert.deepEqual(readItems(h.root, 'api').map(({ key, kind, brief }) => [key, kind, brief]), [
    ['gh-issue:acme/api#1', 'fix', 'Issue 1\n\nWhat goes wrong in 1.\n\nhttps://github.com/acme/api/issues/1'],
    ['gh-issue:acme/api#2', 'improvement', 'Issue 2\n\nWhat goes wrong in 2.\n\nhttps://github.com/acme/api/issues/2'],
  ]);
  assert.deepEqual(readMode(h.root).queueNext, [], 'what comes in by itself waits its turn in the queue');

  h.clock += 14 * MINUTE;
  await pickedUp(h);
  assert.equal(asked.length, 1, 'not again within 15 minutes');

  updateItem(h.root, 'api', readItems(h.root, 'api')[0].id, { state: 'dropped' });
  open = [...open, listed(3)];
  h.clock += MINUTE;
  await pickedUp(h);

  assert.equal(asked.length, 2);
  assert.deepEqual(readItems(h.root, 'api').map(({ key, state }) => [key, state]), [
    ['gh-issue:acme/api#1', 'dropped'],
    ['gh-issue:acme/api#2', 'open'],
    ['gh-issue:acme/api#3', 'open'],
  ], 'each is filed once, and one the user dropped stays dropped');
});

test('a project set to labeled asks GitHub only for its open issues labeled hobkin', async t => {
  const h = director(t);
  const asked = onGitHub(h, () => [listed(4, { labels: [{ name: 'hobkin' }] })]);
  setProjectIssues(h.root, 'api', 'labeled');

  await pickedUp(h);

  assert.deepEqual(asked, [[...ISSUE_LIST, '--label', 'hobkin']]);
  assert.deepEqual(readItems(h.root, 'api').map(({ key }) => key), ['gh-issue:acme/api#4']);
});

test('nothing is picked up while the setting is off, work mode is off or paused, a stop holds it, its project is paused or the budget is spent', async t => {
  const h = director(t);
  const asked = onGitHub(h, () => [listed(1)]);
  const nothingAsked = async why => {
    await pickedUp(h);
    assert.deepEqual(asked, [], why);
  };

  await nothingAsked('the setting is off');
  setProjectIssues(h.root, 'api', 'all');

  writeMode(h.root, { enabled: false });
  await nothingAsked('work mode is off');
  writeMode(h.root, { enabled: true, pausedAt: new Date(h.clock).toISOString() });
  await nothingAsked('a pause by hand');
  writeMode(h.root, { pausedAt: null, usagePause: { at: new Date(h.clock).toISOString(), until: new Date(h.clock + 60 * MINUTE).toISOString(), reason: 'A usage limit.' } });
  await nothingAsked('a usage limit');
  writeMode(h.root, { usagePause: null });

  setProjectPaused(h.root, 'api', true);
  await nothingAsked('its project is paused');
  setProjectPaused(h.root, 'api', false);

  writeMode(h.root, { dailyTokens: 1000 });
  recordTokens(h.root, { slug: 'api', lane: 'do', tokens: 1000 }, h.clock);
  await nothingAsked("the day's budget is spent");
  writeMode(h.root, { dailyTokens: 100000000 });

  await pickedUp(h);
  assert.equal(asked.length, 1, 'once nothing holds it, it reads them');
});

test("the client sets a project to pick up issues and adds one through hobkin's own work actions", async t => {
  const { base, root } = home(t);
  const config = initialize(root, { cwd: base, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const { slug } = chooseProject(root, repository(base, 'api'), 'important');
  // A survey just ran, and work mode is off, so nothing here runs gh.
  atomicJson(join(root, 'work', 'unmerged.json'), { at: new Date().toISOString(), projects: {} });
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000 });
  try {
    await app.workAction('issues', slug, 'all');
    const { message } = await app.workAction('issue', slug, issue(5));

    assert.equal(readProject(root, slug).issues, 'all');
    assert.match(message, /^Added "Issue 5" from acme\/api#5 to api as [0-9a-f]{6}\. It goes first in the queue/);
  } finally {
    await app.close();
  }
});
