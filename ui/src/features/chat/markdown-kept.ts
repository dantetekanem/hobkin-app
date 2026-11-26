import type { ReactElement } from 'react'

/**
 * Markdown drawn once and kept, so a page opened again, or a row drawn again, does not parse its text again. What
 * `markdown.ts` draws depends on the text alone: its components, plugins and address rule read no context, setting or
 * theme. React elements never change, and React may draw the same ones again, in as many places as it likes. The
 * trees are kept by last use, up to a count of texts and of their characters.
 */

/** How many texts are kept. */
export const KEPT_TEXTS = 1000
/** Their characters in all. A tree holds about 4 bytes a character, 12 under React's development build. */
export const KEPT_CHARS = 2_000_000
/** A longer text is drawn and not kept, so one long file does not push the conversations out. */
export const LONGEST_KEPT = KEPT_CHARS / 8

interface Kept {
  /** What drew the trees. A hot update of `markdown.ts` draws with new components, and the trees start over. */
  draw: (text: string) => ReactElement
  /** The trees by their text, the least lately used first. */
  trees: Map<string, ReactElement>
  chars: number
}

// The trees live on globalThis, so a hot update that runs this file again keeps one set instead of starting a second.
const holder = globalThis as { __hobkinMarkdown?: Kept }

/** `text` as `draw` draws it, or the tree it drew for the same text before. */
export function drawnOnce(text: string, draw: (text: string) => ReactElement): ReactElement {
  let kept = holder.__hobkinMarkdown
  if (kept?.draw !== draw) kept = holder.__hobkinMarkdown = { draw, trees: new Map(), chars: 0 }

  const tree = kept.trees.get(text)
  if (tree) {
    kept.trees.delete(text)
    kept.trees.set(text, tree)
    return tree
  }

  const drawn = draw(text)
  if (text.length > LONGEST_KEPT) return drawn
  kept.trees.set(text, drawn)
  kept.chars += text.length
  for (const oldest of kept.trees.keys()) {
    if (kept.trees.size <= KEPT_TEXTS && kept.chars <= KEPT_CHARS) break
    kept.trees.delete(oldest)
    kept.chars -= oldest.length
  }
  return drawn
}

/** How many texts are kept, and their characters. */
export function keptSize(): { texts: number; chars: number } {
  return { texts: holder.__hobkinMarkdown?.trees.size ?? 0, chars: holder.__hobkinMarkdown?.chars ?? 0 }
}
