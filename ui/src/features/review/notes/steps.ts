/**
 * The steps list of a long story. Steps far from the current one fold into ranges, as in pi-coder's
 * Steps sidebar, so the list fits beside the graph.
 */
export type StepItem = { type: 'step'; index: number } | { type: 'fold'; from: number; to: number; count: number }

const FOLD = {
  /** A story of this many steps or fewer is shown whole. */
  fits: 16,
  /** Steps always shown at each end of the story. */
  ends: 2,
  /** Steps shown on each side of the current one. */
  around: 4,
  /** A gap this short is shown, because a fold row would take as much room. */
  least: 3,
} as const

/** The rows of the steps list. `opened` holds the first index of each range the reviewer unfolded. */
export function foldSteps(total: number, current: number, opened: ReadonlySet<number> = new Set()): StepItem[] {
  const shown = (index: number) => total <= FOLD.fits || index < FOLD.ends || index >= total - FOLD.ends || Math.abs(index - current) <= FOLD.around
  const items: StepItem[] = []
  for (let index = 0; index < total; ) {
    if (shown(index)) {
      items.push({ type: 'step', index: index++ })
      continue
    }
    let end = index
    while (end + 1 < total && !shown(end + 1)) end += 1
    const count = end - index + 1
    if (count < FOLD.least || opened.has(index)) for (let step = index; step <= end; step += 1) items.push({ type: 'step', index: step })
    else items.push({ type: 'fold', from: index, to: end, count })
    index = end + 1
  }
  return items
}
