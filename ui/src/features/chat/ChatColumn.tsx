import { useMemo, useRef } from 'react'
import { sampleMessages } from '@/app/sample.ts'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { useChat } from './chat-store.ts'
import { Composer } from './Composer.tsx'
import { buildConversation } from './conversation.ts'
import { MessageList } from './MessageList.tsx'
import { useNow } from './use-now.ts'
import { usePinnedScroll } from './use-pinned-scroll.ts'
import { usePresence } from './use-presence.ts'

const MINUTE_MS = 60000

// The frame's sample conversation, in the shape hobkin's messages have, a minute apart and ending now.
const loadedAt = Date.now()
const SAMPLE: ChatMessage[] = sampleMessages.map((message, index) => ({
  id: `sample:${message.id}`,
  role: message.role === 'hobkin' ? 'assistant' : message.role,
  content: message.text,
  at: loadedAt - (sampleMessages.length - index) * MINUTE_MS,
  ...(message.tone ? { tone: message.tone } : {}),
}))

/**
 * The conversation column. The frame mounts this file and it fills the space it is given.
 * It shows hobkin's stored conversation, the reply being written and what was just sent, and holds the input.
 * A browser tab with no host shows the frame's sample conversation, labelled as sample data. The Mac window never
 * does: until its host first answers it says it is connecting.
 */
export function ChatColumn() {
  const column = useRef<HTMLDivElement | null>(null)
  const scroll = usePinnedScroll()
  const hasHost = useHasHost()
  const connecting = useHost((state) => state.home === null)
  const messages = useHost((state) => state.messages)
  const live = useHost((state) => state.live)
  const epoch = useHost((state) => state.epoch)
  const outbox = useChat((chat) => chat.outbox.entries)
  const local = useChat((chat) => chat.local)
  usePresence(useChat((chat) => chat.draft.text.length > 0))
  // Only the day labels depend on the clock, so a look every minute is enough.
  const now = useNow(true, MINUTE_MS)

  const days = useMemo(
    () => (hasHost ? buildConversation({ messages, local, live, outbox, now }) : buildConversation({ messages: SAMPLE, now })),
    [hasHost, messages, local, live, outbox, now],
  )

  return (
    <div ref={column} className="flex h-full min-w-0 flex-col">
      <div className="min-h-0 flex-1">
        <MessageList
          days={days}
          epoch={hasHost ? epoch : -1}
          scroll={scroll}
          empty={connecting ? 'Connecting to hobkin…' : 'Nothing has been said yet. Write to hobkin below.'}
          label={hasHost ? undefined : 'Sample data'}
        />
      </div>
      <Composer scroll={scroll} followWithin={column} />
    </div>
  )
}
