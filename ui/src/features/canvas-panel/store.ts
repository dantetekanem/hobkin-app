import { create } from 'zustand'
import { MAIN_CANVAS, type CanvasKind, type CanvasState } from '#shared/protocol/canvas.ts'
import { clampWidth, PANEL_WIDTH } from './rules.ts'

/**
 * The canvas panel's own state. The host decides when hobkin opens or closes it (`apply`); the user's close and
 * the dev helper act here at once. The page stays after closing, so the panel can slide away with it still drawn.
 */
interface CanvasPanelState {
  open: boolean
  url: string | null
  title: string | null
  kind: CanvasKind
  /** Goes up each time a drawing is replaced. */
  revision: number | undefined
  /** Whose canvas the panel shows now. */
  owner: string
  /** Each owner's width, kept while the panel shows another's. */
  widths: Record<string, number>
  /** After Save: where the file went, or the host's sentence. Gone when the canvas changes or closes. */
  saved: { path: string } | { error: string } | null
  /** Goes up to load the page again. */
  reloads: number
  /** The panel's share of the area it lies over. */
  width: number
  show: (url: string, title?: string | null, drawing?: { kind?: CanvasKind; revision?: number }) => void
  close: () => void
  reload: () => void
  resize: (share: number) => void
  /** Shows `owner`'s canvas: swaps to it when the owner changed, then follows what the host said about it. */
  sync: (owner: string, canvas: CanvasState | null | undefined) => void
  /** Saves the drawing through `run` and keeps the answer in `saved`. */
  save: (run: (owner: string) => Promise<{ path: string }>) => Promise<void>
  /** Follows what the host said. */
  apply: (state: CanvasState) => void
}

type ShownCanvas = Pick<CanvasPanelState, 'open' | 'url' | 'title' | 'kind' | 'revision' | 'saved' | 'reloads'>

/** No canvas at all: the panel as it starts, and as it is the moment it moves to another owner's canvas. */
const NO_CANVAS: ShownCanvas = {
  open: false,
  url: null,
  title: null,
  kind: 'page',
  revision: undefined,
  saved: null,
  reloads: 0,
}

export const useCanvasPanel = create<CanvasPanelState>()((set, get) => ({
  ...NO_CANVAS,
  owner: MAIN_CANVAS,
  widths: {},
  width: PANEL_WIDTH.initial,
  show: (url, title = null, drawing) => {
    set({
      open: true,
      url,
      title,
      kind: drawing?.kind ?? 'page',
      revision: drawing?.revision,
      saved: null,
    })
  },
  close: () => set({ open: false, saved: null }),
  reload: () => set({ reloads: get().reloads + 1 }),
  resize: (share) => {
    const width = clampWidth(share)
    set({ width, widths: { ...get().widths, [get().owner]: width } })
  },
  sync: (owner, canvas) => {
    const now = get()
    if (owner !== now.owner) {
      set({
        ...NO_CANVAS,
        owner,
        widths: { ...now.widths, [now.owner]: now.width },
        width: now.widths[owner] ?? PANEL_WIDTH.initial,
      })
    }
    if (canvas) get().apply(canvas)
  },
  save: async (run) => {
    const owner = get().owner
    // An answer that comes back once the panel shows another owner's canvas is not kept.
    const stillShown = () => get().owner === owner
    try {
      const { path } = await run(owner)
      if (stillShown()) set({ saved: { path } })
    } catch (error) {
      const why = error instanceof Error && error.message ? error.message : 'The drawing could not be saved.'
      if (stillShown()) set({ saved: { error: why } })
    }
  },
  apply: ({ open, url, title, kind, revision }) => {
    const now = get()
    if (open && url) {
      const next = { kind: kind ?? 'page', revision }
      // The same canvas said again keeps the note from Save. Anything new clears it.
      const same =
        now.open &&
        now.url === url &&
        now.title === title &&
        now.kind === next.kind &&
        now.revision === revision
      set({ open: true, url, title, ...next, ...(same ? {} : { saved: null }) })
    } else if (now.open) {
      set({ open: false, saved: null })
    }
  },
}))
