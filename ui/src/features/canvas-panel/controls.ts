import { CANVAS_CLOSED, MAIN_CANVAS, type CanvasState } from '#shared/protocol/canvas.ts'
import { focusInput, focusTalk } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { hostStore, runCommand } from '@/lib/host/index.ts'
import { inMacWindow } from '@/lib/native.ts'
import { isOpen, showingCanvas, splitOwner, windowCanvas } from './rules.ts'
import { hereOf, useCanvasBoards } from './store.ts'

/**
 * What the canvas's controls do, for the menu's canvas group, the frame's keys and the shell's Escape alike
 * (`040-canvas-board`). Each acts on one owner's canvas: `main`, or a durable hobkin's id.
 */

/** The commands act on the main hobkin's canvas with no `hobkin`, and on a durable hobkin's with its id. */
export const ownerArgs = (owner: string): { hobkin?: string } => (owner === MAIN_CANVAS ? {} : { hobkin: owner })

/** What the host says of `owner`'s canvas now, or null before it has said. */
function hostCanvasOf(owner: string): CanvasState | null {
  const host = hostStore.getState()
  if (owner === MAIN_CANVAS) return host.canvas
  return host.canvases ? (host.canvases[owner] ?? CANVAS_CLOSED) : null
}

/** `owner`'s canvas as the window shows it now. */
export function canvasNow(owner: string): CanvasState | null {
  return windowCanvas(hostCanvasOf(owner), hereOf(useCanvasBoards.getState(), owner))
}

const withHost = () => hasHost(hostStore.getState())

/** Closes `owner`'s canvas here at once and tells the host, which closes it for its hobkin too. */
export function closeCanvas(owner: string): void {
  useCanvasBoards.getState().closeHere(owner, hostCanvasOf(owner))
  if (withHost()) void runCommand('canvas.close', ownerArgs(owner)).catch(() => {})
}

/**
 * Escape in a canvas: it closes, and the keyboard goes to its agent. The main canvas goes back to the place it was
 * opened over, with the keyboard in the message input; a durable hobkin's split undoes, with it in the page's talk box.
 */
export function closeCanvasFromKeys(owner: string): void {
  closeCanvas(owner)
  if (owner === MAIN_CANVAS) {
    useView.getState().closeCanvasPlace()
    focusInput()
  } else if (!focusTalk()) focusInput()
}

/** Saves `owner`'s drawing, and keeps where the file went, or why it could not go, as the canvas's note. */
export function saveCanvas(owner: string): void {
  const canvas = canvasNow(owner)
  if (!isOpen(canvas) || canvas.kind !== 'drawing') return
  void useCanvasBoards.getState().save(owner, canvas, () => runCommand('canvas.save', ownerArgs(owner)))
}

export const reloadCanvas = (owner: string): void => useCanvasBoards.getState().reload(owner)

/** Whether Open in the browser can go anywhere: through the host, or from a plain browser tab. */
export const canOpenInBrowser = (withAHost: boolean): boolean => withAHost || !inMacWindow()

/** Opens the page in the Mac's browser through the host, or in a new tab when the window is itself a browser tab. */
export function openInBrowser(url: string): void {
  if (withHost()) void runCommand('system.open', { url }).catch(() => {})
  else if (!inMacWindow()) window.open(url, '_blank', 'noopener,noreferrer')
}

/** Opens the file a Save wrote. */
export const openSaved = (path: string): void => void runCommand('file.open', { path }).catch(() => {})

/** The canvas on screen now, and where its agent takes the keyboard (`showingCanvas`). */
export function canvasShowingNow(): { owner: string; agent: 'input' | 'talk' } | null {
  const { screen, openAgent } = useView.getState()
  return showingCanvas({ screen, openAgent }, canvasNow)
}

/** The main canvas has its place in the menu: it is open, and no durable hobkin's split has the row. */
export function mainCanvasInMenu(): boolean {
  const { screen, openAgent } = useView.getState()
  return isOpen(canvasNow(MAIN_CANVAS)) && splitOwner({ screen, openAgent }, canvasNow) === null
}

/** The canvas a key was pressed in, by the area or the menu's controls it came from: whose it is and what it shows. */
export function boardAt(target: EventTarget | null): { owner: string; kind: 'page' | 'drawing' } | null {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>('[data-canvas-board], [data-canvas-controls]')
  const owner = element?.dataset.canvasBoard ?? element?.dataset.canvasControls
  if (!element || !owner) return null
  return { owner, kind: element.dataset.canvasKind === 'drawing' ? 'drawing' : 'page' }
}
