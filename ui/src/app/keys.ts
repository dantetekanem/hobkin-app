import { useEffect } from 'react'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'
import { useBlocks } from '@/features/agent-activity/blocks.ts'
import { boardAt, canvasShowingNow, closeCanvasFromKeys, mainCanvasInMenu, saveCanvas } from '@/features/canvas-panel/controls.ts'
import { useChat } from '@/features/chat/chat-store.ts'
import { pressEndOf } from '@/features/hobkins/end.ts'
import { useNewHobkin } from '@/features/hobkins/store.ts'
import { toggleMind } from '@/features/main-agent/route.ts'
import { useNerdStats } from '@/features/settings/nerd-stats-store.ts'
import { useSettings } from '@/features/settings/store.ts'
import { pressForceStopOf } from '@/features/work/force-stop.ts'
import { focusAgentsDock } from './AgentsDock.tsx'
import { answerNext, runningAgents } from './running-agents.ts'
import { resolveEscape, resolveKey, type KeyAction, type KeyContext, type Zone } from './key-map.ts'
import { inOverlay, installFrameKeys } from './key-page.ts'
import { travel } from './location.ts'
import { inMenu, walkScreens, type ScreenId } from './screens.ts'
import { useView } from './view-store.ts'
import { focusInput, messageInput, requestCanvasFocus } from './focus.ts'
export { focusCanvas, focusInput } from './focus.ts'

/**
 * Carries out the frame's keyboard map on the page. The map itself is `key-map.ts`.
 * Everything in the app can be done without a mouse. The message input is home: Escape leads back to it.
 *
 * A screen or panel that uses a key itself calls preventDefault, and the frame then leaves that key alone.
 */

/**
 * The screens Command with a number opens, in order: the menu's own, then a review, Settings or Integrations while
 * one is open, then the main canvas while the menu shows it. Agents are not here. They are reached with Down and
 * walked with Up and Down.
 */
export function visibleScreens(): ScreenId[] {
  const { openReview, screen } = useView.getState()
  return walkScreens({
    screen,
    reviewOpen: openReview !== null,
    githubInMenu: useSettings.getState().showGitHubInMenu,
    canvasOpen: safely(() => mainCanvasInMenu(), false),
  })
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
  // A canvas's area, its drawing and its controls in the menu are the canvas too (040-canvas-board).
  if (target.closest('[data-canvas-screen], [data-canvas-board], [data-canvas-controls]')) return 'canvas'
  return 'other'
}

/** A part of the page that fails to read is logged and taken as nothing, so the other keys keep working. */
function safely<T>(read: () => T, otherwise: T): T {
  try {
    return read()
  } catch (error) {
    console.error('[keys]', error)
    return otherwise
  }
}

/** A text field, where Command with Left and Right move the caret to the ends of the line. */
const typingIn = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))

function contextOf(target: EventTarget | null): KeyContext {
  const { screen, veil, openAgent } = useView.getState()
  return {
    zone: zoneOf(target),
    messageEmpty: (messageInput()?.value.length ?? 0) === 0,
    screens: visibleScreens(),
    screen,
    inOverlay: safely(() => inOverlay(target, document), false),
    veilOpen: veil !== null,
    veilSection: veil,
    dialog: useNewHobkin.getState().open ? 'new-hobkin' : useNerdStats.getState().open ? 'nerd-stats' : useChat.getState().draft.place === 'editor' ? 'prompt' : undefined,
    asking: safely(() => runningAgents().some((agent) => agent.asks), false),
    githubInMenu: useSettings.getState().showGitHubInMenu,
    typing: typingIn(target),
    hobkinPage: screen === 'agent' && hobkinOfAgent(openAgent) !== null,
    board: safely(() => boardAt(target), null),
    canvasShowing: safely(() => canvasShowingNow(), null),
  }
}

/** Does what the map asked. False when there was nothing to do it with, so the key keeps its usual meaning. */
function perform(action: KeyAction): boolean {
  const view = useView.getState()
  switch (action.do) {
    case 'open-screen':
      // The canvas is a place with a way back of its own, kept as it opens. A page of the menu's first row starts a new
      // trail, as its item does; a page open for now, such as Settings, is a place on the trail.
      if (action.screen === 'canvas') view.openCanvasPlace()
      else if (inMenu(action.screen, useSettings.getState().showGitHubInMenu)) view.openMenuScreen(action.screen)
      else view.openScreen(action.screen)
      if (action.focusCanvas) {
        view.engageCanvas()
        requestCanvasFocus()
      } else view.disengageCanvas()
      return true
    case 'focus-input':
      view.closeAgentCanvas()
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
    case 'new-hobkin':
      // The New hobkin sheet takes the keyboard as it opens, as the spotlight does.
      view.closeVeil()
      useNewHobkin.getState().openSheet()
      return true
    case 'close-new-hobkin':
      useNewHobkin.getState().closeSheet()
      return true
    case 'open-prompt': {
      // The editor takes the keyboard as it opens and gives it back to whatever had it when it closes.
      const chat = useChat.getState()
      // The same key closes it; the toggle returns to the small input with the same draft, so nothing is lost.
      chat.change({ type: 'editor-toggled' })
      return true
    }
    case 'toggle-nerd-stats':
      useNerdStats.getState().toggle()
      return true
    case 'open-integrations':
      view.closeVeil()
      view.toggleIntegrations()
      if (useView.getState().screen === 'integrations') requestCanvasFocus()
      else focusInput()
      return true
    case 'open-settings':
      view.closeVeil()
      view.toggleSettings()
      // Opening hands the keyboard to Settings, which puts it on its first control. Closing sends it home.
      if (useView.getState().screen === 'settings') requestCanvasFocus()
      else focusInput()
      return true
    case 'answer-agent':
      return answerNext()
    case 'leave-screen':
      // Back one place along the trail (053), and the page there gets the tab, row and scroll it kept.
      view.leave()
      // Leaving a review, a proof run or a project returns the keyboard to the page it was opened from, onto its row.
      if (view.screen === 'review' || view.screen === 'proof' || view.screen === 'project') {
        requestCanvasFocus()
      } else if (view.screen === 'world' || view.screen === 'yolo') {
        // Onto the control that opened it, where the page back there has one.
        requestCanvasFocus(`[data-opens="${view.screen}"]`)
      } else if (useView.getState().screen === 'settings') {
        // Back in Settings, onto the button that opened the page just left.
        requestCanvasFocus(`[data-opens="${view.screen}"]`)
      } else {
        useView.getState().disengageCanvas()
        focusInput()
      }
      return true
    case 'toggle-mind':
      toggleMind()
      return true
    case 'toggle-blocks':
      useBlocks.getState().toggleAll()
      return true
    case 'end-hobkin': {
      // The same press as End on the page: the first asks, the next ends it.
      const id = hobkinOfAgent(view.openAgent)
      return id ? pressEndOf(id) : false
    }
    case 'force-stop':
      // The same press as Force Stop on the page: the first asks, the next force stops the run.
      return pressForceStopOf(view.openAgent)
    case 'reload':
      location.reload()
      return true
    case 'go-back':
    case 'go-forward':
      // As with Command and a number, the keyboard goes along into the canvas. At either end nothing moves, and the
      // key is still the frame's: the window never leaves the app.
      if (travel(action.do === 'go-back' ? -1 : 1)) {
        view.engageCanvas()
        requestCanvasFocus()
      }
      return true
    case 'close-canvas':
      closeCanvasFromKeys(action.owner)
      return true
    case 'save-canvas':
      saveCanvas(action.owner)
      return true
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return
  const action = resolveKey(
    { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
    contextOf(event.target),
  )
  if (!action || !perform(action)) return
  event.preventDefault()
  // Command+Enter has done its work. A control that reads any Enter, as the agents list opens an agent with it, must not see it too.
  if (event.key === 'Enter' && event.metaKey) event.stopPropagation()
}

function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const action = resolveEscape(contextOf(event.target), event.defaultPrevented)
  if (action) perform(action)
}

/** The app starts with the keyboard in the message input. The listeners are the page's own, below. */
export function useFrameKeys(): void {
  useEffect(() => {
    // A reload restores an agent too; startup focus must not look like a request to leave it.
    if (useView.getState().screen === 'agent') requestCanvasFocus()
    else focusInput()
  }, [])
}

// Each time this module loads, a hot update among them, the page's one pair of listeners starts calling these.
installFrameKeys(window, { capture: onKeyDown, bubble: onEscape })
