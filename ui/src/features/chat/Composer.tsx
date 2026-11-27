import { FileText, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useView } from '@/app/view-store.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useHost } from '@/lib/host/index.ts'
import { executionKey, executionTargets } from '../work/actions.ts'
import { useExecution } from '../work/store.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { AttachButton, AttachmentTray } from './AttachmentTray.tsx'
import { availabilityOf } from './availability.ts'
import { canSendDraft, useChat } from './chat-store.ts'
import { ChatAvatar } from './ChatAvatar.tsx'
import { composerKey, type ComposerKeyAction } from './composer-keys.ts'
import { PromptEditor } from './PromptEditor.tsx'
import { useReportReply } from '@/features/reports/reply.ts'
import { watchRoutineSuggestion } from '@/features/routines/ask.ts'
import { slashList, type SlashKey } from './slash.ts'
import { SlashPanel, slashRowId } from './SlashPanel.tsx'
import { StatusLine } from './StatusLine.tsx'
import { imagesLine, QueuedRows, SendButton } from './TalkControls.tsx'
import { STOP_ARMED_MS, stopKey } from './stop-key.ts'
import { armedAt, shownTurn, type ArmedStop } from './stop-turn.ts'
import type { PinnedScroll } from './use-pinned-scroll.ts'

/** The input stops growing here and scrolls instead. */
const MAX_INPUT_HEIGHT = 200

const SLASH_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'] satisfies SlashKey[]

const firstLine = (input: HTMLTextAreaElement) => !input.value.slice(0, input.selectionStart).includes('\n')
const lastLine = (input: HTMLTextAreaElement) => !input.value.slice(input.selectionEnd).includes('\n')
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true

export interface ComposerProps {
  /** The conversation, scrolled from the input with Page Up, Page Down and Command Down. */
  scroll: PinnedScroll
  /** The area the avatar's eyes follow the pointer in. */
  followWithin: RefObject<HTMLDivElement | null>
}

/**
 * The message input, with the avatar beside it, the line above it that says what hobkin is doing, the images
 * attached to the draft, and the list of commands for a message that starts with a slash.
 *
 * Keys, as in Pi's terminal (`composer-keys.ts`): Enter sends, and during a turn steers it; Alt+Enter queues the message
 * for after the turn; Control+Enter stops the turn and sends at once. Enter in an empty message continues a turn the
 * user stopped, and Alt+Up brings what waits for the turn back into the input. Shift+Enter adds a line.
 * Escape twice, or Control+C, stops a running turn: the first Escape only asks, since one press is too easy to make by
 * mistake. With no turn running, Escape drops the report the message is about. Up in an empty message brings
 * back earlier messages. Command+U attaches an image and Backspace at the start removes the last one.
 * Control+Option+P opens the full prompt editor. Page Up, Page Down and Command+Down move the conversation.
 * While the command list is open, Tab completes, Up and Down move, Enter runs and Escape closes.
 */
export function Composer({ scroll, followWithin }: ComposerProps) {
  const text = useChat((chat) => chat.draft.text)
  const attachments = useChat((chat) => chat.draft.attachments)
  const problem = useChat((chat) => chat.problem)
  const said = useChat((chat) => chat.said)
  const commands = useChat((chat) => chat.commands)
  const slash = useChat((chat) => chat.slash)
  const sent = useChat((chat) => chat.outbox.entries)
  const { change, send, sendDuring, stop, dequeue, continueTurn, attach, detach, slashKey, reachCommand } = useChat.getState()

  const link = useHost((state) => state.link)
  const home = useHost((state) => state.home)
  const owner = useHost((state) => state.owner)
  const signIn = useHost((state) => state.signIn)
  const models = useHost((state) => state.models)
  const availability = availabilityOf({ link, home, owner, signIn, models })
  const ready = availability.ready
  // The turn that can be stopped, by its run, so a stop armed during one turn is never armed for the next.
  const turn = useHost(shownTurn)
  const turnRunning = turn !== null
  // With link, home and owner above, exactly what `executionTargets` reads, so a word of a reply being written does not
  // draw the input again. Its disconnect boundary (`observeExecutionBoundary`) moves only with link, home and epoch.
  const { epoch, stopControls } = useHost(useShallow((state) => ({ epoch: state.epoch, stopControls: state.snapshot.stopControls })))
  const main = useMemo(
    () => executionTargets({ link, home, owner, epoch, snapshot: { stopControls } }).find(target => target.kind === 'main'),
    [link, home, owner, epoch, stopControls],
  )
  const execution = useExecution()
  const stopping = main !== undefined && execution.pending[executionKey(main, 'stop')] === true
  const canSend = ready && canSendDraft({ text, attachments })
  // What the user sent that waits for the running turn, shown above the input until the model reads it.
  const queued = useMemo(() => sent.flatMap((entry) => (entry.queue ? [{ key: String(entry.id), queue: entry.queue, text: entry.text || imagesLine(entry.images ?? 0) }] : [])), [sent])
  // The last turn is one the user stopped and nothing has started since, so Enter in an empty message continues it.
  const stoppedTurn = useHost((state) => state.snapshot.mainStopped ?? null)
  const stopped = ready && !turnRunning && stoppedTurn !== null
  const list = ready ? slashList(text, commands, slash) : null
  // The report the next message is about, chosen with r on a report.
  const report = useReportReply((reply) => reply.report)
  const dropReport = useReportReply((reply) => reply.clear)

  const input = useRef<HTMLTextAreaElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const listId = useId()
  const [dropping, setDropping] = useState(false)
  // When the first Escape of a stop was pressed, and during which turn, while the second is waited for.
  const [armed, setArmed] = useState<ArmedStop | null>(null)
  const stopArmedAt = armedAt(armed, turn)
  const stopArmed = stopArmedAt !== null

  // The first Escape waits only so long for the second, and a turn that ended has nothing left to stop.
  useEffect(() => {
    if (armed === null) return
    if (stopArmedAt === null) return setArmed(null)
    const timer = setTimeout(() => setArmed(null), STOP_ARMED_MS)
    return () => clearTimeout(timer)
  }, [armed, stopArmedAt])

  // The input is as tall as its text, up to a limit. The height is set, never animated.
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [text])

  // A message the Routines screen suggests goes into the input, to edit and send. It is never sent by itself.
  useEffect(() => watchRoutineSuggestion(useChat, () => input.current?.focus()), [])

  // A file dropped anywhere in the window would make the browser open it in place of the app.
  // Over the chat it is attached. Anywhere else nothing happens.
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      setDropping(event.target instanceof Element && event.target.closest('[data-chat-side]') !== null)
    }
    const done = () => setDropping(false)
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      setDropping(false)
      if (event.target instanceof Element && event.target.closest('[data-chat-side]')) attach([...(event.dataTransfer?.files ?? [])])
    }
    addEventListener('dragover', over)
    addEventListener('dragleave', done)
    addEventListener('drop', drop)
    return () => {
      removeEventListener('dragover', over)
      removeEventListener('dragleave', done)
      removeEventListener('drop', drop)
    }
  }, [attach])

  const runSendKey = (action: ComposerKeyAction['do']) => {
    switch (action) {
      case 'send':
        return void send()
      case 'follow-up':
      case 'interrupt':
        return void sendDuring(action)
      case 'continue':
        return continueTurn()
      case 'dequeue':
        return dequeue()
      case 'nothing':
        return
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    const element = event.currentTarget
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    const used = () => event.preventDefault()

    if (event.ctrlKey && event.altKey && event.code === 'KeyP') {
      change({ type: 'editor-toggled' })
      return used()
    }
    // While the list of commands is open its keys come first. A key the list has no use for keeps its usual meaning.
    if (list && plain && !event.shiftKey && SLASH_KEYS.includes(event.key) && slashKey(event.key as SlashKey)) return used()
    // The frame leaves Tab to an open list, so with nothing to complete it must not walk the keyboard out of the input.
    if (list && event.key === 'Tab') return used()

    const sending = composerKey(
      { key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
      { turnRunning, canSend, empty: !text.trim() && attachments.length === 0, stopped, queued: queued.length > 0 },
    )
    if (sending) {
      runSendKey(sending.do)
      used()
    } else if (event.key === 'Escape' && turnRunning) {
      // One Escape never stops hobkin: the first asks, a second soon after stops.
      const pressed = stopKey(stopArmedAt, Date.now())
      // The second press stops the turn the first was pressed during, the one on screen.
      if (pressed.stop) stop('stop', main)
      setArmed(pressed.armedAt === null || turn === null ? null : { at: pressed.armedAt, turn })
      used()
    } else if (event.key === 'c' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && turnRunning) {
      // As in a terminal: Control+C stops at once.
      setArmed(null)
      stop()
      used()
    } else if (event.key === 'Escape' && plain && report) {
      // As in the terminal app: with no turn to stop, Escape drops the report from the message.
      dropReport()
      used()
    } else if (event.key === 'ArrowUp' && plain && !event.shiftKey && firstLine(element)) {
      // Up in an empty message brings back what was sent before, newest first.
      const before = useChat.getState().draft.text
      change({ type: 'recalled', direction: 'older' })
      if (useChat.getState().draft.text !== before) used()
    } else if (event.key === 'ArrowDown' && plain && !event.shiftKey && useChat.getState().draft.recalled !== null && lastLine(element)) {
      change({ type: 'recalled', direction: 'newer' })
      used()
    } else if (event.key === 'Backspace' && plain && attachments.length > 0 && element.selectionStart === 0 && element.selectionEnd === 0) {
      // At the very start there is nothing left to delete but the last image.
      detach(attachments.at(-1)!.id)
      used()
    } else if (event.key === 'u' && event.metaKey && !event.ctrlKey && !event.altKey && ready) {
      picker.current?.click()
      used()
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      scroll.scrollByPage(event.key === 'PageUp' ? -1 : 1)
      used()
    } else if (event.key === 'ArrowDown' && event.metaKey && !scroll.pinned) {
      scroll.jumpToLatest()
      used()
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files]
    if (!files.length) return
    // A copied picture or file is attached. Copied words are pasted as usual.
    event.preventDefault()
    attach(files)
  }

  return (
    <div className="shrink-0 px-3 pt-1 pb-2">
      <div className="mx-auto max-w-[640px]">
        <StatusLine reason={ready ? null : availability.reason} problem={problem} said={said} turnRunning={turnRunning} typing={text.length > 0} stopArmed={stopArmed} stopping={stopping} />
        <div className="flex items-end gap-2">
          <ChatAvatar followWithin={followWithin} typing={text.length > 0} />
          <div className="relative min-w-0 flex-1">
            <SlashPanel list={list} id={listId} onReach={reachCommand} onChoose={(index) => (reachCommand(index), slashKey('Enter'))} />
            <QueuedRows rows={queued} />
            <form
              className={cn(
                'rounded-[24px] border-[1.5px] bg-card py-1.5 pr-1.5 pl-1.5 transition-colors duration-[160ms] ease-[ease] focus-within:border-ring',
                dropping ? 'border-ring' : 'border-input',
              )}
              onSubmit={(event) => {
                event.preventDefault()
                if (canSend) send()
              }}
            >
              <AnimatePresence initial={false}>{report ? <ReportChip key={`${report.kind ?? 'report'}:${report.id}`} title={report.title} onDrop={dropReport} /> : null}</AnimatePresence>
              <AttachmentTray attachments={attachments} onRemove={detach} />
              <div className="flex items-end gap-1">
                <AttachButton picker={picker} disabled={!ready} onPick={attach} />
                <textarea
                  // macOS would offer its own corrections in a bubble over the field; the user writes as they mean.
                  autoCorrect="off"
                  autoCapitalize="off"
                  ref={input}
                  value={text}
                  onChange={(event) => change({ type: 'typed', text: event.target.value })}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  onFocus={() => useView.getState().closeAgentCanvas()}
                  onPointerDown={() => useView.getState().closeAgentCanvas()}
                  rows={1}
                  // Not `disabled`: the input is home for the keyboard, so it keeps the focus even when nothing can be sent.
                  readOnly={!ready}
                  aria-disabled={!ready}
                  aria-label="Message hobkin"
                  // One line always. Why nothing can be sent is said once, in the status line above.
                  placeholder={dropping ? 'Drop the image to attach it' : report ? (report.kind === 'routine' ? 'Ask about this routine' : report.kind === 'item' ? 'Ask about this item' : 'Ask about this report') : 'Message hobkin'}
                  // While the list of commands is open the input is its combobox, which is also how the frame
                  // knows to leave Tab to the list.
                  {...(list ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': listId, 'aria-autocomplete': 'list' as const } : {})}
                  aria-activedescendant={list && list.selected !== null ? slashRowId(listId, list.selected) : undefined}
                  className={cn(
                    'scroll-quiet min-h-8 flex-1 resize-none self-center bg-transparent py-1 pl-1 text-[15px] leading-snug outline-none placeholder:text-muted-foreground',
                    !ready && 'cursor-default',
                  )}
                  style={{ maxHeight: MAX_INPUT_HEIGHT }}
                />
                <SendButton turnRunning={turnRunning} canSend={canSend} stopping={stopping} onStop={() => stop()} />
              </div>
            </form>
          </div>
        </div>
      </div>
      <PromptEditor />
    </div>
  )
}

/** The report the next message is about. It goes with that message, once, and Escape or the button drops it. */
function ReportChip({ title, onDrop }: { title: string; onDrop: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', transition: spring.alive }}
      exit={{ opacity: 0, transform: 'translateY(4px)', transition: tween.exit }}
      className="flex items-center gap-2 px-2 pt-0.5 pb-1.5 text-[13px]"
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-heading font-medium">{title}</span> <span className="text-muted-foreground">goes with your next message.</span>
      </span>
      <button
        type="button"
        onClick={onDrop}
        aria-label={`Drop ${title} from the message`}
        className="flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground outline-offset-1 transition-[transform,background-color,color] duration-[140ms] ease-out hover:bg-surface-2 hover:text-foreground active:scale-[0.97]"
      >
        <X className="size-3" aria-hidden="true" />
        Drop
        <Kbd>esc</Kbd>
      </button>
    </motion.div>
  )
}
