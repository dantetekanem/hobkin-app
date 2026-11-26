import { heldByItsGrade } from './reads.mjs';

const LOCAL_REVIEW = /^Review locally:\s+/;
const GROUPS = ['merge', 'refresh', 'needs'];

/** One batch turned remote PRs into local reviews and put this in front of each title. It says nothing on screen, so a card leaves it out and the item keeps it. */
export function shownTitle(title) {
  const whole = String(title ?? '');
  return whole.replace(LOCAL_REVIEW, '') || whole;
}

/**
 * What one yes on a list may carry: git says nothing is in the way, the commit the card shows is known, so the merge can be pinned to it, there is proof,
 * no grade is against it, nothing is left for the user, no layer under it waits to land first, and it brings no other branch along, so the yes covers exactly what was listed.
 */
const oneYesCarries = entry => entry.conflict === false
  && Boolean(entry.head)
  && entry.proved !== false
  && !heldByItsGrade(entry)
  && !entry.left
  && !entry.unread
  && !entry.stack?.below
  && !entry.holds;

/** `merge` lands as it is, `refresh` is behind its base and goes to an agent first, and `needs` waits for the user to open it. */
const groupOf = entry => {
  if (!oneYesCarries(entry)) return 'needs';
  return entry.behind > 0 ? 'refresh' : 'merge';
};

/** A project's rows sit together, in the order its first row came, so the most urgent row stays on top. */
const byProject = entries => {
  const projects = [...new Set(entries.map(({ slug }) => slug))];
  return projects.flatMap(slug => entries.filter(entry => entry.slug === slug));
};

/** Finished work to approve, in the groups one yes can finish. Each keeps the order it is given within a project, and an empty group is left out. */
export const approvalGroups = entries => GROUPS
  .map(name => ({ name, rows: byProject(entries.filter(entry => groupOf(entry) === name)) }))
  .filter(({ rows }) => rows.length);

/** How a row lands: a branch behind its base after an agent refreshes it, a PR on its host, and any other branch on this machine. */
export function landingWay({ behind, pr }) {
  if (behind > 0) return 'refreshMerge';
  return pr ? 'mergePr' : 'merge';
}

export const groupWords = {
  merge: {
    heading: 'READY TO MERGE',
    name: 'Ready to merge',
    action: count => (count === 1 ? 'Merge this one' : `Merge all ${count}`),
    underWay: count => (count === 1 ? 'Merging it…' : `Merging all ${count}…`),
    why: count => `With proof, no conflict and no grade against ${count === 1 ? 'it' : 'them'}.`,
    question: count => (count === 1 ? 'Merge this one?' : `Merge these ${count}, in this order?`),
    about: 'Each merges at the commit its card showed, or not at all. A branch merges on this machine and pushes nothing, and a PR merges on GitHub. One that cannot merge says why in Chat, and the rest still go.',
  },
  refresh: {
    heading: 'REFRESH THEN MERGE',
    name: 'Refresh then merge',
    action: count => (count === 1 ? 'Refresh and merge this one' : `Refresh and merge all ${count}`),
    underWay: count => (count === 1 ? 'Asking for its refresh…' : `Asking for all ${count} refreshes…`),
    why: count => (count === 1 ? 'Behind its base, so an agent brings it up to date first.' : 'Behind their base, so an agent brings each up to date first.'),
    question: count => (count === 1 ? 'Refresh and merge this one?' : `Refresh and merge these ${count}, in this order?`),
    about: 'An agent brings each up to date with its base and runs its proof again, and hobkin merges it once that run ends well. With work mode off or paused, the main agent hands each to a session. One that cannot start says why in Chat, and the rest still go.',
  },
  needs: { heading: 'NEEDS YOU' },
};

const gradeNote = ({ safety }) => {
  if (!safety) return 'not graded';
  const grade = `${safety.grade} ${safety.rating}`;
  return safety.stale ? `${grade} on an older commit` : grade;
};

const stepNote = entry => [
  entry.pr && 'PR',
  entry.behind > 0 && `${entry.behind} behind`,
  gradeNote(entry),
].filter(Boolean).join(' · ');

/** What a group's confirmation lists: every row its yes carries out, numbered in the order they go, under its project, with how each lands and its grade. */
export function groupPlan(name, entries) {
  const words = groupWords[name];
  const projects = [];
  entries.forEach((entry, index) => {
    const step = { number: index + 1, title: shownTitle(entry.title), note: stepNote(entry) };
    const last = projects.at(-1);
    if (last?.slug === entry.slug) last.steps.push(step);
    else projects.push({ slug: entry.slug, project: entry.project ?? entry.slug, steps: [step] });
  });

  return { name: words.name, about: words.about, projects };
}
