export interface StackSelection {
  id: string
  at: number
}

export const MANUAL_HOLD_MS = 30_000

/** A chosen ID only holds its place while it still exists, before the exact expiry. */
export function visibleCardId(ids: readonly string[], selected: StackSelection | null, now: number): string | null {
  if (selected && ids.includes(selected.id) && now - selected.at < MANUAL_HOLD_MS) return selected.id
  return ids[0] ?? null
}
