import { CalendarClock, FileText, KeyRound, type LucideIcon } from 'lucide-react'
import { motion, useIsPresent, type Variants } from 'motion/react'
import { createContext, useContext, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { Preset } from '#shared/tiers/presets.ts'
import { EFFORTS, TIER_IDS, TIER_INFO, resolveTier, type Effort, type ModelChoice, type TierId, type TiersConfig } from '#shared/tiers/tiers.ts'
import { originOf, setThemeChoice, useThemeChoice, type ThemeChoice } from '@/app/theme.ts'
import { AgentHood } from '@/components/Mark.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useSettings, type Movement } from '@/features/settings/store.ts'
import { ConnectScreen } from '@/features/signin/SignInScreen.tsx'
import { useTiers } from '@/features/tiers/store.ts'
import type { ProviderAccess } from '@/lib/host/index.ts'
import { spring, stagger, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { Step } from './flow.ts'
import { useProposal } from './proposal.ts'
import { useSetup, type MainOutcome } from './store.ts'
import { STEP_TITLES, THINKING_WORDS } from './words.ts'

/**
 * Which way the steps are travelling, whether the setup is handing over to the app, and whether movement is still.
 * Direction 0 is the first step, as the setup opens.
 */
export interface Travel {
  direction: -1 | 0 | 1
  leaving: boolean
  /**
   * Movement is still: nothing travels, things only fade. Said here rather than left to MotionConfig, which does not
   * reduce a whole `transform` string, only Motion's own x, y and scale.
   */
  still: boolean
}

const HOME = 'translateX(0%) scale(1)'

/**
 * A step crosses the whole window and settles on a spring, sideways in the direction of travel. The one leaving falls
 * back and fades. Its pieces land one after another once it has arrived.
 */
const crossing: Variants = {
  enter: ({ direction, still }: Travel) => ({ opacity: 0, transform: still ? HOME : `translateX(${direction * 100}%) scale(0.94)` }),
  center: {
    opacity: 1,
    transform: HOME,
    transition: { transform: spring.screen, opacity: tween.enter, staggerChildren: stagger, delayChildren: staggerDelay },
  },
  exit: ({ direction, leaving, still }: Travel) =>
    still
      ? { opacity: 0, transform: HOME, transition: tween.fade }
      : leaving
        ? { opacity: 0, transform: 'translateX(0%) scale(0.96)', transition: tween.exit }
        : {
            opacity: 0,
            transform: `translateX(${-direction * 46}%) scale(0.9)`,
            transition: { transform: spring.screenExit, opacity: { duration: 0.28, ease: 'linear' } },
          },
}

const LANDED = 'translateY(0px) scale(1)'

/** A piece of a step, rising into place after the step arrives. The same values as the frame's Rise. */
const rise: Variants = {
  enter: (still: boolean) => ({ opacity: 0, transform: still ? LANDED : 'translateY(26px) scale(0.98)' }),
  center: { opacity: 1, transform: LANDED, transition: { transform: spring.rise, opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

/** The first, largest piece: it pops up from below with more spring than the rest. The same values as the frame's Hero. */
const hero: Variants = {
  enter: (still: boolean) => ({ opacity: 0, transform: still ? LANDED : 'translateY(64px) scale(0.6)' }),
  center: { opacity: 1, transform: LANDED, transition: { transform: { type: 'spring', duration: 0.7, bounce: 0.34 }, opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

const Still = createContext(false)

function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={rise} custom={useContext(Still)} className={className}>
      {children}
    </motion.div>
  )
}

function Hero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={hero} custom={useContext(Still)} className={className}>
      {children}
    </motion.div>
  )
}

/** A step's way on and way back. The button that goes on is the step's own, so it lands with the step. */
export interface StepActions {
  label: string
  onNext: () => void
  /** Null on the first step, which has nothing behind it. */
  onBack: (() => void) | null
}

interface StepViewProps {
  step: Step
  /** Where the words start, below the character, on the steps that center it. */
  top: number
  /** Given here for the arrival, and to AnimatePresence for the exit, which reads it after the step has gone. */
  travel: Travel
  actions: StepActions
}

export function StepView({ step, top, travel, actions }: StepViewProps) {
  // The step that is leaving takes no keyboard and no pointer.
  const present = useIsPresent()

  return (
    <motion.section
      custom={travel}
      variants={crossing}
      initial="enter"
      animate="center"
      exit="exit"
      inert={!present}
      aria-label={STEP_TITLES[step]}
      className="absolute inset-0"
    >
      <Still value={travel.still}>
        <StepBody step={step} top={top} actions={actions} />
      </Still>
    </motion.section>
  )
}

function StepBody({ step, top, actions }: { step: Step; top: number; actions: StepActions }) {
  switch (step) {
    case 'welcome':
      return <Welcome top={top} actions={actions} />
    case 'about':
      return <About top={top} actions={actions} />
    case 'connect':
      return <Connect actions={actions} />
    case 'settings':
      return <FirstSettings actions={actions} />
    case 'ready':
      return <Ready top={top} actions={actions} />
  }
}

/**
 * Back and the step's own button. Under the words on the steps that center them, and in a bar along the bottom on
 * the two that fill the window. The button that goes on takes the keyboard as the step arrives.
 */
function Actions({ label, onNext, onBack, bar = false }: StepActions & { bar?: boolean }) {
  const next = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    next.current?.focus({ preventScroll: true })
  }, [])

  const buttons = (
    <>
      {onBack ? (
        <Button variant="secondary" size="lg" className="px-3.5" onClick={onBack}>
          Back
          <Kbd>esc</Kbd>
        </Button>
      ) : null}
      <Button
        ref={next}
        size="lg"
        data-stop=""
        data-primary=""
        className={cn('min-w-[132px] px-4 text-[14px]', bar && 'ml-auto')}
        onClick={onNext}
      >
        {label}
        <Kbd className="bg-foreground/10 text-primary-foreground">↵</Kbd>
      </Button>
    </>
  )

  return bar ? (
    <div className="absolute inset-x-0 bottom-[5vh] flex justify-center">
      <div className="flex w-[min(640px,calc(100vw-48px))] items-center gap-3">{buttons}</div>
    </div>
  ) : (
    <Rise className="mt-9 flex items-center justify-center gap-3">{buttons}</Rise>
  )
}

const centered = 'mx-auto flex w-[min(720px,calc(100vw-48px))] flex-col items-center text-center'

/**
 * The box a step that fills the window scrolls in: below the dots, and above the hills, which sink 12vh on these
 * steps so their crests stay under 87vh (Scene.tsx). Its edges fade, so a long list ends softly instead of on a line.
 */
const FILLED =
  'absolute inset-x-0 top-14 bottom-[16vh] [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-40px),transparent)]'

function Welcome({ top, actions }: { top: number; actions: StepActions }) {
  return (
    <div className={centered} style={{ paddingTop: top }}>
      <Hero>
        <h1 className="wordmark text-[60px] text-foreground">Hello, I'm hobkin.</h1>
      </Hero>
      <Rise>
        <p className="mt-4 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
          I work for you on this Mac. Let's get a few things ready. It takes a minute.
        </p>
      </Rise>
      <Actions {...actions} />
    </div>
  )
}

const DOES: { title: string; line: string; icon?: LucideIcon }[] = [
  { title: 'Your subscriptions', line: 'ChatGPT, Claude and more, through Pi', icon: KeyRound },
  { title: 'Routines', line: 'Checks that run on their own', icon: CalendarClock },
  { title: 'Agents', line: 'Bigger work, handed off' },
  { title: 'Reports', line: 'What happened, when it matters', icon: FileText },
]

function About({ top, actions }: { top: number; actions: StepActions }) {
  return (
    <div className={centered} style={{ paddingTop: top }}>
      <Rise>
        <h2 className="font-heading text-[34px] leading-tight font-semibold tracking-[-0.03em]">What I do</h2>
      </Rise>
      <Rise>
        <p className="mt-3 max-w-[50ch] text-[16px] leading-relaxed text-muted-foreground">
          I work for you through the model subscriptions you already have. I run your routines, hand bigger work to agents, and report back.
        </p>
      </Rise>
      <div className="mt-8 grid w-full grid-cols-4 gap-3">
        {DOES.map(({ title, line, icon: Icon }) => (
          <Rise key={title}>
            <div className="flex h-full flex-col items-center gap-2.5 rounded-3xl bg-surface px-4 pt-5 pb-4 shadow-panel">
              <span className="grid h-10 place-items-center">
                {Icon ? (
                  <span className="grid size-10 place-items-center rounded-full bg-tone-1">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="flex items-end gap-0.5" aria-hidden="true">
                    {[262, 200, 86].map((hue) => (
                      <AgentHood key={hue} hue={hue} size={26} working />
                    ))}
                  </span>
                )}
              </span>
              <span className="font-heading text-[15px] font-semibold">{title}</span>
              <span className="text-[13px] leading-snug text-muted-foreground">{line}</span>
            </div>
          </Rise>
        ))}
      </div>
      <Actions {...actions} />
    </div>
  )
}

/**
 * "Connect a model", the chat lane's own screen (004-signin): subscriptions first, each provider marked connected or
 * not, Pi's sign-in, and what to set for a key. Its face is hidden, since the setup's character is on screen.
 */
function Connect({ actions }: { actions: StepActions }) {
  return (
    <>
      <div className={FILLED}>
        <ConnectScreen face={false} />
      </div>
      <Actions {...actions} bar />
    </>
  )
}

type Target = TierId | 'lead'
const TARGETS: readonly Target[] = ['lead', ...TIER_IDS]
const LEAD = { label: 'hobkin', meantFor: 'Talks with you and hands the work out' }

const THEMES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Follow the Mac' },
]

const MOVEMENTS: readonly { value: Movement; label: string }[] = [
  { value: 'lively', label: 'Lively' },
  { value: 'system', label: 'Follow the Mac' },
  { value: 'still', label: 'Still' },
]

const MOVEMENT_SAYS: Record<Movement, string> = {
  lively: 'Everything moves, even when the Mac asks for less.',
  system: 'Moves unless the Mac asks for less.',
  still: 'Screens fade, and nothing travels.',
}

/** hobkin's model and the four tiers, proposed from the chosen provider, then theme and movement. Enter accepts it all. */
function FirstSettings({ actions }: { actions: StepActions }) {
  const { providers, provider, preset, config, choices } = useProposal()
  const chooseProvider = useSetup((state) => state.chooseProvider)
  const setDraft = useSetup((state) => state.setDraft)
  const themeChoice = useThemeChoice()
  const movement = useSettings((state) => state.movement)
  const setMovement = useSettings((state) => state.setMovement)
  const modelsOpen = useTiers((state) => state.open)
  // The row the keyboard or the pointer was in last, so the Models window opens on that tier.
  const lastRow = useRef<Target>('lead')

  // The Models window changes the proposal itself. What it holds when it closes is the proposal from then on.
  const wasOpen = useRef(modelsOpen)
  useEffect(() => {
    const closed = wasOpen.current && !modelsOpen
    wasOpen.current = modelsOpen
    if (closed && provider) {
      setDraft({ provider: provider.id, config: useTiers.getState().config })
    }
  }, [modelsOpen, provider, setDraft])

  const update = (next: TiersConfig) => {
    if (provider) setDraft({ provider: provider.id, config: next })
  }
  const openModels = () => {
    if (!config) return
    // The window opens on the proposal, not on what was saved before.
    useTiers.getState().applyTiers(config)
    useTiers.getState().openTiers(lastRow.current)
  }
  const providerOptions = providers.map(({ id, name }) => ({ value: id, label: name }))

  return (
    <>
      <div className={cn(FILLED, 'scroll-quiet overflow-y-auto overscroll-contain')}>
        <div className="mx-auto flex w-[min(700px,calc(100vw-48px))] flex-col gap-3 pt-6 pb-6">
          <Rise>
            <h2 className="font-heading text-[28px] leading-tight font-semibold tracking-[-0.03em]">
              {provider ? `Good defaults for ${provider.name}` : 'First settings'}
            </h2>
          </Rise>
          <Rise>
            <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted-foreground">{proposalInWords(provider, preset)}</p>
          </Rise>

          {providers.length > 1 && provider ? (
            <Rise>
              <div className="flex items-center gap-3">
                <span className="eyebrow">Defaults from</span>
                <Choice label="Defaults from" value={provider.id} options={providerOptions} onChoose={(id) => chooseProvider(id)} />
              </div>
            </Rise>
          ) : null}

          {config ? (
            <Rise>
              <div className="rounded-3xl bg-surface p-2 shadow-panel">
                {TARGETS.map((target) => (
                  <TierRow
                    key={target}
                    target={target}
                    config={config}
                    choices={choices}
                    onChange={update}
                    onReach={() => {
                      lastRow.current = target
                    }}
                  />
                ))}
                <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-1.5">
                  <p className="text-[12px] text-muted-foreground">Left and right change how hard a tier thinks. Any model Pi can use fits any tier.</p>
                  <Button variant="outline" className="shrink-0" data-stop="" onClick={openModels}>
                    Change models
                  </Button>
                </div>
              </div>
            </Rise>
          ) : null}

          <Rise>
            <div className="rounded-3xl bg-surface p-2 shadow-panel">
              <SettingRow label="Theme" says="Light, dark, or whatever the Mac is set to.">
                <Choice label="Theme" value={themeChoice} options={THEMES} onChoose={(value, element) => setThemeChoice(value, originOf(element))} />
              </SettingRow>
              <SettingRow label="Movement" says={MOVEMENT_SAYS[movement]}>
                <Choice label="Movement" value={movement} options={MOVEMENTS} onChoose={(value) => setMovement(value)} />
              </SettingRow>
            </div>
          </Rise>
        </div>
      </div>
      <Actions {...actions} bar />
    </>
  )
}

/** The proposal in one plain sentence: where it comes from in Pi, or why there is none yet. */
function proposalInWords(provider: ProviderAccess | null, preset: Preset | null): string {
  if (!provider || !preset) {
    return 'No model is connected yet. Connect one on the step before, and its models are proposed here. Theme and movement work now.'
  }
  if (preset.source === 'pi') {
    return `Pi starts ${provider.name} on ${preset.model.name}. hobkin talks on it, and every tier runs on it too, thinking harder as the work gets harder.`
  }
  return `Pi has no default for ${provider.name} that it can use now, so this starts on ${preset.model.name}, the first one it lists.`
}

interface TierRowProps {
  target: Target
  config: TiersConfig
  choices: readonly ModelChoice[]
  onChange: (config: TiersConfig) => void
  onReach: () => void
}

function TierRow({ target, config, choices, onChange, onReach }: TierRowProps) {
  const info = target === 'lead' ? LEAD : TIER_INFO[target]
  const setting = target === 'lead' ? { ...config.lead, followsLead: false } : resolveTier(config, target)
  const model = choices.find(({ id }) => id === setting.model)
  const levels = EFFORTS.filter((effort) => model?.efforts.includes(effort)).map((effort) => ({ value: effort, label: effort }))
  const choose = (effort: Effort) => {
    const next = { model: setting.model, effort }
    if (target === 'lead') onChange({ ...config, lead: next })
    else onChange({ ...config, tiers: { ...config.tiers, [target]: next } })
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl px-3 py-2" onFocus={onReach} onPointerEnter={onReach}>
      <div className="w-[150px] shrink-0">
        <div className="font-heading text-[15px] leading-tight font-semibold">{info.label}</div>
        <div className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{info.meantFor}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{model?.name ?? setting.model}</div>
        <div className="text-[12px] leading-snug text-muted-foreground">{setting.followsLead ? 'Follows hobkin' : THINKING_WORDS[setting.effort]}</div>
      </div>
      {levels.length > 1 ? <Choice label={`Thinking for ${info.label}`} value={setting.effort} options={levels} onChoose={choose} accent compact /> : null}
    </div>
  )
}

function SettingRow({ label, says, children }: { label: string; says: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="font-heading text-[15px] leading-tight font-semibold">{label}</div>
        <div className="text-[12px] leading-snug text-muted-foreground">{says}</div>
      </div>
      {children}
    </div>
  )
}

interface ChoiceProps<Value extends string> {
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  onChoose: (value: Value, element: HTMLElement) => void
  /** The chosen one in the yellow, for the thinking levels. */
  accent?: boolean
  compact?: boolean
}

const SIDEWAYS: Partial<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowLeft: -1 }

/** A row of choices. Left and Right move along it and stop at its ends. Up and Down are the setup's, between controls. */
function Choice<Value extends string>({ label, value, options, onChoose, accent = false, compact = false }: ChoiceProps<Value>) {
  const id = useId()

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = SIDEWAYS[event.key]
    if (!delta || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()

    const at = options.findIndex((option) => option.value === value)
    const next = options[Math.min(options.length - 1, Math.max(0, at + delta))]
    if (!next || next.value === value) return

    const button = event.currentTarget.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)
    if (!button) return
    button.focus()
    onChoose(next.value, button)
  }

  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit shrink-0 rounded-full bg-tone-1 p-0.5" onKeyDown={onKeyDown}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            // The chosen one is this row's stop when Up and Down walk the step.
            data-stop={selected ? '' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={(event) => onChoose(option.value, event.currentTarget)}
            className={cn(
              'relative rounded-full font-heading font-medium whitespace-nowrap outline-offset-0 transition-colors duration-[160ms] ease-[ease]',
              compact ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-3.5 text-[13px]',
              selected ? (accent ? 'text-primary-foreground' : 'text-foreground') : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`setup-choice-${id}`}
                className={cn('absolute inset-0 rounded-full', accent ? 'bg-primary' : 'bg-surface-2')}
                transition={spring.pill}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Ready({ top, actions }: { top: number; actions: StepActions }) {
  const main = useSetup((state) => state.main)

  return (
    <div className={centered} style={{ paddingTop: top }}>
      <Hero>
        <h2 className="wordmark text-[60px] text-foreground">All set.</h2>
      </Hero>
      <Rise>
        <p className="mt-4 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">I'll be by the message box. Say hello whenever you like.</p>
      </Rise>
      <p role="status" className={cn('mt-3 min-h-[1.5em] max-w-[56ch] text-[13px] leading-snug', main?.state === 'refused' ? 'text-warn-fg' : 'text-muted-foreground')}>
        {mainInWords(main)}
      </p>
      <Actions {...actions} />
    </div>
  )
}

/** How saving hobkin's own model went, once the first settings were accepted. Nothing while it saves or before. */
function mainInWords(main: MainOutcome | null): string | null {
  if (main?.state === 'saved') return `I talk on ${main.name} now.`
  if (main?.state === 'refused') return `I kept the model I had: ${main.reason}`
  return null
}
