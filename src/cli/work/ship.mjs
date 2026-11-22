import { localDay, SHIP_FIRST_AT, workloadOf } from './store.mjs';

/** How much finished work may wait, across every project, before more work stops being the way to get things shipped, unless the user sets another number. */
export { SHIP_FIRST_AT };

// Rows the Done tab lists to land. A branch stacked under another has the gap `stacked`, so it counts once.
const gapsThatMove = ['land', 'rebase', 'unlanded'];

export const pileOf = rows => rows.filter(({ gap }) => gapsThatMove.includes(gap));

const newWorkToday = ({ ship }, now) => ship?.newWorkOn === localDay(now);

/**
 * The pile as the plan, the tab and the main agent read it. `holding` is the user's own rule: while it is on, what starts is ordered, and nothing running stops.
 * The user's workload turns the rule off for good or sets its bar (`shipFirst`, `shipFirstAt`); new work for the rest of a day is a word of its own.
 */
export function shipFirst(rows, mode, now) {
  const pile = pileOf(rows).length;
  const { shipFirst: on, shipFirstAt: bar } = workloadOf(mode);
  const holding = on && pile >= bar && !newWorkToday(mode, now);
  const line = holding ? `Shipping first: ${pile} finished and waiting. New work starts under ${bar}.` : null;
  return { pile, bar, holding, line };
}
