import { create } from 'zustand'

interface ViewerState {
  /** The file the viewer shows, or last showed: it stays while the sheet leaves, so it does not empty as it goes. */
  path: string | null
  open: boolean
  openFile: (path: string) => void
  closeViewer: () => void
}

/** The file viewer sheet: which file, and whether it is open. Not kept between runs. */
export const useViewer = create<ViewerState>()((set) => ({
  path: null,
  open: false,
  openFile: (path) => set({ path, open: true }),
  closeViewer: () => set({ open: false }),
}))
