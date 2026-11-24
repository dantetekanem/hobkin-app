import { existsSync } from 'node:fs';
import { pulseLaunches } from './launches.mjs';
import { scoresHoldAt } from './proofs.mjs';
import { readyItems, saysDoneButWaits, weighedRows } from './reads.mjs';
import { chosenProjects, fileItem, itemTree, ownerView, paths, readItems, readMode, retryItem, runnableStates, updateItem } from './store.mjs';
import { realPlace, retireTree } from './tree.mjs';
import { readUnmerged, surveyUnmerged } from './unmerged.mjs';
import { pullCandidates, pullRequestsMerge } from './yolo-pulls.mjs';
import { reviewsByItself, scoresByItself } from './yolo.mjs';

// The rows the user sees next. Filling in any more would pay for work they may never ship.
const NEXT_ROWS = 5;
// No run comes for an item in one of these, so its tree holds nothing a run still needs.
const CLOSED = ['merged', 'done', 'declined', 'dropped'];
// Each review is a whole run, so a pass asks for a few and the next survey asks for more.
const REVIEWS_A_PASS = 2;
// A `done` item whose branch still holds work is finished work an older run misnamed, so it lands like the rest.
const LANDS = ['land', 'unlanded'];

const describeWork = ({ branch }) => ({
  key: `ship:describe:${branch}`,
  kind: 'pr-fix',
  title: `Describe ${branch}`,
  brief: `${branch} is finished but has no saved description or no recorded proof, so the user cannot decide on it. Run its proof, write the description and record the proof, and change no code.`,
  impact: 'high',
  effort: 'small',
});

/**
 * Rows near the top that cannot be decided on yet get an agent, once each. A key per branch means one that fails stays a gap rather than a loop.
 * A row being closed keeps its place in the five, or each one filed would pull another up behind it and the limit would mean nothing.
 */
export function fillGaps(root, now = Date.now()) {
  const next = readyItems(root).filter(({ gap }) => ['land', 'closing'].includes(gap)).slice(0, NEXT_ROWS);
  const lacking = next.filter(({ gap, described, proved }) => gap === 'land' && (!described || !proved));
  return lacking.flatMap(row => {
    const work = describeWork(row);
    if (readItems(root, row.slug).some(({ key }) => key === work.key)) return [];

    const { id, title } = fileItem(root, row.slug, work, now);
    updateItem(root, row.slug, id, { branch: row.branch, ships: row.item }, now);
    return [{ slug: row.slug, id, title, branch: row.branch }];
  });
}

/**
 * Work that could land with no grade for the commit the survey read. Once a review has been asked for that commit, or has run on it and left its
 * quality, it is not asked for again: no grade came of it, and another would cost a whole run. Markdown alone has nothing for a review to grade,
 * and a review of a commit whose code the head still has, since only models changed after it, still speaks for the head.
 */
const couldLand = row => LANDS.includes(row.gap) && Boolean(row.head) && !row.onlyDocs;
const lacksAGrade = row => couldLand(row) && (!row.safety || row.safety.stale);
// YOLO mode merges nothing a review has not scored, whatever grade Change Review gave it.
const lacksScores = (root, row) => couldLand(row) && scoresByItself(root, row.slug);
const askedOrReviewedAt = (item, head) => item.reviewAsked || item.reviewAskedFor === head || item.quality?.head === head || item.review?.head === head;
const wantsAReview = (root, { row, item, unit }) => (lacksAGrade(row) || lacksScores(root, row)) && !askedOrReviewedAt(item, row.head) && !scoresHoldAt(item.review?.head, unit);

// A run that has recorded its outcome is still going, and decides on its own review as it ends.
// A review asked earlier in this pass puts its item back in the queue, so its branch is taken.
const beingWorkedOn = (root, { slug, item, branch }, running) => running.some(run => run.slug === slug && run.item === item)
  || readItems(root, slug).some(other => other.branch === branch && runnableStates.includes(other.state));

/**
 * With reviews on, a branch earns its review as its run ends, so one that missed that moment gets it here: one finished before reviews existed, one the
 * survey adopted, one a closed PR left, or one whose run a restart cut short. A change waiting on its own open PR gets one the same way. The item keeps
 * the commit it was asked for, so a review that ends with no grade is not asked again until the branch moves. These are the writes `hobkin work
 * review` makes, so each review goes to the front of the queue.
 */
function askReviews(root, now = Date.now()) {
  // With the mode off nothing new starts, and a review runs by itself only once the user turns reviews on, or on a project ready for YOLO mode.
  // A home with no setting is off.
  if (!readMode(root).enabled) return [];

  const { running } = ownerView(root);
  const asked = [];
  // A change waiting on its pull request is one only while YOLO mode takes pull requests (`yolo-pulls.mjs`).
  const pulls = pullRequestsMerge() ? pullCandidates(root) : [];
  for (const { row } of [...weighedRows(root, now), ...pulls].filter(entry => wantsAReview(root, entry))) {
    if (asked.length === REVIEWS_A_PASS) break;
    if (!reviewsByItself(root, row.slug) || beingWorkedOn(root, row, running)) continue;
    updateItem(root, row.slug, row.item, { reviewAsked: true, reviewAskedFor: row.head }, now);
    retryItem(root, row.slug, row.item, now);
    asked.push({ slug: row.slug, id: row.item, title: row.title, branch: row.branch });
  }
  return asked;
}

/**
 * The survey, what it showed needs closing, the reviews it showed were missed, then the pulse on what has landed. These write only hobkin's own
 * records. `launchReviews: false` is a sync someone asked for: asking hobkin something must never start a review, so those wait for work mode's own survey.
 */
/**
 * An item an agent once called done while its branch still waits to merge is finished work, as `done` has meant no change was needed
 * ever since. Left as it was, every card action refused it and it sat in the list for good, so it gets the state a card can act on.
 * One the user closed stays closed.
 */
function restoreWaitingWork(root, now = Date.now()) {
  const { projects } = readUnmerged(root);
  return chosenProjects(root).flatMap(({ slug }) => {
    const items = readItems(root, slug);
    const units = projects[slug]?.open ?? [];
    return items
      .filter(item => saysDoneButWaits(item, items, units))
      .map(item => updateItem(root, slug, item.id, { state: 'branch' }, now));
  });
}

export async function surveyAndClose(root, options = {}) {
  const survey = await surveyUnmerged(root, options);
  restoreWaitingWork(root, options.now);
  const filled = fillGaps(root, options.now);
  // After the gaps, so a branch an agent is describing keeps that one agent, and gets its review on a pass after that is done.
  const reviewing = options.launchReviews === false ? [] : askReviews(root, options.now);
  const pulse = await pulseLaunches(root, options);
  return { ...survey, filed: [...survey.filed, ...filled], reviewing, pulse };
}

/** A project's trees that no run needs any more: each closed item's, and the one every item shared before, once no do run could carry on there. */
function treesNoRunNeeds(root, slug, running) {
  const here = running.filter(run => run.slug === slug);
  const inUse = new Set(here.flatMap(run => [run.cwd, run.tree]).filter(Boolean).map(realPlace));
  const isRunning = item => here.some(run => run.item === item.id);

  const closedTrees = readItems(root, slug)
    .filter(item => CLOSED.includes(item.state) && !isRunning(item))
    .map(item => itemTree(root, slug, item));
  // An item cut short in the old tree carries on there, and a do run getting ready has not said yet where it works.
  const doRunGoing = here.some(run => run.lane === 'do');
  const candidates = doRunGoing ? closedTrees : [...closedTrees, paths(root, slug).oldDoTree];

  return candidates.filter(tree => existsSync(tree) && !inUse.has(realPlace(tree)));
}

/**
 * Takes away every project's trees that no run needs any more, each only when nothing in it could be lost, so one holding work stays and is asked
 * about again next time. Unlike the survey this writes to the repository, because git's record of a tree goes with it. `running` is what the owner has going.
 */
export async function retireClosedTrees(root, { running = [] } = {}) {
  const retired = [];
  for (const { slug, path } of chosenProjects(root)) {
    const repo = path ?? paths(root, slug).clone;
    for (const tree of treesNoRunNeeds(root, slug, running)) {
      if (await retireTree({ repo, tree })) retired.push({ slug, tree });
    }
  }
  return retired;
}
