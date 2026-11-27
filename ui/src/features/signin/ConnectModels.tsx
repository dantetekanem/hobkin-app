import { Check, ChevronDown, Copy } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { runCommand, useHost, useModels, type KeyHelp, type ProviderAccess } from '@/lib/host/index.ts'
import { spring, stagger, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { SignInPrompt, SignInProblem, SignInState } from '#shared/protocol/signin.ts'
import { connectSections, reachSince, type ConnectRoute, type Reach } from './connect.ts'

const pieces: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: stagger, delayChildren: staggerDelay } },
}
const piece: Variants = {
  hidden: { opacity: 0, transform: 'translateY(22px) scale(0.98)' },
  shown: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
}
const unfold: Variants = {
  hidden: { opacity: 0, transform: 'translateY(-6px)' },
  shown: { opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.sheet, opacity: tween.enter } },
  gone: { opacity: 0, transition: tween.exit },
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface ConnectModelsProps {
  /** A provider turned connected while this was shown: by a sign-in, a key, or a change made in a terminal. Once for each. */
  onConnected?: (provider: ProviderAccess) => void
  /** Pi can use a model now, and could not when this was shown. A page that needs the state at the start reads `useModels().ready`. */
  onReady?: () => void
  /** The ways in this page holds, all of them when left out. Without sign-ins, a sign-in and its problem are not shown here. */
  routes?: readonly ConnectRoute[]
  className?: string
}

/**
 * Every way to reach a model, as Pi has them: subscriptions to sign in to, API keys with steps that keep the key out
 * of the app, and cloud credentials. Each provider says whether Pi reaches it now. While a sign-in is under way it
 * shows that sign-in instead. "Connect a model" holds it under its title, and any other page can hold it too.
 *
 * The page that holds it walks its controls with `useStops`: each one carries `data-stop`.
 */
export function ConnectModels({ onConnected, onReady, routes, className }: ConnectModelsProps) {
  const signIn = useHost((state) => state.signIn)
  const models = useModels()
  // Null until the host has said, so what was connected before this was shown is never news.
  const told = useHost((state) => state.models)
  // A command the host refused, such as a second sign-in while one is under way.
  const [refused, setRefused] = useState<string | null>(null)
  const run = <Value,>(command: Promise<Value>): Promise<Value | undefined> => {
    setRefused(null)
    return command.catch((error: unknown) => {
      setRefused(reason(error))
      return undefined
    })
  }

  const connectedNow = useEffectEvent((provider: ProviderAccess) => onConnected?.(provider))
  const readyNow = useEffectEvent(() => onReady?.())
  const seen = useRef<Reach | null>(null)
  useEffect(() => {
    if (!told) return
    const news = reachSince(seen.current, told, models.ready)
    seen.current = news.seen
    for (const provider of news.connected) connectedNow(provider)
    if (news.ready) readyNow()
  }, [told, models.ready])

  const signIns = !routes || routes.includes('signIn')
  const problem = signIns && (signIn.status === 'signed-in' || signIn.status === 'signed-out') ? signIn.problem : undefined
  const nameOf = (id: string | undefined) => models.providers.find((provider) => provider.id === id)?.name ?? id ?? ''

  return (
    <motion.div variants={pieces} initial="hidden" animate="shown" className={cn('flex flex-col gap-5', className)}>
      {problem ? <Problem problem={problem} name={nameOf(problem.provider)} /> : null}
      {refused ? (
        <motion.p variants={piece} role="alert" className="text-[13px] text-destructive">
          {refused}
        </motion.p>
      ) : null}

      {signIns && signIn.status === 'signing-in' ? (
        <SigningIn signIn={signIn} onAnswer={(prompt, value) => void run(runCommand('signin.answer', { prompt, value }))} onCancel={() => void run(runCommand('signin.cancel'))} />
      ) : (
        connectSections(models, routes).map((section) => (
          <motion.section key={section.key} variants={piece} aria-label={section.title} className="flex flex-col gap-1">
            <h2 className="eyebrow px-1 pb-1">{section.title}</h2>
            <ul className="flex flex-col gap-1">
              {section.providers.map((provider) => (
                <ProviderRow key={provider.id} provider={provider} route={section.key} run={run} />
              ))}
            </ul>
          </motion.section>
        ))
      )}
    </motion.div>
  )
}

type Run = <Value>(command: Promise<Value>) => Promise<Value | undefined>

function Problem({ problem, name }: { problem: SignInProblem; name: string }) {
  return (
    <motion.div variants={piece} role="alert" className="rounded-2xl bg-surface-2 px-4 py-3 text-[14px] leading-relaxed">
      {name ? <span className="font-heading font-medium">{name}: </span> : null}
      {problem.message}
    </motion.div>
  )
}

function Connected({ on }: { on: boolean }) {
  return on ? (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-ok/15 px-2.5 py-1 font-heading text-[12px] font-medium text-ok-fg">
      <Check className="size-3.5" aria-hidden="true" />
      Connected
    </span>
  ) : (
    <span className="shrink-0 px-1 font-heading text-[12px] text-muted-foreground">Not connected</span>
  )
}

function ProviderRow({ provider, route, run }: { provider: ProviderAccess; route: ConnectRoute; run: Run }) {
  const [open, setOpen] = useState(false)
  const detail = route === 'signIn' ? provider.signIn?.label : route === 'apiKey' ? provider.apiKey?.env[0] : provider.cloud?.label

  return (
    <li className="rounded-2xl transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2/60">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-heading text-[15px] font-medium">{provider.name}</div>
          {detail ? <div className={cn('truncate text-[13px] text-muted-foreground', route === 'apiKey' && 'font-mono text-[12px]')}>{detail}</div> : null}
        </div>
        {route === 'signIn' ? (
          provider.connected ? (
            <Connected on />
          ) : (
            <Button data-stop size="lg" onClick={() => void run(runCommand('signin.start', { provider: provider.id }))}>
              Sign in
            </Button>
          )
        ) : (
          <>
            <Connected on={provider.connected} />
            <Button data-stop variant="ghost" aria-expanded={open} onClick={() => setOpen((now) => !now)}>
              How
              <ChevronDown className={cn('size-3.5 transition-transform duration-[220ms] ease-out', open && 'rotate-180')} aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="setup" variants={unfold} initial="hidden" animate="shown" exit="gone" className="px-3 pb-3">
            <KeySetup provider={provider} run={run} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  )
}

/** A command to copy, shown as it will run. */
function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div className="flex items-center gap-2 rounded-xl bg-code-bg py-1.5 pr-1.5 pl-3 text-code-text">
      <code className="scroll-quiet min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-[1.7] whitespace-pre">{text}</code>
      <button
        type="button"
        data-stop
        aria-label={copied ? 'Copied' : 'Copy'}
        onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
        className="grid size-7 shrink-0 place-items-center rounded-full outline-offset-1 transition-[transform,background-color] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.97]"
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
    </div>
  )
}

/** How to give Pi this provider's key, or which cloud credentials it reads. The key itself never passes through here. */
function KeySetup({ provider, run }: { provider: ProviderAccess; run: Run }) {
  const [help, setHelp] = useState<KeyHelp | null>(null)
  useEffect(() => {
    let current = true
    void run(runCommand('models.key-help', { provider: provider.id })).then((answer) => current && answer && setHelp(answer))
    return () => {
      current = false
    }
    // Asked once for each provider row that opens.
  }, [provider.id])

  if (!help) return <p className="px-1 text-[13px] text-muted-foreground">Asking Pi.</p>
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 text-[13px] leading-relaxed">
      {help.env ? (
        <div className="flex flex-col gap-2">
          <p>
            Pi reads the key from <code className="rounded-md bg-surface px-1 font-mono text-[12px]">{help.env}</code>. Set it in your shell profile:
          </p>
          <CopyLine text={`export ${help.env}=your-key`} />
          <p className="text-muted-foreground">The app sees it when it starts from a shell that has it. The Keychain below works however the app starts.</p>
        </div>
      ) : null}
      {help.keychain ? <KeychainSteps provider={help.provider} keychain={help.keychain} name={provider.name} run={run} /> : null}
      {help.note ? <p className="text-muted-foreground">{help.note}</p> : null}
    </div>
  )
}

interface KeychainStepsProps {
  provider: string
  keychain: NonNullable<KeyHelp['keychain']>
  name: string
  run: Run
}

function KeychainSteps({ provider, keychain, name, run }: KeychainStepsProps) {
  const [step, setStep] = useState<'ready' | 'asking' | 'adding' | 'done' | 'unread'>('ready')
  const add = async () => {
    setStep('adding')
    const result = await run(runCommand('models.keychain', { provider }))
    setStep(result ? (result.connected ? 'done' : 'unread') : 'ready')
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-heading font-medium">Or keep it in the macOS Keychain</p>
      <p>1. Run this in Terminal. It asks for the key there, so the key never passes through this app.</p>
      <CopyLine text={keychain.store} />
      <p>2. Add one line for {name} to Pi's auth.json. Pi runs it when it needs the key:</p>
      <code className="block overflow-x-auto rounded-xl bg-surface px-3 py-1.5 font-mono text-[12px] whitespace-pre">{keychain.line}</code>
      {step === 'done' ? (
        <p className="text-ok-fg">Pi reads the {name} key from the Keychain now.</p>
      ) : step === 'unread' ? (
        <p>The line is in. Pi could not read the key yet: store it with the Terminal command, then restart the app.</p>
      ) : step === 'asking' || step === 'adding' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pr-1">This adds that one line to Pi's auth.json and changes nothing else there.</span>
          <Button data-stop disabled={step === 'adding'} onClick={() => void add()}>
            Add it
          </Button>
          <Button data-stop variant="ghost" disabled={step === 'adding'} onClick={() => setStep('ready')}>
            Not now
          </Button>
        </div>
      ) : (
        <div>
          <Button data-stop variant="secondary" onClick={() => setStep('asking')}>
            Add the line to Pi
          </Button>
        </div>
      )}
    </div>
  )
}

interface SigningInProps {
  signIn: Extract<SignInState, { status: 'signing-in' }>
  onAnswer: (prompt: string, value: string) => void
  onCancel: () => void
}

/** A sign-in under way: what Pi says, the way back to its page, and what it asks. Any page that starts a sign-in can show it. */
export function SigningIn({ signIn, onAnswer, onCancel }: SigningInProps) {
  const { authUrl, instructions, prompt, lines } = signIn
  return (
    <motion.div variants={piece} className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-5">
      <p className="text-[15px] leading-relaxed">{instructions ?? 'The sign-in page opened in your browser. This screen moves on by itself once you approve there.'}</p>
      {authUrl ? (
        <a
          href={authUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-stop
          className="self-start rounded-full text-[14px] underline decoration-border-strong underline-offset-2 transition-colors duration-[160ms] ease-[ease] hover:decoration-foreground"
        >
          Open the sign-in page again
        </a>
      ) : null}
      {prompt ? <PromptField key={prompt.id} prompt={prompt} onAnswer={(value) => onAnswer(prompt.id, value)} /> : null}
      {lines.length ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {lines.at(-1)}
        </p>
      ) : null}
      <div>
        <Button data-stop variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </motion.div>
  )
}

/** What Pi asks during a sign-in, such as the address to paste when the browser could not reach the app. Never a secret. */
function PromptField({ prompt, onAnswer }: { prompt: SignInPrompt; onAnswer: (value: string) => void }) {
  // The list can be on screen twice, as in the first-run setup over the canvas, so the field's id is its own.
  const field = useId()
  const [value, setValue] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim()) onAnswer(value.trim())
  }

  if (prompt.kind === 'select') {
    return (
      <div className="flex w-full flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">{prompt.message}</p>
        {(prompt.options ?? []).map((option) => (
          <Button key={option.id} data-stop variant="outline" className="h-auto w-full justify-start py-2 text-left whitespace-normal" onClick={() => onAnswer(option.id)}>
            {option.label}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <label htmlFor={field} className="text-[13px] leading-snug text-muted-foreground">
        {prompt.message}
      </label>
      <div className="flex gap-2">
        <Input
          data-stop
          id={field}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={prompt.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="h-9 min-w-0 flex-1"
        />
        <Button data-stop type="submit" variant="secondary" size="lg" disabled={!value.trim()}>
          Finish
        </Button>
      </div>
    </form>
  )
}
