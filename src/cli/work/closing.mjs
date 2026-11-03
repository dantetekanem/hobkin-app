import { pulseLaunches } from './launches.mjs';
import { readyItems, weighedRows } from './reads.mjs';
import { fileItem, ownerView, readItems, readMode, retryItem, runnableStates, updateItem } from './store.mjs';
import { surveyUnmerged } from './unmerged.mjs';

// The rows the user sees next. Filling in any more would pay for work they may never ship.
const NEXT_ROWS = 5;
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
 * quality, it is not asked for again: no grade came of it, and another would cost a whole run. Markdown alone has nothing for a review to grade.
 */
const lacksAGrade = row => LANDS.includes(row.gap) && Boolean(row.head) && !row.onlyDocs && (!row.safety || row.safety.stale);
const askedOrReviewedAt = (item, head) => item.reviewAsked || item.reviewAskedFor === head || item.quality?.head === head;
const wantsAReview = ({ row, item }) => lacksAGrade(row) && !askedOrReviewedAt(item, row.head);

// A run that has recorded its outcome is still going, and decides on its own review as it ends.
// A review asked earlier in this pass puts its item back in the queue, so its branch is taken.
const beingWorkedOn = (root, { slug, item, branch }, running) => running.some(run => run.slug === slug && run.item === item)
  || readItems(root, slug).some(other => other.branch === branch && runnableStates.includes(other.state));

/**
 * A branch earns its review as its run ends, so one that missed that moment gets it here: one finished before reviews existed, one the survey adopted,
 * one a closed PR left, or one whose run a restart cut short. The item keeps the commit it was asked for, so a review that ends with no grade is not
 * asked again until the branch moves. These are the writes `hobkin work review` makes, so each review goes to the front of the queue.
 */
function askReviews(root, now = Date.now()) {
  // With the mode off nothing new starts, and with reviews off one runs only when the user asks.
  const { enabled, reviewOnFinish } = readMode(root);
  if (!enabled || reviewOnFinish === false) return [];

  const { running } = ownerView(root);
  const asked = [];
  for (const { row } of weighedRows(root, now).filter(wantsAReview)) {
    if (asked.length === REVIEWS_A_PASS) break;
    if (beingWorkedOn(root, row, running)) continue;
    updateItem(root, row.slug, row.item, { reviewAsked: true, reviewAskedFor: row.head }, now);
    retryItem(root, row.slug, row.item, now);
    asked.push({ slug: row.slug, id: row.item, title: row.title, branch: row.branch });
  }
  return asked;
}

/**
 * The survey, what it showed needs closing, the reviews it showed were missed, then the pulse on what has landed. These write only hobkin's own
 * records. `reviews: false` is a sync someone asked for: asking hobkin something must never start a review, so those wait for work mode's own survey.
 */
export async function surveyAndClose(root, options = {}) {
  const survey = await surveyUnmerged(root, options);
  const filled = fillGaps(root, options.now);
  // After the gaps, so a branch an agent is describing keeps that one agent, and gets its review on a pass after that is done.
  const reviewing = options.reviews === false ? [] : askReviews(root, options.now);
  const pulse = await pulseLaunches(root, options);
  return { ...survey, filed: [...survey.filed, ...filled], reviewing, pulse };
}
