import { create } from 'zustand'

/**
 * Where a screen's own controls along the top end, in canvas pixels from the canvas's left edge. The window's drag
 * strip starts there, so it takes no clicks over them. Zero when nothing on screen asks for it.
 */
export const useDragEdge = create<{ edge: number; set: (edge: number) => void }>()((set) => ({ edge: 0, set: (edge) => set({ edge }) }))

/** The drag strip's left edge: past the canvas's own shift, and past whatever a screen has claimed. */
export const dragLeft = (shift: number, edge: number): number => Math.max(shift, edge)
