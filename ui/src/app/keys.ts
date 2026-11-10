import { useEffect } from 'react'
import { useSettings } from '@/features/settings/store.ts'
import { focusAgentsDock } from './AgentsDock.tsx'
import { answerNext, runningAgents } from './running-agents.ts'
import { resolveEscape, resolveKey, type KeyAction, type KeyContext, type Zone } from './key-map.ts'
import { walkScreens, type ScreenId } from './screens.ts'
import { useView } from './view-store.ts'

/**
 * Carries out the frame's keyboard map on the page. The map itself is `key-map.ts`.
 * Everything in the app can be done without a mouse. The message input is home: Escape leads back to it.
 *
 * A screen or panel that uses a key itself calls preventDefault, and the frame then leaves that key alone.
 */

/**
 * The screens Tab walks and Command with a number opens, in order: the menu's own, then a review, Settings
 * or Integrations while one is open. Agents are not here. They are reached with Down and walked with Up and Down.
 */
export function visibleScreens(): ScreenId[] {
  const { openReview, screen } = useView.getState()
  return walkScreens({ screen, reviewOpen: openReview !== null, githubInMenu: useSettings.getState().showGitHubInMenu })
}

function messageInput(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-chat-side] textarea')
}

export function focusInput(): void {
  messageInput()?.focus()
}

/** While one screen leaves and another arrives there are two. The last one is the one arriving. */
function lastCanvasScreen(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-canvas-screen]')].at(-1)
}

export function focusCanvas(): void {
  lastCanvasScreen()?.focus()
}

/** The rows of the list that is veiling the chat. */
function veilRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-chat-veil] [data-veil-list]:not([inert]) [data-veil-row]')]
}

function zoneOf(target: EventTarget | null): Zone {
  if (!(target instanceof Element)) return 'other'
  if (target === messageInput()) return 'input'
  if (target.closest('[data-agents-dock]')) return 'agents'
  if (target.closest('[data-chat-veil]')) return 'veil'
  if (target.closest('[data-canvas-screen]')) return 'canvas'
  return 'other'
}

/**
 * A dialog, menu or list that handles its own keys. The veil and the agents list are the frame's own, so they do not count.
 * An input that is showing completions (a combobox with its list open, such as the message input after a slash)
 * owns its keys too: there Tab completes instead of changing the screen.
 */
function inOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.matches('[role="combobox"][aria-expanded="true"]')) return true
  return target.closest('[role="dialog"]:not([data-chat-veil]), [role="menu"], [role="listbox"]:not([data-agents-dock])') !== null
}

function contextOf(target: EventTarget | null): KeyContext {
  const { screen, previewReturn, veil } = useView.getState()
  return {
    zone: zoneOf(target),
    messageEmpty: (messageInput()?.value.length ?? 0) === 0,
    screens: visibleScreens(),
    screen,
    under: screen === 'agent' ? (previewReturn ?? 'work') : undefined,
    inOverlay: inOverlay(target),
    veilOpen: veil !== null,
    asking: runningAgents().some((agent) => agent.asks),
    githubInMenu: useSettings.getState().showGitHubInMenu,
  }
}

/** Does what the map asked. False when there was nothing to do it with, so the key keeps its usual meaning. */
function perform(action: KeyAction): boolean {
  const view = useView.getState()
  switch (action.do) {
    case 'open-screen':
      view.openScreen(action.screen)
      if (action.focusCanvas) {
        view.engageCanvas()
        requestAnimationFrame(focusCanvas)
      } else view.disengageCanvas()
      return true
    case 'focus-input':
      view.closeVeil()
      // Going home gives the chat its room back.
      view.disengageCanvas()
      focusInput()
      return true
    case 'focus-agents':
      return focusAgentsDock()
    case 'open-veil':
      view.openVeil(action.section)
      return true
    case 'veil-move':
      view.moveVeil(action.delta, veilRows().length)
      requestAnimationFrame(() => document.querySelector('[data-chat-veil] [data-veil-row][data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
      return true
    case 'veil-choose':
      veilRows()[view.veilActive]?.click()
      return true
    case 'close-veil':
      view.closeVeil()
      focusInput()
      return true
    case 'open-spotlight':
      // It takes the keyboard itself as it opens, and gives it back when it closes.
      view.openSpotlight()
      return true
    case 'open-integrations':
      view.closeVeil()
      view.toggleIntegrations()
      if (useView.getState().screen === 'integrations') requestAnimationFrame(focusCanvas)
      else focusInput()
      return true
    case 'open-settings':
      view.closeVeil()
      view.toggleSettings()
      // Opening hands the keyboard to Settings, which puts it on its first control. Closing sends it home.
      if (useView.getState().screen === 'settings') requestAnimationFrame(focusCanvas)
      else focusInput()
      return true
    case 'answer-agent':
      return answerNext()
    case 'leave-screen':
      if (view.screen === 'review') view.closeReview()
      else if (view.screen === 'integrations') view.toggleIntegrations()
      else if (view.screen === 'github') view.closeGitHub()
      else view.closeSettings()
      // One step back. Landing on Settings keeps the keyboard there, on the way it came in by. Anywhere else, it goes home.
      if (useView.getState().screen === 'settings') {
        requestAnimationFrame(() => (document.querySelector<HTMLElement>('[data-opens="integrations"]') ?? lastCanvasScreen())?.focus())
      } else {
        useView.getState().disengageCanvas()
        focusInput()
      }
      return true
    case 'reload':
      location.reload()
      return true
    case 'hold':
      return true
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return
  const action = resolveKey(
    { key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
    contextOf(event.target),
  )
  if (action && perform(action)) event.preventDefault()
}

function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const action = resolveEscape(contextOf(event.target), event.defaultPrevented)
  if (action) perform(action)
}

export function useFrameKeys(): void {
  useEffect(() => {
    // Capture, so the map is decided before a focused control sees the key.
    addEventListener('keydown', onKeyDown, true)
    // Escape is read last, in the bubble phase, so whatever had the keyboard gets to use it first.
    addEventListener('keydown', onEscape)
    focusInput()
    return () => {
      removeEventListener('keydown', onKeyDown, true)
      removeEventListener('keydown', onEscape)
    }
  }, [])
}
