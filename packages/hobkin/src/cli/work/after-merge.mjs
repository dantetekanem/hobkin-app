import { postClientNotice } from '../client-notices.mjs';
import { cardActionFor, followCardAction } from './card-actions.mjs';
import { askToDeploy, awaitDeploy, handDeploys } from './deploys.mjs';
import { nameOf } from './names.mjs';
import { saysWhatIsLeft } from './reads.mjs';
import { readItems, readProjects, updateItem } from './store.mjs';
import { AFTER_MERGE, ghWithin } from './unmerged.mjs';

/**
 * What follows a merge, whatever way the work merged: on this machine, as its PR on GitHub, after a refresh, or found merged by the survey. The
 * item is done the moment it merges, so nothing waits on the user's click. This pass then tells once in Chat what the work's run left for the
 * user, and closes the GitHub issue the work came from: at once on a project that does not deploy, and on one that does, once the deploy that
 * carried it held (`deploys.mjs`). Code only: gh costs no tokens. Each merge is followed once, and what came of it is kept on its item, so a
 * failure is told once and never tried again by itself.
 */

// Reading and closing one issue never needs longer than this.
const GH_TIMEOUT_MS = 60000;
const defaultGh = ghWithin(GH_TIMEOUT_MS);
// The longest line a notice keeps (`client-notices.mjs`). A long note is cut at a word to fit, rather than mid-word.
const LONGEST_LINE = 600;

const { afterMerge: DUE } = AFTER_MERGE;
const isDue = ({ state, afterMerge }) => state === 'merged' && afterMerge === DUE;

const flat = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const firstLine = text => String(text ?? '').trim().split('\n', 1)[0].trim();
const atAWord = (text, most) => (text.length <= most ? text : `${text.slice(0, most - 1).replace(/\s*\S*$/, '')}…`);

/** How a closing comment names other work: by its issue, else its PR, else its title. */
function workNamed(other, { repo }) {
  if (other.issue) return other.issue.repo === repo ? `#${other.issue.number}` : `${other.issue.repo}#${other.issue.number}`;
  return /^https?:\/\//.test(other.pr ?? '') ? other.pr : `"${flat(other.title)}"`;
}

/**
 * What fixed it, for the issue's closing comment: the PR the work merged as, or else the commit it landed as. A change that landed through
 * another commit (`sameChange`) names that commit, and the other work it came with when there is one.
 */
function fixedBy({ pr, landed, branch, issue }, items) {
  const same = landed?.sameChange;
  if (!same) return pr ?? landed?.sha ?? branch;
  const other = same.item && items.find(entry => entry.id === same.item);
  return `${landed.sha}, which landed the same change${other ? ` as ${workNamed(other, issue)}` : ''}`;
}

/** How a closing comment says the deploy that carried the change held. */
const liveWords = ({ commit, minutes, unmonitored }) => `live since its deploy of ${commit.slice(0, 7)}. `
  + (unmonitored ? 'It has no monitoring to watch.' : `Its monitoring held for ${minutes} minutes.`);

/** The state `gh issue view --json state` printed, or null when its answer says none. */
function stateOf(answer) {
  try {
    return JSON.parse(answer)?.state ?? null;
  } catch {
    return null;
  }
}

/**
 * Closes the issue as completed, unless GitHub has closed it already, as it does once a PR that fixes it merges into the default branch. What
 * happened comes back as a sentence for Chat. A failure is one of those sentences, so it never undoes the merge.
 */
async function closeIssue(item, items, gh, deployed = null) {
  const { repo, number } = item.issue;
  const named = `${repo}#${number}`;
  try {
    const state = stateOf(await gh(['issue', 'view', String(number), '--repo', repo, '--json', 'state']));
    if (!state) throw Error('gh did not say whether it is still open.');
    if (state === 'CLOSED') return { issue: 'already', said: `GitHub had already closed ${named}.` };

    const comment = `Fixed by ${fixedBy(item, items)}, merged by hobkin${deployed ? ` and ${liveWords(deployed)}` : '.'}`;
    await gh(['issue', 'close', String(number), '--repo', repo, '--reason', 'completed', '--comment', comment]);
    return { issue: 'closed', said: `Closed ${named} on GitHub.` };
  } catch (error) {
    const why = firstLine(error.stderr || error.message) || 'gh did not say why.';
    return { issue: 'failed', said: `hobkin could not close ${named} on GitHub: ${why}` };
  }
}

/** Whether this pass has more to say of a merge: its issue's closing, or what its run left for the user. A card's line waits for that. */
export const followsUp = item => Boolean(item.issue) || saysWhatIsLeft(item);

/**
 * The one line in Chat for a merge: `opening` says the merge, then what became of its issue, or that it waits for the deploy that carries it,
 * and what is still the user's. Null when there is none of these.
 */
function lineFor(opening, item, closing, deploy) {
  const left = saysWhatIsLeft(item) ? `Still for you: ${flat(item.left)}` : null;
  const waits = deploy && item.issue ? `${item.issue.repo}#${item.issue.number} closes once the deploy that carries it is verified live.` : null;
  if (!closing && !waits && !left) return null;

  const said = [opening, closing?.said, waits].filter(Boolean).join(' ');
  if (!left) return said;

  const room = Math.max(LONGEST_LINE - said.length - 1, 1);
  return `${said} ${atAWord(left, room)}`;
}

/**
 * A card that merged it said so and waits, so what followed joins that line and the merge is said once. A close that failed gives it the blocked
 * tone. With no card, as for a merge found on GitHub, or a card that went alone after waiting, the line says which merge it follows.
 */
function tellFollowUp(root, { project, item, closing, deploy, now }) {
  const tone = closing?.issue === 'failed' ? 'blocked' : 'useful';
  const card = cardActionFor(root, { slug: project.slug, item: item.id });
  if (card?.followed) return;
  if (card && !card.posted) {
    followCardAction(root, card.id, { line: lineFor(card.line, item, closing, deploy) ?? card.line, tone: tone === 'blocked' ? tone : null });
    return;
  }
  const line = lineFor(`Merged "${flat(item.title)}" on ${nameOf(project)}.`, item, closing, deploy);
  if (line) postClientNotice(root, { key: `merged:${project.slug}:${item.id}`, line, tone }, now);
}

/**
 * Closes the issue of each change a deploy carried once that deploy held, as its reading said (`deploys.mjs`), saying in Chat that it is live.
 * Like a close at merge, each is tried once, and what came of it is kept with its deploy.
 */
async function closeLiveIssues(root, { gh, now }) {
  const closed = [];
  for (const project of readProjects(root)) {
    const items = readItems(root, project.slug);
    for (const item of items.filter(({ issue, deploy }) => issue && deploy?.state === 'live' && !deploy.issue)) {
      const closing = await closeIssue(item, items, gh, item.deploy);
      const line = `"${flat(item.title)}" is live on ${nameOf(project)}. ${closing.said}`;
      postClientNotice(root, { key: `deploy-closed:${project.slug}:${item.id}`, line, tone: closing.issue === 'failed' ? 'blocked' : 'useful' }, now);
      updateItem(root, project.slug, item.id, { deploy: { ...item.deploy, issue: closing.issue } }, now);
      closed.push({ slug: project.slug, id: item.id, title: item.title, issue: closing.issue, deployed: true });
    }
  }
  return closed;
}

/**
 * Follows every merge not followed yet, on every project, and answers what it did for each. An item that merged before this pass existed carries
 * no mark, so nothing is told or closed for it now. A merge on a project that deploys waits for its deploy: one "Deploy now?" a project asks for
 * it, a yes to that goes to the main agent through `handOff`, and its issue closes once that deploy held. Only gh is ever waited on, and work
 * with no issue to close needs none, so it is followed first, at once: an issue gh is slow to answer holds back no other merge's line.
 */
export async function afterMerges(root, { now = Date.now(), gh = defaultGh, handOff = null } = {}) {
  const due = readProjects(root).flatMap(project => {
    const items = readItems(root, project.slug);
    return items.filter(isDue).map(item => ({ project, item, items, deploy: awaitDeploy(root, project, item, now) }));
  });
  const needsGh = ({ item, deploy }) => Boolean(item.issue) && !deploy;
  const inTurn = [...due.filter(entry => !needsGh(entry)), ...due.filter(needsGh)];

  const followed = [];
  for (const { project, item, items, deploy } of inTurn) {
    const closing = needsGh({ item, deploy }) ? await closeIssue(item, items, gh) : null;
    tellFollowUp(root, { project, item, closing, deploy, now });

    const came = closing ? { issue: closing.issue } : {};
    updateItem(root, project.slug, item.id, { afterMerge: { at: new Date(now).toISOString(), ...came } }, now);
    followed.push({ slug: project.slug, id: item.id, title: item.title, ...came, ...(deploy ? { deploy: deploy.state } : {}) });
  }
  askToDeploy(root, now);
  if (handOff) handDeploys(root, handOff, now);
  return [...followed, ...await closeLiveIssues(root, { gh, now })];
}
