import { readyItems } from './reads.mjs';
import { fileItem, readItems, updateItem } from './store.mjs';
import { surveyUnmerged } from './unmerged.mjs';

// The rows the user sees next. Filling in any more would pay for work they may never ship.
const NEXT_ROWS = 5;

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

/** The survey, then what it showed needs closing. Both write only hobkin's own records. */
export async function surveyAndClose(root, options = {}) {
  const survey = await surveyUnmerged(root, options);
  const filled = fillGaps(root, options.now);
  return { ...survey, filed: [...survey.filed, ...filled] };
}
