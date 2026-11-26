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

type Draw = (text: string) => ReactElement

interface Kept {
  /** What drew the trees. */
  draw: Draw
  /** The trees by their text, the least lately used first. */
  trees: Map<string, ReactElement>
  chars: number
}

// The trees live on globalThis, so a hot update that runs this file again keeps one set instead of starting a second.
const holder = globalThis as { __hobkinMarkdown?: Kept }

/** The trees `draw` made. A hot update of `markdown.ts` draws with new components, so a new `draw` starts over. */
function keptOf(draw: Draw): Kept {
  const kept = holder.__hobkinMarkdown
  if (kept?.draw === draw) return kept

  const fresh: Kept = { draw, trees: new Map(), chars: 0 }
  holder.__hobkinMarkdown = fresh
  return fresh
}

/** Keeps a tree as the newest, and lets the least lately used go until the texts are within both bounds. */
function keep(kept: Kept, text: string, tree: ReactElement): void {
  kept.trees.set(text, tree)
  kept.chars += text.length

  for (const oldest of kept.trees.keys()) {
    const within = kept.trees.size <= KEPT_TEXTS && kept.chars <= KEPT_CHARS
    if (within) return
    kept.trees.delete(oldest)
    kept.chars -= oldest.length
  }
}

/** `text` as `draw` draws it, or the tree it drew for the same text before. */
export function drawnOnce(text: string, draw: Draw): ReactElement {
  const kept = keptOf(draw)

  const tree = kept.trees.get(text)
  if (tree) {
    // Used again, it is the newest.
    kept.trees.delete(text)
    kept.trees.set(text, tree)
    return tree
  }

  const drawn = draw(text)
  if (text.length <= LONGEST_KEPT) keep(kept, text, drawn)
  return drawn
}

/** How many texts are kept, and their characters. */
export function keptSize(): { texts: number; chars: number } {
  const kept = holder.__hobkinMarkdown
  return { texts: kept?.trees.size ?? 0, chars: kept?.chars ?? 0 }
}
