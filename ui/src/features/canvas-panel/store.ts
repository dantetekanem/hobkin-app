import { create } from 'zustand'
import { MAIN_CANVAS, type CanvasState } from '#shared/protocol/canvas.ts'
import { canvasKey, type CanvasHere } from './rules.ts'

/** After Save: where the file went, or the host's sentence. */
export type SavedNote = { path: string } | { error: string }

/** What the window keeps of one canvas beside what the host says of it. */
export interface Board {
  /** Goes up to load the canvas again: Reload. */
  reloads: number
  /** The last Save's note, for the canvas as it was then (`canvasKey`). A canvas that changed since has none. */
  saved: { for: string; note: SavedNote } | null
  /** The canvas the user closed here, until the host says anything new (`windowCanvas`). */
  closed: string | null
}

const NO_BOARD: Board = { reloads: 0, saved: null, closed: null }

interface CanvasBoardsState {
  /** By owner: `main` for the main hobkin's canvas, a durable hobkin's id for its own. */
  boards: Record<string, Board>
  /** Development only: the main canvas shown by hand (`window.__canvasDev`), over what the host said then. */
  dev: CanvasHere['dev']
  reload: (owner: string) => void
  /** Closes the canvas here at once, while the host is told. `host` is what the host says of it now. */
  closeHere: (owner: string, host: CanvasState | null | undefined) => void
  /** Saves the drawing through `run` and keeps the answer as the note for the canvas as it is now. */
  save: (owner: string, canvas: CanvasState, run: () => Promise<{ path: string }>) => Promise<void>
  /** Shows a canvas by hand as the main one, for checks without hobkin. `host` is what the host says of it now. */
  showDev: (canvas: CanvasState, host: CanvasState | null | undefined) => void
}

/**
 * The window's own part of each canvas, by owner (`040-canvas-board`). The host decides what each canvas shows, and the
 * views read that straight from the host's state; this keeps only Reload, the Save note, a close the host has not
 * answered yet, and the development helper's canvas.
 */
export const useCanvasBoards = create<CanvasBoardsState>()((set, get) => {
  const change = (owner: string, update: (board: Board) => Partial<Board>) => {
    const board = get().boards[owner] ?? NO_BOARD
    set({ boards: { ...get().boards, [owner]: { ...board, ...update(board) } } })
  }
  return {
    boards: {},
    dev: null,
    reload: (owner) => change(owner, (board) => ({ reloads: board.reloads + 1 })),
    closeHere: (owner, host) => {
      const { dev } = get()
      if (owner === MAIN_CANVAS && dev && dev.over === canvasKey(host)) set({ dev: { canvas: { ...dev.canvas, open: false }, over: dev.over } })
      else change(owner, () => ({ closed: canvasKey(host) }))
    },
    save: async (owner, canvas, run) => {
      const key = canvasKey(canvas)
      try {
        const { path } = await run()
        change(owner, () => ({ saved: { for: key, note: { path } } }))
      } catch (error) {
        const why = error instanceof Error && error.message ? error.message : 'The drawing could not be saved.'
        change(owner, () => ({ saved: { for: key, note: { error: why } } }))
      }
    },
    showDev: (canvas, host) => set({ dev: { canvas, over: canvasKey(host) } }),
  }
})

/** What the window adds to the host's word on `owner`'s canvas. */
export function hereOf(state: Pick<CanvasBoardsState, 'boards' | 'dev'>, owner: string): CanvasHere {
  return { closed: state.boards[owner]?.closed ?? null, dev: owner === MAIN_CANVAS ? state.dev : null }
}

/** The Save note to show over `canvas`: only one made for it as it is now. */
export function savedNote(board: Board | undefined, canvas: CanvasState | null): SavedNote | null {
  return board?.saved && canvas && board.saved.for === canvasKey(canvas) ? board.saved.note : null
}
