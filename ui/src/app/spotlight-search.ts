/**
 * What the spotlight (Command+K) finds for the text typed into it, and in what order. Pure, so the ranking is tested
 * without a window. The spotlight itself is `Spotlight.tsx`; what it searches comes from `spotlight-entries.ts`.
 * See _specs/026-spotlight.
 */

/** The kinds of things the spotlight finds, in the order their groups come when their best matches are as good. */
export const SPOTLIGHT_KINDS = ['screen', 'setting', 'agent', 'project', 'report', 'routine', 'action', 'pull', 'issue'] as const
export type SpotlightKind = (typeof SPOTLIGHT_KINDS)[number]

export interface SpotlightEntry {
  /** Unique among everything the spotlight searches. */
  id: string
  kind: SpotlightKind
  /** What the row says. It counts most. */
  title: string
  /** The row's second line. It counts less than the title. */
  detail?: string
  /** Other names that find the entry without being shown, such as "motion" for Movement. */
  keywords?: readonly string[]
}

export interface SpotlightGroup<Entry extends SpotlightEntry> {
  kind: SpotlightKind
  entries: Entry[]
  /** How many more of this kind match than the group shows. */
  hidden: number
}

/** The most rows one kind shows for a search, so hundreds of reports cannot push a screen out of sight. */
export const MOST_PER_KIND = 5

/** With nothing typed, the spotlight offers the places to go: the screens, and the agents working now. */
const OFFERED: readonly SpotlightKind[] = ['screen', 'agent']

/** Among matches that are as good, a screen comes first, then a setting, then an agent at work. */
const LEAD: Partial<Record<SpotlightKind, number>> = { screen: 6, setting: 4, agent: 3 }

const MARKS = /\p{M}/gu
const LETTER = /[\p{L}\p{N}]/u
const BETWEEN_WORDS = /[^\p{L}\p{N}]+/u

/** Text as the search compares it: lower case, without accents. */
function fold(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').toLowerCase()
}

/** Whether a word of `text` starts with `word`. A word starts the text, or follows anything that is not a letter or a digit. */
function startsAWord(text: string, word: string): boolean {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !LETTER.test(text[at - 1]!)) return true
  }
  return false
}

/** The first letter of each word: "ai" for Action Items. */
function initialsOf(text: string): string {
  return text
    .split(BETWEEN_WORDS)
    .map((part) => part.charAt(0))
    .join('')
}

/** Whether the letters of `word` all appear in `text`, in order. */
function inOrder(text: string, word: string): boolean {
  let from = 0
  for (const letter of word) {
    const at = text.indexOf(letter, from)
    if (at === -1) return false
    from = at + 1
  }
  return true
}

/** Letters in order only count in a short title, where they cannot match by chance. */
const LONGEST_LOOSE_TITLE = 40

function titleScore(title: string, word: string): number {
  if (title === word) return 100
  if (title.startsWith(word)) return 80
  if (startsAWord(title, word)) return 60
  if (word.length >= 2 && initialsOf(title).startsWith(word)) return 55
  if (title.includes(word)) return 40
  if (word.length >= 3 && title.length <= LONGEST_LOOSE_TITLE && inOrder(title, word)) return 10
  return 0
}

function keywordScore(keyword: string, word: string): number {
  if (keyword === word) return 70
  if (keyword.startsWith(word)) return 50
  if (startsAWord(keyword, word)) return 45
  if (keyword.includes(word)) return 25
  return 0
}

function detailScore(detail: string, word: string): number {
  if (startsAWord(detail, word)) return 30
  if (detail.includes(word)) return 15
  return 0
}

interface Folded {
  title: string
  detail: string
  keywords: string[]
}

/** How well an entry matches every word, or 0 when one of the words matches nothing. */
function scoreOf(entry: Folded, words: readonly string[]): number {
  let total = 0
  for (const word of words) {
    const best = Math.max(titleScore(entry.title, word), detailScore(entry.detail, word), ...entry.keywords.map((keyword) => keywordScore(keyword, word)))
    if (best === 0) return 0
    total += best
  }
  return total
}

/**
 * The entries that match `text`, grouped by kind. Every word typed has to match somewhere: in the title, the second
 * line or the other names. The start of the title counts most, then the start of a word, the initials, anywhere in
 * the title, the other names and the second line, and last, in a short title, its letters in order. Groups come in
 * the order of their best match, and each shows at most `MOST_PER_KIND`. Entries that match as well keep the order
 * they came in, so a list given newest first stays newest first.
 *
 * With nothing typed it offers the screens and the agents working now, as they came.
 */
export function searchSpotlight<Entry extends SpotlightEntry>(entries: readonly Entry[], text: string): SpotlightGroup<Entry>[] {
  const words = fold(text).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return OFFERED.flatMap((kind) => {
      const offered = entries.filter((entry) => entry.kind === kind)
      return offered.length ? [{ kind, entries: offered, hidden: 0 }] : []
    })
  }

  const byKind = new Map<SpotlightKind, { entry: Entry; score: number; at: number }[]>()
  entries.forEach((entry, at) => {
    const folded = { title: fold(entry.title), detail: fold(entry.detail ?? ''), keywords: (entry.keywords ?? []).map(fold) }
    const matched = scoreOf(folded, words)
    if (matched === 0) return
    const scored = { entry, score: matched + (LEAD[entry.kind] ?? 0), at }
    const kind = byKind.get(entry.kind)
    if (kind) kind.push(scored)
    else byKind.set(entry.kind, [scored])
  })

  const groups = [...byKind].map(([kind, scored]) => {
    const ranked = scored.toSorted((left, right) => right.score - left.score || left.at - right.at)
    return {
      kind,
      best: ranked[0]!.score,
      group: { kind, entries: ranked.slice(0, MOST_PER_KIND).map(({ entry }) => entry), hidden: Math.max(0, ranked.length - MOST_PER_KIND) },
    }
  })
  return groups
    .toSorted((left, right) => right.best - left.best || SPOTLIGHT_KINDS.indexOf(left.kind) - SPOTLIGHT_KINDS.indexOf(right.kind))
    .map(({ group }) => group)
}
