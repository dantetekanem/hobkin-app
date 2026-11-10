import { AnimatePresence, MotionConfig, motion, useAnimate, useReducedMotion, type Transition } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { focusInput } from '@/app/keys.ts'
import { Hob, useHobReactions, type HobReactions } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useSettings, type Movement } from '@/features/settings/store.ts'
import { useTiers } from '@/features/tiers/store.ts'
import type { TierSetting } from '#shared/tiers/tiers.ts'
import { runCommand, selectMainModel, useHost, useModels } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { STEPS, type Step } from './flow.ts'
import { resolveSetupKey, type SetupKey, type SetupKeyContext } from './keys.ts'
import { useProposal } from './proposal.ts'
import { Scene } from './Scene.tsx'
import { StepView, type StepActions, type Travel } from './steps.tsx'
import { useSetup } from './store.ts'
import { STEP_MOODS, STEP_TITLES } from './words.ts'

/**
 * The first-run setup, over the whole window: a hello, what hobkin does, connecting a model, the first settings, and
 * a hand-off to the app in which the character flies to its place by the message input. See _specs/025-onboarding.
 *
 * Mount it once, inside the frame. It shows itself on the first run, with `?setup=1`, and after "Run setup again".
 * While it is open the frame behind it takes no keyboard and no pointer.
 */
export function FirstRunSetup() {
  const open = useSetup((state) => state.open)
  const run = useSetup((state) => state.run)
  return open ? createPortal(<SetupLayer key={run} />, document.body) : null
}

/** The character is drawn this big and scaled down where it sits smaller, so it stays sharp. */
const FACE = 176
/** Where the hood ends below the middle of its square, as a share of the square: the art spans 22 to 188 of -28 to 228. */
const HOOD_FOOT = 0.344

interface Seat {
  /** The middle of the character, in the window. */
  x: number
  y: number
  scale: number
}

interface Viewport {
  width: number
  height: number
}

/** Where the character sits on a step, and where the step's words start below it on the steps that center it. */
function placeOf(step: Step, { width, height }: Viewport): { seat: Seat; top: number } {
  /** Centered above the words, which start a gap below the foot of the hood. */
  const centered = (y: number, scale: number, gap: number) => ({
    seat: { x: width / 2, y, scale },
    top: y + FACE * scale * HOOD_FOOT + gap,
  })

  switch (step) {
    case 'welcome':
    case 'ready':
      return centered(Math.max(150, height * 0.27), 1, 30)
    case 'about':
      return centered(Math.max(110, height * 0.17), 0.62, 26)
    case 'connect':
    case 'settings': {
      // Beside the column, at the height of its title, as the face sits beside the message input.
      const column = Math.min(step === 'connect' ? 576 : 700, width - 48)
      return {
        seat: { x: Math.max(52, (width - column) / 2 - 56), y: 128, scale: 0.42 },
        top: 0,
      }
    }
  }
}

/** The face by the message input, which the character flies to at the end. The chat marks it with `data-hob-home`. */
function homeOfFace(): Seat | null {
  const box = document.querySelector('[data-hob-home]')?.getBoundingClientRect()
  if (!box || box.width === 0) return null

  return {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
    scale: box.width / FACE,
  }
}

function useViewport(): Viewport {
  const [size, setSize] = useState<Viewport>(() => ({ width: innerWidth, height: innerHeight }))
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      setSize({ width: innerWidth, height: innerHeight })
    }
    const onResize = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    addEventListener('resize', onResize)
    return () => {
      removeEventListener('resize', onResize)
      cancelAnimationFrame(frame)
    }
  }, [])
  return size
}

/** What the control that has the keyboard does with keys itself. */
function contextOf(target: Element, signingIn: boolean): SetupKeyContext {
  return {
    typing: target.matches('input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"]), textarea, [contenteditable="true"]'),
    // A choice's option is a button too, but Enter means nothing to it: there it goes on.
    pressable: target.matches('button:not([role="radio"]), a[href], [role="button"]'),
    sideways: target.closest('[role="radiogroup"], [role="slider"], [role="spinbutton"], [role="tablist"]') !== null,
    walks: target.matches('textarea') || target.closest('[role="listbox"], [role="menu"]') !== null,
    signingIn,
  }
}

const PRIMARY: Record<Step, string> = {
  welcome: 'Begin',
  about: 'Continue',
  connect: 'Continue',
  settings: 'Use these',
  ready: 'Start',
}

/** The Movement setting, as Motion's own rule for the things it does reduce. */
const REDUCED_MOTION: Record<Movement, 'always' | 'never' | 'user'> = {
  still: 'always',
  lively: 'never',
  system: 'user',
}

/** The character's face: the step's own, unless it is leaving, waiting on a sign-in, or cheering a new connection. */
function moodOf(step: Step, { leaving, signingIn, cheering }: { leaving: boolean; signingIn: boolean; cheering: boolean }): Mood {
  if (leaving) return 'happy'
  if (step === 'connect' && signingIn) return 'searching'
  if (cheering) return 'happy'
  return STEP_MOODS[step]
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function SetupLayer() {
  const flow = useSetup((state) => state.flow)
  const origin = useSetup((state) => state.origin)
  const go = useSetup((state) => state.go)
  const close = useSetup((state) => state.close)
  const chooseProvider = useSetup((state) => state.chooseProvider)
  const setMain = useSetup((state) => state.setMain)
  const movement = useSettings((state) => state.movement)
  const macCalm = useReducedMotion() ?? false
  const still = movement === 'still' || (movement === 'system' && macCalm)
  const viewport = useViewport()
  const proposal = useProposal()
  const signingIn = useHost((state) => state.signIn.status === 'signing-in')
  const root = useRef<HTMLDivElement | null>(null)
  const region = useRef<HTMLDivElement | null>(null)

  const { step, direction, ended } = flow
  const leaving = ended !== null
  const at = STEPS.indexOf(step)
  const place = placeOf(step, viewport)
  // The first step arrives where it stands. Every step after it travels.
  const [moved, setMoved] = useState(false)
  const travel: Travel = { direction: moved ? direction : 0, leaving, still }

  // The frame stays behind the setup, out of reach, until the setup hands over. Then the keyboard goes home.
  useLayoutEffect(() => {
    const frame = document.getElementById('root')
    frame?.setAttribute('inert', '')
    // The step's own button takes the keyboard as it lands. Until then the setup holds it.
    if (!root.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true })
    return () => {
      frame?.removeAttribute('inert')
      requestAnimationFrame(() => focusInput())
    }
  }, [])
  useKeyboardKept(root)

  // A provider that connects during the setup is the one the first settings come from, and the character cheers.
  const cheering = useCheerOnConnect(chooseProvider)

  // Where the character comes from: down from above on a first run, or up from its place by the input when run again.
  // With movement still it fades in where it sits.
  const [from] = useState<(Seat & { fade: boolean }) | null>(() => {
    const seat = placeOf('welcome', { width: innerWidth, height: innerHeight }).seat
    if (still) return { ...seat, fade: true }
    const home = origin === 'again' ? homeOfFace() : null
    return home ? { ...home, fade: false } : { ...seat, y: seat.y - 220, fade: true }
  })

  // The hand-off: the character flies to the face by the message input while the setup fades away around it.
  // With no face to land on it heads that way and fades.
  const [flight, setFlight] = useState<{ from: Seat; to: Seat } | null>(null)
  const [vanish, setVanish] = useState(false)
  useEffect(() => {
    if (!leaving) return
    const home = homeOfFace()
    // Where the message input usually is, for a frame that has no face to land on.
    const towardInput = { x: 56, y: innerHeight - 56, scale: 0.36 }

    if (still || !home) setVanish(true)
    if (!still) setFlight({ from: place.seat, to: home ?? towardInput })

    const timer = setTimeout(close, still ? 280 : 840)
    return () => clearTimeout(timer)
    // Once, as the setup starts to leave, from where the character is then.
  }, [leaving, still, close])

  const face = useHobReactions(moodOf(step, { leaving, signingIn, cheering }))

  /** The step that is leaving takes no keyboard. The setup holds it until the next step's button takes it. */
  const keepKeyboard = () => {
    if (region.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true })
  }

  /** Ready says how it went: the model hobkin talks on now, or the host's reason for keeping the one it has. */
  const saveMain = ({ model, effort }: TierSetting) => {
    const name = proposal.choices.find(({ id }) => id === model)?.name ?? model
    setMain({ state: 'saving' })
    selectMainModel(model, effort).then(
      () => setMain({ state: 'saved', name }),
      (error: unknown) => setMain({ state: 'refused', reason: reasonOf(error) }),
    )
  }

  const next = () => {
    if (leaving) return
    keepKeyboard()
    // Accepting the first settings writes the tiers, and hobkin's own model through hobkin's settings. Theme and
    // movement were applied as they changed.
    if (step === 'settings' && proposal.config) {
      useTiers.getState().applyTiers(proposal.config)
      saveMain(proposal.config.lead)
    }
    setMoved(true)
    go('next')
  }

  const back = () => {
    if (leaving || at === 0) return
    keepKeyboard()
    setMoved(true)
    go('back')
  }

  /** Up and Down walk the step's controls and its button, in reading order, and stop at both ends. */
  const move = (delta: 1 | -1) => {
    const stops = [...(root.current?.querySelectorAll<HTMLElement>('[data-stop]') ?? [])].filter(
      (stop) => !stop.closest('[inert]') && !stop.hasAttribute('disabled') && stop.getClientRects().length > 0,
    )
    const current = stops.findIndex((stop) => stop === document.activeElement)
    // From outside the controls, Down starts at the first one and Up at the last.
    const wanted = current === -1 ? (delta === 1 ? 0 : stops.length - 1) : current + delta
    const target = stops[Math.min(stops.length - 1, Math.max(0, wanted))]

    target?.focus()
    target?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  }

  const perform = (action: SetupKey) => {
    switch (action.do) {
      case 'next':
        return next()
      case 'back':
        return back()
      case 'cancel-signin':
        return void runCommand('signin.cancel').catch(() => {})
      case 'move':
        return move(action.delta)
    }
  }

  // Read before anything inside the setup sees the key, so a control that owns a key is told apart here, not by luck.
  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || !(event.target instanceof Element)) return
    const press = {
      key: event.key,
      meta: event.metaKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
    }

    const action = resolveSetupKey(press, contextOf(event.target, signingIn))
    if (!action) return

    event.preventDefault()
    perform(action)
  }

  const actions: StepActions = {
    label: step === 'settings' && !proposal.config ? 'Continue' : PRIMARY[step],
    onNext: next,
    onBack: at > 0 ? back : null,
  }
  const coverTransition = leaving
    ? { duration: still ? 0.24 : 0.42, delay: still ? 0 : 0.34, ease: 'linear' as const }
    : { duration: 0.32, ease: 'linear' as const }

  return (
    <MotionConfig reducedMotion={REDUCED_MOTION[movement]}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="Set up hobkin"
        tabIndex={-1}
        onKeyDownCapture={onKeyDownCapture}
        className={cn('fixed inset-0 z-[45] overflow-hidden text-foreground outline-none select-none-chrome', leaving && 'pointer-events-none')}
      >
        {/* The window's own background, over the app. It fades as the setup hands over, and the app is there. */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 bg-background"
          initial={origin === 'again' ? { opacity: 0 } : false}
          animate={{ opacity: leaving ? 0 : 1 }}
          transition={coverTransition}
        />
        <Scene at={at} low={step === 'connect' || step === 'settings'} leaving={leaving} rise={origin === 'again'} still={still} />

        <div ref={region} className="absolute inset-0">
          <AnimatePresence custom={travel}>{leaving ? null : <StepView key={step} step={step} top={place.top} travel={travel} actions={actions} />}</AnimatePresence>
        </div>

        <motion.div
          data-tauri-drag-region=""
          className="absolute inset-x-0 top-0 flex h-14 items-center justify-center"
          animate={{ opacity: leaving ? 0 : 1 }}
          transition={tween.exit}
        >
          <Dots at={at} />
          <Button variant="ghost" className="absolute top-3 right-4" onClick={() => go('skip')}>
            Skip setup
          </Button>
        </motion.div>

        <Face
          seat={flight?.to ?? place.seat}
          from={from}
          launch={flight?.from ?? null}
          vanish={vanish}
          still={still}
          face={face}
          followWithin={root}
          hop={step}
          lean={direction}
        />
        <p className="sr-only" aria-live="polite">{`Step ${at + 1} of ${STEPS.length}: ${STEP_TITLES[step]}`}</p>
      </div>
    </MotionConfig>
  )
}

/** Five dots, one for each step, and a pill that is thrown along them to the step the setup is on. */
function Dots({ at }: { at: number }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-3">
      {STEPS.map((step, index) => (
        <span key={step} className="relative grid size-1.5 place-items-center">
          <span className="size-1.5 rounded-full bg-border-strong/50" />
          {index === at ? <motion.span layoutId="setup-dot" className="absolute h-1.5 w-5 rounded-full bg-foreground" transition={spring.pill} /> : null}
        </span>
      ))}
    </div>
  )
}

/** Moving between seats, on a spring that a new seat retargets. */
const SETTLE = { type: 'spring', duration: 0.7, bounce: 0.16 } as const
const JUMP = { duration: 0 } as const
/** The flight at the end: it travels sideways on a spring while it rises a little, then dives into its seat. */
const FLY_X = { type: 'spring', duration: 0.74, bounce: 0 } as const
const FLY_Y: Transition = { duration: 0.74, times: [0, 0.32, 1], ease: ['easeOut', 'easeIn'] }
const RISE = 64

interface FaceProps {
  seat: Seat
  from: (Seat & { fade: boolean }) | null
  /** Where the flight to the message input starts, once the setup is leaving. */
  launch: Seat | null
  vanish: boolean
  still: boolean
  face: HobReactions
  followWithin: RefObject<HTMLElement | null>
  /** Changes with each step, and the character hops when it does. */
  hop: Step
  /** Which way the steps went, so the hop leans that way. */
  lean: 1 | -1
}

/** The character. It stays on screen from the first step to the last, moving between its seats on springs. */
function Face({ seat, from, launch, vanish, still, face, followWithin, hop, lean }: FaceProps) {
  const flying = launch !== null
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const hoppedFor = useRef(hop)
  useEffect(() => {
    // Only a new step makes it hop, not the first one, and not the same one seen again.
    if (hoppedFor.current === hop) return
    hoppedFor.current = hop
    if (still || flying) return

    void animate(
      scope.current,
      {
        transform: [
          'translateY(0px) rotate(0deg) scale(1, 1)',
          `translateY(-34px) rotate(${lean * 7}deg) scale(0.95, 1.07)`,
          'translateY(0px) rotate(0deg) scale(1.08, 0.92)',
          'translateY(0px) rotate(0deg) scale(1, 1)',
        ],
      },
      { duration: 0.64, times: [0, 0.4, 0.72, 1], ease: ['easeOut', 'easeIn', 'easeOut'] },
    )
  }, [hop])

  const across = (where: Seat) => `translateX(${where.x - FACE / 2}px)`
  const down = (where: Seat) => `translateY(${where.y - FACE / 2}px) scale(${where.scale})`
  // With movement still it changes seats at once, and only fades.
  const settle = still ? JUMP : SETTLE
  // The flight rises a little before it dives into the seat by the message input.
  const peak = launch ? { ...launch, y: launch.y - RISE, scale: launch.scale * 1.05 } : null
  const vertical = launch && peak ? [down(launch), down(peak), down(seat)] : down(seat)

  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: FACE, height: FACE }}
      initial={from ? { transform: across(from) } : false}
      animate={{ transform: across(seat) }}
      transition={flying ? FLY_X : settle}
    >
      <motion.div
        initial={from ? { transform: down(from), opacity: from.fade ? 0 : 1 } : false}
        animate={{ transform: vertical, opacity: vanish ? 0 : 1 }}
        transition={{ transform: flying ? FLY_Y : settle, opacity: { duration: vanish ? 0.3 : 0.32 } }}
      >
        <div ref={scope} style={{ transformOrigin: '50% 100%' }}>
          {/* Poking it is play, as by the message input. It takes no keyboard. */}
          <button type="button" tabIndex={-1} aria-label="hobkin" className="pointer-events-auto block cursor-default rounded-full outline-none" {...face.handlers}>
            <Hob mood={face.mood} size={FACE} still={still} followWithin={followWithin} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Keeps the keyboard inside the setup. A control that goes away with the keyboard on it, such as Sign in when the
 * sign-in starts, or the Models window closing, would leave it on the page, where the frame's keys would take it.
 * It goes back to the control it was last on when that is still there, and to the step's own button otherwise.
 */
function useKeyboardKept(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current
    if (!element) return
    let last: HTMLElement | null = null
    const reachable = (control: HTMLElement) => control.isConnected && !control.closest('[inert]') && control.getClientRects().length > 0
    const rescue = () => {
      const active = document.activeElement
      // The Models window, open over the setup, keeps the keyboard it has.
      const held = active !== null && active !== document.body && (element.contains(active) || active.closest('[role="dialog"]') !== null)
      if (held) return

      const stepButton = element.querySelector<HTMLElement>('section:not([inert]) [data-primary]')
      const target = last && reachable(last) ? last : (stepButton ?? element)
      target.focus({ preventScroll: true })
    }
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== element) last = event.target
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!event.relatedTarget) requestAnimationFrame(rescue)
    }
    const timer = setInterval(rescue, 250)
    element.addEventListener('focusin', onFocusIn)
    // On the document, so the keyboard leaving a window over the setup is seen too.
    document.addEventListener('focusout', onFocusOut, true)
    return () => {
      clearInterval(timer)
      element.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut, true)
    }
  }, [root])
}

/** Chooses a provider that connects while the setup is open, and says true for a moment, so the character can cheer. */
function useCheerOnConnect(choose: (provider: string) => void): boolean {
  const { providers, sample } = useModels()
  const connected = providers
    .filter((provider) => provider.connected)
    .map((provider) => provider.id)
    .join(' ')
  const known = useRef<{ sample: boolean; ids: string } | null>(null)
  const [cheers, setCheers] = useState(0)
  const [cheering, setCheering] = useState(false)

  useEffect(() => {
    const before = known.current
    known.current = { sample, ids: connected }
    // The first look, and the switch from sample data to a host, are where things stand, not a connection made.
    if (!before || before.sample !== sample) return
    const had = new Set(before.ids.split(' '))
    const newest = connected
      .split(' ')
      .filter((id) => id && !had.has(id))
      .at(-1)
    if (!newest) return

    choose(newest)
    setCheers((count) => count + 1)
  }, [connected, sample, choose])

  useEffect(() => {
    if (!cheers) return
    setCheering(true)
    const timer = setTimeout(() => setCheering(false), 2400)
    return () => clearTimeout(timer)
  }, [cheers])

  return cheering
}
