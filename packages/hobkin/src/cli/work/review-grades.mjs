import { keptReview } from './classified.mjs';
import { readItems, updateItem } from './store.mjs';
import { readUnmerged } from './unmerged.mjs';

/**
 * The door Change Review's ratings come in by (spec 063). After a change's review finishes, the host calls `recordGrades` with its five scores and
 * kind. It is not a `hobkin work` command and no tool names it, and the `item` command takes no `review` from a run, so no
 * agent writes a grade. YOLO mode reads a review only when it says `by: 'change-review'`, which only this writes.
 */

export const GRADED_BY = 'change-review';
// Finished work waiting to merge, as a branch or as its own pull request.
const FINISHED = ['branch', 'pr'];

/** The commit the last survey read for the item's branch or pull request, or null when it read none. */
function currentHead(root, slug, item) {
  const kind = item.state === 'pr' ? 'pr' : 'branch';
  const unit = (readUnmerged(root).projects[slug]?.open ?? []).find(open => open.kind === kind && open.branch === item.branch);
  return unit?.sha ?? null;
}

/**
 * Keeps a change's five scores, its kind and the commit they were made at, as the review of the change at that commit. The answer must carry
 * every score with a line of evidence, a kind and a full commit (`assertReview`). The item must exist and be finished work, and the commit must
 * be the one the survey last read for it, unless the survey has read none. Answers the review as kept, with `by` and `at`.
 */
export function recordGrades(root, slug, id, grades, now = Date.now()) {
  const kept = keptReview(grades);
  const item = readItems(root, slug).find(entry => entry.id === id);
  if (!item) throw Error(`There is no item ${id} on ${slug} to rate.`);
  if (!FINISHED.includes(item.state)) throw Error(`"${item.title}" is ${item.state}, not finished work, so it has nothing to rate yet.`);
  const head = currentHead(root, slug, item);
  if (head && kept.head !== head) throw Error(`The ratings are for ${kept.head.slice(0, 7)}, and "${item.title}" is at ${head.slice(0, 7)} now.`);
  const review = { ...kept, by: GRADED_BY, at: new Date(now).toISOString() };
  updateItem(root, slug, id, { review }, now);
  return review;
}
