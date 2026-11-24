import { existsSync } from 'node:fs';
import { pulseLaunches } from './launches.mjs';
import { readyItems, saysDoneButWaits } from './reads.mjs';
import { chosenProjects, fileItem, itemTree, paths, readItems, updateItem } from './store.mjs';
import { realPlace, retireTree } from './tree.mjs';
import { readUnmerged, surveyUnmerged } from './unmerged.mjs';

// The rows the user sees next. Filling in any more would pay for work they may never ship.
const NEXT_ROWS = 5;
// No run comes for an item in one of these, so its tree holds nothing a run still needs.
const CLOSED = ['merged', 'done', 'declined', 'dropped'];

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

/**
 * The survey, what it showed needs closing, then the pulse on what has landed. These write only hobkin's own records. No review starts here: Change
 * Review rates each finished change itself, and hobkin's own scored run starts only from a card's Review button.
 */
export async function surveyAndClose(root, options = {}) {
  const survey = await surveyUnmerged(root, options);
  restoreWaitingWork(root, options.now);
  const filled = fillGaps(root, options.now);
  const pulse = await pulseLaunches(root, options);
  return { ...survey, filed: [...survey.filed, ...filled], pulse };
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
