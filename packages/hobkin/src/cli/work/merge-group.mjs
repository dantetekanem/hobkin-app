import { mergeItem, mergePullRequest, reply, toldOf } from './controls.mjs';
import { shownTitle } from './groups.mjs';
import { nameOf } from './names.mjs';
import { refreshThenMerge } from './refresh.mjs';
import { readItems, readProject } from './store.mjs';

// The states each way of landing starts from. A row in none of them has already left the list, often brought along by a merge before it.
const startsFrom = { merge: ['branch'], mergePr: ['pr'], refreshMerge: ['branch', 'pr'] };
const failedDid = { merge: 'could not merge it', mergePr: 'could not merge it', refreshMerge: 'could not refresh it' };
const failedWords = { merge: 'did not merge', mergePr: 'did not merge', refreshMerge: 'could not be refreshed' };

const plural = (amount, one, many) => (amount === 1 ? one : many);

function carryOut(root, { slug, item, how, head = null, read = 'none', readMs = 0 }, { now, gh }) {
  if (how === 'mergePr') return mergePullRequest(root, slug, item, { head, gh, now });
  if (how === 'refreshMerge') return refreshThenMerge(root, slug, item, { read, readMs, now });
  return mergeItem(root, slug, item, { route: 'group', head, read, readMs, now });
}

/** A row that could not go names its work and project, then says why in the words its merge or refresh used. */
function whyNot(project, { title }, how, message) {
  const named = `"${title}" `;
  const reason = message.startsWith(named) ? message.slice(named.length) : `${failedWords[how]}: ${message}`;
  return `"${shownTitle(title)}" on ${nameOf(project)} ${reason}`;
}

async function landRow(root, row, options) {
  const project = readProject(root, row.slug);
  const item = project ? readItems(root, row.slug).find(({ id }) => id === row.item) : null;
  const stillListed = Boolean(item) && startsFrom[row.how].includes(item.state);
  if (!stillListed) return { row, gone: true };

  try {
    return { row, result: await carryOut(root, row, options) };
  } catch (error) {
    return { row, failed: toldOf(project, item, failedDid[row.how], whyNot(project, item, row.how, error.message)) };
  }
}

function mergedLine(here, onHost, tried) {
  const merged = here + onHost;
  if (!merged) return '';
  const howMany = merged < tried ? `${merged} of ${tried}` : plural(tried, 'it', `all ${tried}`);
  if (here && onHost) return `Merged ${howMany}: ${here} here, with nothing pushed, and ${onHost} ${plural(onHost, 'PR', 'PRs')} on GitHub.`;
  return here ? `Merged ${howMany} here, with nothing pushed.` : `Merged ${howMany} on GitHub.`;
}

/** The one line that sums up a group, after a line for each row it tried. */
function sumOf(outcomes) {
  const gone = outcomes.filter(outcome => outcome.gone).length;
  if (gone === outcomes.length) return `${plural(gone, 'It', `All ${gone}`)} had already gone from the list, so nothing changed.`;

  const went = how => outcomes.filter(({ row, result }) => result && row.how === how);
  const refreshed = went('refreshMerge');
  const handed = refreshed.filter(({ result }) => result.handOff).length;
  const queued = refreshed.length - handed;
  const failed = outcomes.filter(outcome => outcome.failed).length;
  return [
    mergedLine(went('merge').length, went('mergePr').length, outcomes.length - gone),
    queued && `${queued} ${plural(queued, 'goes', 'go')} to an agent to be brought up to date, and hobkin merges ${plural(queued, 'it', 'each')} once that run ends well.`,
    handed && `${handed} ${plural(handed, 'goes', 'go')} to the main agent to hand to a session, because work mode cannot start ${plural(handed, 'it', 'them')}.`,
    failed && `${failed} did not go, and ${plural(failed, 'its line says', 'their lines say')} why.`,
    gone && `${gone} had already gone from the list.`,
  ].filter(Boolean).join(' ');
}

/**
 * The user's one yes on exactly these rows, each at the commit its card showed. They go in turn, because a merge moves the base the next one lands on.
 * One that cannot go says why and the rest still go: each lands whole or changes nothing, and rows of a group stand apart, so stopping would only leave
 * work undone. Each row is told the way its own card's choice would be. The line that sums them up is for Chat alone, since the rows tell the main agent.
 */
export async function mergeGroup(root, rows, { now = Date.now(), gh } = {}) {
  const outcomes = [];
  for (const row of rows) outcomes.push(await landRow(root, row, { now, gh }));

  const line = sumOf(outcomes);
  const eachRow = outcomes.map(({ result, failed }) => result?.told ?? failed).filter(Boolean);
  const sum = { did: 'summed up a group', line, heard: true };
  return reply(line, {
    told: [...eachRow, sum],
    handOff: outcomes.map(({ result }) => result?.handOff).filter(Boolean),
    walked: outcomes.filter(({ result }) => result).map(({ row: { how, slug, item } }) => ({ action: how, slug, item })),
  });
}
