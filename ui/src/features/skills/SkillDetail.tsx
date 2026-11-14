import { Link2, LoaderCircle, Power, Send, X } from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { SkillEntry, SkillFile } from '#shared/pi-resources/wire.ts'
import { Button } from '@/components/ui/button.tsx'
import { useChat } from '@/features/chat/chat-store.ts'
import { Prose } from '@/features/routines/Prose.tsx'
import { hostStore } from '@/lib/host/client.ts'
import { spring, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { askForChange } from './ask.ts'
import { messageOf, stopsIn } from './page-parts.tsx'
import type { SkillActions } from './store.ts'

// The page behind blurs and the canvas's own color settles over it, as behind an integration's detail.
const backdrop = (still: boolean): Variants => ({
  away: { backdropFilter: 'blur(0px)', transition: tween.exit },
  here: { backdropFilter: still ? 'blur(0px)' : 'blur(10px)', transition: spring.sheet },
})
const tint: Variants = {
  away: { opacity: 0, transition: tween.exit },
  here: { opacity: 0.6, transition: spring.sheet },
}
const sheet = (still: boolean): Variants => ({
  away: { opacity: 0, transform: still ? 'translateY(0px) scale(1)' : 'translateY(18px) scale(0.985)', transition: tween.exit },
  here: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: still ? { duration: 0 } : spring.sheet, opacity: { ...tween.enter, delay: staggerDelay } } },
})

/** Where Pi found a skill, in a few words. */
export function originText(skill: SkillEntry): string {
  if (skill.package) return `From ${skill.package.name}`
  return skill.from === 'agents' ? 'Agent Skills folder' : skill.from === 'settings' ? "Named in Pi's settings" : "Pi's skills folder"
}

interface SkillDetailProps {
  skill: SkillEntry
  /** Opened to ask for a change: the keyboard starts in the request. */
  ask: boolean
  still: boolean
  actions: SkillActions
  /** It is being turned off or on now. */
  busy: boolean
  onTurn: (on: boolean) => void
  onClose: () => void
}

/**
 * View more: a skill's description, its state, where Pi found it, its file, and the rest of the file as Markdown, with
 * a way to turn it off or on and to ask hobkin for a change.
 */
export function SkillDetail({ skill, ask, still, actions, busy, onTurn, onClose }: SkillDetailProps) {
  const panel = useRef<HTMLElement | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<SkillFile | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    actions.read(skill.path).then(
      (read) => {
        if (active) setFile(read)
      },
      (error: unknown) => {
        if (active) setFailure(messageOf(error))
      },
    )
    return () => {
      active = false
    }
  }, [actions, skill.path])

  // The keyboard lands in the panel as it opens: in the request when it was opened to ask, and otherwise on its first control.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const firstControl = panel.current ? stopsIn(panel.current)[0] : undefined
      const landing = ask ? field.current : firstControl
      landing?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [ask])

  return (
    <motion.div className="absolute inset-0 z-20" initial="away" animate="here" exit="away">
      <motion.div className="absolute inset-0" variants={backdrop(still)} />
      <motion.div className="absolute inset-0 bg-surface" variants={tint} onClick={onClose} />
      <motion.section
        ref={panel}
        variants={sheet(still)}
        data-detail=""
        tabIndex={-1}
        aria-label={`${skill.name}, the whole skill`}
        className="absolute inset-x-6 top-[112px] bottom-6 mx-auto flex max-w-[760px] flex-col overflow-hidden rounded-[28px] bg-background shadow-float outline-none"
      >
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-8">
          <div className="flex flex-col gap-7">
            <header className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em] break-words">{skill.name}</h2>
                <p className="mt-1 text-[14px] text-muted-foreground">{skill.description || 'Pi reads no description in this file.'}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <Chip tone={skill.on ? 'ok' : 'quiet'}>{skill.on ? 'On' : 'Off'}</Chip>
                  <Chip tone="quiet">{originText(skill)}</Chip>
                  {skill.commandOnly ? <Chip tone="quiet">Only with /skill:{skill.name}</Chip> : null}
                </div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" data-key-stop="" onClick={onClose} className="-mt-1 -mr-2">
                <X />
              </Button>
            </header>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant={skill.on ? 'outline' : 'default'} data-key-stop="" disabled={busy} onClick={() => onTurn(!skill.on)}>
                {busy ? <LoaderCircle className={cn(!still && 'animate-spin')} aria-hidden="true" /> : <Power aria-hidden="true" />}
                {skill.on ? 'Turn off' : 'Turn on'}
              </Button>
              <span className="text-[13px] text-muted-foreground">{skill.on ? 'Pi loads it when a task calls for it.' : 'Pi does not load it.'} A change takes hold when Pi next starts or reloads.</span>
            </div>

            {skill.problem ? <p className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] text-warn-fg">Pi skips this file: {skill.problem}.</p> : null}
            {skill.shadowedBy ? (
              <p className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] break-words text-warn-fg">
                Pi loads only the first skill named {skill.name}, and uses <span className="font-mono text-[12px]">{skill.shadowedBy}</span> instead of this one.
              </p>
            ) : null}

            <AskForChange skill={skill} field={field} />

            <Block label="Its file">
              <p className="font-mono text-[12px] break-all">{skill.file}</p>
              {skill.file !== skill.path ? (
                <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
                  <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-all">
                    Pi reaches it through <span className="font-mono">{skill.path}</span>.
                  </span>
                </p>
              ) : null}
              {skill.package ? <p className="text-[12px] text-muted-foreground">A copy from the package. Pi replaces it when the package updates.</p> : null}
            </Block>

            <Block label="The skill">
              {file ? (
                <>
                  {file.body ? <Prose text={file.body} className="rounded-2xl bg-tone-1 px-5 py-4" /> : <p className="text-[13px] text-muted-foreground">Nothing after its description.</p>}
                  {file.cut ? <p className="text-[12px] text-muted-foreground">The file goes on past 256 KB. Open it to read the rest.</p> : null}
                </>
              ) : failure ? (
                <p className="rounded-2xl bg-bad/10 px-4 py-3 text-[13px] text-bad-fg">{failure}</p>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <LoaderCircle className={cn('size-3.5', !still && 'animate-spin')} aria-hidden="true" />
                  Reading the file
                </p>
              )}
            </Block>
          </div>
        </div>
      </motion.section>
    </motion.div>
  )
}

/** The request goes to main hobkin as a chat message sent, as a theme request does. The composer's draft stays as it is. */
function AskForChange({ skill, field }: { skill: SkillEntry; field: RefObject<HTMLInputElement | null> }) {
  const [words, setWords] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const send = async () => {
    if (sending) return
    const asked = words
    setSending(true)
    const { sent, note: said } = await askForChange(skill, asked, useChat, hostStore)
    setSending(false)
    setNote(said)
    // Once hobkin has it the field empties, unless something new was typed meanwhile.
    if (sent) setWords((now) => (now === asked ? '' : now))
  }

  return (
    <Block label="Ask for a change">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <div className="flex gap-2">
          <input
            ref={field}
            data-key-stop=""
            aria-label={`What should change in ${skill.name}`}
            aria-describedby="skill-ask-status"
            value={words}
            onChange={(event) => setWords(event.currentTarget.value)}
            placeholder="Ask before rewriting a whole post"
            className="h-9 min-w-0 flex-1 rounded-full border border-input bg-surface px-3.5 text-[13px] outline-offset-2 placeholder:text-muted-foreground/70"
          />
          <Button type="submit" data-key-stop="" disabled={sending || !words.trim()}>
            <Send aria-hidden="true" />
            {sending ? 'Sending' : 'Send'}
          </Button>
        </div>
        <p id="skill-ask-status" role="status" className="text-[12px] text-muted-foreground">
          {note ?? 'hobkin gets it as your message, with the skill and its file, and answers in the chat.'}
        </p>
      </form>
    </Block>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="eyebrow">{label}</h3>
      {children}
    </section>
  )
}

export function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'quiet'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-heading text-[12px] font-medium whitespace-nowrap',
        tone === 'ok' ? 'bg-ok/15 text-ok-fg' : tone === 'warn' ? 'bg-warn/15 text-warn-fg' : 'bg-surface-2 text-muted-foreground',
      )}
    >
      {tone === 'ok' ? <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
