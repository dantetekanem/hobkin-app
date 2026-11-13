import { AnimatePresence, MotionConfig, motion, type Transition } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { focusInput } from '@/app/keys.ts'
import { useStill } from '@/app/still.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useChat } from '@/features/chat/chat-store.ts'
import { useSettings, type Movement } from '@/features/settings/store.ts'
import { useTour } from '@/features/tour/store.ts'
import { runCommand, useHasHost, useHost, useModels } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { ComputerKind } from '#shared/protocol/setup.ts'
import { connectedNames } from './accounts.ts'
import { Actor, type Act } from './Actor.tsx'
import { AnswerField } from './AnswerField.tsx'
import { Bubble, saidAfter } from './Bubble.tsx'
import { Choices } from './Choices.tsx'
import { ConnectPanel } from './ConnectPanel.tsx'
import { FACE, type Seat, type Viewport } from './face-size.ts'
import { PiPanel } from './PiPanel.tsx'
import { routinesRequest } from './questions.ts'
import { beatOf, checkAnswer, spokenText, type Ask, type Facts } from './story.ts'
import { useSetup } from './store.ts'
import { resolveTaleKey, type TaleKey, type TaleKeyContext } from './tale-keys.ts'
import { WORLD_TIMES, World, type WorldPhase } from './World.tsx'
import { arrivalFor, stageFor } from './world-geometry.ts'

/**
 * How the story opens, in seconds. The window holds empty for a moment, so the world does not start the instant
 * the app does. Then the sky comes, rests, and the mountains rise. Opened again from Settings, the wait is short.
 */
const OPENING = { hold: 1.4, holdAgain: 0.45, skyRest: 0.3 }
/** The character starts on its way as the last ridge is settling, not after it. A share of the land's time. */
const ARRIVE_AT = 0.85

/** How long the hand-off takes before the setup is taken away, in milliseconds: the flight, or a fade when held still. */
const HAND_OFF_MS = { flight: 840, fade: 280 }

/** How far the tip of the hood is above the middle of the character's square, as a share of the square. */
const HOOD_TIP = 0.305

/** The Movement setting, as Motion's own rule for the things it does reduce. */
const REDUCED_MOTION: Record<Movement, 'always' | 'never' | 'user'> = {
  still: 'always',
  lively: 'never',
  system: 'user',
}

type InputAsk = Extract<Ask, { kind: 'input' }>
type ChoiceAsk = Extract<Ask, { kind: 'choice' }>
type ProfileChange = { name?: string; email?: string; computer?: ComputerKind }

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

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

/** What the control that has the keyboard does with keys itself. */
function controlOf(target: Element): Pick<TaleKeyContext, 'typing' | 'pressable'> {
  return {
    typing: target.matches('input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"]), textarea, [contenteditable="true"]'),
    pressable: target.matches('button, a[href], [role="button"]'),
  }
}

/** A click on a control is the control's. A click anywhere else goes on with the story. */
const OWN_CLICKS = 'button, a, input, textarea, label, form, section, [role="group"], [data-own]'

/** hobkin's face: the beat's own, unless the setup is leaving, a sign-in is under way, or an install is running. */
function faceFor(beatMood: Mood, { leaving, signingIn, busy }: { leaving: boolean; signingIn: boolean; busy: boolean }): Mood {
  if (leaving) return 'happy'
  if (signingIn) return 'searching'
  if (busy) return 'working'
  return beatMood
}

/** The window's cover fades out after the character has left its seat, and in at once when the setup opens over the app. */
function coverFade(leaving: boolean, still: boolean): Transition {
  if (!leaving) return { duration: 0.32, ease: 'linear' }
  if (still) return { duration: 0.24, ease: 'linear' }
  return { duration: 0.42, delay: 0.34, ease: 'linear' }
}

/**
 * The opening and what the character does through it. The world builds itself, phase by phase, then the character
 * comes. A user who would not wait rushes it: the world is there at once and the character jumps to its seat.
 */
function useOpening(still: boolean, origin: 'first-run' | 'again') {
  const [phase, setPhase] = useState<WorldPhase>(still ? 'ready' : 'void')
  const [act, setAct] = useState<Act>('waiting')
  const [rushed, setRushed] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    // Held still, the world is simply there and the character with it.
    if (still) return

    const hold = origin === 'again' ? OPENING.holdAgain : OPENING.hold
    const landAt = hold + WORLD_TIMES.sky + OPENING.skyRest
    const arriveAt = landAt + WORLD_TIMES.land * ARRIVE_AT
    const startArriving = () => setAct((now) => (now === 'waiting' ? 'arriving' : now))

    timers.current = [
      setTimeout(() => setPhase('sky'), hold * 1000),
      setTimeout(() => setPhase('land'), landAt * 1000),
      setTimeout(startArriving, arriveAt * 1000),
    ]
    return () => timers.current.forEach(clearTimeout)
    // Once, as the setup opens.
  }, [])

  const rush = () => {
    if (act === 'talking' || rushed) return
    timers.current.forEach(clearTimeout)
    setPhase('ready')
    setRushed(true)
  }
  const arrived = () => {
    setPhase('ready')
    setAct('talking')
  }
  const leave = () => setAct('leaving')

  return { phase, act, rushed, rush, arrived, leave }
}

/** Asks the host what is on this Mac, once it answers: Pi and its packages, and whether Claude Code is signed in. */
function useThisMac(): void {
  const hasHost = useHasHost()
  const link = useHost((state) => state.link)
  const setPi = useSetup((state) => state.setPi)
  const setClaude = useSetup((state) => state.setClaude)

  useEffect(() => {
    if (!hasHost || link !== 'open') return
    let current = true

    runCommand('setup.pi').then(
      (state) => {
        if (current) setPi(state)
      },
      () => {},
    )
    runCommand('claude-code.read').then(
      ({ status }) => {
        if (current) setClaude(status.installed && status.signedIn === true)
      },
      () => {},
    )

    return () => {
      current = false
    }
  }, [hasHost, link, setPi, setClaude])
}

/** The frame stays behind the setup, out of reach, until the setup hands over. Then the keyboard goes home. */
function useFrameOutOfReach(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const frame = document.getElementById('root')
    frame?.setAttribute('inert', '')
    if (!root.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true })

    return () => {
      frame?.removeAttribute('inert')
      requestAnimationFrame(() => focusInput())
    }
  }, [root])
}

/**
 * Whether the bubble that is up is said: all its words are there, by time or because the user went on. Kept by the
 * bubble's id, so a new bubble is never said for a frame before its words start.
 */
function useSaid(bubble: string, line: string, talking: boolean, still: boolean): [said: boolean, sayAll: () => void] {
  const [saidBubble, setSaidBubble] = useState<string | null>(null)

  useEffect(() => {
    if (!talking || still) return
    const timer = setTimeout(() => setSaidBubble(bubble), saidAfter(line))
    return () => clearTimeout(timer)
  }, [bubble, talking, still, line])

  return [still || saidBubble === bubble, () => setSaidBubble(bubble)]
}

/**
 * The first-run setup as a story, over the whole window. The window holds empty for a moment, the sky comes, the
 * mountains rise, and hobkin hops in from behind them to the middle and talks in speech bubbles. It asks whose
 * computer this is, the user's name and email, installs Pi when it is missing, finds an account or signs in to
 * one, offers five more questions, and hands over to the app, where a short tour follows. See _specs/025-onboarding.
 *
 * While it is open the frame behind it takes no keyboard and no pointer.
 */
export function Storyteller() {
  const origin = useSetup((state) => state.origin)
  const tale = useSetup((state) => state.tale)
  const answers = useSetup((state) => state.answers)
  const pi = useSetup((state) => state.pi)
  const claude = useSetup((state) => state.claude)
  const tell = useSetup((state) => state.tell)
  const answer = useSetup((state) => state.answer)
  const setPi = useSetup((state) => state.setPi)
  const close = useSetup((state) => state.close)
  const movement = useSettings((state) => state.movement)
  const still = useStill()
  const viewport = useViewport()
  const hasHost = useHasHost()
  const signingIn = useHost((state) => state.signIn.status === 'signing-in')
  const { providers } = useModels()
  const root = useRef<HTMLDivElement | null>(null)
  const reach = useRef<((side: 'left' | 'right') => void) | null>(null)

  useFrameOutOfReach(root)
  useKeyboardKept(root)
  useThisMac()

  const facts: Facts = useMemo(() => ({ pi, connected: connectedNames(providers), claude }), [pi, providers, claude])
  const beat = beatOf(tale.at, answers, facts)
  const lastLine = tale.line >= beat.lines.length - 1
  const line = beat.lines[Math.min(tale.line, beat.lines.length - 1)]!
  const leaving = tale.ended !== null

  const { phase, act, rushed, rush, arrived, leave } = useOpening(still, origin)
  const [arrival] = useState(() => arrivalFor({ width: innerWidth, height: innerHeight }))
  const talking = act === 'talking'

  const bubble = `${tale.at}:${tale.line}`
  const [said, sayAll] = useSaid(bubble, line, talking, still)
  // The question comes with the last bubble, once that bubble is said.
  const asking: Ask | null = talking && !leaving && lastLine && said ? (beat.ask ?? null) : null
  // With nothing asked, or only a bubble to pass, the story waits for the user to go on.
  const waitsToGoOn = !lastLine || !beat.ask || beat.ask.kind === 'go'

  // An install is running: nothing goes back from it.
  const [busy, setBusy] = useState(false)
  // Something that was meant to be kept and was not. Said once, quietly, at the bottom.
  const [trouble, setTrouble] = useState<string | null>(null)

  const on = () => {
    if (leaving) return
    if (!talking) return rush()
    if (!said) return sayAll()
    tell('on', facts)
  }
  const back = () => {
    if (leaving || !talking || busy) return
    tell('back', facts)
  }

  /** Keeps a part of the profile in hobkin's home. A browser tab on sample data has no home, and keeps nothing. */
  const keep = async (change: ProfileChange): Promise<string | null> => {
    if (!hasHost) return null
    try {
      await runCommand('profile.set', change)
      return null
    } catch (error) {
      return reasonOf(error)
    }
  }

  /** A typed answer: checked, kept, and the story goes on. It answers with what is wrong when it cannot be kept. */
  const typed = async (ask: InputAsk, text: string): Promise<string | null> => {
    const wrong = checkAnswer(ask.field.kind, text)
    if (wrong) return wrong
    const value = text.trim()

    if (ask.field.kind === 'reply') {
      answer({ replies: { ...answers.replies, [ask.field.question]: value } }, facts)
      return null
    }

    if (ask.field.kind === 'name') {
      const refused = await keep({ name: value })
      if (refused) return refused
      answer({ name: value }, facts)
      return null
    }

    // An email left out is not an answer to keep.
    const refused = value ? await keep({ email: value }) : null
    if (refused) return refused
    answer(value ? { email: value } : {}, facts)
    return null
  }

  const chosen = (ask: ChoiceAsk, value: string) => {
    if (ask.field === 'more') return answer({ more: value === 'yes' }, facts)

    const computer = value as ComputerKind
    // The story goes on at once. If hobkin could not keep it, that is said, since the questions still follow it.
    void keep({ computer }).then((refused) => {
      if (refused) setTrouble(`I could not keep that in my profile: ${refused}`)
    })
    answer({ computer }, facts)
  }

  /** What was typed for a question before, when the user comes back to it. */
  const typedBefore = (ask: InputAsk): string => {
    if (ask.field.kind === 'reply') return answers.replies[ask.field.question] ?? ''
    return answers[ask.field.kind] ?? ''
  }

  const perform = (action: TaleKey) => {
    switch (action.do) {
      case 'on':
        return on()
      case 'back':
        return back()
      case 'cancel-signin':
        return void runCommand('signin.cancel').catch(() => {})
      case 'reach':
        return reach.current?.(action.side)
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
    const context: TaleKeyContext = { ...controlOf(event.target), asking: asking?.kind ?? null, signingIn, busy }
    const action = resolveTaleKey(press, context)
    if (!action) return

    event.preventDefault()
    perform(action)
  }

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(OWN_CLICKS)) return
    on()
  }

  // The hand-off. The character flies to its place by the message input while the setup fades away around it. Told
  // to the end, the answers to the questions go to hobkin in the chat, and the tour of the app starts.
  const [home, setHome] = useState<Seat | null>(null)
  useEffect(() => {
    if (!leaving) return
    const toldToTheEnd = tale.ended === 'done'
    setHome(homeOfFace())
    leave()

    const handOver = () => {
      close()
      if (!toldToTheEnd) return

      const request = routinesRequest(answers)
      if (request && hasHost) void useChat.getState().send(request)
      useTour.getState().start()
    }
    const timer = setTimeout(handOver, still ? HAND_OFF_MS.fade : HAND_OFF_MS.flight)
    return () => clearTimeout(timer)
    // Once, as the story ends, with what was answered by then.
  }, [leaving])

  const stage = stageFor(viewport)
  const hoodTip = { x: stage.x, y: stage.y - FACE * stage.scale * HOOD_TIP }
  const mood = faceFor(beat.mood, { leaving, signingIn, busy })
  const storyShows = talking && !leaving

  return (
    <MotionConfig reducedMotion={REDUCED_MOTION[movement]}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="Set up hobkin"
        tabIndex={-1}
        onKeyDownCapture={onKeyDownCapture}
        onClick={onClick}
        className={cn('fixed inset-0 z-[45] overflow-hidden text-foreground outline-none select-none-chrome', leaving && 'pointer-events-none')}
      >
        {/* The window's own background, over the app. It fades as the setup hands over, and the app is there. */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 bg-background"
          initial={origin === 'again' ? { opacity: 0 } : false}
          animate={{ opacity: leaving ? 0 : 1 }}
          transition={coverFade(leaving, still)}
        />

        <World phase={phase} leaving={leaving} still={still}>
          <Actor
            act={act}
            arrival={arrival}
            seat={stage}
            home={home}
            rushed={rushed}
            mood={mood}
            beat={tale.at}
            still={still}
            followWithin={root}
            onArrived={arrived}
          />
        </World>

        {storyShows ? <Bubble id={bubble} line={line} said={said} waits={waitsToGoOn} above={hoodTip} still={still} /> : null}

        {asking?.kind === 'choice' ? (
          <Choices
            key={tale.at}
            label={spokenText(line)}
            options={asking.options}
            around={{ x: stage.x, y: stage.y + 8 }}
            apart={clamp(viewport.width * 0.22, 190, 320)}
            onChoose={(value) => chosen(asking, value)}
            still={still}
            reach={reach}
          />
        ) : null}

        <AnimatePresence>
          {asking?.kind === 'input' ? (
            <AnswerField
              key={tale.at}
              ask={asking}
              label={spokenText(line)}
              initial={typedBefore(asking)}
              onAnswer={(text) => typed(asking, text)}
              still={still}
            />
          ) : null}
          {asking?.kind === 'go' ? <GoOn key={tale.at} label={asking.label} onGo={on} still={still} /> : null}
          {asking?.kind === 'pi' && pi ? (
            <PiPanel
              key="pi"
              pi={pi}
              onState={setPi}
              onDone={(outcome) => answer({ pi: outcome }, facts)}
              onBusy={setBusy}
              still={still}
            />
          ) : null}
          {asking?.kind === 'connect' ? <ConnectPanel key="connect" onDone={(outcome) => answer({ account: outcome }, facts)} still={still} /> : null}
        </AnimatePresence>

        <motion.div
          data-tauri-drag-region=""
          // Out of reach until hobkin talks, so a click during the opening never lands on a button nobody can see.
          className={cn('absolute inset-x-0 top-0 z-[90] flex h-14 items-center justify-end', !storyShows && 'pointer-events-none')}
          initial={{ opacity: 0 }}
          animate={{ opacity: storyShows ? 1 : 0 }}
          transition={tween.exit}
        >
          <Button variant="ghost" className="mt-1 mr-4" tabIndex={talking ? 0 : -1} onClick={() => tell('skip', facts)}>
            Skip setup
          </Button>
        </motion.div>

        {trouble ? (
          <p role="status" className="absolute inset-x-0 bottom-2 z-[90] mx-auto w-fit max-w-[70ch] rounded-full bg-card px-3 py-1 text-center text-[12px] text-muted-foreground shadow-panel">
            {trouble}
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {storyShows ? spokenText(line) : ''}
        </p>
      </div>
    </MotionConfig>
  )
}

const GO_LANDED = 'translateX(-50%) translateY(0px) scale(1)'

/** The one button under a bubble that only asks to go on, such as "Ready?". Enter passes it too. */
function GoOn({ label, onGo, still }: { label: string; onGo: () => void; still: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, transform: still ? GO_LANDED : 'translateX(-50%) translateY(28px) scale(0.96)' }}
      animate={{ opacity: 1, transform: GO_LANDED, transition: { transform: spring.rise, opacity: tween.enter } }}
      exit={{ opacity: 0, transform: still ? GO_LANDED : 'translateX(-50%) translateY(14px) scale(0.98)', transition: tween.exit }}
      className="absolute bottom-[9vh] left-1/2 z-[80]"
    >
      <Button size="lg" className="h-12 gap-2.5 px-7 text-[15px]" onClick={onGo}>
        {label}
        <Kbd className="bg-foreground/10 text-primary-foreground">↵</Kbd>
      </Button>
    </motion.div>
  )
}

/**
 * Keeps the keyboard inside the setup. A control that goes away with the keyboard on it, such as a choice that was
 * picked or the field of a question that was answered, would leave it on the page, where the frame's keys would
 * take it. It goes back to the control it was last on when that is still there, and to the setup itself otherwise.
 */
function useKeyboardKept(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current
    if (!element) return
    let last: HTMLElement | null = null

    const reachable = (control: HTMLElement) => {
      const onThePage = control.isConnected && control.getClientRects().length > 0
      const usable = !control.closest('[inert]') && !control.hasAttribute('disabled')
      return onThePage && usable
    }
    const rescue = () => {
      const active = document.activeElement
      const nowhere = active === null || active === document.body
      // A window of the app over the setup keeps the keyboard it has.
      const held = !nowhere && (element.contains(active) || active.closest('[role="dialog"]') !== null)
      if (held) return

      const target = last && reachable(last) ? last : element
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
