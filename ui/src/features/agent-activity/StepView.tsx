import { AnimatePresence, motion } from 'motion/react'
import { Braces, Check, ChevronRight, FilePenLine, FileText, FolderOpen, Globe, Search, SquareTerminal, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react'
import { createContext, Fragment, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { FilePath } from '@/components/FilePath.tsx'
import { GrowingMarkdown, risen, sunk } from '@/features/chat/markdown.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { languageOf } from '@/features/review/code/languages.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import './agent-activity.css'
import { useBlock } from './blocks.ts'
import { partsOf, type Part } from './change-parts.ts'
import { ChangeDiff } from './ChangeDiff.tsx'
import { CodeText, MoreButton } from './CodeText.tsx'
import { BOX } from './boxes.ts'
import { CodemodeCall } from './CodemodeCall.tsx'
import { cutOf, cutWords, type CutState } from './cut-output.ts'
import { earlierWords, type EarlierRow } from './newest.ts'
import { wholeOutput } from './older-steps.ts'
import { previewOf } from './preview.ts'
import { RowStamp, Stamped } from './Stamp.tsx'
import { atOf, foldOf, looksSummary, sameStep, shownCommandsKey, tailOf, type CallState, type Change, type Command, type Look, type LookKind, type Step } from './steps.ts'
import { useUnfold } from './unfold.ts'
import { proofCheckOf } from '@/features/proofs/proof-match.ts'
import { ProofCheckStep, useCheckRun } from '@/features/proofs/ProofCheckStep.tsx'
import { useNear } from './use-colors.ts'
import type { EntryTime } from './use-agent-activity.ts'

/** A running command shows at most this many of its last lines (021 A5). One that failed shows as many. */
const TAIL_LINES = 12
/** A finished command that stays open shows fewer. */
const DONE_LINES = 6

type TimeOf = (id: string) => EntryTime | undefined

/**
 * The run whose steps these are, so an output the feed cut to its ends can be read whole from the run's saved session.
 * None for the main chat and for teams agents, whose outputs then say only how long they are.
 */
export const StepJob = createContext<string | null>(null)

/** The entries the step drawn was made from, so a part of it finds its own. */
const StepEntries = createContext<readonly ActivityEntry[]>([])

const arriving = { transform: spring.rise, opacity: tween.enter }

/**
 * One step of an agent's work as its canvas draws it: what it said as Markdown, its commands folded into one group,
 * a file it changed as a diff, and what it read in one row. Each kind of tool block arrives open or closed to its
 * one-line header as Settings says, and opens or closes by that header, or with every other block by Control+O
 * (blocks.ts). A step that arrives after the canvas has
 * opened rises into place by itself (Reveal.tsx: a piece that comes later needs its own entrance). A step that did not
 * change is not drawn again, and one out of view is not drawn at all.
 */
export const StepItem = memo(
  function StepItem({ step, timeOf, ended }: { step: Step; timeOf: TimeOf; ended: boolean }) {
    const still = useStill()
    return (
      <motion.li
        data-step={step.kind}
        data-step-key={step.key}
        tabIndex={-1}
        initial={holdStill(sunk, still)}
        animate={holdStill({ ...risen, transition: arriving }, still)}
        style={{ transformOrigin: '0% 100%' }}
        // Every step shares one inset, so text, rows and boxes start on one line. The step paints only inside itself
        // (content-visibility), and the inset leaves room for a glyph's edge and for a row's hover to bleed into.
        className={cn(
          'w-full min-w-0 rounded-[18px] px-2.5 text-left outline-none [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]',
          step.kind === 'says' ? '[contain-intrinsic-size:auto_56px]' : '[contain-intrinsic-size:auto_44px]',
        )}
      >
        {/* On a page that shows times, the step's first row has its time beside it. A group of commands times each of its rows. */}
        <Stamped at={step.kind === 'shell' ? undefined : atOf(step)} line={step.kind === 'says' ? 'text' : 'row'}>
          <StepEntries.Provider value={step.entries}>
            <StepBody step={step} timeOf={timeOf} ended={ended} />
          </StepEntries.Provider>
        </Stamped>
      </motion.li>
    )
  },
  (before, after) => before.timeOf === after.timeOf && before.ended === after.ended && sameStep(before.step, after.step),
)

/**
 * The row above a long conversation's newest steps (newest.ts): how many came before them, and a press that draws forty
 * more, or, with all the steps held drawn, a press that reads forty more from the run's saved session, saying so until
 * they come. It keeps its place and its one line while it reads. Up and Down walk onto it as onto a step, and Enter or
 * Right presses it.
 */
export function EarlierSteps({ row, onMore }: { row: EarlierRow; onMore: () => void }) {
  const reading = row.kind === 'saved' && row.loading
  return (
    <li data-step="earlier" tabIndex={-1} className="flex justify-center rounded-[18px] outline-none focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]">
      <button
        type="button"
        data-step-toggle
        aria-expanded={false}
        aria-busy={reading || undefined}
        onClick={reading ? undefined : onMore}
        className="rounded-full px-3 py-1 text-[12px] text-muted-foreground transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 hover:text-foreground"
      >
        {earlierWords(row)}
      </button>
    </li>
  )
}

function StepBody({ step, timeOf, ended }: { step: Step; timeOf: TimeOf; ended: boolean }) {
  switch (step.kind) {
    case 'codemode':
      return <CodemodeStep entry={step.entries[0]!} state={step.state} />
    case 'says':
      return <Says text={step.text} ended={ended} />
    case 'shell':
      return <ShellGroup commands={step.commands} timeOf={timeOf} />
    case 'change':
      return <ChangeBlock change={step.change} />
    case 'looks':
      return <Looks looks={step.looks} />
    case 'tool':
      return <OtherTool id={step.key} name={step.name} summary={step.summary} state={step.state} output={step.output} failure={step.failure} />
  }
}

/** How long the agent's words stay the same before they count as finished and parse whole. */
const SAID_MS = 1000

/**
 * What the agent said, as Markdown, as the window has it: every word the moment it arrives, with nothing rising or
 * fading in. While it is being written only its last block parses again. Words that were whole when drawn, that have
 * not changed for a second, or whose run has finished parse whole, as a stored message does.
 */
function Says({ text, ended }: { text: string; ended: boolean }) {
  const [said, setSaid] = useState({ text, still: true })
  // Words that changed are being written, until they rest.
  if (said.text !== text) setSaid({ text, still: false })
  useEffect(() => {
    if (said.still) return
    const timer = setTimeout(() => setSaid((now) => (now.text === said.text ? { ...now, still: true } : now)), SAID_MS)
    return () => clearTimeout(timer)
  }, [said])
  return (
    <div className="max-w-[92%] text-[15px] leading-relaxed break-words">
      <GrowingMarkdown text={text} whole={ended || said.still} />
    </div>
  )
}

/** Seconds as the canvas says them: 8s, 1m 05s. */
function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** How a call stands, in a word and a mark. A running one breathes and counts its time. */
export function StateMark({ state, time, exitCode }: { state: CallState; time?: EntryTime; exitCode?: number }) {
  const running = state === 'running'
  const now = useNow(running && time?.started !== undefined, 1000)
  if (running) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] opacity-70 tabular-nums">
        <span className="aa-running size-1.5 rounded-full bg-current" aria-hidden="true" />
        {time?.started !== undefined ? duration(now - time.started) : 'running'}
      </span>
    )
  }
  if (state === 'failed' || state === 'stopped') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-bad-fg tabular-nums">
        <TriangleAlert className="size-3" aria-hidden="true" />
        {state === 'stopped' ? 'stopped' : exitCode !== undefined ? `exit ${exitCode}` : 'failed'}
      </span>
    )
  }
  const took = time?.started !== undefined && time.ended !== undefined ? duration(time.ended - time.started) : null
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] opacity-70 tabular-nums">
      <Check className="size-3 text-ok-fg" aria-hidden="true" />
      <span className="sr-only">passed</span>
      {took}
    </span>
  )
}

/**
 * A number that changes by sliding: the old one leaves upward as the new one rises in. Both sit in the grid's one
 * cell while they pass, so the count keeps its height and nothing leaves the flow (no style sheet is added for it).
 */
function Count({ value }: { value: number }) {
  const still = useStill()
  return (
    <span className="relative inline-grid overflow-hidden tabular-nums">
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          className="col-start-1 row-start-1"
          initial={holdStill({ opacity: 0, transform: 'translateY(70%)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'translateY(0%)', transition: arriving }, still)}
          exit={holdStill({ opacity: 0, transform: 'translateY(-70%)', transition: tween.exit }, still)}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** The row a group folds into. It opens to the list with Enter or a click. */
function FoldRow({ icon: Icon, open, onToggle, children, failed = false }: { icon: LucideIcon; open: boolean; onToggle?: () => void; children: ReactNode; failed?: boolean }) {
  const content = (
    <>
      <Icon className={cn('size-3.5 shrink-0', failed ? 'text-bad-fg' : 'text-muted-foreground')} aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">{children}</span>
      {onToggle ? <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]', open && 'rotate-90')} aria-hidden="true" /> : null}
    </>
  )
  // Its icon sits on the steps' line, and its hover reaches out into their inset.
  const look = '-mx-2.5 flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px]'
  if (!onToggle) return <div className={look}>{content}</div>
  return (
    <button type="button" data-step-toggle aria-expanded={open} onClick={onToggle} className={cn(look, 'transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1')}>
      {content}
    </button>
  )
}

/** A list that opens under its row: each line rises in after the one before. */
function Opened({ children }: { children: ReactNode[] }) {
  const still = useStill()
  return (
    // Lined up under the row's words, past its icon. The times of its items reach back past the indent (Stamp.tsx).
    <ul className="flex flex-col gap-1 pl-[22px] [--aa-indent:22px]">
      {children.map((child, index) => (
        <motion.li
          key={index}
          initial={holdStill({ opacity: 0, transform: 'translateY(10px)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: { ...spring.rise, delay: Math.min(index, 8) * 0.03 }, opacity: { ...tween.enter, delay: Math.min(index, 8) * 0.03 } } }, still)}
          className="min-w-0"
        >
          {child}
        </motion.li>
      ))}
    </ul>
  )
}

/**
 * Commands in a row (021 A3, A4). The newest stays out of the fold, with any still running and any that failed. The
 * ones that passed before it fold into one row that opens to the list. When a new command starts, the one before it
 * slides up into that row and the count goes up as the new one rises in.
 */
function ShellGroup({ commands, timeOf }: { commands: Command[]; timeOf: TimeOf }) {
  const still = useStill()
  const { open, toggle } = useBlock('shell')
  const { folded, open: shown } = foldOf(commands)
  // Motion measures where the commands are only when one comes or goes, not each time one prints more.
  const layoutKey = shownCommandsKey(shown)
  return (
    <div className="flex flex-col gap-1.5">
      {folded.length ? (
        <>
          {/* A column, so the row stretches across it as it did without its time. */}
          <div className="relative flex flex-col">
            <RowStamp at={folded[0]!.at} line="row" />
            <FoldRow icon={SquareTerminal} open={open} onToggle={toggle}>
              <span className="shrink-0 font-medium">
                <Count value={folded.length} /> {folded.length === 1 ? 'command' : 'commands'}
              </span>
              <span className="truncate font-mono text-[12px] text-muted-foreground">{folded.map((command) => firstLine(command.command)).join(' · ')}</span>
            </FoldRow>
          </div>
          {open ? <Opened>{folded.map((command) => <CommandCard key={command.id} command={command} time={timeOf(command.id)} />)}</Opened> : null}
        </>
      ) : null}
      {/* Positioned, so a command giving way is lifted out within it and never stretches the canvas. */}
      <div className="relative flex flex-col gap-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((command) => (
            <motion.div
              key={command.id}
              // Under Still nothing travels, not even to make room.
              layout={still ? false : 'position'}
              layoutDependency={layoutKey}
              initial={holdStill(sunk, still)}
              animate={holdStill({ ...risen, transition: { ...arriving, layout: spring.sheet } }, still)}
              // It gives way to the next command by sliding up into the row above.
              exit={holdStill({ opacity: 0, transform: 'translateY(-18px) scale(0.97)', transition: { transform: spring.screenExit, opacity: { duration: 0.2, ease: 'linear' } } } as const, still)}
            >
              <CommandOrProof command={command} time={timeOf(command.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

const firstLine = (text: string) => text.split('\n').find((line) => line.trim())?.trim() ?? ''

/**
 * A command, or, for `hobkin proof check`, the run it started (050-tla-proofs). A check that ended with no run to show
 * is the command it was, so what it printed can still be read.
 */
function CommandOrProof({ command, time }: { command: Command; time?: EntryTime }) {
  const spec = proofCheckOf(command.command)
  return spec ? <ProofCommand command={command} time={time} spec={spec} /> : <CommandCard command={command} time={time} />
}

function ProofCommand({ command, time, spec }: { command: Command; time?: EntryTime; spec: string }) {
  const run = useCheckRun(spec, command.at ?? time?.started, command.output)
  if (!run && command.state !== 'running') return <CommandCard command={command} time={time} />
  return (
    <div className="relative min-w-0">
      <RowStamp at={command.at} line="card" />
      <ProofCheckStep run={run} spec={spec} />
    </div>
  )
}

/** The size and look of the step view's small presses, as CodeText's MoreButton draws them. */
const PRESS = 'rounded-full px-2 py-0.5 text-[11px] font-medium opacity-70 transition-opacity duration-[160ms] ease-[ease] hover:opacity-100'

interface Whole {
  /** How long the output is in all, when the feed cut it to its ends. Null when it holds it whole. */
  length: number | null
  /** The whole text, once read. */
  text: string | null
  state: CutState
  read: () => void
}

/**
 * An output the feed cut to its ends (`outputLength`), by its entry's id: how long it is in all, and its whole text once
 * a press read it from the run's saved session. The text is kept only while the part showing it is drawn.
 */
function useWhole(id: string): Whole {
  const job = useContext(StepJob)
  const length = cutOf(useContext(StepEntries).find((entry) => entry.id === id))
  const [read, setRead] = useState<{ text: string | null } | null>(null)
  const [reading, setReading] = useState(false)
  const drawn = useRef(true)
  useEffect(() => {
    drawn.current = true
    return () => {
      drawn.current = false
    }
  }, [])

  const start = () => {
    if (!job || reading) return
    setReading(true)
    void wholeOutput(job, id).then((text) => {
      if (!drawn.current) return
      setRead({ text })
      setReading(false)
    })
  }
  const state: CutState = !job || (read && read.text === null) ? 'unsaved' : reading ? 'reading' : 'cut'
  return { length, text: read?.text ?? null, state, read: start }
}

/** Under an output the feed cut: how much there is in all, and a press that reads all of it. It keeps its size while it reads. */
function CutNote({ whole }: { whole: Whole }) {
  if (whole.length === null || whole.text !== null) return null
  const words = cutWords(whole.length, whole.state)
  if (whole.state === 'cut') {
    return (
      <button type="button" onClick={whole.read} className={PRESS}>
        {words}
      </button>
    )
  }
  return (
    <span aria-live="polite" className="rounded-full px-2 py-0.5 text-[11px] font-medium opacity-70">
      {words}
    </span>
  )
}

/** One command: its line, its state and time, and, once opened by its line, the last of its output, all of which opens on request. */
function CommandCard({ command, time }: { command: Command; time?: EntryTime }) {
  const { open: shown, toggle: toggleShown } = useBlock('shell')
  const { open: all, toggle, box } = useUnfold<HTMLDivElement>()
  const whole = useWhole(command.id)
  const tail = tailOf(command.output, all ? Number.MAX_SAFE_INTEGER : command.state === 'done' ? DONE_LINES : TAIL_LINES)
  const lines = command.command.split('\n')
  const more = lines.length > 1
  return (
    <div
      ref={box}
      className={cn(
        'relative min-w-0 rounded-2xl bg-code-bg text-code-text',
        // A hairline, so the card stands off a canvas of nearly its own color. A failed one also carries a red edge.
        command.state === 'failed' ? 'shadow-[inset_3px_0_0_var(--hb-bad),inset_0_0_0_1px_var(--hb-border)]' : 'shadow-[inset_0_0_0_1px_var(--hb-border)]',
      )}
    >
      <RowStamp at={command.at} line="card" />
      <button
        type="button"
        data-step-toggle
        aria-expanded={shown}
        onClick={toggleShown}
        className="flex w-full min-w-0 items-start gap-2 px-3.5 py-2 text-left"
      >
        <span className="font-mono text-[13px] leading-[1.7] opacity-50" aria-hidden="true">
          $
        </span>
        <code className="min-w-0 flex-1 font-mono text-[13px] leading-[1.7] break-words whitespace-pre-wrap">{all || !more ? command.command : `${lines[0]} …`}</code>
        <span className="pt-[3px]">
          <StateMark state={command.state} time={time} exitCode={command.exitCode} />
        </span>
      </button>
      {shown && whole.text !== null ? (
        // The whole output, read from the run's saved session, opens two hundred lines a press as a big read does.
        <div className="px-3.5 pb-2.5">
          <CodeText text={whole.text} language={null} label={`Output of ${lines[0]}`} />
        </div>
      ) : shown && (tail.lines.length || command.failure) ? (
        <div className="px-3.5 pb-2.5">
          {tail.hidden && !all ? <p className="mb-0.5 text-[11px] opacity-50">{tail.hidden === 1 ? '1 line above' : `${tail.hidden.toLocaleString('en-US')} lines above`}</p> : null}
          {tail.lines.length ? (
            <div {...{ [BOX]: '' }} className="aa-box scroll-quiet">
              <pre className="font-mono text-[12px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap opacity-75">{tail.lines.join('\n')}</pre>
            </div>
          ) : null}
          {command.failure ? <p className="mt-1 font-mono text-[12px] text-bad-fg">{command.failure}</p> : null}
          {tail.hidden || all || whole.length !== null ? (
            <p className="mt-1.5 flex items-center gap-1">
              {tail.hidden || all ? <MoreButton open={all} count={tail.lines.length + tail.hidden} onToggle={toggle} /> : null}
              <CutNote whole={whole} />
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A file the agent changed (021 A1, A2): the review's own diff, with syntax colors, added and removed lines tinted
 * and the words that changed marked. It arrives open, unless Settings says otherwise. Edits to one file in a row are
 * one change that updates in place, drawn in one box as Pi's code previews draw an edit: each place it changed after
 * the one before, with a quiet band where lines were left out between them. It is as tall as its lines, wrapped: a
 * long one shows its first lines across its parts and opens in place to all of them.
 */
function ChangeBlock({ change }: { change: Change }) {
  const block = useBlock('change')
  const { open, presses, toggle, more, box } = useUnfold<HTMLDivElement>()
  // Colored only once in or near view: a page's changes far above it wait until they are scrolled to.
  const near = useNear(box)
  // The change grows in place: a new edit diffs only the place it added or changed, and the rest are the parts drawn.
  const drawn = useRef<readonly Part[]>([])
  const parts = useMemo(() => partsOf(change, drawn.current), [change])
  useEffect(() => {
    drawn.current = parts
  }, [parts])
  const additions = parts.reduce((sum, part) => sum + part.additions, 0)
  const deletions = parts.reduce((sum, part) => sum + part.deletions, 0)
  // A big change opens two hundred lines a press: its rows are drawn as they are asked for, never all at once.
  const preview = previewOf(parts.map((part) => part.rows), presses)
  const verb = change.whole !== null ? 'Wrote' : 'Edited'
  const shown = block.open && parts.length > 0
  return (
    <div ref={box} className="flex min-w-0 flex-col gap-1.5">
      <FoldRow icon={FilePenLine} open={shown} onToggle={parts.length ? block.toggle : undefined} failed={change.state === 'failed'}>
        <span className="shrink-0 font-medium">{change.state === 'running' ? (change.whole !== null ? 'Writing' : 'Editing') : change.state === 'failed' ? 'Could not change' : verb}</span>
        <FilePath path={change.path} className="font-mono text-[12px]" />
        {additions || deletions ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            <span className="text-ok-fg">+{additions}</span> <span className="text-bad-fg">−{deletions}</span>
          </span>
        ) : null}
        {change.calls > 1 ? <span className="shrink-0 text-[11px] text-muted-foreground">{change.calls} edits</span> : null}
      </FoldRow>
      {shown ? (
        <div className="aa-diff overflow-hidden rounded-2xl" data-numbers={parts[0]!.numbered ? undefined : 'none'}>
          <div {...{ [BOX]: '' }} className="aa-box scroll-quiet bg-code-bg py-1">
            {parts.map((part, index) =>
              preview.shown[index] ? (
                <Fragment key={part.key}>
                  {index > 0 ? (
                    <div className="aa-skip" role="separator" aria-label="Lines left out">
                      <span aria-hidden="true">⋯</span>
                    </div>
                  ) : null}
                  <ChangeDiff file={part.file} diff={part.diff} rows={preview.shown[index]!} near={near} />
                </Fragment>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      {shown && preview.foldable ? (
        <p>
          <MoreButton open={open} count={parts.reduce((sum, part) => sum + part.lines, 0)} onToggle={toggle} onMore={more} left={preview.left} next={preview.next} />
        </p>
      ) : null}
      {change.failures.map((failure, index) => (
        <p key={index} className="flex items-start gap-1.5 pl-[22px] text-[12px] text-bad-fg">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words whitespace-pre-wrap">{failure}</span>
        </p>
      ))}
    </div>
  )
}

const LOOK_ICON: Record<LookKind, LucideIcon> = { read: FileText, search: Search, list: FolderOpen, fetch: Globe }
const LOOK_WORDS: Record<LookKind, [running: string, done: string, failed: string]> = {
  read: ['Reading', 'Read', 'Could not read'],
  search: ['Searching for', 'Searched for', 'Could not search for'],
  list: ['Listing', 'Listed', 'Could not list'],
  fetch: ['Fetching', 'Fetched', 'Could not fetch'],
}

/** A read or a listing is about a path, which is cut from its front. A search's pattern and a fetch's address are cut at their end. */
const aboutPath = (kind: LookKind) => kind === 'read' || kind === 'list'

/** One read or search, named by what it was about. */
function LookLine({ look }: { look: Look }) {
  const [running, done, failed] = LOOK_WORDS[look.kind]
  const words = look.state === 'running' ? running : look.state === 'failed' ? failed : done
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn('shrink-0', look.state === 'failed' && 'text-bad-fg')}>{words}</span>
        {aboutPath(look.kind) ? <FilePath path={look.what} className="font-mono text-[12px]" /> : <code className="truncate font-mono text-[12px]">{look.what}</code>}
        {look.where ? <span className="shrink-0 text-[12px] text-muted-foreground">{look.where}</span> : null}
        {look.state === 'running' ? <span className="aa-running size-1.5 shrink-0 self-center rounded-full bg-current opacity-70" aria-hidden="true" /> : null}
      </span>
      {look.failure ? <span className="truncate text-[12px] text-bad-fg">{look.failure}</span> : null}
    </span>
  )
}

/** What a read gave back, as a preview of the file in its colors that opens to the rest. */
function ReadText({ look, className }: { look: Look; className: string }) {
  const whole = useWhole(look.id)
  if (!look.text) return null
  return (
    <div className={className}>
      {whole.text !== null ? (
        <CodeText text={whole.text} language={languageOf(look.what)} from={look.from} label={`What ${look.what} holds`} />
      ) : (
        <>
          <CodeText text={look.text} language={languageOf(look.what)} from={look.from} label={`What ${look.what} holds`} note={look.notice} />
          <CutNote whole={whole} />
        </>
      )}
    </div>
  )
}

/** One read or search in an opened list: its line, which opens to what a read gave back. */
function LookItem({ look }: { look: Look }) {
  const { open, toggle } = useBlock('looks')
  if (!look.text) {
    return (
      <div className="relative py-0.5 text-[13px]">
        <RowStamp at={look.at} line="item" />
        <LookLine look={look} />
      </div>
    )
  }
  return (
    <div className="relative flex flex-col gap-1 py-0.5 text-[13px]">
      <RowStamp at={look.at} line="item" />
      <button
        type="button"
        data-step-toggle
        aria-expanded={open}
        onClick={toggle}
        className="-mx-1.5 min-w-0 rounded-lg px-1.5 text-left transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1"
      >
        <LookLine look={look} />
      </button>
      {open ? <ReadText look={look} className="pb-1" /> : null}
    </div>
  )
}

/** Reads and searches in a row (021 A7): one row that says how many, and opens to the list of what was read. */
function Looks({ looks }: { looks: Look[] }) {
  const { open, toggle } = useBlock('looks')
  const failed = looks.filter((look) => look.state === 'failed').length
  const latest = looks.at(-1)!
  if (looks.length === 1) {
    return (
      <div className="flex flex-col gap-1">
        <FoldRow icon={LOOK_ICON[latest.kind]} open={open && Boolean(latest.text)} onToggle={latest.text ? toggle : undefined} failed={failed > 0}>
          <LookLine look={latest} />
        </FoldRow>
        {open ? <ReadText look={latest} className="" /> : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <FoldRow icon={LOOK_ICON[latest.kind]} open={open} onToggle={toggle}>
        <span className="shrink-0 font-medium">{looksSummary(looks)}</span>
        {failed ? <span className="shrink-0 text-[12px] text-bad-fg">{failed === 1 ? '1 failed' : `${failed} failed`}</span> : null}
        {latest.state === 'running' ? <RunningLook look={latest} /> : null}
      </FoldRow>
      {open ? (
        <Opened>
          {looks.map((look) => (
            <LookItem key={look.id} look={look} />
          ))}
        </Opened>
      ) : null}
    </div>
  )
}

/** The read or search still running in a folded group, after the group's count. */
function RunningLook({ look }: { look: Look }) {
  const words = LOOK_WORDS[look.kind][0]
  if (!aboutPath(look.kind)) {
    return (
      <span className="truncate text-[12px] text-muted-foreground">
        {words} {look.what}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-baseline text-[12px] text-muted-foreground">
      <span className="shrink-0 whitespace-pre">{words} </span>
      <FilePath path={look.what} />
    </span>
  )
}

/** A tool the canvas has no words of its own for: its name, what it was given, and its output on request. */
function OtherTool({ id, name, summary, state, output, failure }: { id: string; name: string; summary: string; state: CallState; output: string; failure?: string }) {
  const whole = useWhole(id)
  const block = useBlock('other')
  const opens = Boolean(output.trim()) && !failure
  const open = opens && block.open
  return (
    <div className="flex flex-col gap-1">
      <FoldRow icon={Wrench} open={open} onToggle={opens ? block.toggle : undefined} failed={state === 'failed'}>
        <span className="shrink-0 font-medium">{state === 'running' ? 'Using' : 'Used'}</span>
        <code className="shrink-0 font-mono text-[12px]">{name}</code>
        {summary ? <span className="truncate text-[12px] text-muted-foreground">{summary}</span> : null}
        <span className="ml-auto">
          <StateMark state={state} />
        </span>
      </FoldRow>
      {failure ? <p className="pl-[22px] text-[12px] break-words whitespace-pre-wrap text-bad-fg">{failure}</p> : null}
      {open ? (
        <>
          <CodeText text={whole.text ?? output} language={null} label={`Output of ${name}`} />
          <CutNote whole={whole} />
        </>
      ) : null}
    </div>
  )
}

/** A codemode script: one row with how it stands, which opens to its operations, output and source. */
function CodemodeStep({ entry, state }: { entry: ActivityEntry; state: CallState }) {
  const { open, toggle } = useBlock('other')
  return (
    <div className="flex flex-col gap-1.5">
      <FoldRow icon={Braces} open={open} onToggle={toggle} failed={state === 'failed'}>
        <span className="shrink-0 font-medium">{state === 'running' ? 'Running' : 'Ran'}</span>
        <code className="shrink-0 font-mono text-[12px]">codemode</code>
        <span className="ml-auto">
          <StateMark state={state} />
        </span>
      </FoldRow>
      {open ? <CodemodeCall entry={entry} ended={state === 'stopped'} /> : null}
    </div>
  )
}
