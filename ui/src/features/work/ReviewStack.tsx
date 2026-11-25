import { ArrowDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { placeOf } from './stacks.ts'
import { stackHeading, type LayerRow, type ListEntry, type MergingLayer } from './review-stacks.ts'

/**
 * A stack on the Review list, drawn as Work draws one (_specs/067-review-list-one-list): one quiet frame under its
 * heading, the layer that lands first as the whole row, each layer over it as one line, an arrow from each layer to the
 * one that lands after it. A press on a line opens its whole row under it, and presses it closed again.
 */

type StackEntry = Extract<ListEntry, { kind: 'stack' }>

/** What a layer's one line needs: its place and what it lands after, and whether it is open. Null where the layer is the whole row. */
export interface LineOf {
  place: string
  lands: string
  opened: boolean
  onToggle: () => void
}

/** Draws one layer, as its line or as its whole row. */
export type DrawLayer = (layer: LayerRow, line: LineOf | null) => ReactNode

export function ReviewStack({ entry, draw }: { entry: StackEntry; draw: DrawLayer }) {
  // Opening a layer closes nothing else, and it stays open until it is pressed again.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <li>
      <div role="group" aria-label={stackHeading(entry)} className="flex flex-col gap-1.5 rounded-[28px] bg-foreground/[0.025] p-1.5 pt-3">
        <p className="px-5 text-[12.5px] leading-snug font-medium text-muted-foreground">{stackHeading(entry)}</p>
        <ul className="flex flex-col">
          {inOrder(entry).map((layer, index) => {
            if ('key' in layer) {
              return (
                <LayerSlot key={`merging:${layer.key}`} first={index === 0}>
                  <MergingLine layer={layer} />
                </LayerSlot>
              )
            }
            const id = layer.row.item.id
            // The layer that lands first of those still to review is the whole row; a merging line above it is not one.
            const line: LineOf | null = layer === entry.layers[0] ? null : { place: placeOf(layer.place), lands: `lands after ${layer.place.layer - 1}`, opened: open.has(id), onToggle: () => toggle(id) }
            return (
              <LayerSlot key={id} first={index === 0}>
                {draw(layer, line)}
              </LayerSlot>
            )
          })}
        </ul>
      </div>
    </li>
  )
}

/** A layer with the arrow from the layer under it. The layer is a list item of its own, so the arrow is one too. */
function LayerSlot({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {first ? null : (
        <li aria-hidden="true" className="flex h-5 items-center pl-[30px] text-muted-foreground/70">
          <ArrowDown className="size-3.5" />
        </li>
      )}
      {children}
    </>
  )
}

/** The stack's layers, rows and merging lines together, bottom first. */
function inOrder({ layers, merging }: StackEntry): (LayerRow | MergingLayer)[] {
  const place = (layer: LayerRow | MergingLayer) => layer.place.layer
  return [...layers, ...merging].toSorted((a, b) => place(a) - place(b))
}

/** A layer the user already said merge to: one quiet line in its place, with the height of any other line, and nothing to press. */
function MergingLine({ layer }: { layer: MergingLayer }) {
  return (
    <li className="flex min-h-11 items-center gap-3 rounded-2xl px-4 py-2 text-muted-foreground" aria-label={`${placeOf(layer.place)}: ${layer.title}, merging`}>
      <span className="flex h-11 w-[6.5rem] shrink-0 items-center justify-center text-[12px]">merging</span>
      <span className="w-9 shrink-0 text-[12px] font-medium tabular-nums">{placeOf(layer.place)}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] leading-snug">{layer.title}</span>
    </li>
  )
}
