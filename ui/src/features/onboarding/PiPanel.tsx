import { Check, Circle, Copy, LoaderCircle, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { PiSetup } from '#shared/protocol/setup.ts'
import { agentPrompt } from '#shared/setup/agent-prompt.ts'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { copyText, useCopied } from './copy.ts'
import { piBlocks, piByHand, piHandWords, piNeeds, piSteps, type PiStep } from './story.ts'
import './story.css'

/** Installs one step through the host, which answers with Pi as it is after. */
function installStep(step: PiStep): Promise<PiSetup> {
  switch (step.kind) {
    case 'node':
      return runCommand('setup.install-node')
    case 'pi':
      return runCommand('setup.install-pi')
    case 'package':
      return runCommand('setup.install-package', { name: step.id })
  }
}

type Run =
  | { state: 'idle' }
  /** Installing the step at `at`. The ones before it are done. */
  | { state: 'running'; at: number }
  | { state: 'failed'; at: number; reason: string }

/** Where a step stands: not started, being installed, installed, or failed. */
type Mark = 'waiting' | 'running' | 'done' | 'failed'

/** What a screen reader hears for a step. A step that has not started says nothing. */
const MARK_SAYS: Record<Mark, string> = {
  waiting: '',
  running: 'installing',
  done: 'installed',
  failed: 'failed',
}

function StepMark({ mark }: { mark: Mark }) {
  switch (mark) {
    case 'done':
      return <Check className="size-4 text-ok-fg" />
    case 'running':
      return <LoaderCircle className="tale-spin size-4 text-foreground" />
    case 'failed':
      return <X className="size-4 text-destructive" />
    case 'waiting':
      return <Circle className="size-3 text-border-strong" />
  }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const LANDED = 'translateX(-50%) translateY(0px) scale(1)'

interface PiPanelProps {
  pi: PiSetup
  /** Pi as the host says it is after a step. */
  onState: (pi: PiSetup) => void
  onDone: (outcome: 'installed' | 'later') => void
  /** An install is running, so the story cannot be gone back from. */
  onBusy: (busy: boolean) => void
  still: boolean
}

/**
 * What of Pi is missing, and the way to install it from the window: without npm a Node of hobkin's own first, then
 * Pi, then each package, one at a time, each shown as it goes. Where there is no npm and no Node hobkin can install,
 * the window says what is missing and gives the command to run. Once something has failed, or by hand, it looks again
 * on the user's press and offers a prompt for a coding agent, which can fix what stands in the way.
 */
export function PiPanel({ pi, onState, onDone, onBusy, still }: PiPanelProps) {
  // Kept as it was when the panel opened: an installed step stays in the list, ticked.
  const [steps, setSteps] = useState(() => piSteps(pi))
  const [run, setRun] = useState<Run>({ state: 'idle' })
  const [checking, setChecking] = useState(false)
  // What the last failure said, kept for the agent's prompt after Look again clears the list's marks.
  const [lastFailure, setLastFailure] = useState<string | null>(null)
  const [commandCopied, copiedCommand] = useCopied()
  const [promptCopied, copiedPrompt] = useCopied()
  const primary = useRef<HTMLButtonElement | null>(null)
  const running = run.state === 'running'
  const byHand = piByHand(pi)
  // Something is still missing after a failure, or must be installed by hand: the user may look again, or ask an agent.
  const stuck = byHand || lastFailure !== null
  // Without Pi the story cannot go on, so only the packages can be put off.
  const mayPutOff = !piBlocks(pi)

  useEffect(() => {
    primary.current?.focus({ preventScroll: true })
  }, [])

  const fail = (at: number, reason: string) => {
    setRun({ state: 'failed', at, reason })
    setLastFailure(reason)
  }

  const install = async (from: number) => {
    onBusy(true)
    for (let at = from; at < steps.length; at += 1) {
      setRun({ state: 'running', at })
      try {
        onState(await installStep(steps[at]!))
      } catch (error) {
        fail(at, reasonOf(error))
        onBusy(false)
        return
      }
    }
    onBusy(false)
    onDone('installed')
  }

  const lookAgain = async () => {
    setChecking(true)
    try {
      const now = await runCommand('setup.pi')
      onState(now)
      if (!piNeeds(now)) return onDone('installed')
      setSteps(piSteps(now))
      setRun({ state: 'idle' })
    } catch (error) {
      fail(0, reasonOf(error))
    } finally {
      setChecking(false)
    }
  }

  const markOf = (index: number): Mark => {
    if (run.state === 'idle') return 'waiting'
    if (index < run.at) return 'done'
    if (index > run.at) return 'waiting'
    return run.state === 'running' ? 'running' : 'failed'
  }

  return (
    <motion.section
      aria-label="Install Pi"
      initial={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(28px) scale(0.96)' }}
      animate={{ opacity: 1, transform: LANDED, transition: { transform: spring.rise, opacity: tween.enter } }}
      exit={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(14px) scale(0.98)', transition: tween.exit }}
      className="tale-glassy tale-glass absolute bottom-[5vh] left-1/2 z-[80] flex w-[min(520px,calc(100vw-48px))] flex-col gap-3 rounded-3xl p-4"
    >
      <ul className="flex flex-col gap-0.5">
        {steps.map((step, index) => {
          const mark = markOf(index)
          return (
            <li key={step.id} className="flex items-center gap-3 rounded-2xl px-2 py-1.5">
              <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
                <StepMark mark={mark} />
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('truncate font-heading text-[14px] font-medium', mark === 'waiting' && running && 'text-muted-foreground')}>{step.name}</div>
                <div className="truncate text-[12px] text-muted-foreground">{step.adds}</div>
              </div>
              <span className="sr-only" role={mark === 'running' ? 'status' : undefined}>
                {MARK_SAYS[mark]}
              </span>
            </li>
          )
        })}
      </ul>

      {byHand ? (
        <div className="flex flex-col gap-2 px-2">
          <p className="text-[13px] leading-relaxed">{piHandWords(pi)}</p>
          <div className="flex items-center gap-2 rounded-xl bg-code-bg py-1.5 pr-1.5 pl-3 text-code-text">
            <code className="scroll-quiet min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-[1.7] whitespace-pre select-text">{pi.installCommand}</code>
            <button
              type="button"
              aria-label={commandCopied ? 'Copied' : 'Copy'}
              onClick={() => copyText(pi.installCommand, copiedCommand)}
              className="grid size-7 shrink-0 place-items-center rounded-full outline-offset-1 transition-[transform,background-color] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.97]"
            >
              {commandCopied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      ) : null}

      {run.state === 'failed' ? (
        <p role="alert" className="scroll-quiet max-h-24 overflow-y-auto px-2 text-[12.5px] leading-snug whitespace-pre-wrap text-destructive select-text">
          {run.reason}
        </p>
      ) : null}

      {stuck ? (
        <div className="flex items-center gap-3 px-2">
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">A coding agent can do this for you. Give it this prompt, then press Look again.</p>
          <Button variant="outline" size="sm" className="px-3" onClick={() => copyText(agentPrompt(pi, lastFailure), copiedPrompt)}>
            {promptCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {promptCopied ? 'Copied' : 'Copy a prompt for an agent'}
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {mayPutOff ? (
          <Button variant="ghost" size="lg" className="px-3.5" disabled={running || checking} onClick={() => onDone('later')}>
            Not now
          </Button>
        ) : null}
        {stuck && !byHand ? (
          <Button variant="outline" size="lg" className="px-3.5" disabled={running || checking} onClick={() => void lookAgain()}>
            {checking ? 'Looking' : 'Look again'}
          </Button>
        ) : null}
        {byHand ? (
          <Button ref={primary} size="lg" className="min-w-[132px] px-4 text-[14px]" disabled={checking} onClick={() => void lookAgain()}>
            {checking ? 'Looking' : 'Look again'}
          </Button>
        ) : (
          <Button ref={primary} size="lg" className="min-w-[132px] px-4 text-[14px]" disabled={running || checking} onClick={() => void install(run.state === 'failed' ? run.at : 0)}>
            {running ? 'Installing' : run.state === 'failed' ? 'Try again' : 'Install'}
          </Button>
        )}
      </div>
    </motion.section>
  )
}
