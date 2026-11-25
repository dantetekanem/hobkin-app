import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ClaudeChoice, EngineChoice } from './rules.ts'

/** A hobkin this window started. It starts with no message, so its first turn begins on its page. */
interface StartedHobkin {
  id: string
}

/** A prompt the sheet carries from the full prompt editor: its words become the new hobkin's first message. */
export interface SheetPrompt {
  text: string
  /** How many images the draft holds. `hobkin.start` takes none, so they stay in the draft. */
  images: number
  /** The hobkin started with these words, so they leave the editor. Never called when the sheet closes or the start is refused. */
  onStarted: () => void
}

interface NewHobkinState {
  /** The New hobkin sheet is open. */
  open: boolean
  /** The prompt this opening of the sheet carries, or null for Command+N. Kept while the sheet leaves, so it keeps its size. */
  prompt: SheetPrompt | null
  /**
   * The folder and what it ran on the last time one was started, so the next sheet starts there, and the model and effort
   * the last one on Claude Code used, so choosing Claude Code starts there. Kept from before Claude Code had them, `claude`
   * may be missing.
   */
  last: { cwd: string | null; engine: EngineChoice | null; claude?: ClaudeChoice }
  /** The hobkin this window started last. Its page waits for it rather than saying it ended. */
  started: StartedHobkin | null

  /** Opens the sheet, carrying a prompt from the editor, or none. */
  openSheet: (prompt?: SheetPrompt) => void
  closeSheet: () => void
  /** A hobkin was started with these choices, and the prompt the sheet carried went with it. */
  remember: (started: StartedHobkin, cwd: string, engine: EngineChoice) => void
}

/**
 * The New hobkin sheet (Command+N) and the choices it keeps. The last folder and engine are kept in the window's
 * storage, as the tiers are (`tiers/store.ts`). See _specs/034-durable-hobkins.
 */
export const useNewHobkin = create<NewHobkinState>()(
  persist(
    (set, get) => ({
      open: false,
      prompt: null,
      last: { cwd: null, engine: null },
      started: null,
      openSheet: (prompt) => set({ open: true, prompt: prompt ?? null }),
      closeSheet: () => set({ open: false }),
      remember: (started, cwd, engine) => {
        get().prompt?.onStarted()
        set(({ last }) => ({
          started,
          last: { cwd, engine, claude: engine.kind === 'claude' && engine.model && engine.effort ? { model: engine.model, effort: engine.effort } : last.claude },
        }))
      },
    }),
    {
      name: 'hobkin-client-new-hobkin',
      version: 1,
      partialize: ({ last }) => ({ last }),
    },
  ),
)
