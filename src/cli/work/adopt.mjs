import { findProject, nameOf } from './names.mjs';
import { fileItem, ownerView, paths, readItems, updateItem } from './store.mjs';
import { defaultBranch, gitOrNothing, isMerged } from './tree.mjs';
import { landingTip } from './unmerged.mjs';

/**
 * A branch an agent made outside work mode, such as a `hobkin session`'s, registered as finished work, so it goes the way hobkin's own does:
 * its review, a fix if the review finds it risky, the merge on the user's yes, "Deploy now?" and its issue's closing. The branch keeps its name,
 * since the survey reads any branch a finished item names, and nothing on it is moved or rewritten. It has to be a real local branch holding
 * commits the default branch lacks, and one no open item names yet. The issue an item came from stays hobkin's or the user's word, so `issue`
 * only says which of hobkin's own items for an issue the branch is for, and it puts the branch there.
 */

// Items nothing works on any more, so their branch is free to name again.
const OVER = ['merged', 'done', 'declined', 'dropped'];
const KINDS_OF_WORK = ['security', 'fix', 'update', 'chore', 'improvement', 'feature'];
const SHORT_SHA = 7;

const isText = text => typeof text === 'string' && text.trim().length > 0;
// A name only: never an option, a range or a ref outside refs/heads.
const isBranchName = name => typeof name === 'string' && /^[\w][\w./-]*$/.test(name) && !name.includes('..') && !/[/.]$/.test(name) && !name.endsWith('.lock');
const sameIssue = ({ repo, number }) => item => item.issue?.repo === repo && item.issue?.number === number;

function issueOf(issue) {
  if (issue === undefined) return null;
  const { repo, number } = issue ?? {};
  if (typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && Number.isInteger(number) && number > 0) return { repo, number };
  throw Error('issue is { "repo": "owner/name", "number": 12 }, the GitHub issue the branch is for.');
}

/** The local branch's commit, checked to be work the default branch lacks. */
async function branchTip(repo, project, branch) {
  const base = await defaultBranch(repo);
  if (branch === base) throw Error(`${branch} is the default branch, so there is no finished work on it to register.`);
  const tip = await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (!tip) throw Error(`${nameOf(project)} has no local branch ${branch}, so nothing was registered.`);
  const landing = await landingTip(repo, base);
  if (landing && await isMerged(repo, tip, landing)) throw Error(`${branch} holds nothing ${base} lacks, so nothing was registered.`);
  return tip;
}

/** hobkin's own open item for the issue, when there is one, and it can take this branch. */
function issueItem(root, project, items, issue) {
  const item = items.find(entry => !OVER.includes(entry.state) && sameIssue(issue)(entry));
  if (!item) return null;
  if (item.branch && ['branch', 'pr'].includes(item.state)) throw Error(`"${item.title}" already has its own branch, ${item.branch}, so nothing was registered.`);
  if (ownerView(root).running.some(run => run.slug === project.slug && run.item === item.id)) throw Error(`An agent is working on "${item.title}" now, so nothing was registered.`);
  return item;
}

export async function adoptBranch(root, reference, { title, branch, state = 'branch', summary, proof, kind = 'chore', issue: named }, now = Date.now()) {
  const project = findProject(root, reference);
  const issue = issueOf(named);
  if (![title, summary, proof].every(isText)) throw Error('A branch is registered with its title, summary and proof.');
  if (!isBranchName(branch)) throw Error('branch is the name of a local branch.');
  if (state !== 'branch') throw Error('A branch is registered as finished work, with state branch.');
  if (!KINDS_OF_WORK.includes(kind)) throw Error(`kind must be one of: ${KINDS_OF_WORK.join(', ')}`);

  const repo = project.path ?? paths(root, project.slug).clone;
  const tip = await branchTip(repo, project, branch);
  const items = readItems(root, project.slug);
  const known = items.find(item => item.branch === branch && !OVER.includes(item.state));
  if (known) throw Error(`${branch} is already "${known.title}", item ${known.id}. Pipe { "id": "${known.id}", ... } to change it.`);

  const finished = { state: 'branch', branch, summary: summary.trim(), proof: proof.trim(), attempts: 0, lastError: null };
  const own = issue ? issueItem(root, project, items, issue) : null;
  const item = own ?? fileItem(root, project.slug, { key: `adopted:${branch}:${tip.slice(0, SHORT_SHA)}`, kind, title: title.trim(), brief: summary.trim() }, now);
  updateItem(root, project.slug, item.id, finished, now);

  const where = own ? `, the item for ${issue.repo}#${issue.number}` : '';
  const unlinked = issue && !own ? ` hobkin has no item for ${issue.repo}#${issue.number}, so it is not linked: the user adds the issue from the GitHub page.` : '';
  const message = `Registered ${branch} on ${nameOf(project)} as finished work: "${item.title}"${where}. It waits with the rest of the finished work for its review and the user's yes.${unlinked}`;
  return { ok: true, id: item.id, message };
}
