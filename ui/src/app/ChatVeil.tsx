import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useEffect, useState } from 'react'
import { HistoryView, type HistoryViewProps } from '@/features/chat/HistoryView.tsx'
import { clockTime, dayLabel } from '@/features/reports/time.ts'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { hostStore, runCommand, useHasHost, useHost, useSessions } from '@/lib/host/index.ts'
import { requestCanvasFocus } from './focus.ts'
import { keyboardHomeFor } from './key-map.ts'
import { sampleMessages } from './sample.ts'
import { stillVariants, useStill } from './still.ts'
import { useView } from './view-store.ts'

/** How far the blur goes, and how much of the chat's own color lies over it. */
const BLUR = 'blur(14px)'
const TINT = 0.72
/** How often History lists again while it still waits for titles, in milliseconds. */
const TITLING_EVERY = 3000

// One transition drives the blur, the tint and the list, so the veil thickens exactly as the list slides in.
// Opacity on a parent would not do: a blurred backdrop does not fade with its parent, it pops.
const arrive: Transition = spring.sheet
const leave: Transition = { ...spring.sheet, duration: 0.3 }

/**
 * Earlier conversations, as a veil over the chat. It is not a pane: it lies inside the chat's own bounds, the
 * conversation stays visible beneath it, and it leaves as soon as something is chosen. Projects live in Work.
 *
 * Its keys are the frame's (`key-map.ts`): Up and Down walk the list, Enter chooses and Escape closes, wherever
 * the keyboard was when the veil opened. The reached row is state, not focus, so a click on the header's button
 * works the same as its key.
 */
export function ChatVeil() {
  const still = useStill()
  const veil = useView((view) => view.veil)
  const closeVeil = useView((view) => view.closeVeil)

  const close = () => {
    closeVeil()
    // Back on an agent's screen, the keyboard stays on it: the chat's input would close it.
    if (keyboardHomeFor(useView.getState().screen) === 'canvas') requestCanvasFocus()
    else document.querySelector<HTMLTextAreaElement>('[data-chat-side] textarea')?.focus()
  }

  return (
    <AnimatePresence>
      {veil !== null ? (
        <motion.div
          key="veil"
          role="dialog"
          aria-label="Earlier conversations"
          data-chat-veil
          className="select-none-chrome absolute inset-0 z-10"
          initial="away"
          animate="here"
          exit="away"
          variants={{ away: { transition: leave }, here: { transition: arrive } }}
        >
          {/* The blur grows from nothing. */}
          <motion.div
            className="absolute inset-0"
            variants={{
              away: { backdropFilter: 'blur(0px)', transition: leave },
              here: { backdropFilter: BLUR, transition: arrive },
            }}
          />
          {/* The chat's own color settles over it. A click on the veil closes the list. */}
          <motion.div
            className="absolute inset-0 bg-background"
            variants={{ away: { opacity: 0, transition: leave }, here: { opacity: TINT, transition: arrive } }}
            onClick={close}
          />
          <motion.div
            className="relative flex max-h-full flex-col overflow-hidden"
            variants={stillVariants(
              {
                away: { opacity: 0, transform: 'translateY(-32px)', transition: leave },
                here: { opacity: 1, transform: 'translateY(0px)', transition: arrive },
              },
              still,
            )}
          >
            <Conversations onClose={close} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** A row of the list. `when` says "Now" for the conversation hobkin is in, which holds what `/clear` hid. */
interface Listed {
  id: string
  title: string
  when: string
  messages: number
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
/** A host started before History existed refuses its commands by name. Say what to do instead of the refusal. */
const listingRefusal = (error: unknown) =>
  /no command named "?history\./i.test(reason(error)) ? 'History needs hobkin to restart once: the running host is older than History.' : reason(error)

/** With no host, a row opens the chat's own sample conversation. */
const SAMPLE: HistoryViewProps['conversation'] = {
  messages: sampleMessages.flatMap(({ role, text }) => (role === 'notice' ? [] : [{ role: role === 'user' ? ('user' as const) : ('assistant' as const), text, at: null }])),
  earlier: 0,
  cut: false,
}

/**
 * hobkin's main conversations, newest first, read from the host's home each time History opens. Choosing one opens
 * it in place of the list. Its back arrow returns to the list at the same row.
 */
function Conversations({ onClose }: { onClose: () => void }) {
  const live = useHasHost()
  const sample = useSessions()
  const setVeilActive = useView((view) => view.setVeilActive)
  const home = useHost((state) => state.home), epoch = useHost((state) => state.epoch)
  const [listed, setListed] = useState<Listed[] | string | null>(null)
  const [opened, setOpened] = useState<{ home: string | null; epoch: number; row: number; chosen: Listed; conversation: HistoryViewProps['conversation']; error: string | null } | null>(null)

  useEffect(() => {
    setOpened(null)
    setListed(null)
    if (!live) return
    let gone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const when = (at: number, current: boolean) => (current ? 'Now' : `${dayLabel(at, Date.now())}, ${clockTime(at)}`)
    // While titles are being made, list again: a title that arrives replaces the first line in place.
    const load = (first: boolean) =>
      runCommand('history.list').then(
        ({ conversations, titling }) => {
          if (gone) return
          setListed(conversations.map(({ id, title, at, messages, current }) => ({ id, title, messages, when: when(at, current) })))
          if (titling && titling > 0) timer = setTimeout(() => load(false), TITLING_EVERY)
        },
        (error: unknown) => {
          if (!gone && first) setListed(listingRefusal(error))
        },
      )
    load(true)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [live, home, epoch])

  const open = (row: number, chosen: Listed) => {
    setOpened({ home, epoch, row, chosen, conversation: live ? null : SAMPLE, error: null })
    if (!live) return
    // A late answer cannot cross the selected row or the host's source generation.
    const source = hostStore.getState()
    const settle = (change: { conversation: HistoryViewProps['conversation'] } | { error: string }) => {
      const current = hostStore.getState()
      if (current.home !== source.home || current.epoch !== source.epoch || current.link !== 'open') return
      setOpened((now) => (now?.chosen.id === chosen.id ? { ...now, ...change } : now))
    }
    runCommand('history.open', { id: chosen.id }).then(
      (conversation) => settle({ conversation }),
      (error: unknown) => settle({ error: reason(error) }),
    )
  }

  if (opened && opened.home === home && opened.epoch === epoch) {
    const back = () => {
      setVeilActive(opened.row)
      setOpened(null)
    }
    return <HistoryView title={opened.chosen.title} when={opened.chosen.when} conversation={opened.conversation} error={opened.error} onBack={back} onClose={onClose} />
  }

  const rows = live ? listed : sample
  return (
    <div role="listbox" aria-label="Earlier conversations" data-veil-list className="scroll-quiet min-h-0 overflow-y-auto px-3 pt-2 pb-4">
      <div className="mx-auto flex max-w-[640px] flex-col gap-0.5">
        {typeof rows === 'string' || !rows?.length ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{typeof rows === 'string' ? rows : rows ? 'No conversations yet.' : 'Looking for conversations…'}</p>
        ) : (
          rows.map((session, row) => (
            <Row key={session.id} row={row} onChoose={() => open(row, session)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] leading-tight">{session.title}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {session.when} · {session.messages} messages
                </span>
              </span>
            </Row>
          ))
        )}
      </div>
    </div>
  )
}

function Row({ row, onChoose, children }: { row: number; onChoose: () => void; children: React.ReactNode }) {
  const active = useView((view) => view.veilActive === row)
  const setVeilActive = useView((view) => view.setVeilActive)

  return (
    <div
      role="option"
      aria-selected={active}
      data-veil-row
      data-active={active}
      onClick={onChoose}
      // The pointer and the arrows share one selection.
      onPointerMove={() => {
        if (!active) setVeilActive(row)
      }}
      className={cn(
        'flex w-full cursor-default items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-[120ms] ease-[ease]',
        active && 'bg-surface-2',
      )}
    >
      {children}
    </div>
  )
}
