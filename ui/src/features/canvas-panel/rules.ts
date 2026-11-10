import { isLocalPage } from '#shared/protocol/canvas.ts'

/** How wide the panel may be, as a share of the area it lies over. It opens at about half. */
export const PANEL_WIDTH = { initial: 0.5, min: 0.3, max: 0.8 } as const

export const clampWidth = (share: number): number => Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, share))

/**
 * What the framed page may do. A page on this Mac (localhost or 127.0.0.1 over http) runs scripts with its own
 * origin, as it does in a tab, so a dev server works. Any other page runs scripts but without its origin, so it
 * cannot read cookies or storage, and nothing else is granted: no top-level navigation, no downloads.
 */
export function sandboxFor(url: string): string {
  return isLocalPage(url) ? 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals' : 'allow-scripts allow-forms allow-popups'
}

/** The name in the bar: what hobkin called the page, or the page's host. */
export function labelFor(url: string, title: string | null): string {
  if (title?.trim()) return title.trim()
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** How long a page may take to load before the panel says it may refuse to be framed. */
export const LOAD_PATIENCE_MS = 8000
