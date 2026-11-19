import { useMemo, useState } from 'react'

/**
 * A long conversation draws only its newest steps: an agent's page and a durable hobkin's page draw the newest forty, and
 * a row above them says how many came before and draws forty more each time it is pressed. A step that is not drawn
 * works out no diff and adds nothing to the page. New steps still arrive at the bottom, and the newest stay drawn.
 */

/** How many of a conversation's newest steps are drawn when it opens, and how many more each press draws. */
export const NEWEST_STEPS = 40

/** The newest `drawn` of a conversation's steps, and how many came before them. A conversation that fits is the same list. */
export function newestOf<Item>(items: readonly Item[], drawn: number): { shown: readonly Item[]; earlier: number } {
  if (items.length <= drawn) return { shown: items, earlier: 0 }
  return { shown: items.slice(items.length - drawn), earlier: items.length - drawn }
}

/** How many are drawn after one more press: forty more, and never past the first step. */
export const drawMore = (drawn: number, total: number): number => Math.max(drawn, Math.min(total, drawn + NEWEST_STEPS))

/**
 * How many of a conversation's newest steps are drawn, kept for the conversation by its own name. Another
 * conversation starts again from forty.
 */
export function useNewest<Item>(name: string, items: readonly Item[]): { shown: readonly Item[]; earlier: number; more: () => void } {
  const [drawn, setDrawn] = useState({ name, count: NEWEST_STEPS })
  const count = drawn.name === name ? drawn.count : NEWEST_STEPS
  // The same steps give the same list, so what follows the list's changes runs only when it changed.
  const { shown, earlier } = useMemo(() => newestOf(items, count), [items, count])
  return { shown, earlier, more: () => setDrawn({ name, count: drawMore(count, items.length) }) }
}
