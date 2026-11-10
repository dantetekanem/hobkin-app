import { AnimatePresence, motion, type Transition, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, stagger, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { AttachButton, AttachmentTray } from './AttachmentTray.tsx'
import { canSendDraft, useChat } from './chat-store.ts'
import { Markdown } from './markdown.ts'

/** How far the window blurs behind the editor, and how dark the scrim over it gets. */
const BLUR = 'blur(14px)'

// The blur's radius grows with the panel's travel. A parent's opacity over a blurred backdrop would pop.
const arrive: Transition = spring.screen
const leave: Transition = spring.screenExit

const backdrop: Variants = {
  away: { backdropFilter: 'blur(0px)', transition: leave },
  here: { backdropFilter: BLUR, transition: spring.sheet },
}
const scrim: Variants = {
  away: { opacity: 0, transition: leave },
  here: { opacity: 1, transition: spring.sheet },
}
// It comes up from where the input is, with weight: a long way, a little small, settling on a spring.
const panel: Variants = {
  away: { opacity: 0, transform: 'translateY(96px) scale(0.92)', transition: { transform: leave, opacity: tween.exit } },
  here: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: arrive, opacity: tween.enter, staggerChildren: stagger, delayChildren: staggerDelay } },
}
const piece: Variants = {
  away: { opacity: 0, transform: 'translateY(26px) scale(0.98)' },
  here: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
}

const CHOICES = [
  { id: 'keep', label: 'Keep the draft', action: 'leave-kept' },
  { id: 'discard', label: 'Discard it', action: 'leave-discarded' },
] as const

/**
 * Full prompt focus: a large editor over the window for writing a long message, with the Markdown it will
 * render as beside it. It edits the same draft as the small input, so nothing is copied in or out.
 *
 * Keys, as in pi-prompt: Enter adds a line, Control+Enter sends, Escape asks whether to keep or discard the
 * draft, and Control+Option+P goes back to the small input with the text as it is.
 */
export function PromptEditor() {
  const open = useChat((chat) => chat.draft.place === 'editor')
  return createPortal(<AnimatePresence>{open ? <Editor key="prompt-editor" /> : null}</AnimatePresence>, document.body)
}

function Editor() {
  const text = useChat((chat) => chat.draft.text)
  const attachments = useChat((chat) => chat.draft.attachments)
  const leaving = useChat((chat) => chat.draft.leaving)
  const change = useChat((chat) => chat.change)
  const send = useChat((chat) => chat.send)
  const attach = useChat((chat) => chat.attach)
  const detach = useChat((chat) => chat.detach)
  const canSend = canSendDraft({ text, attachments })

  const input = useRef<HTMLTextAreaElement | null>(null)
  const preview = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const [choice, setChoice] = useState(0)

  // The keyboard goes into the editor, at the end of what is written, and back to the message input on the way out.
  useEffect(() => {
    const element = input.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
    return () => document.querySelector<HTMLTextAreaElement>('[data-chat-side] textarea')?.focus()
  }, [])
  useEffect(() => {
    if (leaving) setChoice(0)
    else input.current?.focus()
  }, [leaving])

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
    if (leaving) {
      // The question has the keys: Left and Right change the answer, Enter gives it, Escape goes back to writing.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') setChoice(0)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') setChoice(1)
      else if (event.key === 'Enter') change({ type: CHOICES[choice]!.action })
      else if (event.key === 'Escape') change({ type: 'leave-cancelled' })
      else return
      return used()
    }
    if (event.key === 'Escape') {
      change({ type: 'editor-escaped' })
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
      initial="away"
      animate="here"
      exit="away"
      className="fixed inset-0 z-50 grid place-items-center p-[4vmin]"
      onKeyDown={onKeyDown}
    >
      <motion.div aria-hidden="true" className="absolute inset-0" variants={backdrop} />
      <motion.div aria-hidden="true" className="absolute inset-0 bg-scrim" variants={scrim} onClick={() => change({ type: 'editor-escaped' })} />

      <motion.div variants={panel} style={{ transformOrigin: '30% 100%' }} className="@container relative flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-[26px] bg-card shadow-float">
        <motion.header variants={piece} className="flex shrink-0 items-center gap-3 px-6 pt-4 pb-2">
          <h2 className="text-[15px] font-semibold">Prompt</h2>
          <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>⌃↵</Kbd> send
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> new line
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> leave
            </span>
            <span className="flex items-center gap-1">
              <Kbd>⌃⌥P</Kbd> back to the input
            </span>
          </span>
        </motion.header>

        <div className="grid min-h-0 flex-1 grid-rows-2 gap-px bg-border @4xl:grid-cols-2 @4xl:grid-rows-1">
          <motion.div variants={piece} className="flex min-h-0 flex-col bg-card">
            <textarea
              ref={input}
              value={text}
              onChange={(event) => change({ type: 'typed', text: event.target.value })}
              onPaste={onPaste}
              onScroll={(event) => {
                // The preview follows the place being written.
                const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
                const pane = preview.current
                if (pane) pane.scrollTop = (scrollTop / Math.max(1, scrollHeight - clientHeight)) * (pane.scrollHeight - pane.clientHeight)
              }}
              readOnly={leaving}
              aria-label="Prompt"
              placeholder="Write the whole message here. Markdown shows on the other side as you type."
              spellCheck
              className="scroll-quiet min-h-0 flex-1 resize-none bg-transparent px-6 py-4 font-mono text-[14px] leading-[1.7] outline-none placeholder:font-sans placeholder:text-muted-foreground"
            />
          </motion.div>
          <motion.div variants={piece} className="flex min-h-0 flex-col bg-card">
            <div ref={preview} aria-label="Preview" role="region" className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-6 py-4 text-[15px] leading-relaxed break-words">
              {text.trim() ? <Markdown text={text} /> : <p className="text-muted-foreground">The message as hobkin will show it.</p>}
            </div>
          </motion.div>
        </div>

        <motion.footer variants={piece} className="flex shrink-0 items-end gap-2 px-4 pt-2 pb-3">
          <AttachButton picker={picker} disabled={leaving} onPick={attach} />
          <div className="min-w-0 flex-1">
            <AttachmentTray attachments={attachments} onRemove={detach} />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {leaving ? (
              <motion.div
                key="leaving"
                role="group"
                aria-label="Keep the draft or discard it"
                initial={{ opacity: 0, transform: 'translateY(8px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }}
                exit={{ opacity: 0, transform: 'translateY(4px)', transition: tween.exit }}
                className="flex items-center gap-2"
              >
                <span className="pr-1 text-[13px] text-muted-foreground">Leaving the editor.</span>
                {CHOICES.map(({ id, label, action }, index) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={index === choice}
                    onClick={() => change({ type: action })}
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
        </motion.footer>
      </motion.div>
    </motion.div>
  )
}
