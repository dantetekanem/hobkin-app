import { AnimatePresence, MotionConfig, motion, type Transition } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { focusInput } from '@/app/keys.ts'
import { useStill } from '@/app/still.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { PET_TOP } from '@/avatar/pets.ts'
import { usePet } from '@/avatar/use-pet.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useChat } from '@/features/chat/chat-store.ts'
import { useSettings, type Movement } from '@/features/settings/store.ts'
import { play } from '@/features/sound/index.ts'
import { useTour } from '@/features/tour/store.ts'
import { answerQuestion, hostStore, isLive, runCommand, useHasHost, useHost, useModels, usePendingQuestion, type QuestionReply } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { ComputerKind, Goal, GoalCards, ProjectFolder, SetupSaved, SetupWorkDone } from '#shared/protocol/setup.ts'
import type { FirstModels } from '#shared/tiers/first-models.ts'
import { routinesFromHost } from '@/features/routines/host-data.ts'
import type { FirstRunStop } from '@/features/tour/steps.ts'
import { connectedNames } from './accounts.ts'
import { Actor, type Act } from './Actor.tsx'
import { AnswerField } from './AnswerField.tsx'
import { Bubble, saidAfter } from './Bubble.tsx'
import { cardPicksOf, cardsInOrder, firstRunOf, keptCards, NO_PICKS, picksFrom, routinesWritten, writeRequest, writingOver, type Card, type NamedRoutine, type Written } from './cards.ts'
import { CardsScreen } from './CardsScreen.tsx'
import { Choices } from './Choices.tsx'
import { ConnectPanel } from './ConnectPanel.tsx'
import { FACE, footBelow, type Seat, type Viewport } from './face-size.ts'
import { FollowUps } from './FollowUps.tsx'
import { NeedsPanel } from './NeedsPanel.tsx'
import { PickCloud } from './PickCloud.tsx'
import { foldersPicked, pickedAnswer, picksOf } from './picks.ts'
import { PiPanel } from './PiPanel.tsx'
import { checksWanted, goalAnswersOf, GOAL_WORDS, goalsOf, projectStart, setupAnswersOf } from './goals.ts'
import { SAMPLE_PROJECTS, startingReply } from './questions.ts'
import { sampleGoalCards } from './sample-cards.ts'
import { beatOf, checkAnswer, followUpOf, piBlocks, spokenText, type Answers, type Ask, type BeatId, type Facts, type Tale } from './story.ts'
import { endedAs, tourFollows } from './first-run.ts'
import { useSetup } from './store.ts'
import { keepUsage, usageAnswer } from './usage-ask.ts'
import { useProofTools } from './use-proof-tools.ts'
import { resolveTaleKey, type TaleKey, type TaleKeyContext } from './tale-keys.ts'
import { WORLD_TIMES, World, type WorldPhase } from './World.tsx'
import { LAYER, arrivalFor, cardsStage, stageFor, type Arrival } from './world-geometry.ts'

/**
 * How the story opens, in seconds. The window holds empty for a moment, so the world does not start the instant
 * the app does. Then the sky comes, rests, and the mountains rise. Opened again from Settings, the wait is short.
 */
const OPENING = { hold: 1.4, holdAgain: 0.45, skyRest: 0.3 }
/** The character starts on its way as the last ridge is settling, not after it. A share of the land's time. */
const ARRIVE_AT = 0.85

/** How long the hand-off takes before the setup is taken away, in milliseconds: the flight, or a fade when held still. */
const HAND_OFF_MS = { flight: 840, fade: 280 }

/** How far the top of the chosen pet is above the middle of the character's square, as a share of the square. */
const topShare = (top: number) => (100 - top) / 256

/**
 * How far into the hill the character stands, in pixels. Its faces lean and bob from a point below its foot, which
 * lifts a foot, so standing exactly on the crest it looks like it floats.
 */
const SUNK = 7
const onTheGround = (seat: Seat): Seat => ({ ...seat, y: seat.y + SUNK })

/** The way in, with its last hop landing on the ground where the character then stands. */
function grounded(arrival: Arrival): Arrival {
  const hops = arrival.hops.map((hop, index) => (index === arrival.hops.length - 1 ? { ...hop, to: onTheGround(hop.to) } : hop))
  return { ...arrival, hops, stage: onTheGround(arrival.stage) }
}

/**
 * Where the two choices float, in pixels: how far above the top of the pet, never nearer the top of the window
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
 * hobkin's first model and tiers, set once the story reaches an account it found or signed in to (`tiers.first`, in
 * 017-model-tiers). Asked once per setup, and only of a live host: the scripted one saves nothing. A home where a model
 * was chosen before keeps it, so the host answers that it set nothing. Null until the host said.
 */
function useFirstModels(at: BeatId, onTrouble: (words: string) => void): FirstModels | null {
  const live = useHost((state) => state.link === 'open' && state.model === 'live')
  const [models, setModels] = useState<FirstModels | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    if (asked.current || !live || (at !== 'found' && at !== 'connected')) return
    asked.current = true
    runCommand('tiers.first').then(setModels, (error: unknown) => {
      onTrouble(`I could not set my models, so they stay as Pi picks them: ${reasonOf(error)}`)
    })
  }, [at, live])

  return models
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
  /** The folders found, with where each is, so what is picked goes to work mode by path. None for a list that is given. */
  folders: readonly ProjectFolder[]
  /** Why there are none, when there are none. */
  note?: string
}

const LOOKING: Bubbles = { state: 'loading', options: [], folders: [] }

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
          setFound({ state: 'ready', options: names, folders: projects })
          return
        }
        setFound({ state: 'none', options: [], folders: [], note: `I found no folders in ${folder}. Go back to name another one, or skip.` })
      },
      (error: unknown) => {
        if (current) setFound({ state: 'none', options: [], folders: [], note: reasonOf(error) })
      },
    )
    return () => {
      current = false
    }
  }, [folder, hasHost])

  if (!ask) return LOOKING
  if ('options' in ask.from) return { state: 'ready', options: ask.from.options, folders: [] }
  // Made-up ones have nowhere to be, and nothing is handed to work mode without a host.
  return hasHost ? found : { state: 'ready', options: SAMPLE_PROJECTS, folders: [] }
}

/** What the setup saved the last time it ran, so its fields start from it when it runs again. Asked once, as it opens. */
function useEarlier(): SetupSaved | null {
  const hasHost = useHasHost()
  const link = useHost((state) => state.link)
  const [earlier, setEarlier] = useState<SetupSaved | null>(null)

  useEffect(() => {
    if (!hasHost || link !== 'open') return
    let current = true
    // A host from before the setup kept its answers does not know the command, and the fields start empty.
    runCommand('setup.saved').then(
      (saved) => {
        if (current) setEarlier(saved)
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [hasHost, link])

  return earlier
}

/** Each bubble's id. A beat whose words change while it is up, as an answer comes back, says them as a new bubble. */
function bubbleOf(tale: Tale, facts: Facts): string {
  if (tale.at === 'writing') return `${tale.at}:${facts.asked?.id ?? 'thinking'}`
  if (tale.at === 'projects-said') return `${tale.at}:${facts.worked ? 'said' : 'waiting'}`
  return `${tale.at}:${tale.line}`
}

/** The message that asks main hobkin to write the kept routines: the goals, their answers, the cards and the projects' checks. */
function writingRequestOf(answers: Answers, cards: readonly GoalCards[]): string | null {
  const goals = answers.goals ?? []
  const { replies } = answers
  return writeRequest({ goals, answers: goalAnswersOf(goals, replies), cards, picks: answers.cards ?? NO_PICKS, checks: checksWanted(goals, replies) })
}

/** The routines in hobkin's snapshot, as far as the writing reads them: id, title, the template each names, and whether it is on. */
function namedRoutines(schedules: unknown): NamedRoutine[] {
  return routinesFromHost({ schedules, errors: [] }).routines.map(({ id, title, template, enabled }) => ({ id, title, template, enabled }))
}

/** What the story needs of the writing. */
interface Writing {
  /** Whether the host took the message, once it was sent. Null while it never was. */
  seeded: RefObject<Promise<boolean> | null>
  /** Gives main hobkin the answer to its question. It answers with what went wrong, or null once hobkin has it. */
  answer: (id: string, reply: QuestionReply) => Promise<string | null>
  /** The person said That's enough. */
  enough: () => void
}

interface WritingAt {
  /** The story is at the writing, and not leaving. */
  here: boolean
  /** The message that asks main hobkin to write the kept routines. */
  request: string | null
  /** The cards kept, in card order. */
  kept: readonly Card[]
  /** The id of the question main hobkin has open, or null. */
  open: string | null
  /** Once it is over, with the kept cards that have their routine. */
  onOver: (written: Written[]) => void
  onTrouble: (words: string) => void
}

/**
 * Main hobkin writes the kept routines (044-goal-first-setup). Reaching the writing sends it the message, once, in the
 * chat, and a question it opens is asked in the story. It is over when every kept card has a routine that names its
 * template, when hobkin stops with nothing open, when the person says enough, when the message did not go, or after
 * two minutes with nothing asked (`writingOver`). A question still open then is left to the question sheet.
 */
function useWriting({ here, request, kept, open, onOver, onTrouble }: WritingAt): Writing {
  const busy = useHost((state) => state.snapshot.busy === true)
  const schedules = useHost((state) => state.snapshot.schedules)
  const seeded = useRef<Promise<boolean> | null>(null)
  // The routines when the message went, so one that already named its template is not counted as written now.
  const before = useRef<NamedRoutine[]>([])
  const stirredAt = useRef(0)
  const [takenAt, setTakenAt] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [enough, setEnough] = useState(false)

  // Once, on reaching it. Through the chat, so the message shows there. The story never comes back to it.
  useEffect(() => {
    if (!here || seeded.current || !request) return
    stirredAt.current = Date.now()
    before.current = namedRoutines(hostStore.getState().snapshot.schedules)
    seeded.current = useChat
      .getState()
      .send(request)
      .catch(() => false)
      .then((taken) => {
        if (taken) setTakenAt(Date.now())
        else {
          setFailed(true)
          onTrouble('I could not reach our chat just now, so I will write them once we are in.')
        }
        return taken
      })
    // Once, with what was kept by then.
  }, [here])

  // A question that comes or goes is hobkin still at it, so its two minutes start over.
  useEffect(() => {
    stirredAt.current = Date.now()
  }, [open])

  useEffect(() => {
    if (!here || !seeded.current) return
    const check = () => {
      const written = routinesWritten(kept, namedRoutines(hostStore.getState().snapshot.schedules), before.current)
      const state = { takenAt, failed, busy, open: open !== null, enough, stirredAt: stirredAt.current, kept: kept.length, written: written.length }
      if (writingOver(state, Date.now())) onOver(written)
    }
    check()
    // Time alone can end it too: a few quiet seconds after the message, or two minutes with nothing asked.
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [here, takenAt, failed, busy, open, enough, schedules])

  const answer = async (id: string, reply: QuestionReply): Promise<string | null> => {
    const wrong = 'typed' in reply ? checkAnswer('reply', reply.typed) : null
    if (wrong) return wrong
    try {
      await answerQuestion(id, reply)
      return null
    } catch (error) {
      return reasonOf(error)
    }
  }

  return { seeded, answer, enough: () => setEnough(true) }
}

/**
 * The routine cards for the goals picked: read from hobkin's templates through the host, or the sample's made-up ones
 * in a browser tab. Null while they are read. Run again, the cards start kept or dropped as the last setup left them.
 */
function useGoalCards(hasHost: boolean, earlier: SetupSaved | null, onTrouble: (words: string) => void) {
  const [cards, setCards] = useState<GoalCards[] | null>(null)
  const asked = useRef(0)

  const load = (goals: Goal[]) => {
    const round = ++asked.current
    const landed = (groups: GoalCards[]) => {
      if (round !== asked.current) return
      setCards(groups)
      const { answers, note } = useSetup.getState()
      if (!answers.cards && earlier?.cards.length) note({ cards: picksFrom(earlier.cards) })
    }
    if (!hasHost) return landed(sampleGoalCards(goals))
    setCards(null)
    runCommand('setup.watchers', { goals }).then(
      ({ goals: groups }) => landed(groups),
      (error: unknown) => {
        if (round !== asked.current) return
        // With no cards to show, the story goes on to the thanks, and the routines wait for the chat.
        setCards([])
        onTrouble(`I could not read my routine templates: ${reasonOf(error)}`)
      },
    )
  }

  return { cards, load }
}

/**
 * The first-run setup as a story, over the whole window. The window holds empty for a moment, the sky comes, the
 * mountains rise, and hobkin hops in from behind them to the middle and talks in speech bubbles. It asks what the
 * person is working toward, whose computer this is when that matters, their name and email, installs Pi when it is
 * missing, finds an account or signs in to one, and offers routines for the goals: each goal's question, its cards,
 * main hobkin writing the kept ones, and a first run. Then it hands over to the app, where a short tour follows. See
 * _specs/025-onboarding and _specs/044-goal-first-setup.
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
  // The answers of the last setup, where the fields start when it runs again. The story still asks every question.
  const earlier = useEarlier()
  // What work mode did with the projects picked: null while the host has not said.
  const [worked, setWorked] = useState<SetupWorkDone | 'failed' | null>(null)
  // Something that was meant to be kept and was not. Said once, quietly, at the bottom.
  const [trouble, setTrouble] = useState<string | null>(null)
  // The routine cards for the goals picked, and the kept cards that have their routine once the writing is over.
  const { cards, load: loadCards } = useGoalCards(hasHost, earlier, setTrouble)
  const [written, setWritten] = useState<Written[] | undefined>(undefined)
  // The routine the setup ran, for the tour's stop about its first report.
  const firstRun = useRef<FirstRunStop | null>(null)
  // What hobkin's model and tiers were set to once an account was found or connected.
  const models = useFirstModels(tale.at, setTrouble)
  const facts: Facts = useMemo(
    () => ({ pi, connected: connectedNames(providers), claude, smart, asked: followUpOf(pending), host: hasHost, worked, cards, written, models }),
    [pi, providers, claude, smart, pending, hasHost, worked, cards, written, models],
  )
  const beat = beatOf(tale.at, answers, facts)
  const lastLine = tale.line >= beat.lines.length - 1
  const line = beat.lines[Math.min(tale.line, beat.lines.length - 1)]!
  const leaving = tale.ended !== null

  const { phase, act, arrived, leave } = useOpening(still, origin)
  const [arrival] = useState(() => grounded(arrivalFor({ width: innerWidth, height: innerHeight })))
  const talking = act === 'talking'

  // Each question main hobkin asks is a bubble of its own, so its words arrive anew, and so is what it did with the projects.
  const bubble = bubbleOf(tale, facts)
  const [said, sayAll] = useSaid(bubble, line, talking, still)
  // The question comes with the last bubble, once that bubble is said.
  const asking: Ask | null = talking && !leaving && lastLine && said ? (beat.ask ?? null) : null
  // With nothing asked, or only a bubble to pass, the story waits for the user to go on.
  const waitsToGoOn = !lastLine || !beat.ask || beat.ask.kind === 'go'

  // An install is running: nothing goes back from it.
  const [busy, setBusy] = useState(false)
  // The TLA+ tools, set up in the background. The quiet line says how it goes while nothing went wrong.
  const toolsLine = useProofTools(setTrouble)
  const quietLine = trouble ?? toolsLine

  // The kept cards, and the message that asks main hobkin to write them, from what was answered.
  const goals = answers.goals ?? []
  const picksNow = answers.cards ?? NO_PICKS
  const kept = useMemo(() => keptCards(cardsInOrder(cards ?? []), picksNow), [cards, picksNow])
  const request = writingRequestOf(answers, cards ?? [])

  // Main hobkin writes the kept routines. The story goes on by itself once that is over.
  const writing = useWriting({
    here: tale.at === 'writing' && !leaving,
    request,
    kept,
    open: facts.asked?.id ?? null,
    onOver: (done) => {
      // The story may have moved on since the last look, by "That's enough" or Skip setup.
      if (useSetup.getState().tale.at !== 'writing') return
      setWritten(done)
      tell('answered', { ...facts, written: done })
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

  // The projects picked, with where each is, kept with every save once they were picked.
  const picks = useRef<ProjectFolder[]>([])
  // Each hand-off to work mode, so only the last one's answer is said.
  const handed = useRef(0)

  // The cards as last read, for saves made from a handler before the next render.
  const cardsNow = useRef(cards)
  cardsNow.current = cards

  /** The answers so far, kept in hobkin's home after each one, so hobkin knows them from the first conversation. */
  const keepAnswers = () => {
    if (!hasHost) return
    const now = useSetup.getState().answers
    const picked = cardPicksOf(cardsNow.current ?? [], now.cards ?? NO_PICKS)
    runCommand('setup.save', setupAnswersOf(now, picks.current, picked)).catch((error: unknown) => {
      setTrouble(`I could not keep your answers: ${reasonOf(error)}`)
    })
  }

  /** One of the questions answered: the story goes on, and the answers so far are kept. */
  const replied = (question: string, value: string) => {
    answer({ replies: { ...answers.replies, [question]: value } }, facts)
    keepAnswers()
  }

  /**
   * The folder and the projects picked go to work mode, which answers with what it did with each. Nothing turns work
   * mode on or starts a run here. Without a host nothing goes, and a failure is said quietly while the story goes on.
   */
  const handToWork = (folder: string, folders: readonly ProjectFolder[]) => {
    if (!hasHost) return
    const asked = ++handed.current
    setWorked(null)
    runCommand('setup.work', { folder, projects: folders.map(({ path }) => path) }).then(
      (done) => {
        if (asked !== handed.current) return
        setWorked(done)
        if (done.folder.problem) setTrouble(`I could not keep ${folder} for work mode. ${done.folder.problem}`)
      },
      (error: unknown) => {
        if (asked !== handed.current) return
        setWorked('failed')
        setTrouble(`I could not put your projects in Work: ${reasonOf(error)}`)
      },
    )
  }

  /** A typed answer: checked, kept, and the story goes on. It answers with what is wrong when it cannot be kept. */
  const typed = async (ask: InputAsk, text: string): Promise<string | null> => {
    const wrong = checkAnswer(ask.field.kind, text)
    if (wrong) return wrong
    const value = text.trim()

    if (ask.field.kind === 'reply') {
      replied(ask.field.question, value)
      return null
    }

    if (ask.field.kind === 'launcher') {
      // Left empty, the command is put off. Otherwise the host asks it for its models, and refuses one that lists none.
      if (!value) {
        answer({ launcher: 'later' }, facts)
        return null
      }
      try {
        setPi(await runCommand('setup.launcher', { command: value }))
      } catch (error) {
        return reasonOf(error)
      }
      answer({ launcher: 'saved' }, facts)
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

  /**
   * Run it now starts the one routine hobkin offered, once, as `routine.run` does: the report comes later. A refusal,
   * such as background places that are full, is said in the quiet line, and the story goes on.
   */
  const runFirst = async (value: string) => {
    const routine = firstRunOf(written ?? [], smart)
    if (value !== 'run' || !routine) return answer({ firstRun: 'later' }, facts)
    const startedAt = Date.now()
    setBusy(true)
    try {
      await runCommand('routine.run', { id: routine.id })
      firstRun.current = { routineId: routine.id, title: routine.title, startedAt }
      answer({ firstRun: 'run' }, facts)
    } catch (error) {
      setTrouble(`I could not run ${routine.title} now: ${reasonOf(error)}`)
      answer({ firstRun: 'later' }, facts)
    } finally {
      setBusy(false)
    }
  }

  /**
   * The answer about usage counts: the story goes on at once, and the host keeps it, which makes it hobkin's own
   * setting on the real home. A refusal is said in the quiet line, and nothing is sent.
   */
  const usageChosen = (value: string) => {
    const upload = usageAnswer(value)
    answer({ usage: upload }, facts)
    void keepUsage(upload, (name, args) => runCommand(name, args)).then((trouble) => {
      if (trouble) setTrouble(trouble)
    })
  }

  const chosen = (ask: ChoiceAsk, value: string) => {
    if (ask.field === 'more') return answer({ more: value === 'yes' }, facts)
    if (ask.field === 'usage') return usageChosen(value)
    if (ask.field === 'first-run') return void runFirst(value)
    if (ask.field === 'sound') {
      const heard = value === 'sound-on'
      // Kept as the app's own setting, which Settings shows too. The cheer is what was chosen, heard.
      useSettings.getState().setSound(heard)
      if (heard) play('cheer')
      return answer({ sound: heard }, facts)
    }
    // One of the questions, answered with one of its two words.
    if (typeof ask.field === 'object') return replied(ask.field.reply, value)

    const computer = value as ComputerKind
    // The story goes on at once. If hobkin could not keep it, that is said, since the questions still follow it.
    void keep({ computer }).then((refused) => {
      if (refused) setTrouble(`I could not keep that in my profile: ${refused}`)
    })
    answer({ computer }, facts)
  }

  const picking = asking?.kind === 'pick' ? asking : null
  /** The goals picked before, as bubbles: this time's, or the last setup's, and the person's own words. */
  const goalsBefore = (): string[] => {
    const picked = answers.goals ?? earlier?.goals ?? []
    return [...picked.map((goal) => GOAL_WORDS[goal].bubble), ...(answers.own ?? [])]
  }
  const bubbles = useBubbles(picking, hasHost)
  const pet = usePet()
  // A list that is given takes bubbles of the user's own. Projects are only the ones that are there.
  const ownAllowed = picking !== null && 'options' in picking.from

  /** A pick answered. Projects are kept by path and handed to work mode, and the story goes on to what it did with them. */
  const pickedFor = (ask: PickAsk, picked: string[]) => {
    // The goals: their bubbles and the person's own words, which count as a project. Their cards are read at once.
    if (ask.question === 'goals') {
      const chosenGoals = goalsOf(picked)
      answer(chosenGoals, facts)
      keepAnswers()
      if (chosenGoals.goals.length) loadCards(chosenGoals.goals)
      return
    }
    if ('projectsIn' in ask.from) {
      picks.current = foldersPicked(picked, bubbles.folders)
      handToWork(ask.from.projectsIn, picks.current)
    }
    replied(ask.question, pickedAnswer(picked))
  }

  /** What was typed for a question before, when the user comes back to it, or the last time the setup ran. Own words start the project. */
  const typedBefore = (ask: InputAsk): string => {
    if (ask.field.kind === 'reply' && ask.field.question === 'project') return startingReply(answers, earlier, 'project') || projectStart(answers.own ?? [])
    if (ask.field.kind === 'reply') return startingReply(answers, earlier, ask.field.question)
    if (ask.field.kind === 'launcher') return ''
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
    setHome(homeOfFace())
    leave()

    // Ended while Pi is missing, or told to the end with no account, the setup is unfinished: it opens again where Pi
    // and the account are, and no tour starts.
    const ended = tale.ended === 'done' ? 'done' : 'skipped'
    const as = endedAs(ended, facts.connected.length > 0, !piBlocks(facts.pi))
    const handOver = () => {
      close(as)
      if (!tourFollows(ended, as)) return

      // Main hobkin already has the kept cards when the writing message went. Otherwise it goes now, once, and only
      // to main hobkin on a real model: the scripted host and a browser tab write nothing.
      void (writing.seeded.current ?? Promise.resolve(false)).then((taken) => {
        if (!taken && request && smart && hasHost) void useChat.getState().send(request)
      })
      const workFolder = worked !== null && worked !== 'failed' && worked.folder.saved !== null
      useTour.getState().startWith({ work: goals.includes('code') || workFolder, firstRun: firstRun.current })
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

  // While the cards are up hobkin stands on the hill at the side, and its bubble fits between the window's edge and them.
  const onCards = tale.at.startsWith('cards-')
  const beside = cardsStage(viewport)
  const stage = onTheGround(onCards ? beside.seat : stageFor(viewport))
  const petTop = { x: stage.x, y: stage.y - FACE * stage.scale * topShare(PET_TOP[pet]) }
  // The two choices float in the sky, either side of what hobkin says, clear of it and inside the window.
  const choicesAt = { x: stage.x, y: Math.max(petTop.y - CHOICES.above, CHOICES.top) }
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

        {storyShows ? <Bubble id={bubble} line={line} said={said} waits={waitsToGoOn} above={petTop} maxWidth={onCards ? beside.bubbleWidth : undefined} still={still} /> : null}

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
              initial={picking.question === 'goals' ? goalsBefore() : picksOf(startingReply(answers, earlier, picking.question), bubbles.options, ownAllowed)}
              allowOwn={ownAllowed}
              remark={picking.note}
              top={stage.y + footBelow(stage.scale) + 28}
              onAnswer={(picked) => pickedFor(picking, picked)}
              still={still}
            />
          ) : null}
          {tale.at === 'writing' && storyShows ? (
            <FollowUps
              key="writing"
              label={spokenText(line)}
              ask={asking?.kind === 'follow-up' ? asking : null}
              top={stage.y + footBelow(stage.scale) + 28}
              onAnswer={writing.answer}
              onEnough={writing.enough}
              still={still}
            />
          ) : null}
          {asking?.kind === 'cards' ? (
            <CardsScreen
              key={asking.goal}
              group={cards?.find(({ goal }) => goal === asking.goal) ?? { goal: asking.goal, starters: [], more: [] }}
              picks={picksNow}
              onPicks={(next) => {
                useSetup.getState().note({ cards: next })
                keepAnswers()
              }}
              work={answers.computer === 'work'}
              area={beside.area}
              wide={beside.wide}
              onDone={() => tell('answered', facts)}
              onBack={back}
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
          {asking?.kind === 'needs' ? (
            <NeedsPanel
              key="needs"
              top={stage.y + footBelow(stage.scale) + 28}
              onDone={() => tell('answered', facts)}
              onBusy={setBusy}
              still={still}
            />
          ) : null}
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

        {quietLine ? (
          <p role="status" className="absolute inset-x-0 bottom-2 z-[90] mx-auto w-fit max-w-[70ch] rounded-full bg-card px-3 py-1 text-center text-[12px] text-muted-foreground shadow-panel">
            {quietLine}
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
