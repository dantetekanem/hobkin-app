import { AnimatePresence, MotionConfig, motion, type Transition } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { focusInput } from '@/app/keys.ts'
import { useStill } from '@/app/still.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useChat } from '@/features/chat/chat-store.ts'
import { useSettings, type Movement } from '@/features/settings/store.ts'
import { play } from '@/features/sound/index.ts'
import { useTour } from '@/features/tour/store.ts'
import { answerQuestion, isLive, runCommand, useHasHost, useHost, useModels, usePendingQuestion, type QuestionReply } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { ComputerKind } from '#shared/protocol/setup.ts'
import { connectedNames } from './accounts.ts'
import { Actor, type Act } from './Actor.tsx'
import { AnswerField } from './AnswerField.tsx'
import { Bubble, saidAfter } from './Bubble.tsx'
import { Choices } from './Choices.tsx'
import { ConnectPanel } from './ConnectPanel.tsx'
import { FACE, footBelow, type Seat, type Viewport } from './face-size.ts'
import { FollowUps } from './FollowUps.tsx'
import { PickCloud } from './PickCloud.tsx'
import { pickedAnswer, picksOf } from './picks.ts'
import { PiPanel } from './PiPanel.tsx'
import { followUpRequest, followUpsOver, routinesRequest, SAMPLE_PROJECTS } from './questions.ts'
import { beatOf, checkAnswer, followUpOf, spokenText, type Answers, type Ask, type Facts } from './story.ts'
import { useSetup } from './store.ts'
import { resolveTaleKey, type TaleKey, type TaleKeyContext } from './tale-keys.ts'
import { WORLD_TIMES, World, type WorldPhase } from './World.tsx'
import { LAYER, arrivalFor, stageFor, type Arrival } from './world-geometry.ts'

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

/**
 * How far into the hill the character stands, in pixels. Its faces lean and bob from a point below its foot, which
 * lifts a corner of the hood, so standing exactly on the crest it looks like it floats.
 */
const SUNK = 7
const onTheGround = (seat: Seat): Seat => ({ ...seat, y: seat.y + SUNK })

/** The way in, with its last hop landing on the ground where the character then stands. */
function grounded(arrival: Arrival): Arrival {
  const hops = arrival.hops.map((hop, index) => (index === arrival.hops.length - 1 ? { ...hop, to: onTheGround(hop.to) } : hop))
  return { ...arrival, hops, stage: onTheGround(arrival.stage) }
}

/**
 * Where the two choices float, in pixels: how far above the tip of the hood, never nearer the top of the window
 * than `top`, between `nearest` and `farthest` from the middle, and at least `edge` from the window's side.
 */
const CHOICES = { above: 96, top: 116, nearest: 344, farthest: 400, edge: 106 }

/** The Movement setting, as Motion's own rule for the things it does reduce. */
const REDUCED_MOTION: Record<Movement, 'always' | 'never' | 'user'> = {
  still: 'always',
  lively: 'never',
  system: 'user',
}

type InputAsk = Extract<Ask, { kind: 'input' }>
type ChoiceAsk = Extract<Ask, { kind: 'choice' }>
type PickAsk = Extract<Ask, { kind: 'pick' }>
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
 * comes. It always plays through: a click or a key before the character has landed does nothing.
 */
function useOpening(still: boolean, origin: 'first-run' | 'again') {
  const [phase, setPhase] = useState<WorldPhase>(still ? 'ready' : 'void')
  const [act, setAct] = useState<Act>('waiting')
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

  const arrived = () => {
    setPhase('ready')
    setAct('talking')
  }
  const leave = () => setAct('leaving')

  return { phase, act, arrived, leave }
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

/**
 * A setup always starts with sound, whatever was chosen before, so hobkin is heard as it arrives and says hello.
 * Then it asks, and Quiet mutes it. Left before the question is answered, the setting goes back to what it was.
 */
function useSoundUntilAsked(): void {
  useEffect(() => {
    const before = useSettings.getState().sound
    useSettings.getState().setSound(true)

    return () => {
      const neverAsked = useSetup.getState().answers.sound === undefined
      if (neverAsked) useSettings.getState().setSound(before)
    }
  }, [])
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

/** The bubbles of a pick: the list it was given, or the folders found where the user's projects live. */
interface Bubbles {
  state: 'loading' | 'ready' | 'none'
  options: readonly string[]
  /** Why there are none, when there are none. */
  note?: string
}

const LOOKING: Bubbles = { state: 'loading', options: [] }

/**
 * What there is to pick from for a question. A list is there at once. Projects are asked of the host, which reads
 * the names of the folders in the folder the user named. A browser tab on sample data has no folder, and shows
 * made-up ones.
 */
function useBubbles(ask: PickAsk | null, hasHost: boolean): Bubbles {
  const folder = ask && 'projectsIn' in ask.from ? ask.from.projectsIn : null
  const [found, setFound] = useState<Bubbles>(LOOKING)

  useEffect(() => {
    if (folder === null || !hasHost) return
    let current = true
    setFound(LOOKING)

    runCommand('setup.projects', { folder }).then(
      ({ projects }) => {
        if (!current) return
        const names = projects.map(({ name }) => name)
        if (names.length) {
          setFound({ state: 'ready', options: names })
          return
        }
        setFound({ state: 'none', options: [], note: `I found no folders in ${folder}. Go back to name another one, or skip.` })
      },
      (error: unknown) => {
        if (current) setFound({ state: 'none', options: [], note: reasonOf(error) })
      },
    )
    return () => {
      current = false
    }
  }, [folder, hasHost])

  if (!ask) return LOOKING
  if ('options' in ask.from) return { state: 'ready', options: ask.from.options }
  return hasHost ? found : { state: 'ready', options: SAMPLE_PROJECTS }
}

/** What the story needs of main hobkin's own questions. */
interface FollowingUp {
  /** Whether the host took the message that starts them, once it was sent. Null while it never was. */
  seeded: RefObject<Promise<boolean> | null>
  /** Gives main hobkin the answer to its question. It answers with what went wrong, or null once hobkin has it. */
  answer: (id: string, reply: QuestionReply) => Promise<string | null>
  /** The user has told hobkin enough. */
  enough: () => void
}

interface FollowUpsAt {
  /** The story is at the follow-ups, and not leaving. */
  here: boolean
  answers: Answers
  /** The id of the question main hobkin has open, or null. */
  open: string | null
  onOver: () => void
  onTrouble: (words: string) => void
}

/**
 * Main hobkin's own questions, after the fixed ones. Reaching them sends hobkin the answers, once, as one message in
 * the chat, and it asks what else it needs with its `ask_question` tool. The story goes on when they are over
 * (`followUpsOver`). A question still open then is left open, and the question sheet takes it after the setup.
 */
function useFollowUps({ here, answers, open, onOver, onTrouble }: FollowUpsAt): FollowingUp {
  const busy = useHost((state) => state.snapshot.busy === true)
  const seeded = useRef<Promise<boolean> | null>(null)
  const stirredAt = useRef(0)
  const [takenAt, setTakenAt] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [answered, setAnswered] = useState(0)
  const [enough, setEnough] = useState(false)

  // Once, on reaching them. Through the chat, so the message shows there. The story never comes back to them.
  useEffect(() => {
    if (!here || seeded.current) return
    stirredAt.current = Date.now()
    seeded.current = useChat
      .getState()
      .send(followUpRequest(answers))
      .catch(() => false)
      .then((taken) => {
        if (taken) setTakenAt(Date.now())
        else {
          setFailed(true)
          onTrouble('I could not reach our chat just now, so I will not ask more here.')
        }
        return taken
      })
    // Once, with what was answered by then.
  }, [here])

  // A question that comes or goes is hobkin still asking, so its two minutes start over.
  useEffect(() => {
    stirredAt.current = Date.now()
  }, [open])

  useEffect(() => {
    if (!here || !seeded.current) return
    const check = () => {
      if (followUpsOver({ takenAt, failed, busy, open: open !== null, answered, enough, stirredAt: stirredAt.current }, Date.now())) onOver()
    }
    check()
    // Time alone can end them too: a few quiet seconds after the message, or two minutes with nothing asked.
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [here, takenAt, failed, busy, open, answered, enough])

  const answer = async (id: string, reply: QuestionReply): Promise<string | null> => {
    const wrong = 'typed' in reply ? checkAnswer('reply', reply.typed) : null
    if (wrong) return wrong
    try {
      await answerQuestion(id, reply)
      setAnswered((count) => count + 1)
      return null
    } catch (error) {
      return reasonOf(error)
    }
  }

  return { seeded, answer, enough: () => setEnough(true) }
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
  useSoundUntilAsked()

  // Main hobkin can ask questions of its own only on a real model. The scripted host's hobkin has no `ask_question`.
  const smart = useHost((state) => isLive(state) && state.model === 'live')
  const pending = usePendingQuestion()
  const facts: Facts = useMemo(() => ({ pi, connected: connectedNames(providers), claude, smart, asked: followUpOf(pending) }), [pi, providers, claude, smart, pending])
  const beat = beatOf(tale.at, answers, facts)
  const lastLine = tale.line >= beat.lines.length - 1
  const line = beat.lines[Math.min(tale.line, beat.lines.length - 1)]!
  const leaving = tale.ended !== null

  const { phase, act, arrived, leave } = useOpening(still, origin)
  const [arrival] = useState(() => grounded(arrivalFor({ width: innerWidth, height: innerHeight })))
  const talking = act === 'talking'

  // Each question main hobkin asks is a bubble of its own, so its words arrive anew.
  const bubble = tale.at === 'follow-ups' ? `${tale.at}:${facts.asked?.id ?? 'thinking'}` : `${tale.at}:${tale.line}`
  const [said, sayAll] = useSaid(bubble, line, talking, still)
  // The question comes with the last bubble, once that bubble is said.
  const asking: Ask | null = talking && !leaving && lastLine && said ? (beat.ask ?? null) : null
  // With nothing asked, or only a bubble to pass, the story waits for the user to go on.
  const waitsToGoOn = !lastLine || !beat.ask || beat.ask.kind === 'go'

  // An install is running: nothing goes back from it.
  const [busy, setBusy] = useState(false)
  // Something that was meant to be kept and was not. Said once, quietly, at the bottom.
  const [trouble, setTrouble] = useState<string | null>(null)

  // Main hobkin's own questions after the fixed ones. The story goes on by itself once they are over.
  const followUps = useFollowUps({
    here: tale.at === 'follow-ups' && !leaving,
    answers,
    open: facts.asked?.id ?? null,
    onOver: () => {
      // The story may have moved on since the last look, by "That's enough" or Skip setup.
      if (useSetup.getState().tale.at === 'follow-ups') tell('answered', facts)
    },
    onTrouble: setTrouble,
  })

  const on = () => {
    // Nothing goes on until the character has landed and talks.
    if (leaving || !talking) return
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
    if (ask.field === 'sound') {
      const heard = value === 'sound-on'
      // Kept as the app's own setting, which Settings shows too. The cheer is what was chosen, heard.
      useSettings.getState().setSound(heard)
      if (heard) play('cheer')
      return answer({ sound: heard }, facts)
    }
    // One of the questions, answered with one of its two words.
    if (typeof ask.field === 'object') return answer({ replies: { ...answers.replies, [ask.field.reply]: value } }, facts)

    const computer = value as ComputerKind
    // The story goes on at once. If hobkin could not keep it, that is said, since the questions still follow it.
    void keep({ computer }).then((refused) => {
      if (refused) setTrouble(`I could not keep that in my profile: ${refused}`)
    })
    answer({ computer }, facts)
  }

  const picking = asking?.kind === 'pick' ? asking : null
  const bubbles = useBubbles(picking, hasHost)
  // A list that is given takes bubbles of the user's own. Projects are only the ones that are there.
  const ownAllowed = picking !== null && 'options' in picking.from

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

      // Main hobkin already has the answers when the follow-ups' message went. Otherwise they go now, as one message.
      const request = routinesRequest(answers)
      void (followUps.seeded.current ?? Promise.resolve(false)).then((taken) => {
        if (!taken && request && hasHost) void useChat.getState().send(request)
      })
      useTour.getState().start()
    }
    const timer = setTimeout(handOver, still ? HAND_OFF_MS.fade : HAND_OFF_MS.flight)
    return () => clearTimeout(timer)
    // Once, as the story ends, with what was answered by then.
  }, [leaving])

  // Good news is cheered: an account found or connected, Pi ready.
  const cheering = beat.mood === 'celebrating' && talking && !leaving
  useEffect(() => {
    if (cheering) play('cheer')
  }, [cheering, tale.at])

  const stage = onTheGround(stageFor(viewport))
  const hoodTip = { x: stage.x, y: stage.y - FACE * stage.scale * HOOD_TIP }
  // The two choices float in the sky, either side of what hobkin says, clear of it and inside the window.
  const choicesAt = { x: stage.x, y: Math.max(hoodTip.y - CHOICES.above, CHOICES.top) }
  const choicesApart = Math.min(clamp(viewport.width * 0.27, CHOICES.nearest, CHOICES.farthest), viewport.width / 2 - CHOICES.edge)
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
          {/* Its shadow on the hill, so it stands on the ground. In front of the hill, behind the character. */}
          <div
            className={cn('absolute h-4 w-[128px] rounded-[50%] bg-black/30 blur-[6px] transition-opacity duration-300 ease-out', storyShows ? 'opacity-100' : 'opacity-0')}
            style={{ left: stage.x - 64, top: stage.y + footBelow(stage.scale) - 9, zIndex: LAYER.hill + 1 }}
          />
          <Actor
            act={act}
            arrival={arrival}
            seat={stage}
            home={home}
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
            around={choicesAt}
            apart={choicesApart}
            onChoose={(value) => chosen(asking, value)}
            // Quiet is quiet from the pick itself: the setting changes before the pick's own sound would play.
            onPicked={asking.field === 'sound' ? (value) => useSettings.getState().setSound(value === 'sound-on') : undefined}
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
          {picking ? (
            <PickCloud
              key={`${tale.at}:${bubbles.state}`}
              label={spokenText(line)}
              options={bubbles.options}
              state={bubbles.state}
              note={bubbles.note}
              initial={picksOf(answers.replies[picking.question], bubbles.options, ownAllowed)}
              allowOwn={ownAllowed}
              top={stage.y + footBelow(stage.scale) + 28}
              onAnswer={(picked) => answer({ replies: { ...answers.replies, [picking.question]: pickedAnswer(picked) } }, facts)}
              still={still}
            />
          ) : null}
          {tale.at === 'follow-ups' && storyShows ? (
            <FollowUps
              key="follow-ups"
              label={spokenText(line)}
              ask={asking?.kind === 'follow-up' ? asking : null}
              top={stage.y + footBelow(stage.scale) + 28}
              onAnswer={followUps.answer}
              onEnough={followUps.enough}
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
