import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronRight, FilePenLine, FileText, FolderOpen, Globe, Search, SquareTerminal, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { holdStill, useStill } from '@/app/still.ts'
import { MessageText, risen, sunk } from '@/features/chat/markdown.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { diffOf, startView, unifiedRows, type FileSides } from '@/features/review/code/diff-rows.ts'
import { DiffView } from '@/features/review/code/DiffView.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import './agent-activity.css'
import { foldOf, looksSummary, sameStep, tailOf, type CallState, type Change, type Command, type Look, type LookKind, type Step } from './steps.ts'
import type { EntryTime } from './use-agent-activity.ts'

/** A running command shows at most this many of its last lines (021 A5). One that failed shows as many. */
const TAIL_LINES = 12
/** A finished command that stays open shows fewer. */
const DONE_LINES = 6
/** Rows of a diff are measured once drawn. Until then each is one line of code: 13px at a line height of 1.7. */
const DIFF_ROW = 22.1
/** A gap between the parts shown, as the diff estimates it. */
const DIFF_GAP = 30
/** A change is drawn this tall at most until it is opened, and the whole of it then scrolls inside the canvas's height. */
const DIFF_CLOSED = 320

type TimeOf = (id: string) => EntryTime | undefined

const arriving = { transform: spring.rise, opacity: tween.enter }

/**
 * One step of an agent's work as its canvas draws it: what it said as Markdown, its commands folded into one group,
 * a file it changed as a diff, and what it read in one row. A step that arrives after the canvas has opened rises
 * into place by itself (Reveal.tsx: a piece that comes later needs its own entrance). A step that did not change
 * is not drawn again, and one out of view is not drawn at all.
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
        className={cn(
          'w-full min-w-0 rounded-[18px] text-left outline-none [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]',
          step.kind === 'says' ? '[contain-intrinsic-size:auto_56px]' : step.kind === 'change' ? '[contain-intrinsic-size:auto_220px]' : '[contain-intrinsic-size:auto_44px]',
        )}
      >
        <StepBody step={step} timeOf={timeOf} />
      </motion.li>
    )
  },
  (before, after) => before.timeOf === after.timeOf && before.ended === after.ended && sameStep(before.step, after.step),
)

function StepBody({ step, timeOf }: { step: Step; timeOf: TimeOf }) {
  switch (step.kind) {
    case 'says':
      return (
        <div className="max-w-[92%] text-[15px] leading-relaxed break-words">
          <MessageText text={step.text} role="assistant" />
        </div>
      )
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

/** Seconds as the canvas says them: 8s, 1m 05s. */
function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** How a call stands, in a word and a mark. A running one breathes and counts its time. */
function StateMark({ state, time, exitCode }: { state: CallState; time?: EntryTime; exitCode?: number }) {
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

/** A number that changes by sliding: the old one leaves upward as the new one rises in. */
function Count({ value }: { value: number }) {
  const still = useStill()
  return (
    <span className="relative inline-grid overflow-hidden tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
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
  const look = 'flex w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px]'
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
    <ul className="flex flex-col gap-1 pl-6">
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
 * Commands in a row (021 A3, A4). The newest stays open, with any still running and any that failed. The ones
 * that passed before it fold into one row that opens to the list. When a new command starts, the one before it
 * slides up into that row and the count goes up as the new one rises in.
 */
function ShellGroup({ commands, timeOf }: { commands: Command[]; timeOf: TimeOf }) {
  const still = useStill()
  const [open, setOpen] = useState(false)
  const { folded, open: shown } = foldOf(commands)
  return (
    <div className="flex flex-col gap-1.5">
      {folded.length ? (
        <>
          <FoldRow icon={SquareTerminal} open={open} onToggle={() => setOpen(!open)}>
            <span className="shrink-0 font-medium">
              <Count value={folded.length} /> {folded.length === 1 ? 'command' : 'commands'}
            </span>
            <span className="truncate font-mono text-[12px] text-muted-foreground">{folded.map((command) => firstLine(command.command)).join(' · ')}</span>
          </FoldRow>
          {open ? <Opened>{folded.map((command) => <CommandCard key={command.id} command={command} time={timeOf(command.id)} closed />)}</Opened> : null}
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
              <CommandCard command={command} time={timeOf(command.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

const firstLine = (text: string) => text.split('\n').find((line) => line.trim())?.trim() ?? ''

/** One command: its line, its state and time, and the last of its output, all of which opens on request. */
function CommandCard({ command, time, closed = false }: { command: Command; time?: EntryTime; closed?: boolean }) {
  const [shown, setShown] = useState(!closed)
  const [all, setAll] = useState(false)
  const tail = tailOf(command.output, all ? Number.MAX_SAFE_INTEGER : command.state === 'done' ? DONE_LINES : TAIL_LINES)
  const lines = command.command.split('\n')
  const more = lines.length > 1
  return (
    <div
      className={cn(
        'min-w-0 rounded-2xl bg-code-bg text-code-text',
        // A hairline, so the card stands off a canvas of nearly its own color. A failed one also carries a red edge.
        command.state === 'failed' ? 'shadow-[inset_3px_0_0_var(--hb-bad),inset_0_0_0_1px_var(--hb-border)]' : 'shadow-[inset_0_0_0_1px_var(--hb-border)]',
      )}
    >
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown(!shown)}
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
            <pre className={cn('scroll-quiet overflow-x-auto font-mono text-[12px] leading-[1.6] whitespace-pre opacity-75', all && 'max-h-[60vh] overflow-y-auto')}>{tail.lines.join('\n')}</pre>
          ) : null}
          {command.failure ? <p className="mt-1 font-mono text-[12px] text-bad-fg">{command.failure}</p> : null}
          {tail.hidden || all ? (
            <button type="button" onClick={() => setAll(!all)} className="mt-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium opacity-70 transition-opacity duration-[160ms] ease-[ease] hover:opacity-100">
              {all ? 'Show the last lines' : 'Show all output'}
            </button>
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
  /** How tall its rows are before they are measured, as the diff itself estimates them. */
  height: number
  additions: number
  deletions: number
  /** False for an edit: its place in the file is not known, so it gets no line numbers. */
  numbered: boolean
}

function partsOf(change: Change): Part[] {
  const part = (key: string, base: string | null, head: string, numbered: boolean): Part => {
    const diff = diffOf(base, head)
    const height = unifiedRows(diff, startView(diff)).reduce((sum, item) => sum + (item.type === 'gap' ? DIFF_GAP : DIFF_ROW), 0)
    return { key, file: { path: change.path, base, head, binary: false }, height, additions: diff.additions, deletions: diff.deletions, numbered }
  }
  if (change.whole !== null) return [part('whole', null, change.whole, true)]
  return change.hunks.filter((hunk) => hunk.oldText !== hunk.newText).map((hunk, index) => part(`hunk${index}`, hunk.oldText, hunk.newText, false))
}

/**
 * A file the agent changed (021 A1, A2): the review's own diff, with syntax colors, added and removed lines tinted
 * and the words that changed marked. Edits to one file in a row are one change that updates in place.
 */
function ChangeBlock({ change }: { change: Change }) {
  const [open, setOpen] = useState(false)
  const parts = useMemo(() => partsOf(change), [change])
  const additions = parts.reduce((sum, part) => sum + part.additions, 0)
  const deletions = parts.reduce((sum, part) => sum + part.deletions, 0)
  const tall = parts.some((part) => part.height > DIFF_CLOSED)
  const verb = change.whole !== null ? 'Wrote' : 'Edited'
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FoldRow icon={FilePenLine} open={open} onToggle={tall ? () => setOpen(!open) : undefined} failed={change.state === 'failed'}>
        <span className="shrink-0 font-medium">{change.state === 'running' ? (change.whole !== null ? 'Writing' : 'Editing') : change.state === 'failed' ? 'Could not change' : verb}</span>
        <code className="truncate font-mono text-[12px]">{change.path}</code>
        {additions || deletions ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            <span className="text-ok-fg">+{additions}</span> <span className="text-bad-fg">−{deletions}</span>
          </span>
        ) : null}
        {change.calls > 1 ? <span className="shrink-0 text-[11px] text-muted-foreground">{change.calls} edits</span> : null}
      </FoldRow>
      {parts.map((part) => (
        <div
          key={part.key}
          className="aa-diff overflow-hidden rounded-2xl"
          data-numbers={part.numbered ? undefined : 'none'}
          style={{ height: Math.min(part.height + 8, open ? Number.MAX_SAFE_INTEGER : DIFF_CLOSED), maxHeight: '70vh' }}
        >
          <DiffView file={part.file} className="py-1" />
        </div>
      ))}
      {change.failures.map((failure, index) => (
        <p key={index} className="flex items-start gap-1.5 pl-2.5 text-[12px] text-bad-fg">
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

/** Reads and searches in a row (021 A7): one row that says how many, and opens to the list of what was read. */
function Looks({ looks }: { looks: Look[] }) {
  const [open, setOpen] = useState(false)
  const failed = looks.filter((look) => look.state === 'failed').length
  const latest = looks.at(-1)!
  if (looks.length === 1) {
    return (
      <FoldRow icon={LOOK_ICON[latest.kind]} open={false} failed={failed > 0}>
        <LookLine look={latest} />
      </FoldRow>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <FoldRow icon={LOOK_ICON[latest.kind]} open={open} onToggle={() => setOpen(!open)}>
        <span className="shrink-0 font-medium">{looksSummary(looks)}</span>
        {failed ? <span className="shrink-0 text-[12px] text-bad-fg">{failed === 1 ? '1 failed' : `${failed} failed`}</span> : null}
        {latest.state === 'running' ? <span className="truncate text-[12px] text-muted-foreground">{LOOK_WORDS[latest.kind][0]} {latest.what}</span> : null}
      </FoldRow>
      {open ? (
        <Opened>
          {looks.map((look) => (
            <span key={look.id} className="block px-2.5 py-0.5 text-[13px]">
              <LookLine look={look} />
            </span>
          ))}
        </Opened>
      ) : null}
    </div>
  )
}

/** A tool the canvas has no words of its own for: its name, what it was given, and its output on request. */
function OtherTool({ name, summary, state, output, failure }: { name: string; summary: string; state: CallState; output: string; failure?: string }) {
  const [open, setOpen] = useState(false)
  const shown = tailOf(output, 40)
  return (
    <div className="flex flex-col gap-1">
      <FoldRow icon={Wrench} open={open} onToggle={output.trim() && !failure ? () => setOpen(!open) : undefined} failed={state === 'failed'}>
        <span className="shrink-0 font-medium">{state === 'running' ? 'Using' : 'Used'}</span>
        <code className="shrink-0 font-mono text-[12px]">{name}</code>
        {summary ? <span className="truncate text-[12px] text-muted-foreground">{summary}</span> : null}
        <span className="ml-auto">
          <StateMark state={state} />
        </span>
      </FoldRow>
      {failure ? <p className="pl-8 text-[12px] break-words whitespace-pre-wrap text-bad-fg">{failure}</p> : null}
      {open ? (
        <pre className="scroll-quiet mx-2.5 max-h-[40vh] overflow-auto rounded-2xl bg-code-bg px-3.5 py-2 font-mono text-[12px] leading-[1.6] text-code-text shadow-[inset_0_0_0_1px_var(--hb-border)]">
          {shown.hidden ? `${shown.hidden.toLocaleString('en-US')} lines above\n` : ''}
          {shown.lines.join('\n')}
        </pre>
      ) : null}
    </div>
  )
}
