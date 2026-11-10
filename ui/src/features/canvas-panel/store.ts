import { create } from 'zustand'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import { clampWidth, PANEL_WIDTH } from './rules.ts'

/**
 * The canvas panel's own state. The host decides when hobkin opens or closes it (`apply`); the user's close and
 * the dev helper act here at once. The page stays after closing, so the panel can slide away with it still drawn.
 */
interface CanvasPanelState {
  open: boolean
  url: string | null
  title: string | null
  /** Goes up to load the page again. */
  reloads: number
  /** The panel's share of the area it lies over. */
  width: number
  show: (url: string, title?: string | null) => void
  close: () => void
  reload: () => void
  resize: (share: number) => void
  /** Follows what the host said. */
  apply: (state: CanvasState) => void
}

export const useCanvasPanel = create<CanvasPanelState>()((set, get) => ({
  open: false,
  url: null,
  title: null,
  reloads: 0,
  width: PANEL_WIDTH.initial,
  show: (url, title = null) => set({ open: true, url, title }),
  close: () => set({ open: false }),
  reload: () => set({ reloads: get().reloads + 1 }),
  resize: (share) => set({ width: clampWidth(share) }),
  apply: ({ open, url, title }) => {
    if (open && url) set({ open: true, url, title })
    else if (get().open) set({ open: false })
  },
}))
