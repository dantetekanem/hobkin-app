import { readyItems } from './reads.mjs';
import { fileItem, updateItem } from './store.mjs';
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

/** Rows near the top that cannot be decided on yet get an agent, once each. A key per branch means one that fails stays a gap rather than a loop. */
export function fillGaps(root, now = Date.now()) {
  const next = readyItems(root).filter(row => row.gap === 'land').slice(0, NEXT_ROWS);
  const lacking = next.filter(({ described, proved }) => !described || !proved);
  return lacking.map(row => {
    const { id, state } = fileItem(root, row.slug, describeWork(row), now);
    if (state === 'open') updateItem(root, row.slug, id, { branch: row.branch, ships: row.item }, now);
    return { slug: row.slug, id, title: `Describe ${row.branch}`, branch: row.branch };
  });
}

/** The survey, then what it showed needs closing. Both write only hobkin's own records. */
export async function surveyAndClose(root, options = {}) {
  const survey = await surveyUnmerged(root, options);
  const filled = fillGaps(root, options.now);
  return { ...survey, filed: [...survey.filed, ...filled] };
}
