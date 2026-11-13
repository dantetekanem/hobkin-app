import { isLocalPage, MAIN_CANVAS, type CanvasKind } from '#shared/protocol/canvas.ts'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'

/** How wide the panel may be, as a share of the area it lies over. It opens at about half. */
export const PANEL_WIDTH = { initial: 0.5, min: 0.3, max: 0.8 } as const

export const clampWidth = (share: number): number => Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, share))

/**
 * What the framed page may do. A page on this Mac (localhost or 127.0.0.1 over http) runs scripts with its own
 * origin, as it does in a tab, so a dev server works. Any other page runs scripts but without its origin, so it
 * cannot read cookies or storage, and nothing else is granted: no top-level navigation, no downloads.
 */
export function sandboxFor(url: string, kind: CanvasKind = 'page'): string {
  // A drawing is served from this Mac but written by a model: it runs without an origin, whatever its address.
  if (kind === 'drawing') return 'allow-scripts allow-forms allow-popups allow-modals'
  if (isLocalPage(url)) return 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
  return 'allow-scripts allow-forms allow-popups'
}

/** The name in the bar: what hobkin called it, else "Drawing" for a drawing, else the page's host. */
export function labelFor(url: string, title: string | null, kind: CanvasKind = 'page'): string {
  if (title?.trim()) return title.trim()
  if (kind === 'drawing') return 'Drawing'
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Whose canvas the panel shows: a durable hobkin's while its page is on screen, the main hobkin's everywhere else. */
export function canvasOwner({ screen, openAgent }: { screen: string; openAgent: string | null }): string {
  return (screen === 'agent' && hobkinOfAgent(openAgent)) || MAIN_CANVAS
}

/** The frame's key: a new address, a new revision or a Reload loads the page again. */
export const frameKey = (url: string, revision: number | undefined, reloads: number): string => `${url}#${revision ?? 0}#${reloads}`

/** Only a drawing can be saved as a file. */
export const canSave = (kind: CanvasKind | undefined): boolean => kind === 'drawing'

/** How long a page may take to load before the panel says it may refuse to be framed. */
export const LOAD_PATIENCE_MS = 8000
