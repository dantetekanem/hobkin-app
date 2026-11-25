import type { FinishedChange, FinishedGroup, StackPlace } from '#shared/protocol/work.ts'

/**
 * How the finished changes are drawn when some are layers of a stack (_specs/060-make-it-a-stack, "A stack once it
 * exists"). Pure, so it is tested without a window. A change in no stack stays a card, in the order it came.
 */

/** A change with the group it came in, since its card says why it is there. */
export interface Placed {
  change: FinishedChange
  group: FinishedGroup
}

export type Entry =
  | { kind: 'change'; key: string; at: Placed; /** Set for a layer whose stack has no other layer here: its card says "2 of 5". */ place: StackPlace | null }
  | { kind: 'stack'; key: string; id: string; size: number; name: string | null; layers: Placed[] }

export interface Arranged {
  group: FinishedGroup
  entries: Entry[]
}

const byLayer = (a: Placed, b: Placed) => (a.change.stack?.layer ?? 0) - (b.change.stack?.layer ?? 0)

/**
 * Each group's entries, in the groups' order. A stack stands in the group and at the place of its lowest layer here,
 * which is the bottom one when it is here, and its other layers leave the groups they came in.
 */
export function arrange(groups: readonly FinishedGroup[]): Arranged[] {
  const stacks = new Map<string, Placed[]>()
  for (const group of groups) {
    for (const change of group.changes) {
      if (change.stack) stacks.set(change.stack.id, [...(stacks.get(change.stack.id) ?? []), { change, group }])
    }
  }
  for (const layers of stacks.values()) layers.sort(byLayer)

  return groups.map((group) => {
    const entries: Entry[] = []
    for (const change of group.changes) {
      const stack = change.stack
      if (!stack) {
        entries.push({ kind: 'change', key: change.key, at: { change, group }, place: null })
        continue
      }
      const layers = stacks.get(stack.id) ?? []
      const lowest = layers[0]
      if (lowest?.change !== change) continue
      if (layers.length === 1) entries.push({ kind: 'change', key: change.key, at: lowest, place: stack })
      else entries.push({ kind: 'stack', key: `stack:${stack.id}`, id: stack.id, size: stack.of, name: stack.name, layers })
    }
    return { group, entries }
  })
}

/**
 * The layer drawn as the whole card: the lowest one here, which lands next once the layers under it have gone, as one
 * the user said merge to has. Every other layer is a line until it is opened.
 */
export const wholeLayerOf = (entry: Extract<Entry, { kind: 'stack' }>): Placed | undefined => entry.layers[0]

/** "2 of 5", beside a layer's title. */
export const placeOf = (stack: StackPlace): string => `${stack.layer} of ${stack.of}`

/**
 * What a layer above the bottom says on its line: its place and its title. The arrow in front of the line shows the
 * layer it sits on, so only its label, for a screen reader, says that in words.
 */
export function layerLine({ stack, title }: { stack: StackPlace; title: string }): { place: string; title: string; label: string } {
  return { place: placeOf(stack), title, label: `Layer ${placeOf(stack)}: ${title}, on layer ${stack.layer - 1}` }
}

/** The stack's one quiet heading: how many layers and what they are of. Its whole card names the project. */
export function headingOf(entry: Extract<Entry, { kind: 'stack' }>): string {
  return entry.name ? `Stack of ${entry.size} · ${entry.name}` : `Stack of ${entry.size}`
}
