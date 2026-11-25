import { Fragment, useState, type ReactNode } from 'react'
import { LayerArrow } from './LayerArrow.tsx'
import { layerLine, placeOf } from './stacks.ts'
import { stackHeading, type LayerRow, type ListEntry, type MergingLayer } from './review-stacks.ts'

/**
 * A stack on the Review list, drawn as Work draws one (_specs/067-review-list-one-list): one quiet frame under its
 * heading, the layer that lands first as the whole row, each layer over it as one line with an arrow in front from the
 * layer under it. A press on a line opens its whole row under it, and presses it closed again.
 */

type StackEntry = Extract<ListEntry, { kind: 'stack' }>

/** What a layer's one line needs: its place, what a screen reader says of it, and whether it is open. Null where the layer is the whole row. */
export interface LineOf {
  place: string
  label: string
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
        <ul className="flex flex-col gap-2">
          {inOrder(entry).map((layer, index) => {
            if ('key' in layer) return <MergingLine key={`merging:${layer.key}`} layer={layer} first={index === 0} />
            const id = layer.row.item.id
            // The layer that lands first of those still to review is the whole row; a merging line above it is not one.
            if (layer === entry.layers[0]) {
              return (
                <WholeSlot key={id} first={index === 0}>
                  {draw(layer, null)}
                </WholeSlot>
              )
            }
            // A layer's line is never the first, and draws its arrow in front of itself.
            const words = layerLine({ stack: layer.place, title: layer.row.item.title })
            return <Fragment key={id}>{draw(layer, { place: words.place, label: words.label, opened: open.has(id), onToggle: () => toggle(id) })}</Fragment>
          })}
        </ul>
      </div>
    </li>
  )
}

/** The whole row, with the arrow in front of its first line from a merging line under it. The row is a list item of its own, so it sits in a list beside the arrow. */
function WholeSlot({ first, children }: { first: boolean; children: ReactNode }) {
  if (first) return children
  return (
    <li className="flex">
      <LayerArrow className="pt-[22px]" />
      <ul className="flex min-w-0 flex-1 flex-col">{children}</ul>
    </li>
  )
}

/** The stack's layers, rows and merging lines together, bottom first. */
function inOrder({ layers, merging }: StackEntry): (LayerRow | MergingLayer)[] {
  const place = (layer: LayerRow | MergingLayer) => layer.place.layer
  return [...layers, ...merging].toSorted((a, b) => place(a) - place(b))
}

/** A layer the user already said merge to: one quiet line in its place, with the height of any other line, and nothing to press. */
function MergingLine({ layer, first }: { layer: MergingLayer; first: boolean }) {
  return (
    <li className="flex items-center" aria-label={`${placeOf(layer.place)}: ${layer.title}, merging`}>
      {first ? null : <LayerArrow />}
      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-2 text-muted-foreground">
        <span className="flex h-11 w-[6.5rem] shrink-0 items-center justify-center text-[12px]">merging</span>
        <span className="w-9 shrink-0 text-[12px] font-medium tabular-nums">{placeOf(layer.place)}</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] leading-snug">{layer.title}</span>
      </div>
    </li>
  )
}
