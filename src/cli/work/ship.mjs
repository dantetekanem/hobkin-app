import { localDay } from './store.mjs';

/** How much finished work may wait, across every project, before more work stops being the way to get things shipped. */
export const SHIP_FIRST_AT = 8;

// Rows the Done tab lists to land. A branch stacked under another has the gap `stacked`, so it counts once.
const gapsThatMove = ['land', 'rebase', 'unlanded'];

export const pileOf = rows => rows.filter(({ gap }) => gapsThatMove.includes(gap));

const newWorkToday = ({ ship }, now) => ship?.newWorkOn === localDay(now);

/** The pile as the plan, the tab and the main agent read it. `holding` is the user's own rule: while it is on, what starts is ordered, and nothing running stops. */
export function shipFirst(rows, mode, now) {
  const pile = pileOf(rows).length;
  const holding = pile >= SHIP_FIRST_AT && !newWorkToday(mode, now);
  const line = holding ? `Shipping first: ${pile} finished and waiting. New work starts under ${SHIP_FIRST_AT}.` : null;
  return { pile, bar: SHIP_FIRST_AT, holding, line };
}
