import type { StripItem, Thought, Tip } from './types.ts'

/**
 * Short, friendly hints that teach the app. Each one is about something that works today: every `kbd` is a real
 * binding from `key-list.ts`/`key-map.ts`, and every promise is true now, not "soon". They are the base rotation in
 * the top strip. Add a tip here only once the thing it describes actually ships.
 */
export const TIPS: readonly Tip[] = [
  {
    id: 'prompt-editor',
    kbd: '⌃⌥P',
    text: 'Have an idea? Open the full prompt editor from any screen and write it out. Your draft stays until you send it.',
  },
  {
    id: 'spotlight',
    kbd: '⌘K',
    text: 'Search everything — screens, reports, routines, agents — and jump straight there.',
  },
  {
    id: 'mind',
    kbd: '⌘J',
    text: "Open hobkin's mind to watch its main agent work beside the chat. Press it again to close.",
  },
  {
    id: 'history',
    kbd: '⌘Y',
    text: 'Open History to revisit anything that happened while you were away.',
  },
  {
    id: 'reload',
    kbd: '⌘R',
    text: 'Reload any time — the window reopens right where you left it.',
  },
]

const str = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** The thoughts hobkin sent, validated and de-duplicated by id. Anything malformed is dropped, not thrown. */
export function thoughtsOf(value: unknown): Thought[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, Thought>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (!str(raw.id) || !str(raw.text) || byId.has(raw.id)) continue
    byId.set(raw.id, { id: raw.id, text: raw.text, ...(str(raw.at) ? { at: raw.at } : {}) })
  }
  return [...byId.values()]
}

/**
 * The live strip items: hobkin's thoughts first, so the proactive ones surface, then the base tips. Dismissed items
 * (by their `tip:` / `thought:` key) drop out for good. The order is stable; the strip rotates a window over it.
 */
export function stripItems(tips: readonly Tip[], thoughts: readonly Thought[], dismissed: ReadonlySet<string>): StripItem[] {
  const items: StripItem[] = [
    ...thoughts.map((thought): StripItem => ({ kind: 'thought', id: `thought:${thought.id}`, text: thought.text })),
    ...tips.map((tip): StripItem => ({ kind: 'tip', id: `tip:${tip.id}`, text: tip.text, ...(tip.kbd ? { kbd: tip.kbd } : {}) })),
  ]
  return items.filter(item => !dismissed.has(item.id))
}

/**
 * The `size` items visible now: the whole list when it fits, otherwise a window that slides by `step` and wraps, so
 * the strip rotates through every item over time while always showing several at once. Pure: the caller advances `step`.
 */
export function rotationWindow<T>(items: readonly T[], step: number, size: number): T[] {
  if (items.length <= size) return [...items]
  const start = ((step % items.length) + items.length) % items.length
  return Array.from({ length: size }, (_, offset) => items[(start + offset) % items.length]!)
}
