/**
 * What the panel's "Make it a stack" button and its box say and do (spec 060, step S1), as plain data: whether the
 * button is there, whether it can be pressed, whether it is drawn for attention, what its tooltip says, and the box's
 * heading, rows and closing line. Pure, so each state is tested without a window.
 */
import { LAYER_LINES, type StackLayer, type StackPlan } from '#shared/review/stack-plan.ts'

export interface StackButtonInput {
  /** The change merged: it has no button. */
  merged: boolean
  /** The change review is ready, so there are facts to plan from. */
  ready: boolean
  /** A review the window made up, with no host behind it. */
  sample: boolean
  /** The review is of an older commit than the change is at. */
  outdated: boolean
  /** The change's changed lines without lockfiles and generated files. */
  readLines: number
}

export interface StackButton {
  shown: boolean
  disabled: boolean
  /** Over `LAYER_LINES` read lines: drawn in the attention color of the Outdated notice. About size, never about risk. */
  emphasized: boolean
  tooltip: string
}

export function stackButton({ merged, ready, readLines }: StackButtonInput): StackButton {
  if (merged) return { shown: false, disabled: true, emphasized: false, tooltip: '' }
  if (!ready) return { shown: true, disabled: true, emphasized: false, tooltip: 'The plan is made from the review, once it is ready.' }
  if (readLines > LAYER_LINES) {
    return { shown: true, disabled: false, emphasized: true, tooltip: `${readLines.toLocaleString('en-US')} changed lines to read, past the ${LAYER_LINES} a reviewer takes in at a sitting.` }
  }
  return { shown: true, disabled: false, emphasized: false, tooltip: 'Split this change into layers a reviewer reads one at a time.' }
}

/** Whether the box is open after a press of the button or of ⇧S (`toggle`), or of Escape. A button that cannot be pressed leaves it closed. */
export function stackBoxOpen(open: boolean, press: 'toggle' | 'escape', button: StackButton): boolean {
  if (!button.shown || button.disabled) return false
  return press === 'toggle' ? !open : false
}

export interface StackRow {
  number: number
  text: string
  /** A quiet line under the row, for the layer the agent splits further. */
  note: string | null
}

export interface StackBox {
  heading: string
  rows: StackRow[]
  /** A case that holds for the plan itself, above the rows. */
  note: string | null
  /** The one quiet line where Build will stand: what the window cannot do from here. */
  footer: string
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function rowOf(layer: StackLayer): StackRow {
  const kind = layer.kind === 'mechanical' ? 'Mechanical' : 'Behaviour'
  const needs = layer.needsYou > 0 ? ` · ${layer.needsYou} need you` : ''
  return {
    number: layer.number,
    text: `${layer.number} · ${kind} · ${layer.title} · ${plural(layer.files.length, 'file')} · +${layer.additions} −${layer.deletions}${needs}`,
    note: layer.splitFurther ? `This zone is over ${LAYER_LINES} lines, so the agent splits it further, or says why not.` : null,
  }
}

export function stackBox(input: StackButtonInput, plan: StackPlan): StackBox {
  const { layers } = plan
  const heading = layers.length === 0 ? 'No layers' : layers.length === 1 ? 'One layer' : `A stack of ${layers.length}, bottom first`
  const note = layers.length === 1 ? "The review's facts give one layer. The agent can still split it inside its files." : null
  const footer = input.sample
    ? 'Sample review: nothing is made from here.'
    : input.outdated
      ? 'This review is of an older commit. Rebuild it first: a stack is made from the commit its review read.'
      : layers.length === 0
        ? 'The review lists no changed files.'
        : 'hobkin cannot build a stack yet.'
  return { heading, rows: layers.map(rowOf), note, footer }
}
