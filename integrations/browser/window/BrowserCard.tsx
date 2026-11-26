import { Download, LoaderCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { useStore } from 'zustand'
import type { BrowserState } from '../protocol.ts'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { serviceMark } from '@/features/integrations/marks.ts'
import { ServiceMark } from '@/features/integrations/ServiceMark.tsx'
import { heldDown } from '@/features/review/verdict.ts'
import { useSlice } from '@/integration/use-slice.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { CONFIRM_MS, createTwoClicks, type TwoClicks } from '@/lib/two-clicks.ts'
import { cn } from '@/lib/utils.ts'
import { run } from './commands.ts'
import { browserCard, closeBrowsers, reasonOf, type CloseCommand, type EnginePill, type EngineState, type Said, type SessionLine } from './model.ts'

/** The pill's colors by its tone. A busy pill shows a spinner where its dot would be. */
const PILL_TONE: Record<EnginePill['tone'], { pill: string; dot: string }> = {
  ok: { pill: 'bg-ok/15 text-ok-fg', dot: 'bg-ok' },
  warn: { pill: 'bg-warn/15 text-warn-fg', dot: 'bg-warn' },
  bad: { pill: 'bg-bad/15 text-bad-fg', dot: 'bg-bad' },
  quiet: { pill: 'bg-surface-2 text-muted-foreground', dot: 'bg-muted-foreground' },
}

const QUIET_PILL = 'inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-heading text-[12px] font-medium text-muted-foreground'

/** How long the list's times go without being read again. */
const CLOCK_MS = 30000

const closeOnHost: CloseCommand = (args) => run('browser.close', args)

function StatePill({ pill, still }: { pill: EnginePill; still: boolean }) {
  const tone = PILL_TONE[pill.tone]

  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-heading text-[12px] font-medium whitespace-nowrap', tone.pill)}>
      {pill.busy ? (
        <LoaderCircle className={cn('size-3.5', !still && 'svc-spin')} aria-hidden="true" />
      ) : (
        <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden="true" />
      )}
      {pill.label}
    </span>
  )
}

/**
 * Close all's two clicks (`lib/two-clicks.ts`). The close reads the host as it is when it is confirmed, not as it was
 * when the card appeared, and hands what came of it to `onSaid`.
 */
function useCloseAll(live: boolean, onSaid: (said: Said) => void): TwoClicks {
  const latest = useRef({ live, onSaid })
  useEffect(() => {
    latest.current = { live, onSaid }
  })

  const [flow] = useState(() =>
    createTwoClicks<string>({
      initial: '',
      run: async () => {
        const confirmed = latest.current
        const said = await closeBrowsers({ live: confirmed.live, command: closeOnHost })
        confirmed.onSaid(said)
        return ''
      },
    }),
  )
  useEffect(() => () => flow.dispose(), [flow])

  return flow
}

/**
 * Close all, confirmed in place by the app's two clicks: the first click turns it into "Click again to close" for ten
 * seconds, a line along its foot running out over them, and the second closes every browser. Escape, moving to
 * another control or the ten seconds take the first click back.
 */
function CloseAll({ flow, still }: { flow: TwoClicks; still: boolean }) {
  const { armed, busy } = useStore(flow)

  // Focus that moves to another control takes the first click back. A click that focuses nothing names nowhere, and the ten seconds see to it.
  const onBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (armed && event.relatedTarget instanceof Node) flow.cancel()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // A key held from the first click only repeats, and never gives the second.
    if (heldDown(event)) {
      event.preventDefault()
      return
    }
    if (event.key !== 'Escape' || !armed) return

    // Escape takes the first click back here, before the screen or the frame hears it.
    event.preventDefault()
    event.stopPropagation()
    flow.cancel()
  }

  return (
    <Button
      variant="outline"
      size="sm"
      data-key-stop=""
      aria-pressed={armed}
      disabled={busy}
      focusableWhenDisabled
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onClick={() => void flow.press()}
      className={cn('relative shrink-0 overflow-hidden', armed && 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background')}
    >
      {busy ? 'Closing…' : armed ? 'Click again to close' : 'Close all'}
      {armed && !still ? (
        <motion.span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-55"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: CONFIRM_MS / 1000, ease: 'linear' }}
        />
      ) : null}
    </Button>
  )
}

function SessionRow({ line, closing, onClose }: { line: SessionLine; closing: boolean; onClose: (agent: string) => void }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-tone-1 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-[14px] font-medium">{line.label}</p>
        <p className="truncate text-[12px] text-muted-foreground" title={line.address ?? undefined}>
          {line.page} · {line.used}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        data-key-stop=""
        aria-label={line.closeLabel}
        disabled={closing}
        focusableWhenDisabled
        onClick={() => onClose(line.agent)}
        className="shrink-0"
      >
        {closing ? 'Closing…' : 'Close'}
      </Button>
    </li>
  )
}

/**
 * The browser for hobkin's agents, on the Integrations screen. The card says whether its engine is installed and in
 * which versions, installs it on the user's press and says what the install is doing, and lists the agents that have
 * a browser open now, each with a Close and all with one more. What a press could not do is said here, in the host's
 * words. What it says of the state comes from `model.ts`.
 */
export function BrowserCard({ still }: { still: boolean }) {
  const browser = useSlice<BrowserState>('browser')
  const live = useHasHost()
  const now = useNow(browser.sessions.length > 0, CLOCK_MS)
  const card = browserCard(browser, now)
  const engine = browser.engine.state

  const [asking, setAsking] = useState(false)
  // A refusal belongs to the state it was said in: once the engine stands otherwise, it is no longer shown.
  const [refused, setRefused] = useState<{ at: EngineState; text: string } | null>(null)
  const refusal = refused?.at === engine ? refused.text : null

  const [closing, setClosing] = useState<readonly string[]>([])
  const [said, setSaid] = useState<Said | null>(null)
  const closeAll = useCloseAll(live, setSaid)

  // A host that has not looked yet is asked to. One that does not run the browser says what fixes it, and the card shows that.
  useEffect(() => {
    if (!live || engine !== 'unknown') return

    let gone = false
    run('browser.status').catch((error: unknown) => {
      if (!gone) setRefused({ at: 'unknown', text: reasonOf(error) })
    })

    return () => {
      gone = true
    }
  }, [live, engine])

  const install = () => {
    setAsking(true)
    setRefused(null)

    run('browser.install').then(
      () => setAsking(false),
      (error: unknown) => {
        setAsking(false)
        setRefused({ at: engine, text: reasonOf(error) })
      },
    )
  }

  const closeOne = (agent: string) => {
    setSaid(null)
    setClosing((agents) => [...agents, agent])

    void closeBrowsers({ live, command: closeOnHost, agent }).then((result) => {
      setClosing((agents) => agents.filter((other) => other !== agent))
      setSaid(result)
    })
  }

  return (
    <section aria-label="Browser" className="flex flex-col gap-5 rounded-[28px] bg-background p-5">
      <header className="flex items-start gap-4">
        <ServiceMark look={serviceMark('browser')} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-[22px] leading-tight font-semibold tracking-[-0.022em]">Browser</h3>
            <StatePill pill={card.pill} still={still} />
            {live ? null : <span className={QUIET_PILL}>Sample data</span>}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{card.line}</p>
          {card.versions ? <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">{card.versions}</p> : null}
        </div>
      </header>

      {card.progress ? (
        <p role="status" className="rounded-2xl bg-tone-1 px-4 py-3 text-[13px] break-words text-muted-foreground">
          {card.progress}
        </p>
      ) : null}
      {card.failure ? <p className="rounded-2xl bg-bad/10 px-4 py-3 text-[13px] break-words text-bad-fg">{card.failure}</p> : null}
      {card.explains ? <p className="max-w-[64ch] text-[13px] leading-relaxed text-muted-foreground">{card.explains}</p> : null}

      {card.sessions.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex min-h-7 items-center justify-between gap-3">
            <h4 className="eyebrow">{card.open}</h4>
            {card.sessions.length > 1 ? <CloseAll flow={closeAll} still={still} /> : null}
          </div>
          <ul aria-label="Open browsers" className="flex flex-col gap-2">
            {card.sessions.map((line) => (
              <SessionRow key={line.agent} line={line} closing={closing.includes(line.agent)} onClose={closeOne} />
            ))}
          </ul>
        </div>
      ) : card.empty ? (
        <p className="text-[13px] text-muted-foreground">{card.empty}</p>
      ) : null}
      {said ? (
        <p role={said.tone === 'refused' ? 'alert' : 'status'} className={cn('text-[13px] leading-snug', said.tone === 'refused' ? 'text-bad-fg' : 'text-muted-foreground')}>
          {said.text}
        </p>
      ) : null}

      {card.button ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button data-key-stop="" disabled={asking} focusableWhenDisabled onClick={install}>
            <Download aria-hidden="true" />
            {asking ? 'Starting…' : card.button}
          </Button>
        </div>
      ) : null}
      {refusal !== null ? (
        <p role="alert" className="text-[13px] leading-snug break-words text-bad-fg">
          {refusal}
        </p>
      ) : null}
    </section>
  )
}
