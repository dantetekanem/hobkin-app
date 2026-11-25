import { Dialog } from '@base-ui/react/dialog'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { GuideButton, GuideRunLine, GuideSources, GuideText } from '@/features/project/RunGuide.tsx'
import { useRunGuide } from '@/features/project/use-project.ts'
import type { FinishedChange } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { useWorkView } from './store.ts'
import { firstStepOf, offersTryIt, type FirstStep } from './try-it.ts'

/**
 * Try it on a finished change (_specs/068-run-guide, "In the window"): a sheet with the change's title, the commands
 * that bring it into the user's own checkout, then its project's run guide and last run. With no guide it says so and
 * offers Write the run guide. It opens from the row's "⋯" and has no key of its own. It stays at the top of the window
 * and grows only downward, so nothing in it moves when the guide arrives or its button changes.
 */

/** Try it in a row's "⋯", for a change of a code project. It exists only while the menu is open. */
export function TryItItem({ change, onTry }: { change: FinishedChange; onTry: () => void }) {
  const { work } = useWorkView()
  if (!offersTryIt(change, work?.projects ?? [])) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onTry} title="How to run its project with this change in, from its run guide.">
        Try it
      </DropdownMenuItem>
    </>
  )
}

/** The keyboard goes back to the change's row once the sheet closes. */
const rowOf = (key: string) => document.querySelector<HTMLElement>(`[data-change="${CSS.escape(key)}"]`)

interface TryItSheetProps {
  open: boolean
  change: FinishedChange
  live: boolean
  onClose: () => void
}

export function TryItSheet({ open, change, live, onClose }: TryItSheetProps) {
  const still = useStill()
  const fade = still
    ? 'transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
    : 'transition-[translate,scale,opacity] duration-[320ms] ease-[var(--ease-drawer)] data-[starting-style]:-translate-y-3 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:duration-[160ms]'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm transition-opacity duration-[240ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          finalFocus={() => rowOf(change.key)}
          className={cn(
            'scroll-quiet fixed top-[8vh] left-1/2 z-50 flex max-h-[84vh] w-[min(760px,calc(100vw-48px))] -translate-x-1/2 flex-col overflow-y-auto rounded-[28px] bg-background shadow-float outline-none',
            fade,
          )}
        >
          <TryIt change={change} live={live} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const STEP_LINE: Record<FirstStep['kind'], (project: string) => string> = {
  branch: (project) => `In your own checkout of ${project}, fetch its branch and switch to it.`,
  pr: (project) => `In your own checkout of ${project}, check out its pull request with GitHub's gh.`,
  none: () => 'This change has no branch or pull request to bring in.',
}

/** What the sheet holds. It reads the guide only while it shows. */
export function TryIt({ change, live }: { change: FinishedChange; live: boolean }) {
  const { read, control } = useRunGuide(live, change.slug, true)
  const step = firstStepOf(change)
  const stepLine = STEP_LINE[step.kind](change.project)
  const text = read.state === 'read' ? read.guide.text : null
  // With a guide the sheet shows it. With none it offers Write the run guide, beside the step's name.
  const offersWrite = read.state !== 'reading' && !text

  return (
    <div className="flex flex-col px-7 pt-6 pb-7">
      <header className="flex items-start gap-4 pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-[18px] text-muted-foreground">Try it · {change.project}</p>
          <Dialog.Title title={change.title} className="mt-1 line-clamp-2 font-heading text-[22px] leading-tight font-semibold tracking-[-0.02em] break-words">
            {change.title}
          </Dialog.Title>
        </div>
        <Dialog.Close render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
          Close <Kbd>esc</Kbd>
        </Dialog.Close>
      </header>

      <Step label="Bring the change in">
        <Dialog.Description className="px-1 text-[13px] leading-snug text-muted-foreground">{stepLine}</Dialog.Description>
        {step.commands.length ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {step.commands.map((command) => (
              <CopyLine key={command} text={command} />
            ))}
          </div>
        ) : null}
      </Step>

      <Step label="Run it with the run guide" aside={offersWrite ? <GuideButton read={read} control={control} /> : null}>
        <div className="flex flex-col gap-1 px-1">
          <GuideRunLine read={read} />
          <GuideSources read={read} />
        </div>
        {text ? (
          <div className="mt-3 border-t border-border/60 px-1 pt-4">
            <GuideText text={text} />
          </div>
        ) : null}
      </Step>
    </div>
  )
}

/** One step of the sheet: its name, quieter than what it holds, with room at its right for the guide's button. */
function Step({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="border-t border-border/60 py-3 first-of-type:border-t-0">
      <div className="mb-1 flex min-h-8 items-center gap-3">
        <h3 className="shrink-0 px-1 text-[13px] leading-snug font-medium text-muted-foreground">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** How long a copy button says it copied. */
const COPIED_MS = 1600

/** A command as it is typed, with a button that copies it, as the sign-in's key setup has. */
function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div className="flex items-center gap-2 rounded-xl bg-code-bg py-1.5 pr-1.5 pl-3 text-code-text">
      <code className="scroll-quiet min-w-0 flex-1 overflow-x-auto font-mono text-[12.5px] leading-[1.7] whitespace-pre">{text}</code>
      <button
        type="button"
        aria-label={copied ? 'Copied' : `Copy ${text}`}
        onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
        className="grid size-7 shrink-0 place-items-center rounded-full outline-offset-1 transition-[transform,background-color] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.97]"
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
    </div>
  )
}
