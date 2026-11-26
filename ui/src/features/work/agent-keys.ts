import type { KeyboardEvent } from 'react'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { walkOf, type StepWalk } from '@/features/agent-activity/windowed-rows.ts'

/**
 * The keys of an agent's page, the same for every agent (`021-agent-rendering`, 011 A11): Up leaves the page for the
 * agents list, and the steps are walked with the arrows. A page on its way out keeps its own input and steps: each is
 * found from within its own screen.
 */

/** The steps and messages of the exchange, top to bottom, for the keyboard. */
const walkable = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(':scope > [data-step]')]
const screenOf = (element: Element) => element.closest('[data-canvas-screen]')
const focusTalkInput = (from: Element) => screenOf(from)?.querySelector<HTMLTextAreaElement>('[data-agent-input]')?.focus({ preventScroll: true })

/** Moves the keyboard from the talk box up onto the newest step. False when there is nothing to walk. */
export function focusNewestStep(input: Element): boolean {
  const list = screenOf(input)?.querySelector<HTMLElement>('[data-agent-exchange]')
  // A windowed list draws only some of its rows: its newest step is found in the whole list, and drawn if it is not.
  const walk = list ? walkOf(list) : undefined
  if (walk) {
    const at = walk.next(walk.count(), -1)
    if (at >= 0) walk.focus(at)
    return at >= 0
  }
  const newest = list ? walkable(list).at(-1) : undefined
  newest?.focus()
  return Boolean(newest)
}

/**
 * Up on an agent's page is navigation, never a jump into the input: Up and Down walk the steps and, past them, the agents.
 *  - On the page (focus on the screen itself, not a step or control): Up moves to the agents list, this agent's row.
 *  - In the steps: Up walks to the previous step; from the first step it spills to the agents list.
 *  - In an empty input: Up walks the steps, newest first; with no steps it goes to the agents list.
 *  - In the agents list (AgentsDock): Up walks to the previous agent, and from the first agent to the main chat input.
 * The input is reached by Down from the newest step, or Escape — not by Up.
 */
export function upToAgents(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowUp' || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
  const target = event.target as HTMLElement
  if (target.closest('[data-step], input, textarea, select, button, a, dialog, [contenteditable="true"], [role="dialog"]')) return
  // Not into the input: Up leaves the canvas for the agents list, where Up and Down then walk between agents.
  if (focusAgentsDock()) event.preventDefault()
}

/**
 * The exchange's keys (021 A9): Up and Down move between steps, Right or Enter opens a group or a change, Left
 * closes it, Home and End go to the first and the newest, and Down from the newest or Escape goes back to the input.
 */
export function walkSteps(event: KeyboardEvent<HTMLOListElement>) {
  const walk = walkOf(event.currentTarget)
  if (walk) return walkWindowed(event, walk)
  const items = walkable(event.currentTarget)
  const current = (event.target as HTMLElement).closest<HTMLElement>('[data-step]')
  const at = current ? items.indexOf(current) : -1
  if (!current || at === -1) return
  // Inside a step, its own controls keep their keys. Escape still leads back.
  if (event.target !== current && event.key !== 'Escape') return
  const toggle = (expanded: boolean) => current.querySelector<HTMLElement>(`[data-step-toggle][aria-expanded="${expanded}"]`)
  if (event.key === 'ArrowUp') {
    // Up from the first step spills to the agents list, on this agent. Without a list it stays.
    if (at > 0) items[at - 1]!.focus()
    else focusAgentsDock()
  } else if (event.key === 'ArrowDown') {
    if (at < items.length - 1) items[at + 1]!.focus()
    else focusTalkInput(current)
  } else if (event.key === 'Home') items[0]?.focus()
  else if (event.key === 'End') items.at(-1)?.focus()
  else if (event.key === 'ArrowRight' || event.key === 'Enter') toggle(false)?.click()
  else if (event.key === 'ArrowLeft') toggle(true)?.click()
  else if (event.key === 'Escape') focusTalkInput(current)
  else return
  event.preventDefault()
}

/**
 * The same keys over a windowed list (`windowed-list.tsx`), which draws only some of its rows: each moves by the row's
 * place in the whole list, and a row not drawn is drawn before it takes the keyboard and comes into view.
 */
function walkWindowed(event: KeyboardEvent<HTMLOListElement>, walk: StepWalk) {
  const current = (event.target as HTMLElement).closest<HTMLElement>('[data-step]')
  const at = current ? walk.indexOf(current) : -1
  if (!current || at === -1) return
  // Inside a step, its own controls keep their keys. Escape still leads back.
  if (event.target !== current && event.key !== 'Escape') return
  const toggle = (expanded: boolean) => current.querySelector<HTMLElement>(`[data-step-toggle][aria-expanded="${expanded}"]`)
  if (event.key === 'ArrowUp') {
    // Up from the first step spills to the agents list, on this agent. Without a list it stays.
    const up = walk.next(at, -1)
    if (up >= 0) walk.focus(up)
    else focusAgentsDock()
  } else if (event.key === 'ArrowDown') {
    const down = walk.next(at, 1)
    if (down >= 0) walk.focus(down)
    else focusTalkInput(current)
  } else if (event.key === 'Home') walk.focus(walk.next(-1, 1))
  else if (event.key === 'End') walk.focus(walk.next(walk.count(), -1))
  else if (event.key === 'ArrowRight' || event.key === 'Enter') toggle(false)?.click()
  else if (event.key === 'ArrowLeft') toggle(true)?.click()
  else if (event.key === 'Escape') focusTalkInput(current)
  else return
  event.preventDefault()
}
