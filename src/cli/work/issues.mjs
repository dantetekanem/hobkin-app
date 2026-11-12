import { reply } from './controls.mjs';
import { findProject, nameOf } from './names.mjs';
import { chosenProjects, fileItem, issueMode, pickNext, readItems, readProjects, readState, writeState } from './store.mjs';
import { gitOrNothing } from './tree.mjs';
import { ghWithin } from './unmerged.mjs';

/**
 * GitHub issues as work. The user adds one from the client's GitHub page, and it goes first in the queue like anything added by hand. A taken
 * project set to pick them up files its new open issues by itself, as ordinary items: auto-pick, a pause, the budget and every stop decide when
 * they start. Each issue is filed once for good under a key of its own, so neither way files one twice, whatever became of it.
 */

// gh costs no tokens, and a project's issues do not change fast enough to be worth asking about more often than this.
const ISSUES_EVERY_MS = 15 * 60000;
const GH_TIMEOUT_MS = 60000;
const defaultGh = ghWithin(GH_TIMEOUT_MS);
// What marks an issue for hobkin on a project that picks up only those.
const ISSUE_LABEL = 'hobkin';
const ISSUE_FIELDS = 'number,title,body,url,labels';
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
const issueKey = ({ repo, number }) => `gh-issue:${repo.toLowerCase()}#${number}`;
const named = ({ repo, number }) => `${repo}#${number}`;

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

function fileIssue(root, slug, issue, now) {
  const { repo, number, title, body, url, labels } = issue;
  return fileItem(root, slug, {
    key: issueKey(issue),
    kind: kindOf(labels),
    title,
    brief: [title, body, url].filter(Boolean).join('\n\n'),
    issue: { repo, number, url },
  }, now);
}

/** The user's word, from the GitHub page: the issue goes first in the queue, as an item added by hand does. Added again it changes nothing, and says so. */
export function addIssue(root, reference, value, now = Date.now()) {
  const project = findProject(root, reference);
  const issue = issueOf(value);
  if (!issue) throw Error('An issue needs its repository as owner/name, its number and its title.');
  const { slug } = project;
  const before = readItems(root, slug).find(item => item.key === issueKey(issue));
  if (before) return reply(`${named(issue)} is already filed on ${nameOf(project)} as ${before.id}, ${before.state}. Nothing changed.`, { slug, id: before.id });

  const filed = fileIssue(root, slug, issue, now);
  if (project.state === 'chosen') pickNext(root, `item:${slug}:${filed.id}`);
  const next = project.state === 'chosen'
    ? 'It goes first in the queue, after anything picked before it.'
    : `Nothing runs until ${nameOf(project)} is taken.`;
  return reply(`Added "${filed.title}" from ${named(issue)} to ${nameOf(project)} as ${filed.id}. ${next}`, { slug, id: filed.id });
}

/** A gh that is missing, signed out or offline has no issues to give, and the next pass asks again. */
async function openIssues(gh, { path }, repo, mode) {
  const labeled = mode === 'labeled' ? ['--label', ISSUE_LABEL] : [];
  try {
    const list = JSON.parse(await gh(['issue', 'list', '--repo', repo, '--state', 'open', '--json', ISSUE_FIELDS, ...labeled], path));
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
