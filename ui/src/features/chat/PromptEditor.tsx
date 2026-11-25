import { AnimatePresence, motion, useIsPresent, type Transition, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { focusInput } from '@/app/focus.ts'
import { stillVariants, useStill } from '@/app/still.ts'
import { Mark } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useNewHobkin } from '@/features/hobkins/store.ts'
import { useAgentImages } from '@/features/work/agent-images.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { AttachButton, AttachmentTray } from './AttachmentTray.tsx'
import { canSendDraft, useChat } from './chat-store.ts'
import { editorEnter, hobkinPrompt, type Attachment } from './draft.ts'
import { DraftList } from './DraftList.tsx'
import { LiveMarkdownField } from './LiveMarkdownField.tsx'
import { agentTarget, closeAgentPrompt, useAgentPrompt, type AgentBox, type PromptTarget, type PromptTo } from './prompt-target.ts'

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

/** The keys the top says. An agent's editor sends with its box's keys (`agentEditorEnter`), and Escape goes back to the box. */
const CHAT_KEYS = [
  { keys: ['⌃↵'], does: 'send' },
  { keys: ['⌃⇧↵'], does: 'durable agent' },
  { keys: ['↵'], does: 'new line' },
  { keys: ['esc'], does: 'keep or delete' },
  { keys: ['⇧⇥'], does: 'drafts' },
  { keys: ['⌃⌥P'], does: 'back' },
] as const
const AGENT_KEYS = [
  { keys: ['⌘↵'], does: 'send' },
  { keys: ['⌥↵'], does: 'after the turn' },
  { keys: ['⌃↵'], does: 'send now' },
  { keys: ['⌃⇧↵'], does: 'durable agent' },
  { keys: ['↵'], does: 'new line' },
  { keys: ['esc', '⌃⌥P'], does: 'back' },
] as const

/** Where the keyboard can be in the editor, for Tab to go round them without leaving it. */
const STOPS = 'textarea, button:not([disabled]), [role="listbox"], a[href]'

const newId = () => crypto.randomUUID()

/** The main chat's editor says it posts to hobkin, with its mark. */
const HOBKIN: PromptTo = { name: 'hobkin', face: <Mark size={20} /> }

const NO_IMAGES: readonly Attachment[] = []

/**
 * Full prompt focus: a large editor over the window for writing a long message, with its Markdown taking its look as it
 * is typed. Its top says who gets the message, with their face, and so does its send button. It edits the same words as
 * the box it was opened from, so nothing is copied in or out (`prompt-target.ts`): opened from an agent's talk box it
 * writes that box's message and sends it to that agent as the box does; anywhere else it writes the main chat's draft,
 * with the drafts beside it, where a draft set aside waits until it is opened, sent or deleted.
 *
 * Keys, as in pi-prompt: Control+Option+P opens it from every screen (the frame's map) and goes back with the text as it
 * is. Enter adds a line. In the main chat's, Control+Enter sends, Escape asks whether to keep the draft for later or delete
 * it, and a second Escape keeps it; Shift+Tab reaches the drafts, where Up and Down move and Enter opens one. In an
 * agent's, Command+Enter sends as Enter in the box does, Option+Enter and Control+Enter wait for its turn or stop it as
 * they do there, and Escape goes back to the box. On the way out the keyboard goes back to whatever had it before.
 *
 * Shift+Control+Enter, or Send to a durable agent, opens the New hobkin sheet with the prompt as its first message. The
 * words leave the editor only once that hobkin has started; a sheet closed or refused leaves the draft as it was.
 */
export function PromptEditor() {
  const open = useChat((chat) => chat.draft.place === 'editor')
  return createPortal(<AnimatePresence>{open ? <ChatEditor key="prompt-editor" /> : null}</AnimatePresence>, document.body)
}

export interface AgentPromptProps extends Omit<AgentBox, 'attachments' | 'attach' | 'detach'> {
  /** The agent, by the window's id for it. Its images are its box's (`useAgentImages`). */
  agent: string
}

/** The full prompt on an agent's talk box, drawn by the box while Control+Option+P has it open there. */
export function AgentPromptEditor({ agent, ...box }: AgentPromptProps) {
  const open = useAgentPrompt((state) => state.agent === agent)
  const attachments = useAgentImages((images) => images.trays[agent] ?? NO_IMAGES)
  // A box that goes away takes its editor with it.
  useEffect(() => {
    return () => closeAgentPrompt(agent)
  }, [agent])

  const { attach, detach } = useAgentImages.getState()
  const target = agentTarget(
    {
      ...box,
      attachments,
      attach: (files) => attach(agent, files),
      detach: (id) => detach(agent, id),
    },
    () => closeAgentPrompt(agent),
  )
  return createPortal(<AnimatePresence>{open ? <Editor key="prompt-editor" target={target} /> : null}</AnimatePresence>, document.body)
}

/** The main chat's draft, the one the small input writes, with the drafts set aside. */
function ChatEditor() {
  const text = useChat((chat) => chat.draft.text)
  const attachments = useChat((chat) => chat.draft.attachments)
  const kept = useChat((chat) => chat.draft.kept)
  const leaving = useChat((chat) => chat.draft.leaving)
  const change = useChat((chat) => chat.change)
  const send = useChat((chat) => chat.send)
  const attach = useChat((chat) => chat.attach)
  const detach = useChat((chat) => chat.detach)
  const target: PromptTarget = {
    to: HOBKIN,
    text,
    setText: (text) => change({ type: 'typed', text }),
    attachments,
    attach,
    detach,
    canSend: canSendDraft({ text, attachments }),
    enter: editorEnter,
    send: () => void send(),
    back: () => change({ type: 'editor-toggled' }),
    handedOff: (text) => change({ type: 'handed-off', text }),
    drafts: {
      kept,
      leaving,
      escape: () => change({ type: 'editor-escaped', at: Date.now(), id: newId() }),
      answer: (choice) => change(choice === 'keep' ? { type: 'leave-kept', at: Date.now(), id: newId() } : { type: 'leave-discarded' }),
      stay: () => change({ type: 'leave-cancelled' }),
      open: (id) => change({ type: 'draft-opened', id, at: Date.now(), keepAs: newId() }),
    },
  }
  return <Editor target={target} />
}

function Editor({ target }: { target: PromptTarget }) {
  const { to, text, attachments, canSend, drafts } = target
  const leaving = drafts?.leaving ?? false
  const prompt = hobkinPrompt({ text, attachments })
  const still = useStill()
  const present = useIsPresent()

  const input = useRef<HTMLTextAreaElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const opener = useRef<Element | null>(null)
  /** The prompt started a durable hobkin, whose sheet puts the keyboard in its talk box. */
  const handedOff = useRef(false)
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
    // After a hand-off the keyboard is the sheet's to place: the main input would take it and close the new hobkin's page.
    if (present || handedOff.current) return
    const to = opener.current
    if (to instanceof HTMLElement && to.isConnected && to !== document.body && !box.current?.contains(to)) to.focus({ preventScroll: true })
    else focusInput()
  }, [present])
  useEffect(() => {
    if (leaving) setChoice(0)
    else if (present) input.current?.focus()
  }, [leaving, present])

  // The main chat's asks whether to keep the draft. An agent's goes back to its box, where the words stay.
  const escape = drafts ? drafts.escape : target.back
  const open = (id: string) => {
    drafts?.open(id)
    requestAnimationFrame(writeAtEnd)
  }
  const toHobkin = () => {
    if (!prompt) return
    useNewHobkin.getState().openSheet({
      ...prompt,
      onStarted: () => {
        handedOff.current = true
        target.handedOff(prompt.text)
      },
    })
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
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    // A nested portalled dialog owns its keys, not this editor's draft shortcuts.
    if (event.target instanceof Element && !event.currentTarget.contains(event.target)) return
    const used = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (event.ctrlKey && event.altKey && event.code === 'KeyP') {
      target.back()
      return used()
    }
    if (event.key === 'Tab') return roundTab(event)
    if (drafts?.leaving) {
      // The question has the keys: Left and Right change the answer, Enter gives it, and Escape keeps the draft.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') setChoice(0)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') setChoice(1)
      else if (event.key === 'Enter') drafts.answer(CHOICES[choice]!.id)
      else if (event.key === 'Escape') escape()
      else return
      return used()
    }
    const enter = event.key === 'Enter' ? target.enter({ ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }) : null
    if (event.key === 'Escape') {
      escape()
      used()
    } else if (enter) {
      if (enter === 'durable') toHobkin()
      else if (enter !== 'nothing' && canSend) target.send(enter === 'send' ? undefined : enter)
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
    target.attach(files)
  }

  const field = (
    <LiveMarkdownField
      ref={input}
      value={text}
      onChange={(event) => target.setText(event.target.value)}
      onPaste={onPaste}
      // Back to the text from the question, by pointing at it.
      onPointerDown={() => leaving && drafts?.stay()}
      readOnly={leaving}
      aria-label="Prompt"
      placeholder="Write the whole message here. Its Markdown takes its look as you type."
      spellCheck
      className="flex-1"
    />
  )

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Full prompt to ${to.name}`}
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
          {/* Who gets what is written here, so a message meant for an agent never goes to the main chat by mistake. */}
          <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center">
              {to.face}
            </span>
            <span className="truncate">To {to.name}</span>
          </h2>
          <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            {(drafts ? CHAT_KEYS : AGENT_KEYS).map(({ keys, does }) => (
              <span key={does} className="flex items-center gap-1">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
                {does}
              </span>
            ))}
          </span>
        </header>

        {drafts ? (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,10rem)_minmax(0,1fr)] gap-px bg-border @3xl:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] @3xl:grid-rows-1">
            <div className="flex min-h-0 flex-col bg-card">
              <DraftList current={{ text, images: attachments.length }} kept={drafts.kept} onOpen={open} onBack={writeAtEnd} />
            </div>
            <div className="flex min-h-0 flex-col bg-card">{field}</div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{field}</div>
        )}

        <footer className="flex shrink-0 items-end gap-2 px-4 pt-2 pb-3">
          <AttachButton picker={picker} disabled={leaving} onPick={target.attach} />
          <div className="min-w-0 flex-1">
            <AttachmentTray attachments={attachments} onRemove={target.detach} />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {drafts?.leaving ? (
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
                    onClick={() => drafts.answer(id)}
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
              <motion.div
                key="send"
                initial={{ opacity: 0, transform: 'translateY(8px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }}
                exit={{ opacity: 0, transform: 'translateY(4px)', transition: tween.exit }}
                className="flex min-w-0 items-center gap-1"
              >
                <button
                  type="button"
                  disabled={!prompt}
                  onClick={toHobkin}
                  className="h-8 shrink-0 rounded-full px-3.5 font-heading text-[13px] font-medium text-muted-foreground outline-offset-2 transition-[transform,background-color,color,opacity] duration-[140ms] ease-out enabled:hover:bg-surface-2 enabled:hover:text-foreground active:scale-[0.97] disabled:opacity-40"
                >
                  Send to a durable agent
                </button>
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => target.send()}
                  title={`Send to ${to.name}`}
                  className="h-8 max-w-[20rem] truncate rounded-full bg-primary px-4 font-heading text-[13px] font-medium text-primary-foreground outline-offset-2 transition-[transform,opacity] duration-[140ms] ease-out active:scale-[0.97] disabled:opacity-40"
                >
                  Send to {to.name}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </footer>
      </motion.div>
    </motion.div>
  )
}
