import { reply } from './controls.mjs';
import { findProject, nameOf } from './names.mjs';
import { chosenProjects, fileItem, issueMode, pickNext, readItems, readProjects, readState, runnableStates, writeState } from './store.mjs';
import { gitOrNothing } from './tree.mjs';
import { ghWithin } from './unmerged.mjs';

/**
 * GitHub issues as work. The user adds one from the client's GitHub page, and it goes first in the queue like anything added by hand. A taken
 * project set to pick them up files its new open issues by itself, as ordinary items: auto-pick, a pause, the budget and every stop decide when
 * they start. Each issue is filed once for good under a key of its own, so neither way files one twice, whatever became of it. Only the user
 * files it again, as a follow-up of its own (`again` on `addIssue`), once the work before it is finished.
 */

// gh costs no tokens, and a project's issues do not change fast enough to be worth asking about more often than this.
const ISSUES_EVERY_MS = 15 * 60000;
const GH_TIMEOUT_MS = 60000;
const defaultGh = ghWithin(GH_TIMEOUT_MS);
// What marks an issue for hobkin on a project that picks up only those.
const ISSUE_LABEL = 'hobkin';
const ISSUE_FIELDS = 'number,title,body,url,labels';
// gh lists 30 issues unless it is told how many, so a project with more open would never have the rest picked up.
const MOST_ISSUES = '1000';
// Enough of an issue's own words to say what is wrong. A longer body is cut at a word.
const MOST_BODY = 4000;
// `owner/name` on github.com, however a remote writes it: https, ssh or the short `git@github.com:` form.
const GITHUB_REMOTE = /^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?github\.com(?::\d+)?[:/]([A-Za-z0-9][\w.-]*)\/([\w.-]+?)(?:\.git)?\/?$/i;
const REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
// A project the user works on speaks for its repository before one only proposed or left alone.
const STATE_ORDER = ['chosen', 'proposed', 'skipped', 'dropped'];

export const githubRepoOf = remote => {
  const [, owner, name] = GITHUB_REMOTE.exec(String(remote ?? '').trim()) ?? [];
  return owner && name ? `${owner}/${name}` : null;
};

/** The project's repository on GitHub: its folder's origin, or the remote hobkin clones. Null for one that is not on github.com. */
export const repoOfProject = async ({ path, remote }) => githubRepoOf(path ? await gitOrNothing(path, 'remote', 'get-url', 'origin') : remote);

/** The project whose repository is `owner/name` on GitHub, in any case, or null when hobkin knows none. */
export async function projectOfRepo(root, repo) {
  const wanted = String(repo).toLowerCase();
  const rank = ({ state }) => (STATE_ORDER.includes(state) ? STATE_ORDER.indexOf(state) : STATE_ORDER.length);
  for (const project of readProjects(root).toSorted((left, right) => rank(left) - rank(right))) {
    if ((await repoOfProject(project))?.toLowerCase() === wanted) return project;
  }
  return null;
}

/** GitHub matches repositories in any case, so the key does too. */
const ISSUE_KEY = 'gh-issue:';
const issueKey = ({ repo, number }) => `${ISSUE_KEY}${repo.toLowerCase()}#${number}`;
const named = ({ repo, number }) => `${repo}#${number}`;
// Each time the user has an issue worked on again is an item of its own, under the issue's key and the count of times it was filed.
const againKey = (issue, times) => `${issueKey(issue)}:again:${times}`;
const isFor = issue => ({ key }) => key === issueKey(issue) || key?.startsWith(`${issueKey(issue)}:again:`);
// Work on an issue that has not finished yet: in the queue, running or waiting to.
const unfinished = [...runnableStates, 'waiting'];

/**
 * What hobkin has filed for GitHub issues, from one read of every project's items: a lookup from an issue's `{ repo, number }` to its item and
 * that item's project, or null for an issue with nothing filed. A taken project speaks for an issue before one only proposed or left alone, and
 * in a project the newest work on an issue, a follow-up, speaks for it.
 */
export function filedIssues(root) {
  const filed = new Map();
  const rank = ({ state }) => (STATE_ORDER.includes(state) ? STATE_ORDER.indexOf(state) : STATE_ORDER.length);
  for (const project of readProjects(root).toSorted((left, right) => rank(right) - rank(left))) {
    for (const item of readItems(root, project.slug)) {
      if (item.key?.startsWith(ISSUE_KEY)) filed.set(item.issue ? issueKey(item.issue) : item.key, { project, item });
    }
  }
  return issue => filed.get(issueKey(issue)) ?? null;
}

const labelNames = labels => (Array.isArray(labels) ? labels : []).map(label => String((typeof label === 'string' ? label : label?.name) ?? '').toLowerCase());

function kindOf(labels) {
  const names = labelNames(labels);
  const has = word => names.some(name => new RegExp(`\\b${word}\\b`).test(name));
  if (has('security')) return 'security';
  return has('bug') ? 'fix' : 'improvement';
}

const atAWord = (text, most) => (text.length <= most ? text : `${text.slice(0, most - 1).replace(/\s*\S*$/, '')}…`);

/** The issue's own words, without what its template left in comments, its blank lines and its length kept in check. */
const plainBody = body => atAWord(String(body ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim(), MOST_BODY);

/** An issue as hobkin files it, from what the client or gh sends. Null when its repository, number or title is missing. */
function issueOf({ repo, number, title, body, url, labels } = {}) {
  const heading = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!REPO.test(String(repo ?? '')) || !Number.isInteger(number) || number < 1 || !heading) return null;
  const link = typeof url === 'string' && url.startsWith('https://github.com/') ? url : `https://github.com/${repo}/issues/${number}`;
  return { repo, number, title: heading, body: plainBody(body), url: link, labels };
}

/** `earlier` is the work on the issue before this, its items in the order they were filed, for a follow-up. */
function fileIssue(root, slug, issue, now, earlier = []) {
  const { repo, number, title, body, url, labels } = issue;
  const last = earlier.at(-1);
  const followUp = last && `Follow-up on ${named(issue)}. The earlier work on it, ${last.id}, is ${last.state}${last.pr ? `, in ${last.pr}` : ''}.`;
  return fileItem(root, slug, {
    key: last ? againKey(issue, earlier.length + 1) : issueKey(issue),
    kind: kindOf(labels),
    title: last ? `Follow-up: ${title}` : title,
    brief: [followUp, title, body, url].filter(Boolean).join('\n\n'),
    issue: { repo, number, url },
  }, now);
}

/**
 * The user's word, from the GitHub page: the issue goes first in the queue, as an item added by hand does. Added again it changes nothing, and
 * says so. With `again`, once the work on it before is finished, it is filed once more as a follow-up that says what that work came to.
 */
export function addIssue(root, reference, value, now = Date.now()) {
  const project = findProject(root, reference);
  const issue = issueOf(value);
  if (!issue) throw Error('An issue needs its repository as owner/name, its number and its title.');
  const { slug } = project;
  const earlier = readItems(root, slug).filter(isFor(issue));
  const before = earlier.at(-1);
  if (before && value.again !== true) {
    return reply(`${named(issue)} is already filed on ${nameOf(project)} as ${before.id}, ${before.state}. Nothing changed.`, { slug, id: before.id });
  }
  if (before && unfinished.includes(before.state)) {
    return reply(`${named(issue)} is still in work on ${nameOf(project)} as ${before.id}, ${before.state}. Nothing changed.`, { slug, id: before.id });
  }

  const filed = fileIssue(root, slug, issue, now, earlier);
  if (project.state === 'chosen') pickNext(root, `item:${slug}:${filed.id}`);
  const next = project.state === 'chosen'
    ? 'It goes first in the queue, after anything picked before it.'
    : `Nothing runs until ${nameOf(project)} is taken.`;
  const added = before ? `Added a follow-up on ${named(issue)}` : `Added "${filed.title}" from ${named(issue)}`;
  return reply(`${added} to ${nameOf(project)} as ${filed.id}. ${next}`, { slug, id: filed.id });
}

/** A gh that is missing, signed out or offline has no issues to give, and the next pass asks again. */
async function openIssues(gh, { path }, repo, mode) {
  const labeled = mode === 'labeled' ? ['--label', ISSUE_LABEL] : [];
  try {
    const list = JSON.parse(await gh(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', MOST_ISSUES, '--json', ISSUE_FIELDS, ...labeled], path));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const due = (root, { slug }, now) => {
  const { lastIssuesAt } = readState(root, slug);
  return !lastIssuesAt || now - Date.parse(lastIssuesAt) >= ISSUES_EVERY_MS;
};

/**
 * Code only: gh reads the open issues of each taken project that picks them up, at most every 15 minutes a project, and the new ones are filed.
 * A paused project is left alone. The caller holds the whole pass while anything holds work. Returns what was filed.
 */
export async function fileOpenIssues(root, { now = Date.now(), gh = defaultGh } = {}) {
  const filed = [];
  for (const project of chosenProjects(root)) {
    const mode = issueMode(project);
    if (mode === 'off' || project.paused || !due(root, project, now)) continue;
    // Stamped first, so a gh that fails is asked again after the wait, never on every tick.
    writeState(root, project.slug, { lastIssuesAt: new Date(now).toISOString() });
    const repo = await repoOfProject(project);
    if (!repo) continue;

    const known = new Set(readItems(root, project.slug).map(({ key }) => key));
    for (const issue of (await openIssues(gh, project, repo, mode)).map(row => issueOf({ ...row, repo }))) {
      if (!issue || known.has(issueKey(issue))) continue;
      known.add(issueKey(issue));
      filed.push({ slug: project.slug, ...fileIssue(root, project.slug, issue, now) });
    }
  }
  return filed;
}
