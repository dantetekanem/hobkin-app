/**
 * The sides of a card its wires come in and go out by (spec 006): what it depends on comes in on the left and what leans
 * on it goes out on the right, or on a graph that reads top to bottom, in at the top and out at the bottom. Its pins,
 * React Flow's handles and the count of wires it folded away stand on these sides.
 */
import { Position } from '@xyflow/react'
import type { GraphFlow } from '#shared/review/layout.ts'

export const PIN_SIDES = {
  'left-to-right': { in: Position.Left, out: Position.Right },
  'top-to-bottom': { in: Position.Top, out: Position.Bottom },
} as const satisfies Record<GraphFlow, { in: Position; out: Position }>
