import type { MemoryNote } from '#shared/protocol/memory.ts'
import { lineWords } from './line.ts'
import { LinkPress } from './LinkPress.tsx'
import { memoryActions, openMemory, useMemory } from './use-memories.ts'

/**
 * See and Undo after the words of a chat line hobkin posts when an agent changes a memory (`057-shared-memory`). See
 * opens the Memory page on that memory. Undo is sent once and turns into what it did, in its own place on one line of
 * fixed height, so See never moves and the transcript does not shift.
 */
export function MemoryLine({ note }: { note: MemoryNote }) {
  const words = lineWords(useMemory((state) => state.lines[note.change]))
  return (
    <span className="mt-1 flex h-6 min-w-0 items-center gap-3 text-[12.5px]">
      <LinkPress onPress={() => openMemory(note.name)} label={`See the memory ${note.name} on the Memory page`}>
        See
      </LinkPress>
      {words === null ? (
        <LinkPress onPress={() => void memoryActions.undoLine(note.change)} label="Undo this change to a memory">
          Undo
        </LinkPress>
      ) : (
        <span role="status" title={words} className="min-w-0 truncate text-muted-foreground">
          {words}
        </span>
      )}
    </span>
  )
}
