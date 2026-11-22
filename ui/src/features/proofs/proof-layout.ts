/**
 * How a proof run lays out in the room it has (053-work-control-room, "Proofs"): from 1,100 pixels the check and the
 * proof show together, the trace or state graph at the left and the math with the proof tree at the right, under the
 * run's summary. Narrower, Run, State graph and Math are tabs. It is read from the box itself, as a container query
 * is, so a page and a panel beside another page follow the same rule. Only what the layout shows is mounted.
 */

export const SIDE_BY_SIDE_PX = 1100

export type ProofLayout = 'tabs' | 'side'

export const layoutOf = (width: number): ProofLayout => (width >= SIDE_BY_SIDE_PX ? 'side' : 'tabs')
