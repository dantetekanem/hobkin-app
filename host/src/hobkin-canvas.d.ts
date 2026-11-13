/**
 * hobkin's canvas store (`src/cli/canvas.mjs`), typed here because hobkin ships plain JavaScript. The `hobkin canvas`
 * command writes the same files from other processes, so what these read can change at any time. Refusals are
 * thrown Errors with a plain sentence. See _specs/035-canvas-drawings.
 */

declare module 'hobkin/src/cli/canvas.mjs' {
  export interface CanvasEntry {
    open: boolean
    kind: 'page' | 'drawing' | null
    url: string | null
    title: string | null
    /** Goes up each time the canvas changes. */
    revision: number
    /** 32 random hex characters made at a drawing's first draw, or null before one. */
    key: string | null
    updatedAt: string
  }
  /** Every canvas by owner: `main`, or a durable hobkin's id. `{}` when the store is missing or unreadable. */
  export function readCanvases(root: string): Record<string, CanvasEntry>
  export function showPage(root: string, owner: string, page: { url: string; title?: string | null }): CanvasEntry
  export function drawCanvas(root: string, owner: string, drawing: { html: string; title?: string | null }): CanvasEntry
  export function closeCanvas(root: string, owner: string): CanvasEntry
  export function readCanvas(root: string, owner: string): { state: CanvasEntry; file: string | null }
  export function saveCanvas(root: string, owner: string, options?: { path?: string; downloads?: string; home?: string }): { path: string }
  /** The file that holds an owner's drawing. */
  export function drawingFile(root: string, owner: string): string
}
