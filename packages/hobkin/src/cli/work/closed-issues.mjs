import { movesFinishedWork, ownerView, readItems, runnableStates, updateItem } from './store.mjs';

// Only issue pickup sets this field. A link in the brief or proof is not the source of the work.
export const queuedIssue = item => item?.issue && runnableStates.includes(item.state) && !movesFinishedWork(item);

async function confirmedClosed(gh, { repo, number }) {
  try {
    const path = `repos/${repo}/issues/${number}`;
    const source = JSON.parse(await gh(['api', path, '--hostname', 'github.com']));
    // The REST issues endpoint also returns pull requests.
    return source?.number === number && source.state === 'closed' && !source.pull_request;
  } catch {
    return false; // Missing, unauthorized or offline is not closed.
  }
}

export async function retireClosedIssues(root, slug, { gh, now }) {
  const dropped = [];
  const running = id => ownerView(root, now).running.some(run => run.slug === slug && run.item === id);
  for (const item of readItems(root, slug).filter(queuedIssue)) {
    if (running(item.id)) continue;
    if (!await confirmedClosed(gh, item.issue)) continue;

    // A run may have started or finished while GitHub answered.
    const current = readItems(root, slug).find(({ id }) => id === item.id);
    if (!queuedIssue(current) || current.state !== item.state || running(item.id)) continue;
    const { repo, number } = item.issue;
    updateItem(root, slug, item.id, { state: 'dropped', reason: `GitHub closed ${repo}#${number}.` }, now);
    dropped.push({ slug, id: item.id });
  }
  return dropped;
}
