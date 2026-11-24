import type { LineUndo } from './store.ts'

/**
 * What a chat line about a memory says once its Undo was pressed, in the place Undo was (`057-shared-memory`): on its
 * way, done, or why not in the host's words. Null while Undo has not been pressed.
 */
export function lineWords(undo: LineUndo | undefined): string | null {
  if (!undo) return null
  if (undo.state === 'sending') return 'Undoing…'
  if (undo.state === 'undone') return 'Undone.'
  return `Not undone: ${undo.reason ?? 'hobkin did not say why.'}`
}
