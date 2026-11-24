/**
 * The parts of hobkin's memories (057-shared-memory) the host and its tests call, typed here because hobkin ships plain
 * JavaScript. Each answer is in the shapes of `shared/protocol/memory.ts`, and the host reads it without trust, so it is
 * `unknown` here. A hobkin from before has none of these files. hobkin stays the owner of all of it.
 */

declare module 'hobkin/src/cli/memory-window.mjs' {
  type MemorySave = import('#shared/protocol/memory.ts').MemorySave
  type MemoryForget = import('#shared/protocol/memory.ts').MemoryForget
  type MemoryUndo = import('#shared/protocol/memory.ts').MemoryUndo
  type MemoryNowChange = import('#shared/protocol/memory.ts').MemoryNowChange

  /** Every memory, private ones too, the right-now list and its version, and the files that are not memories. */
  export function memoryList(root: string): unknown
  /** Adds with no `version`, or changes the memory of that name; a change from here is the user's, from the window. */
  export function memorySave(root: string, save: MemorySave): unknown
  export function memoryForget(root: string, forget: MemoryForget): unknown
  export function memoryUndo(root: string, undo: MemoryUndo): unknown
  export function memoryNowChange(root: string, change: MemoryNowChange): unknown
}

declare module 'hobkin/src/cli/memories.mjs' {
  /** The index a run the user does not talk to reads: no private memory, within 4 KB, read whole with `recall`. */
  export function runIndex(root: string, recall?: 'hobkin_recall' | 'hobkin memory'): string
}

declare module 'hobkin/src/cli/inbox.mjs' {
  /** `hobkin remember` from another of the user's sessions: saved at once as a memory, and said in Chat with its change. */
  export function remember(root: string, handed: { words: readonly string[]; from: string },now?: number, options?: { env?: Record<string, string | undefined> }): { ok: boolean; id: string; memory?: string; message: string }
}
