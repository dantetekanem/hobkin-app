import { ArrowUp } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { answerAgent, questionOf, useAgent } from '@/app/running-agents.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { useAgentThreads, type AgentNote } from './agent-threads.ts'
import { sayToAgent } from './say.ts'

/** Where the small screen's header starts, below the menu and its second row. */
const HEADER_TOP = 152
/** The header shrinks into a bar at the top when the user steps in. */
const FULL = 'translateY(0px) scale(1)'
const COMPACT = 'translateY(-36px) scale(0.56)'
/** Where the exchange starts below the shrunken header, and the room always kept for the input. */
const EXCHANGE_TOP = 224
const INPUT_ROOM = 124

/**
 * One agent's canvas. This file is the entry the frame mounts. Spec: 011-work.
 *
 * While the user walks the agents list, each agent shows its small screen: its face, its title, what it is
 * on, and its question or the last thing said. It is the same size for every agent however long the
 * exchange is, so moving between agents is always the same light movement, and nothing long is drawn
 * for an agent the user only passes.
 *
 * Stepping in (Enter on it in the list, or Command+G when it waits for the user) draws the whole exchange:
 * the header shrinks into a bar at the top, the exchange fades in below it already at its newest message,
 * and an input rises into the room kept for it. Escape steps back out the same way.
 * Only transforms and opacity move, and messages out of view are not drawn.
 */
export function AgentScreen() {
  const agentId = useView((view) => view.openAgent)
  const talking = useView((view) => view.agentTalk)
  const agent = useAgent(agentId)
  const question = questionOf(agentId)
  const waiting = Boolean(agent?.asks)
  const still = useStill()

  return (
    <div className="relative h-full overflow-hidden">
      <motion.div
        className="absolute inset-x-[10%] flex origin-top flex-col items-center gap-4 text-center"
        style={{ top: HEADER_TOP }}
        initial={false}
        animate={{ transform: talking ? COMPACT : FULL }}
        transition={still ? { duration: 0 } : spring.screen}
      >
        {agent ? (
          <Hero>
            <AgentHood hue={agent.hue} size={120} mood={agent.mood} asking={waiting} />
          </Hero>
        ) : null}
        <Rise>
          <p className="font-heading text-[22px] font-semibold tracking-[-0.022em]">{agent ? agent.title : 'This agent has finished'}</p>
        </Rise>
        {/* The rest of the small screen gives way to the exchange while the user is in. */}
        <motion.div
          className={cn('flex w-full flex-col items-center gap-4', talking && 'pointer-events-none')}
          initial={false}
          animate={{ opacity: talking ? 0 : 1 }}
          transition={{ duration: talking ? 0.14 : 0.24, ease: 'linear' }}
        >
          {agent ? (
            <Rise>
              <p className="text-[15px] text-muted-foreground">
                {agent.project} · {waiting ? 'waiting for you' : agent.doing} · {agent.tier}
              </p>
            </Rise>
          ) : null}
          {agent && agentId ? (
            <Rise className="w-full">
              <Glance agentId={agentId} hue={agent.hue} question={question} waiting={waiting} />
            </Rise>
          ) : null}
        </motion.div>
      </motion.div>
      <AnimatePresence>{talking && agent && agentId ? <Exchange key={agentId} agentId={agentId} hue={agent.hue} question={question} waiting={waiting} /> : null}</AnimatePresence>
      <AnimatePresence>
        {talking && agent && agentId ? <TalkInput key={agentId} agentId={agentId} name={agent.title} hue={agent.hue} mood={agent.mood} answering={waiting} /> : null}
      </AnimatePresence>
    </div>
  )
}

/** The bottom of the small screen: the agent's question, or the last thing said, or what will come. Never more. */
function Glance({ agentId, hue, question, waiting }: { agentId: string; hue: number; question?: string; waiting: boolean }) {
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const last = notes?.at(-1)

  if (waiting && question) {
    return (
      <div className="flex w-full flex-col gap-2">
        <QuestionBubble hue={hue} question={question} waiting />
        <p className="flex h-6 items-center gap-1.5 self-start pl-8 text-[12px] text-muted-foreground">
          Answer with <Kbd>⌘G</Kbd> or Enter on it in the list.
        </p>
      </div>
    )
  }
  if (last) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <p className="line-clamp-2 max-w-[72%] rounded-2xl bg-secondary px-3.5 py-2 text-[15px] leading-relaxed">{last.text}</p>
        <p className="text-[12px] text-muted-foreground">
          {notes!.length === 1 ? '1 message' : `${notes!.length} messages`} · Enter to step in
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-[15px] text-muted-foreground">Its steps, tool calls and output will draw here as it works.</p>
      <p className="font-mono text-[12px] text-muted-foreground">_specs/011-work</p>
    </div>
  )
}

function QuestionBubble({ hue, question, waiting }: { hue: number; question: string; waiting: boolean }) {
  return (
    <div className="flex max-w-[72%] items-end gap-2 self-start text-left">
      <span className="mb-0.5 shrink-0">
        <AgentHood hue={hue} size={22} mood="confused" working={waiting} />
      </span>
      <span className="rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2 text-[15px] leading-relaxed">{question}</span>
    </div>
  )
}

const RISE_IN = {
  initial: { opacity: 0, transform: 'translateY(22px) scale(0.92)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
} as const

/**
 * The whole exchange, drawn only while the user is in. It fills the room between the shrunken header and
 * the input, holds its newest message at the bottom, and opens already scrolled there.
 * Each message is drawn only while it is in view, so a long exchange, code included, costs what fits on screen.
 */
function Exchange({ agentId, hue, question, waiting }: { agentId: string; hue: number; question?: string; waiting: boolean }) {
  const still = useStill()
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const scroller = useRef<HTMLDivElement | null>(null)
  const count = notes?.length ?? 0
  const seen = useRef(count)

  // It opens at the newest message: no scrolling to watch.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [])
  // A message sent while in glides into view.
  useEffect(() => {
    const element = scroller.current
    if (!element || count <= seen.current) return
    seen.current = count
    element.scrollTo({ top: element.scrollHeight, behavior: document.documentElement.dataset.motion === 'still' ? 'auto' : 'smooth' })
  }, [count])

  return (
    <motion.div
      ref={scroller}
      className="scroll-quiet absolute inset-x-0 bottom-0 overflow-y-auto px-[10%]"
      style={{ top: EXCHANGE_TOP, paddingBottom: INPUT_ROOM }}
      initial={holdStill({ opacity: 0, transform: 'translateY(24px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: { duration: 0.24, delay: 0.06 } } }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(16px)', transition: { duration: 0.16, ease: 'linear' } } as const, still)}
    >
      <ol className="flex min-h-full flex-col justify-end gap-2 pt-2">
        {question ? (
          <li className="flex flex-col gap-2 [contain-intrinsic-size:auto_64px] [content-visibility:auto]">
            <QuestionBubble hue={hue} question={question} waiting={waiting} />
            <p className="flex h-6 items-center self-start pl-8 text-[12px] text-muted-foreground">{waiting ? 'Your answer goes in the box below.' : 'Answered.'}</p>
          </li>
        ) : null}
        <AnimatePresence initial={false}>
          {(notes ?? []).map((note) => (
            <Said key={note.id} note={note} />
          ))}
        </AnimatePresence>
        {count ? <li className="self-end text-[12px] text-muted-foreground">Sample data. The host will deliver these to the agent as it works.</li> : null}
      </ol>
    </motion.div>
  )
}

function Said({ note }: { note: AgentNote }) {
  const still = useStill()
  return (
    <motion.li
      initial={holdStill(RISE_IN.initial, still)}
      animate={holdStill(RISE_IN.animate, still)}
      className="max-w-[72%] self-end rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-left text-[15px] leading-relaxed whitespace-pre-wrap [contain-intrinsic-size:auto_48px] [content-visibility:auto]"
    >
      {note.text}
    </motion.li>
  )
}

/** The input for talking to one agent. It rises from the bottom of the canvas into the room kept for it, and leaves the same way. */
function TalkInput({ agentId, name, hue, mood, answering }: { agentId: string; name: string; hue: number; mood: Mood; answering: boolean }) {
  const leaveAgentTalk = useView((view) => view.leaveAgentTalk)
  const still = useStill()
  const say = useAgentThreads((threads) => threads.say)
  const live = useHasHost()
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const canSend = draft.trim().length > 0

  // Stepping in hands the keyboard to this input. Without preventScroll the browser would scroll the canvas
  // to show the input while it is still below the edge, and the whole canvas would jump.
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  const send = async () => {
    if (!canSend) return
    const text = draft.trim()
    setProblem(null)
    // With a host the words reach the running agent as steering. They show here only once they were sent.
    const result = await sayToAgent(agentId, text, { live })
    if (!result.sent) {
      setProblem(result.why)
      return
    }
    say(agentId, text)
    // The answer is what the agent was waiting for: it gets on with its work.
    if (answering) answerAgent(agentId)
    setDraft('')
  }

  const stepOut = () => {
    leaveAgentTalk()
    // Back onto the same agent in the list, where Enter was pressed.
    focusAgentsDock()
  }

  const label = answering ? `Answer ${name}` : `Message ${name}`

  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 px-[10%] pt-2 pb-5"
      initial={holdStill({ opacity: 0, transform: 'translateY(100%)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0%)', transition: { transform: spring.screen, opacity: tween.enter } }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(100%)', transition: { transform: spring.screenExit, opacity: { duration: 0.2 } } }, still)}
    >
      <form
        className="flex items-end gap-2 rounded-[26px] border-[1.5px] border-input bg-background py-2 pr-2 pl-3 shadow-panel transition-colors duration-[160ms] ease-[ease] focus-within:border-ring"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <span className="grid size-9 shrink-0 place-items-center">
          <AgentHood hue={hue} size={26} mood={answering ? 'listening' : mood} />
        </span>
        <textarea
          ref={input}
          data-agent-input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // The key is used here, so the frame leaves it alone.
              event.preventDefault()
              stepOut()
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
            }
          }}
          rows={1}
          placeholder={label}
          aria-label={label}
          className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none self-center bg-transparent py-1.5 text-[15px] leading-snug outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={answering ? 'Send the answer' : 'Send to this agent'}
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground',
            'transition-[transform,opacity] duration-[140ms] ease-out active:scale-[0.97] disabled:opacity-40',
          )}
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </button>
      </form>
      {problem ? (
        <p role="alert" className="mt-1.5 px-3 text-[11px] text-bad-fg">
          {problem}
        </p>
      ) : (
        <p className="mt-1.5 px-3 text-[11px] text-muted-foreground">Enter sends. Esc steps back out.</p>
      )}
    </motion.div>
  )
}
