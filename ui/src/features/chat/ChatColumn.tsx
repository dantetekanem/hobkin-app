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
 * Until a host answers it shows the frame's sample conversation, labelled as sample data.
 */
export function ChatColumn() {
  const column = useRef<HTMLDivElement | null>(null)
  const scroll = usePinnedScroll()
  const hasHost = useHasHost()
  const messages = useHost((state) => state.messages)
  const live = useHost((state) => state.live)
  const epoch = useHost((state) => state.epoch)
  const readOnly = useHost((state) => (state.owner?.state === 'read-only' ? state.owner : null))
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
          empty="Nothing has been said yet. Write to hobkin below."
          label={hasHost ? undefined : 'Sample data'}
        />
      </div>
      {readOnly ? <ReadOnlyNotice savedAt={readOnly.savedAt} /> : null}
      <Composer scroll={scroll} followWithin={column} />
    </div>
  )
}

const savedTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** Another process owns the home, so this is the last view it saved. The host takes over by itself when it lets go. */
function ReadOnlyNotice({ savedAt }: { savedAt: string | null }) {
  const at = Date.parse(savedAt ?? '')
  return (
    <div className="shrink-0 px-3 pb-1">
      <p role="status" className="mx-auto max-w-[640px] rounded-2xl bg-surface-2 px-3.5 py-2 text-[13px] leading-snug">
        hobkin is open in the terminal app. This is the conversation as it was last saved{Number.isFinite(at) ? ` at ${savedTime.format(at)}` : ''}, and it goes live here
        when the terminal app closes.
      </p>
    </div>
  )
}
