import { postClientNotice } from '../client-notices.mjs';
import { nameOf } from './names.mjs';
import { saysWhatIsLeft } from './reads.mjs';
import { readItems, readProjects, updateItem } from './store.mjs';
import { AFTER_MERGE, ghWithin } from './unmerged.mjs';

/**
 * What follows a merge, whatever way the work merged: on this machine, as its PR on GitHub, after a refresh, or found merged by the survey. The
 * item is done the moment it merges, so nothing waits on the user's click. This pass then tells once in Chat what the work's run left for the
 * user, and closes the GitHub issue the work came from. Code only: gh costs no tokens. Each merge is followed once, and what came of it is kept
 * on its item, so a failure is told once and never tried again by itself.
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

/** What fixed it, for the issue's closing comment: the PR the work merged as, or else the commit it landed as. */
const fixedBy = ({ pr, landed, branch }) => pr ?? landed?.sha ?? branch;

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
async function closeIssue(item, gh) {
  const { repo, number } = item.issue;
  const named = `${repo}#${number}`;
  try {
    const state = stateOf(await gh(['issue', 'view', String(number), '--repo', repo, '--json', 'state']));
    if (!state) throw Error('gh did not say whether it is still open.');
    if (state === 'CLOSED') return { issue: 'already', said: `GitHub had already closed ${named}.` };

    const comment = `Fixed by ${fixedBy(item)}, merged by hobkin.`;
    await gh(['issue', 'close', String(number), '--repo', repo, '--reason', 'completed', '--comment', comment]);
    return { issue: 'closed', said: `Closed ${named} on GitHub.` };
  } catch (error) {
    const why = firstLine(error.stderr || error.message) || 'gh did not say why.';
    return { issue: 'failed', said: `hobkin could not close ${named} on GitHub: ${why}` };
  }
}

/** The one line in Chat for a merge: what became of its issue and what is still the user's. Null when there is neither. */
function lineFor(project, item, closing) {
  const left = saysWhatIsLeft(item) ? `Still for you: ${flat(item.left)}` : null;
  if (!closing && !left) return null;

  const opening = [`Merged "${flat(item.title)}" on ${nameOf(project)}.`, closing?.said].filter(Boolean).join(' ');
  if (!left) return opening;

  const room = Math.max(LONGEST_LINE - opening.length - 1, 1);
  return `${opening} ${atAWord(left, room)}`;
}

/**
 * Follows every merge not followed yet, on every project, and answers what it did for each. An item that merged before this pass existed carries
 * no mark, so nothing is told or closed for it now. Only gh is ever waited on, and work with no issue needs none, so it is followed first, at
 * once: an issue gh is slow to answer holds back no other merge's line.
 */
export async function afterMerges(root, { now = Date.now(), gh = defaultGh } = {}) {
  const due = readProjects(root).flatMap(project => readItems(root, project.slug)
    .filter(isDue)
    .map(item => ({ project, item })));
  const needsGh = ({ item }) => Boolean(item.issue);
  const inTurn = [...due.filter(entry => !needsGh(entry)), ...due.filter(needsGh)];

  const followed = [];
  for (const { project, item } of inTurn) {
    const closing = item.issue ? await closeIssue(item, gh) : null;

    const line = lineFor(project, item, closing);
    const tone = closing?.issue === 'failed' ? 'blocked' : 'useful';
    if (line) postClientNotice(root, { key: `merged:${project.slug}:${item.id}`, line, tone }, now);

    const came = closing ? { issue: closing.issue } : {};
    updateItem(root, project.slug, item.id, { afterMerge: { at: new Date(now).toISOString(), ...came } }, now);
    followed.push({ slug: project.slug, id: item.id, title: item.title, ...came });
  }
  return followed;
}
