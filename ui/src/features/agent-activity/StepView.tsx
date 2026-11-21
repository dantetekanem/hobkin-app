import { AnimatePresence, motion } from 'motion/react'
import { Braces, Check, ChevronRight, FilePenLine, FileText, FolderOpen, Globe, Search, SquareTerminal, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react'
import { Fragment, memo, useMemo, type ReactNode } from 'react'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { GrowingMarkdown, risen, sunk } from '@/features/chat/markdown.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { usePaced } from '@/features/chat/use-paced.ts'
import { diffOf, startView, unifiedRows, type Diff, type FileSides } from '@/features/review/code/diff-rows.ts'
import { languageOf } from '@/features/review/code/languages.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import './agent-activity.css'
import { useBlock } from './blocks.ts'
import { ChangeDiff } from './ChangeDiff.tsx'
import { CodeText, MoreButton } from './CodeText.tsx'
import { BOX } from './boxes.ts'
import { CodemodeCall } from './CodemodeCall.tsx'
import { NEWEST_STEPS } from './newest.ts'
import { previewOf } from './preview.ts'
import { RowStamp, Stamped } from './Stamp.tsx'
import { atOf, foldOf, looksSummary, sameStep, tailOf, type CallState, type Change, type Command, type Look, type LookKind, type Step } from './steps.ts'
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
  function StepItem({ step, timeOf }: { step: Step; timeOf: TimeOf; ended: boolean }) {
    const still = useStill()
    return (
      <motion.li
        data-step={step.kind}
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
          <StepBody step={step} timeOf={timeOf} />
        </Stamped>
      </motion.li>
    )
  },
  (before, after) => before.timeOf === after.timeOf && before.ended === after.ended && sameStep(before.step, after.step),
)

/**
 * The row above a long conversation's newest steps (newest.ts): how many came before them, and a press that draws forty
 * more. Up and Down walk onto it as onto a step, and Enter or Right presses it.
 */
export function EarlierSteps({ count, onMore }: { count: number; onMore: () => void }) {
  const more = Math.min(count, NEWEST_STEPS)
  return (
    <li data-step="earlier" tabIndex={-1} className="flex justify-center rounded-[18px] outline-none focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]">
      <button
        type="button"
        data-step-toggle
        aria-expanded={false}
        onClick={onMore}
        className="rounded-full px-3 py-1 text-[12px] text-muted-foreground transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 hover:text-foreground"
      >
        {count === 1 ? '1 earlier step' : `${count.toLocaleString('en-US')} earlier steps`} · Show {more === count ? (count === 1 ? 'it' : 'them') : `${more} more`}
      </button>
    </li>
  )
}

function StepBody({ step, timeOf }: { step: Step; timeOf: TimeOf }) {
  switch (step.kind) {
    case 'codemode':
      return <CodemodeStep entry={step.entries[0]!} state={step.state} />
    case 'says':
      return <Says text={step.text} />
    case 'shell':
      return <ShellGroup commands={step.commands} timeOf={timeOf} />
    case 'change':
      return <ChangeBlock change={step.change} />
    case 'looks':
      return <Looks looks={step.looks} />
    case 'tool':
      return <OtherTool name={step.name} summary={step.summary} state={step.state} output={step.output} failure={step.failure} />
  }
}

/** What the agent said, as Markdown. While it is being written its words change at most ten times a second, as the chat's do. */
function Says({ text }: { text: string }) {
  const shown = usePaced(text, true)
  return (
    <div className="max-w-[92%] text-[15px] leading-relaxed break-words">
      <GrowingMarkdown text={shown} />
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

/** One command: its line, its state and time, and, once opened by its line, the last of its output, all of which opens on request. */
function CommandCard({ command, time }: { command: Command; time?: EntryTime }) {
  const { open: shown, toggle: toggleShown } = useBlock('shell')
  const { open: all, toggle, box } = useUnfold<HTMLDivElement>()
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
      {shown && (tail.lines.length || command.failure) ? (
        <div className="px-3.5 pb-2.5">
          {tail.hidden && !all ? <p className="mb-0.5 text-[11px] opacity-50">{tail.hidden === 1 ? '1 line above' : `${tail.hidden.toLocaleString('en-US')} lines above`}</p> : null}
          {tail.lines.length ? (
            <div {...{ [BOX]: '' }} className="aa-box scroll-quiet">
              <pre className="font-mono text-[12px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap opacity-75">{tail.lines.join('\n')}</pre>
            </div>
          ) : null}
          {command.failure ? <p className="mt-1 font-mono text-[12px] text-bad-fg">{command.failure}</p> : null}
          {tail.hidden || all ? (
            <p className="mt-1.5">
              <MoreButton open={all} count={tail.lines.length + tail.hidden} onToggle={toggle} />
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** One place a file changed, as the review draws it. */
interface Part {
  key: string
  file: FileSides
  /** Its diff, worked out once for the counts and the rows. */
  diff: Diff
  /** The rows its diff starts with (lines and the gaps between them), and how many of them are lines. */
  rows: number
  lines: number
  additions: number
  deletions: number
  /** False for an edit: its place in the file is not known, so it gets no line numbers. */
  numbered: boolean
}

function partsOf(change: Change): Part[] {
  const part = (key: string, base: string | null, head: string, numbered: boolean): Part => {
    const diff = diffOf(base, head)
    const rows = unifiedRows(diff, startView(diff))
    return { key, file: { path: change.path, base, head, binary: false }, diff, rows: rows.length, lines: rows.filter((row) => row.type === 'line').length, additions: diff.additions, deletions: diff.deletions, numbered }
  }
  if (change.whole !== null) return [part('whole', null, change.whole, true)]
  return change.hunks.filter((hunk) => hunk.oldText !== hunk.newText).map((hunk, index) => part(`hunk${index}`, hunk.oldText, hunk.newText, false))
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
  const parts = useMemo(() => partsOf(change), [change])
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
        <code className="truncate font-mono text-[12px]">{change.path}</code>
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

/** One read or search, named by what it was about. */
function LookLine({ look }: { look: Look }) {
  const [running, done, failed] = LOOK_WORDS[look.kind]
  const words = look.state === 'running' ? running : look.state === 'failed' ? failed : done
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn('shrink-0', look.state === 'failed' && 'text-bad-fg')}>{words}</span>
        <code className="truncate font-mono text-[12px]">{look.what}</code>
        {look.where ? <span className="shrink-0 text-[12px] text-muted-foreground">{look.where}</span> : null}
        {look.state === 'running' ? <span className="aa-running size-1.5 shrink-0 self-center rounded-full bg-current opacity-70" aria-hidden="true" /> : null}
      </span>
      {look.failure ? <span className="truncate text-[12px] text-bad-fg">{look.failure}</span> : null}
    </span>
  )
}

/** What a read gave back, as a preview of the file in its colors that opens to the rest. */
function ReadText({ look, className }: { look: Look; className: string }) {
  if (!look.text) return null
  return (
    <div className={className}>
      <CodeText text={look.text} language={languageOf(look.what)} from={look.from} label={`What ${look.what} holds`} note={look.notice} />
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
        {latest.state === 'running' ? <span className="truncate text-[12px] text-muted-foreground">{LOOK_WORDS[latest.kind][0]} {latest.what}</span> : null}
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

/** A tool the canvas has no words of its own for: its name, what it was given, and its output on request. */
function OtherTool({ name, summary, state, output, failure }: { name: string; summary: string; state: CallState; output: string; failure?: string }) {
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
      {open ? <CodeText text={output} language={null} label={`Output of ${name}`} /> : null}
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
