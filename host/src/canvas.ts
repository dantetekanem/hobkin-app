import { CANVAS_CLOSED, canvasUrl, type CanvasState } from '#shared/protocol/canvas.ts'

/**
 * The canvas panel's state: the page hobkin wants to show beside the screens (`030-canvas-panel`). The host only
 * holds it and tells the window; the window draws the iframe. Nothing here opens a browser or fetches the page.
 */
export class Canvas {
  state: CanvasState = CANVAS_CLOSED
  private readonly onChange: () => void

  constructor({ onChange }: { onChange: () => void }) {
    this.onChange = onChange
  }

  /** Opens the panel on a page, or moves it to another. Throws in plain words for an address it will not show. */
  show(address: string, title?: string): CanvasState {
    const url = canvasUrl(address).href
    this.set({ open: true, url, title: title?.trim() || null })
    return this.state
  }

  close(): CanvasState {
    this.set(CANVAS_CLOSED)
    return this.state
  }

  private set(next: CanvasState) {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    this.onChange()
  }
}
