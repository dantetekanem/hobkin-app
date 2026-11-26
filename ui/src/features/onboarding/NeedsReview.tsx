import { Check, Circle, Copy, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { SETUP_NEED_GROUPS, type SetupFix, type SetupNeed, type SetupNeedGroup } from '#shared/protocol/setup.ts'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { copyText, useCopied } from './copy.ts'

const GROUP_NAMES: Record<SetupNeedGroup, string> = {
  run: 'Needed to run',
  code: 'For code work',
  features: 'Features',
  optional: 'Optional',
}

/** The groups hobkin cannot do without: a need missing there is marked as wrong, and elsewhere only as not there. */
const NEEDED: readonly SetupNeedGroup[] = ['run', 'code']

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A fix the window runs itself, through one of the setup's own install commands. */
type SetupInstall = Exclude<SetupFix, { kind: 'sign-in' } | { kind: 'command' }>

/** Runs one of the setup's own installs. A TLA+ setup that did not go through says why, as a failed install does. */
async function install(fix: SetupInstall): Promise<void> {
  if (fix.kind === 'install-package') {
    await runCommand('setup.install-package', { name: fix.name })
    return
  }

  switch (fix.what) {
    case 'node':
      await runCommand('setup.install-node')
      return
    case 'pi':
      await runCommand('setup.install-pi')
      return
    case 'proof-tools': {
      const { ok, message } = await runCommand('setup.install-proof-tools')
      if (!ok) throw Error(message)
    }
  }
}

/** A command to run in Terminal, cut to the room it has, with a button that copies it whole. */
function CommandToCopy({ command }: { command: string }) {
  const [copied, setCopied] = useCopied()
  return (
    <div className="flex h-7 max-w-[210px] min-w-0 items-center gap-1 rounded-lg bg-code-bg pr-0.5 pl-2 text-code-text" title={command}>
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] select-text">{command}</code>
      <button
        type="button"
        aria-label={copied ? 'Copied' : `Copy ${command}`}
        onClick={() => copyText(command, setCopied)}
        className="grid size-6 shrink-0 place-items-center rounded-md outline-offset-1 transition-[transform,background-color] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.97]"
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
    </div>
  )
}

interface NeedRowProps {
  need: SetupNeed
  /** This row's install is running. */
  fixing: boolean
  /** Another install is running, so this one waits. */
  waiting: boolean
  onFix: (need: SetupNeed) => void
}

function NeedMark({ need }: { need: SetupNeed }) {
  if (need.found) return <Check className="size-4 text-ok-fg" aria-hidden="true" />
  if (NEEDED.includes(need.group)) return <X className="size-4 text-destructive" aria-hidden="true" />
  return <Circle className="size-3 text-border-strong" aria-hidden="true" />
}

/** The fix at the end of a row: a command to copy, or a button for the setup's own install or sign-in. */
function FixControl({ need, fixing, waiting, onFix }: NeedRowProps) {
  const { fix } = need
  if (!fix) return null
  if (fix.kind === 'command') return <CommandToCopy command={fix.command} />

  let label = fixing ? 'Installing' : 'Install'
  if (fix.kind === 'sign-in') label = 'Connect'
  return (
    <Button variant="outline" size="sm" className="min-w-[76px]" disabled={fixing || waiting} onClick={() => onFix(need)}>
      {label}
    </Button>
  )
}

/** One need on two lines that keep their height, found or not, so nothing below moves when it changes. */
function NeedRow(props: NeedRowProps) {
  const { need } = props
  return (
    <li className="flex h-11 items-center gap-3 px-2">
      <span className="grid size-5 shrink-0 place-items-center">
        <NeedMark need={need} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-heading text-[13.5px] font-medium">{need.name}</span>
          {need.version ? <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{need.version}</span> : null}
        </div>
        {/* What is wrong comes first, so a long line never cuts it off. */}
        <div className="truncate text-[12px] text-muted-foreground" title={need.problem ? `${need.problem} · ${need.neededBy}` : need.neededBy}>
          {need.problem ? <span className={cn(NEEDED.includes(need.group) && 'text-destructive')}>{need.problem} · </span> : null}
          {need.neededBy}
        </div>
      </div>
      <span className="sr-only">{need.found ? 'found' : 'missing'}</span>
      <FixControl {...props} />
    </li>
  )
}

interface NeedsReviewProps {
  /** The sign-in's fix: the setup's own sign-in in the story, the app's Connect a model elsewhere. */
  onSignIn: () => void
  /** An install is running. */
  onBusy?: (busy: boolean) => void
  /** Buttons after Look again, such as the one that goes on. */
  children?: ReactNode
  /** How tall the list may grow before it scrolls, where its frame does not set it. */
  listClassName?: string
}

/**
 * Everything hobkin needs on this Mac, read from the host (`setup.needs`): each thing with what needs it, found or
 * missing, its version, and its fix, which is the setup's own install, its sign-in, or a command to copy. Nothing
 * installs but on a press. Look again reads it all again. See _specs/025-onboarding.
 */
export function NeedsReview({ onSignIn, onBusy, children, listClassName }: NeedsReviewProps) {
  const [needs, setNeeds] = useState<SetupNeed[] | null>(null)
  const [reading, setReading] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  // What the last read or install said when it failed. One line at the foot, so nothing above it moves.
  const [trouble, setTrouble] = useState<string | null>(null)

  const read = useCallback(async () => {
    setReading(true)
    try {
      setNeeds((await runCommand('setup.needs')).needs)
    } catch (error) {
      setTrouble(`I could not look: ${reasonOf(error)}`)
    } finally {
      setReading(false)
    }
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  const fix = async (need: SetupNeed) => {
    const how = need.fix
    if (!how || how.kind === 'command') return
    if (how.kind === 'sign-in') return onSignIn()

    setFixing(need.id)
    setTrouble(null)
    onBusy?.(true)
    try {
      await install(how)
    } catch (error) {
      setTrouble(`${need.name}: ${reasonOf(error)}`)
    } finally {
      setFixing(null)
      onBusy?.(false)
    }
    await read()
  }

  const lookAgain = () => {
    setTrouble(null)
    void read()
  }

  return (
    <NeedsView
      needs={needs}
      reading={reading}
      fixing={fixing}
      trouble={trouble}
      onFix={(need) => void fix(need)}
      onLookAgain={lookAgain}
      listClassName={listClassName}
    >
      {children}
    </NeedsView>
  )
}

interface NeedsViewProps extends Pick<NeedsReviewProps, 'children' | 'listClassName'> {
  /** Null until the first read answers. */
  needs: SetupNeed[] | null
  reading: boolean
  /** The need whose install is running. */
  fixing: string | null
  trouble: string | null
  onFix: (need: SetupNeed) => void
  onLookAgain: () => void
}

/** The review as it stands, with nothing of its own to keep. */
export function NeedsView({ needs, reading, fixing, trouble, onFix, onLookAgain, children, listClassName }: NeedsViewProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      {needs ? (
        <div className={cn('scroll-quiet flex min-h-0 flex-col gap-2 overflow-y-auto', listClassName)}>
          {SETUP_NEED_GROUPS.map((group) => {
            const inGroup = needs.filter((need) => need.group === group)
            if (!inGroup.length) return null
            return (
              <section key={group} aria-label={GROUP_NAMES[group]}>
                <h3 className="eyebrow px-2 pb-0.5">{GROUP_NAMES[group]}</h3>
                <ul>
                  {inGroup.map((need) => (
                    <NeedRow
                      key={need.id}
                      need={need}
                      fixing={fixing === need.id}
                      waiting={fixing !== null && fixing !== need.id}
                      onFix={onFix}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <p className="px-2 text-[13px] text-muted-foreground">{reading ? 'Looking at this Mac.' : 'Nothing to show yet.'}</p>
      )}

      <div className="flex items-center gap-2">
        <p role={trouble ? 'alert' : undefined} className="min-w-0 flex-1 truncate px-2 text-[12.5px] text-destructive select-text" title={trouble ?? undefined}>
          {trouble}
        </p>
        <Button variant="outline" size="lg" className="px-3.5" disabled={reading || fixing !== null} onClick={onLookAgain}>
          {reading ? 'Looking' : 'Look again'}
        </Button>
        {children}
      </div>
    </div>
  )
}
