/**
 * Picking from a cloud of bubbles: which ones show for what was typed, how many fit at once, and what is kept.
 * Pure rules only. See _specs/025-onboarding.
 */

/** The most bubbles on screen at once. The rest are reached by typing. */
export const PICKS_SHOWN = 50

const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()

/** The options that hold what was typed, the ones that start with it first. Everything, in its own order, for nothing typed. */
export function matching(options: readonly string[], typed: string): string[] {
  const wanted = typed.trim().toLowerCase()
  if (!wanted) return [...options]

  const holding = options.filter((option) => option.toLowerCase().includes(wanted))
  const starting = holding.filter((option) => option.toLowerCase().startsWith(wanted))
  const elsewhere = holding.filter((option) => !option.toLowerCase().startsWith(wanted))
  return [...starting, ...elsewhere]
}

/** What shows of the matching options, and how many more there are than fit. */
export function shownOf(matched: readonly string[], limit: number = PICKS_SHOWN): { shown: string[]; more: number } {
  return { shown: matched.slice(0, limit), more: Math.max(0, matched.length - limit) }
}

/** Picking one that is picked lets it go, and picking another adds it, in the order they were picked. */
export function togglePick(picked: readonly string[], option: string): string[] {
  return picked.includes(option) ? picked.filter((one) => one !== option) : [...picked, option]
}

/**
 * What typing Enter adds: the typed words as an option of their own, when the list takes new ones and has none by
 * that name. Null when there is nothing to add.
 */
export function ownOption(options: readonly string[], typed: string): string | null {
  const words = typed.trim()
  if (!words || options.some((option) => same(option, words))) return null
  return words
}

/** The picks as the answer that is kept, in the order they were picked. */
export const pickedAnswer = (picked: readonly string[]): string => picked.join(', ')

/** The folders picked, by their names in the folder that was named, in the order they were picked, so they go to work mode by path. */
export function foldersPicked<Folder extends { name: string }>(picked: readonly string[], folders: readonly Folder[]): Folder[] {
  return picked.flatMap((name) => folders.find((folder) => folder.name === name) ?? [])
}

/** The picks an answer holds, for coming back to a question. Only the ones still among the options, unless own ones are allowed. */
export function picksOf(answer: string | undefined, options: readonly string[], allowOwn: boolean): string[] {
  const named = (answer ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  return allowOwn ? named : named.filter((name) => options.includes(name))
}
