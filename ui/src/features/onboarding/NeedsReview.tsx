import { Check, Circle, Copy, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SETUP_NEED_GROUPS, type ProgramSignIn, type SetupFix, type SetupNeed, type SetupNeedGroup } from '#shared/protocol/setup.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { openAddress } from '@/lib/open-link.ts'
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
type SetupInstall = Extract<SetupFix, { kind: 'install' } | { kind: 'install-package' }>
/** A program's install or sign-in, which keeps a line to copy for when the press fails. */
type ProgramFix = Extract<SetupFix, { kind: 'install-program' } | { kind: 'sign-in-program' }>

const isProgramFix = (fix: SetupFix | null): fix is ProgramFix => fix?.kind === 'install-program' || fix?.kind === 'sign-in-program'

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

/** Words to copy, cut to the room they have, with a button that copies them whole. */
function TextToCopy({ text, className, label }: { text: string; className?: string; label: string }) {
  const [copied, setCopied] = useCopied()
  return (
    <div className={cn('flex h-7 min-w-0 items-center gap-1 rounded-lg bg-code-bg pr-0.5 pl-2 text-code-text', className)} title={text}>
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] select-text">{text}</code>
      <button
        type="button"
        aria-label={copied ? 'Copied' : label}
        onClick={() => copyText(text, setCopied)}
        className="grid size-6 shrink-0 place-items-center rounded-md outline-offset-1 transition-[transform,background-color] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.97]"
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
    </div>
  )
}

/** The code a sign-in page asks for, pasted here and passed to the program with Enter. */
function CodeToPaste({ onPaste }: { onPaste: (code: string) => void }) {
  const [code, setCode] = useState('')
  return (
    <Input
      value={code}
      aria-label="Code from the sign-in page"
      placeholder="Paste code"
      className="h-7 w-[124px] font-mono text-[11.5px] md:text-[11.5px]"
      onChange={(event) => setCode(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !code.trim()) return
        event.preventDefault()
        onPaste(code.trim())
        setCode('')
      }}
    />
  )
}

/** A program's sign-in under way, and the row it belongs to. */
interface SigningIn {
  id: string
  prompt: ProgramSignIn
}

interface NeedRowProps {
  need: SetupNeed
  /** This row's press is running. */
  fixing: boolean
  /** Another press is running, so this one waits. */
  waiting: boolean
  /** This row's press failed, so it offers its line to copy until Look again. */
  failed: boolean
  /** This row's press opened an installer that finishes in its own window (Apple's, for git). */
  opened: boolean
  /** This row's program is signing in. */
  signingIn: ProgramSignIn | null
  onFix: (need: SetupNeed) => void
  onPaste: (code: string) => void
}

function NeedMark({ need }: { need: SetupNeed }) {
  if (need.found) return <Check className="size-4 text-ok-fg" aria-hidden="true" />
  if (NEEDED.includes(need.group)) return <X className="size-4 text-destructive" aria-hidden="true" />
  return <Circle className="size-3 text-border-strong" aria-hidden="true" />
}

/** What the row says under its name: what needs it, then what to do in a sign-in, or what its press installs. */
function aboutLine({ need, opened, signingIn }: Pick<NeedRowProps, 'need' | 'opened' | 'signingIn'>): string {
  if (signingIn?.code) return 'Enter this code on the GitHub page and approve. This row turns green by itself.'
  if (signingIn) return 'Sign in on the page in your browser. If it shows a code, paste it here.'
  if (need.found) return need.neededBy
  if (opened) return "Apple's installer is open. When it finishes, press Look again."
  if (isProgramFix(need.fix)) return `${need.neededBy}. ${need.fix.says}`
  return need.neededBy
}

const PRESS_WORDS: Record<Exclude<SetupFix['kind'], 'command'>, [idle: string, busy: string]> = {
  install: ['Install', 'Installing'],
  'install-package': ['Install', 'Installing'],
  'install-program': ['Install', 'Installing'],
  'sign-in': ['Connect', 'Connect'],
  'sign-in-program': ['Sign in', 'Starting'],
}

/** The fix at the end of a row: what a sign-in under way needs, a line to copy, or a button for the setup's own fix. */
function FixControl({ need, fixing, waiting, failed, signingIn, onFix, onPaste }: NeedRowProps) {
  const { fix } = need
  if (!fix) return null

  if (signingIn) {
    const open = (
      <Button variant="outline" size="sm" onClick={() => openAddress(signingIn.url)}>
        {signingIn.code ? 'Open GitHub' : 'Open page'}
      </Button>
    )
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {signingIn.code ? <TextToCopy text={signingIn.code} label="Copy the code" className="w-[112px]" /> : null}
        {signingIn.pastes ? <CodeToPaste onPaste={onPaste} /> : null}
        {open}
      </div>
    )
  }
  if (fix.kind === 'command') return <TextToCopy text={fix.command} label={`Copy ${fix.command}`} className="max-w-[210px]" />
  if (failed && isProgramFix(fix)) return <TextToCopy text={fix.byHand} label={`Copy ${fix.byHand}`} className="max-w-[210px]" />

  const [idle, busy] = PRESS_WORDS[fix.kind]
  return (
    <Button variant="outline" size="sm" className="min-w-[76px]" disabled={fixing || waiting} onClick={() => onFix(need)}>
      {fixing ? busy : idle}
    </Button>
  )
}

/** One need in a row that keeps its height in every state, so nothing below moves when it changes. */
function NeedRow(props: NeedRowProps) {
  const { need } = props
  const about = aboutLine(props)
  return (
    <li className="flex h-[58px] items-center gap-3 px-2">
      <span className="grid size-5 shrink-0 place-items-center">
        <NeedMark need={need} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          {/* What is wrong gives way first, so the name always shows whole; its tooltip has it all. */}
          <span className="max-w-full shrink-0 truncate font-heading text-[13.5px] font-medium">{need.name}</span>
          {need.version ? <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{need.version}</span> : null}
          {need.problem ? (
            <span className={cn('min-w-0 truncate text-[12px] text-muted-foreground', NEEDED.includes(need.group) && 'text-destructive')} title={need.problem}>
              · {need.problem}
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-[12px] leading-[16px] text-muted-foreground" title={about}>
          {about}
        </p>
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

const withId = (ids: ReadonlySet<string>, id: string) => new Set([...ids, id])

/**
 * Everything hobkin needs on this Mac, read from the host (`setup.needs`): each thing with what needs it, found or
 * missing, its version, and its fix, which is the setup's own install, its sign-in, a program's install or sign-in, or
 * a command to copy. A program's press keeps its line to copy for when it fails. Nothing installs but on a press. Look
 * again reads it all again. See _specs/025-onboarding.
 */
export function NeedsReview({ onSignIn, onBusy, children, listClassName }: NeedsReviewProps) {
  const [needs, setNeeds] = useState<SetupNeed[] | null>(null)
  const [reading, setReading] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  // What the last read or install said when it failed. One line at the foot, so nothing above it moves.
  const [trouble, setTrouble] = useState<string | null>(null)
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [signingIn, setSigningIn] = useState<SigningIn | null>(null)
  // Each sign-in started, so an older one that ends late changes nothing.
  const attempt = useRef(0)

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

  const failedOn = (need: SetupNeed, error: unknown) => {
    setTrouble(`${need.name}: ${reasonOf(error)}`)
    setFailed((ids) => withId(ids, need.id))
  }

  /** Starts the program's sign-in, shows what to do, and reads the Mac again once the program says it ended. */
  const signIn = async (need: SetupNeed, name: ProgramSignIn['name']) => {
    const mine = ++attempt.current
    let prompt: ProgramSignIn
    try {
      prompt = await runCommand('setup.sign-in-program', { name })
    } catch (error) {
      failedOn(need, error)
      return
    } finally {
      setFixing(null)
      onBusy?.(false)
    }
    setSigningIn({ id: need.id, prompt })

    const end = await runCommand('setup.sign-in-program-wait', { name }).catch((error: unknown) => ({ signedIn: false, message: reasonOf(error) }))
    if (mine !== attempt.current) return
    setSigningIn(null)
    if (!end.signedIn && end.message) failedOn(need, Error(end.message))
    await read()
  }

  const fix = async (need: SetupNeed) => {
    const how = need.fix
    if (!how || how.kind === 'command') return
    if (how.kind === 'sign-in') return onSignIn()

    setFixing(need.id)
    setTrouble(null)
    onBusy?.(true)
    if (how.kind === 'sign-in-program') return signIn(need, how.name)
    try {
      if (how.kind === 'install-program') {
        const { finished } = await runCommand('setup.install-program', { name: how.name })
        if (!finished) setOpened((ids) => withId(ids, need.id))
      } else {
        await install(how)
      }
    } catch (error) {
      failedOn(need, error)
    } finally {
      setFixing(null)
      onBusy?.(false)
    }
    await read()
  }

  const paste = (code: string) => {
    const name = signingIn?.prompt.name
    if (!name) return
    setTrouble(null)
    void runCommand('setup.sign-in-program-code', { name, code }).catch((error: unknown) => setTrouble(reasonOf(error)))
  }

  const lookAgain = () => {
    setTrouble(null)
    setFailed(new Set())
    void read()
  }

  return (
    <NeedsView
      needs={needs}
      reading={reading}
      fixing={fixing}
      trouble={trouble}
      failed={failed}
      opened={opened}
      signingIn={signingIn}
      onFix={(need) => void fix(need)}
      onPaste={paste}
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
  /** The need whose press is running. */
  fixing: string | null
  trouble: string | null
  failed?: ReadonlySet<string>
  opened?: ReadonlySet<string>
  signingIn?: SigningIn | null
  onFix: (need: SetupNeed) => void
  onPaste?: (code: string) => void
  onLookAgain: () => void
}

const NONE: ReadonlySet<string> = new Set()

/** The review as it stands, with nothing of its own to keep. */
export function NeedsView({ needs, reading, fixing, trouble, failed = NONE, opened = NONE, signingIn = null, onFix, onPaste = () => {}, onLookAgain, children, listClassName }: NeedsViewProps) {
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
                      failed={failed.has(need.id)}
                      opened={opened.has(need.id)}
                      signingIn={signingIn?.id === need.id && !need.found ? signingIn.prompt : null}
                      onFix={onFix}
                      onPaste={onPaste}
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
