import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AGENT_PAGE_TOP } from '@/app/screen-layout.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { endingOf, pressEndOf, takeBackEnd, useEnding } from '@/features/work/end-agent.ts'
import { spring, tween } from '@/lib/motion.ts'

/**
 * The parts every agent's page shares (`034-durable-hobkins`, `021-agent-rendering`): a run's and a durable hobkin's
 * pages are one page, and only what each shows in them is its own.
 */

/** The split's spring: it forms on the screens' spring and undoes on their exit spring. */
export const splitSpring = (split: boolean) => (split ? spring.screen : spring.screenExit)

/**
 * The page's side gutter, set as `--page-gutter` on the whole page (`HobkinScreen.tsx`) and read by its header, lines,
 * conversation and talk box: a tenth of the page each side, or in the split, where the page takes the chat's place and
 * width, the chat's own 16px. Each is one calc of both units, so it travels from one to the other on the split's spring.
 */
export const pageGutter = (split: boolean) => (split ? 'calc(0% + 16px)' : 'calc(10% + 0px)')

const RISE_IN = {
  initial: { opacity: 0, transform: 'translateY(22px) scale(0.96)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
} as const

/**
 * One agent's own pieces on its page: its header, its lines and its conversation. Moving to another agent, the next
 * one's fade in over these as these fade out, and the ones leaving take no keyboard and no pointer.
 */
export function PartFrame({ children }: { children: ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.div
      className="absolute inset-0 flex flex-col"
      inert={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: tween.enter }}
      exit={{ opacity: 0, transition: tween.exit }}
    >
      {children}
    </motion.div>
  )
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface PageHeaderProps {
  /** The agent, by the window's id for it: End and Control+X go by it. */
  agentId: string
  split: boolean
  /** Its face, 48 pixels. */
  face: ReactNode
  title: string
  /** A durable hobkin is renamed in place: the name is a button that opens a field. Its own command, which throws when refused. */
  rename?: { max: number; send: (title: string) => Promise<void> }
  /** Under the name: where it works, what it runs on and how it stands. */
  line: string | null
  lineTitle?: string
  /** End is drawn while the agent is there to end; `false` draws it off, as for a run the host cannot force stop now. */
  end: { ready: boolean; why: string } | null
  /** What the last stop of its turn did, in the host's words. */
  status?: string | null
}

/**
 * Its face, its name, the line under it, and End, which asks once. Control+X presses End too (`end-agent.ts`), so the
 * key and the button share the ask: a durable hobkin ends, a run is force stopped.
 *
 * Its top leaves room for the floating menu above it. In the split the menu is over the canvas and the page is where the
 * chat is, so it leaves room for the window's own buttons and a drag strip instead.
 */
export function PageHeader({ agentId, split, face, title, rename, line, lineTitle, end, status = null }: PageHeaderProps) {
  const still = useStill()
  const top = split ? 56 : AGENT_PAGE_TOP
  const [naming, setNaming] = useState<string | null>(null)
  const [renamed, setRenamed] = useState<string | null>(null)
  const ending = useEnding((store) => endingOf(store, agentId))
  const endProblem = useEnding((store) => (store.agent === agentId ? store.problem : null))
  const [renameProblem, setProblem] = useState<string | null>(null)
  const problem = endProblem ?? renameProblem
  const nameButton = useRef<HTMLButtonElement | null>(null)
  // Leaving the page takes the ask back, as it always has.
  useEffect(() => () => takeBackEnd(agentId, false), [agentId])
  /** The name being typed, read once: Enter and the blur as the field goes must not both send it. */
  const draft = useRef<string | null>(null)
  const shownTitle = renamed !== null && renamed !== title ? renamed : title

  const beginRename = (current: string) => {
    draft.current = current
    setNaming(current)
  }

  const stopRenaming = () => {
    draft.current = null
    setNaming(null)
    requestAnimationFrame(() => nameButton.current?.focus({ preventScroll: true }))
  }

  const sendRename = async () => {
    if (draft.current === null || !rename) return
    const next = draft.current.trim()
    stopRenaming()
    if (!next || next === title) return
    setProblem(null)
    setRenamed(next)
    try {
      await rename.send(next)
    } catch (error) {
      setRenamed(null)
      setProblem(message(error))
    }
  }

  const pressEnd = () => {
    setProblem(null)
    pressEndOf(agentId)
  }
  const stopAsking = () => takeBackEnd(agentId, true)
  const asking = end !== null && ending !== 'no'

  return (
    <motion.div
      className="flex flex-col gap-2 px-[var(--page-gutter,10%)] pb-3"
      initial={{ ...holdStill(RISE_IN.initial, still), paddingTop: top }}
      animate={{
        ...holdStill(RISE_IN.animate, still),
        paddingTop: top,
        transition: { ...RISE_IN.animate.transition, paddingTop: still ? { duration: 0 } : splitSpring(split) },
      }}
    >
      <div className="flex items-center gap-3">
        {face}
        <div className="min-w-0 flex-1">
          {naming !== null && rename ? (
            <input
              autoFocus
              aria-label="Name"
              value={naming}
              maxLength={rename.max}
              onChange={(event) => {
                draft.current = event.target.value
                setNaming(event.target.value)
              }}
              onBlur={() => void sendRename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void sendRename()
                } else if (event.key === 'Escape') {
                  // The rename is let go, and the screen stays.
                  event.preventDefault()
                  stopRenaming()
                }
              }}
              className="w-full rounded-lg bg-surface-2 px-2 py-0.5 font-heading text-[20px] font-semibold tracking-[-0.022em] outline-none select-text"
            />
          ) : (
            <h2 className="truncate font-heading text-[20px] font-semibold tracking-[-0.022em]">
              {rename ? (
                <button
                  ref={nameButton}
                  type="button"
                  title="Rename"
                  onClick={() => beginRename(shownTitle)}
                  // In the split, where the page has the chat's width, a long name is cut only at the end of its room:
                  // the padding its hover shows passes the edge instead of taking room from the name.
                  className={`${split ? 'max-w-[calc(100%+1rem)]' : 'max-w-full'} truncate rounded-lg px-2 py-0.5 -mx-2 text-left transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2`}
                >
                  {shownTitle}
                </button>
              ) : (
                shownTitle
              )}
            </h2>
          )}
          {line ? (
            <p className="truncate text-[13px] text-muted-foreground" title={lineTitle}>
              {line}
            </p>
          ) : null}
        </div>
        {end && !asking ? (
          <Button data-end-agent={agentId} variant="ghost" size="sm" disabled={!end.ready} onClick={pressEnd}>
            End <Kbd>⌃X</Kbd>
          </Button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {end && asking ? (
          <motion.div
            key="end"
            role="group"
            aria-label={`End ${shownTitle}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface-2 px-4 py-3"
            initial={holdStill({ opacity: 0, transform: 'translateY(-8px) scale(0.98)' }, still)}
            animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: spring.alive }, still)}
            exit={holdStill({ opacity: 0, transform: 'translateY(-6px) scale(0.98)', transition: tween.exit }, still)}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== 'Escape' || ending === 'busy') return
              event.preventDefault()
              stopAsking()
            }}
          >
            <p className="min-w-0 flex-1 basis-60 text-[13.5px] leading-snug">
              <span className="font-medium">End {shownTitle}?</span> <span className="text-muted-foreground">{end.why}</span>
            </p>
            <Button variant="destructive" size="sm" disabled={ending === 'busy'} onClick={pressEnd}>
              End it <Kbd>⌃X</Kbd>
            </Button>
            <Button data-end-keep={agentId} variant="ghost" size="sm" disabled={ending === 'busy'} onClick={stopAsking}>
              Keep it
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {problem ? (
        <p role="alert" className="text-[12px] text-bad-fg">
          {problem}
        </p>
      ) : status ? (
        <p role="status" className="text-[12px] text-muted-foreground">
          {status}
        </p>
      ) : null}
    </motion.div>
  )
}
