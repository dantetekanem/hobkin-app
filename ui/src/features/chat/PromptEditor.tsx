import { AnimatePresence, motion, useIsPresent, type Transition, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { focusInput } from '@/app/focus.ts'
import { stillVariants, useStill } from '@/app/still.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { AttachButton, AttachmentTray } from './AttachmentTray.tsx'
import { canSendDraft, useChat } from './chat-store.ts'
import { DraftList } from './DraftList.tsx'
import { LiveMarkdownField } from './LiveMarkdownField.tsx'

/** How far the window blurs behind the editor, and how dark the scrim over it gets. */
const BLUR = 'blur(14px)'

// It slides up from where the input is in one quick, continuous movement, and the window blurs behind it as it comes.
// A parent's opacity over a blurred backdrop would pop, so the panel fades on its own.
const slide: Transition = spring.sheet
const leave: Transition = spring.screenExit

const backdrop: Variants = {
  below: { backdropFilter: 'blur(0px)' },
  here: { backdropFilter: BLUR, transition: slide },
  away: { backdropFilter: 'blur(0px)', transition: leave },
}
const scrim: Variants = {
  below: { opacity: 0 },
  here: { opacity: 1, transition: slide },
  away: { opacity: 0, transition: leave },
}
const panel: Variants = {
  below: { opacity: 0, transform: 'translateY(96px) scale(1)' },
  here: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: slide, opacity: tween.enter } },
  away: { opacity: 0, transform: 'translateY(96px) scale(0.92)', transition: { transform: leave, opacity: tween.exit } },
}

const CHOICES = [
  { id: 'keep', label: 'Keep it for later' },
  { id: 'delete', label: 'Delete it' },
] as const

/** Where the keyboard can be in the editor, for Tab to go round them without leaving it. */
const STOPS = 'textarea, button:not([disabled]), [role="listbox"], a[href]'

const newId = () => crypto.randomUUID()

/**
 * Full prompt focus: a large editor over the window for writing a long message, with its Markdown taking its
 * look as it is typed, and the drafts beside it. It edits the same draft as the small input, so nothing is
 * copied in or out, and a draft set aside waits in the list until it is opened, sent or deleted.
 *
 * Keys, as in pi-prompt: Control+Option+P opens it from every screen (the frame's map) and goes back with the text
 * as it is. Enter adds a line, Control+Enter sends, Escape asks whether to keep the draft for later or delete it,
 * and a second Escape keeps it. Shift+Tab reaches the drafts, where Up and Down move and Enter opens one.
 * On the way out the keyboard goes back to whatever had it before.
 */
export function PromptEditor() {
  const open = useChat((chat) => chat.draft.place === 'editor')
  return createPortal(<AnimatePresence>{open ? <Editor key="prompt-editor" /> : null}</AnimatePresence>, document.body)
}

function Editor() {
  const text = useChat((chat) => chat.draft.text)
  const attachments = useChat((chat) => chat.draft.attachments)
  const kept = useChat((chat) => chat.draft.kept)
  const leaving = useChat((chat) => chat.draft.leaving)
  const change = useChat((chat) => chat.change)
  const send = useChat((chat) => chat.send)
  const attach = useChat((chat) => chat.attach)
  const detach = useChat((chat) => chat.detach)
  const canSend = canSendDraft({ text, attachments })
  const still = useStill()
  const present = useIsPresent()

  const input = useRef<HTMLTextAreaElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const opener = useRef<Element | null>(null)
  const [choice, setChoice] = useState(0)

  const writeAtEnd = () => {
    const element = input.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
  }

  // The keyboard goes into the editor, at the end of what is written, remembering what had it. Only the first
  // time: an effect run again (as React does in development) would find the editor's own text.
  useLayoutEffect(() => {
    opener.current ??= document.activeElement
    writeAtEnd()
  }, [])
  // As the editor starts to leave, the keyboard goes back there, or home when that is gone.
  useEffect(() => {
    if (present) return
    const to = opener.current
    if (to instanceof HTMLElement && to.isConnected && to !== document.body && !box.current?.contains(to)) to.focus({ preventScroll: true })
    else focusInput()
  }, [present])
  useEffect(() => {
    if (leaving) setChoice(0)
    else if (present) input.current?.focus()
  }, [leaving, present])

  const escape = () => change({ type: 'editor-escaped', at: Date.now(), id: newId() })
  const answer = (id: (typeof CHOICES)[number]['id']) => change(id === 'keep' ? { type: 'leave-kept', at: Date.now(), id: newId() } : { type: 'leave-discarded' })
  const open = (id: string) => {
    change({ type: 'draft-opened', id, at: Date.now(), keepAs: newId() })
    requestAnimationFrame(writeAtEnd)
  }

  // Tab goes round the editor's own controls: it is a dialog, and the window behind it waits.
  const roundTab = (event: KeyboardEvent<HTMLElement>) => {
    const stops = [...(box.current?.querySelectorAll<HTMLElement>(STOPS) ?? [])].filter((element) => element.offsetParent !== null)
    const [first, last] = [stops[0], stops.at(-1)]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) last.focus()
    else if (!event.shiftKey && document.activeElement === last) first.focus()
    else return
    event.preventDefault()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return
    const used = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (event.ctrlKey && event.altKey && event.code === 'KeyP') {
      change({ type: 'editor-toggled' })
      return used()
    }
    if (event.key === 'Tab') return roundTab(event)
    if (leaving) {
      // The question has the keys: Left and Right change the answer, Enter gives it, and Escape keeps the draft.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') setChoice(0)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') setChoice(1)
      else if (event.key === 'Enter') answer(CHOICES[choice]!.id)
      else if (event.key === 'Escape') escape()
      else return
      return used()
    }
    if (event.key === 'Escape') {
      escape()
      used()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      if (canSend) send()
      used()
    } else if (event.key === 'u' && event.metaKey) {
      picker.current?.click()
      used()
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files]
    if (!files.length) return
    event.preventDefault()
    attach(files)
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Full prompt"
      // While it leaves, it takes no clicks and no keyboard.
      inert={!present}
      initial="below"
      animate="here"
      exit="away"
      className="fixed inset-0 z-50 grid place-items-center p-[4vmin]"
      onKeyDown={onKeyDown}
    >
      <motion.div aria-hidden="true" className="absolute inset-0" variants={backdrop} />
      <motion.div aria-hidden="true" className="absolute inset-0 bg-scrim" variants={scrim} onClick={escape} />

      <motion.div
        ref={box}
        variants={stillVariants(panel, still)}
        style={{ transformOrigin: '30% 100%' }}
        className="@container relative flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-[26px] bg-card shadow-float"
      >
        <header className="flex shrink-0 items-center gap-3 px-6 pt-4 pb-2">
          <h2 className="text-[15px] font-semibold">Prompt</h2>
          <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>⌃↵</Kbd> send
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> new line
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> keep or delete
            </span>
            <span className="flex items-center gap-1">
              <Kbd>⇧⇥</Kbd> drafts
            </span>
            <span className="flex items-center gap-1">
              <Kbd>⌃⌥P</Kbd> back
            </span>
          </span>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,10rem)_minmax(0,1fr)] gap-px bg-border @3xl:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] @3xl:grid-rows-1">
          <div className="flex min-h-0 flex-col bg-card">
            <DraftList current={{ text, images: attachments.length }} kept={kept} onOpen={open} onBack={writeAtEnd} />
          </div>
          <div className="flex min-h-0 flex-col bg-card">
            <LiveMarkdownField
              ref={input}
              value={text}
              onChange={(event) => change({ type: 'typed', text: event.target.value })}
              onPaste={onPaste}
              // Back to the text from the question, by pointing at it.
              onPointerDown={() => leaving && change({ type: 'leave-cancelled' })}
              readOnly={leaving}
              aria-label="Prompt"
              placeholder="Write the whole message here. Its Markdown takes its look as you type."
              spellCheck
              className="flex-1"
            />
          </div>
        </div>

        <footer className="flex shrink-0 items-end gap-2 px-4 pt-2 pb-3">
          <AttachButton picker={picker} disabled={leaving} onPick={attach} />
          <div className="min-w-0 flex-1">
            <AttachmentTray attachments={attachments} onRemove={detach} />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {leaving ? (
              <motion.div
                key="leaving"
                role="group"
                aria-label="Keep the draft for later or delete it"
                initial={{ opacity: 0, transform: 'translateY(8px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }}
                exit={{ opacity: 0, transform: 'translateY(4px)', transition: tween.exit }}
                className="flex flex-wrap items-center justify-end gap-2"
              >
                <span className="pr-1 text-[13px] text-muted-foreground">
                  Leaving the editor. <Kbd>esc</Kbd> keeps it.
                </span>
                {CHOICES.map(({ id, label }, index) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={index === choice}
                    onClick={() => answer(id)}
                    onPointerMove={() => setChoice(index)}
                    className={cn(
                      'h-8 rounded-full border px-3.5 font-heading text-[13px] font-medium outline-offset-2 transition-[transform,background-color,border-color] duration-[140ms] ease-out active:scale-[0.97]',
                      index === choice ? 'border-ring bg-surface-2' : 'border-border',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </motion.div>
            ) : (
              <motion.button
                key="send"
                type="button"
                disabled={!canSend}
                onClick={send}
                initial={{ opacity: 0, transform: 'translateY(8px)' }}
                animate={{ opacity: canSend ? 1 : 0.4, transform: 'translateY(0px)', transition: tween.enter }}
                exit={{ opacity: 0, transform: 'translateY(4px)', transition: tween.exit }}
                className="h-8 rounded-full bg-primary px-4 font-heading text-[13px] font-medium text-primary-foreground outline-offset-2 transition-transform duration-[140ms] ease-out active:scale-[0.97]"
              >
                Send
              </motion.button>
            )}
          </AnimatePresence>
        </footer>
      </motion.div>
    </motion.div>
  )
}
