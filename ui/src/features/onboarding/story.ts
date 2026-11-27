import type { PendingQuestion } from '#shared/protocol/question.ts'
import { PROFILE_TEXT_MAX, type ComputerKind, type Goal, type PiSetup, type SetupWorkDone } from '#shared/protocol/setup.ts'
import { PI_NODE } from '#shared/setup/agent-prompt.ts'
import type { FirstModels } from '#shared/tiers/first-models.ts'
import type { Mood } from '../../avatar/moods.tsx'
import { cardsInOrder, cardsLines, firstRunLines, firstRunOf, keptCards, routinesSaid, type CardPicks, type GoalCards, type NamedRoutine, type Written } from './cards.ts'
import { asksComputer, emailWhy, GOAL_BUBBLES, GOALS, goalQuestions, goalsSaid } from './goals.ts'
import { USUAL_FOLDER, type Question } from './questions.ts'
import { asksUsage, USAGE_CHOICES, USAGE_LINES, USAGE_MOOD } from './usage-ask.ts'

/**
 * The first-run setup as a story hobkin tells in speech bubbles: what it says, what it asks, and what comes next
 * for what the user answered and what is on this Mac. Pure rules only. See _specs/025-onboarding and
 * _specs/044-goal-first-setup.
 *
 * A beat is a few bubbles said in a row. Its question, when it has one, is asked with the last bubble. A word
 * between backticks, such as `⌘,`, is drawn as a key.
 */

/** One beat for each of the goals' questions: one each for a job, a business and a project, three for code. */
export const QUESTION_BEATS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const
export type QuestionBeat = (typeof QUESTION_BEATS)[number]

/** One beat for each goal's cards, in the goals' order. */
export type CardsBeat = `cards-${Goal}`
export const cardsBeatOf = (goal: Goal): CardsBeat => `cards-${goal}`
const goalOfCards = (id: CardsBeat): Goal => id.slice('cards-'.length) as Goal
const isCardsBeat = (id: BeatId): id is CardsBeat => id.startsWith('cards-')

export type BeatId =
  | 'hello'
  | 'sound'
  | 'goals'
  | 'goals-said'
  | 'computer'
  | 'computer-work'
  | 'name'
  | 'name-hi'
  | 'email'
  | 'subscription'
  | 'computer-late'
  | 'launcher'
  | 'pi'
  | 'pi-ready'
  | 'pi-later'
  | 'found'
  | 'connect'
  | 'connected'
  | 'no-account'
  | 'more'
  | QuestionBeat
  | 'projects-said'
  | CardsBeat
  | 'routines-need'
  | 'writing'
  | 'written'
  | 'first-run'
  | 'first-run-started'
  | 'thanks'
  | 'usage'
  | 'needs'
  | 'settings'
  | 'tour'

/** What the setup knows about this Mac when a beat is reached. */
export interface Facts {
  /** Pi on this Mac. Null while no host has said, as in a browser tab on sample data. */
  pi: PiSetup | null
  /** The names of the providers Pi already reaches. */
  connected: readonly string[]
  /** Claude Code is installed and signed in. */
  claude: boolean
  /** The host runs hobkin on a real model, so main hobkin can ask questions of its own. Not the scripted one. */
  smart: boolean
  /** The question main hobkin has open now, or null when it has none. */
  asked: OpenQuestion | null
  /** A host answers, so what is picked can be handed to hobkin. Left out, as in a browser tab on sample data, there is none. */
  host?: boolean
  /** What work mode did with the projects picked, once the host said, or `failed` when it could not. Left out while it has not. */
  worked?: SetupWorkDone | 'failed' | null
  /** The routine cards for the goals picked, once they are read. Left out or null while they are not, and then every picked goal has its beat. */
  cards?: readonly GoalCards[] | null
  /** The kept cards that have a routine, once the writing is over. Left out until then. */
  written?: readonly Written[]
  /** What the host set hobkin's model and tiers to once an account was found or connected (`tiers.first`). Left out or null until it said. */
  models?: FirstModels | null
}

/** A question main hobkin has open, as the story asks it. */
export interface OpenQuestion {
  id: string
  /** Its own words, said in hobkin's bubble. */
  words: string
  choices: readonly Option[]
  /** An answer in the user's own words is taken too. */
  typed: boolean
}

/** Main hobkin's own question, as the story asks it. A routine's or another session's is left to the question sheet. */
export function followUpOf(question: PendingQuestion | null): OpenQuestion | null {
  if (!question || question.from !== 'hobkin') return null
  return {
    id: question.id,
    words: question.question.trim(),
    // A choice without a label is said by its value, as the question sheet says it.
    choices: question.choices.map(({ value, label }) => ({ value, label: label.trim() || value })),
    typed: question.other,
  }
}

/** What the person answered so far. */
export interface Answers {
  /** hobkin may make its sounds. */
  sound?: boolean
  /** What the person is working toward. Left out until the goals question is answered. */
  goals?: Goal[]
  /** Bubbles of the person's own words in the goals question. They count as a project. */
  own?: string[]
  computer?: ComputerKind
  name?: string
  email?: string
  /** Pi was installed from the setup, or put off. */
  pi?: 'installed' | 'later'
  /** The sign-in the setup offered connected, or was put off. */
  account?: 'connected' | 'later'
  /** The command that starts Pi, asked on a work computer without an account: kept as the launcher, or put off. */
  launcher?: 'saved' | 'later'
  /** The person wants their routines set up. */
  more?: boolean
  /** The answers to the goals' questions, by question id. */
  replies: Readonly<Record<string, string | undefined>>
  /** The cards kept and turned down, with the changes. */
  cards?: CardPicks
  /** The first run was asked for, or put off. */
  firstRun?: 'run' | 'later'
  /** The answer to the question about usage counts: only yes sends them (`usage-ask.ts`). */
  usage?: boolean
}

export interface Option {
  value: string
  label: string
}

/** What is typed into: the name, the email, or the answer to one of the questions, by its id. */
export type InputField = { kind: 'name' } | { kind: 'email' } | { kind: 'launcher' } | { kind: 'reply'; question: string }

/** What a choice between two answers: one of the setup's own facts, or one of the questions, by its id. */
export type ChoiceField = 'sound' | 'computer' | 'more' | 'first-run' | 'usage' | { reply: string }

/** Where the bubbles to pick from come from: a list that is given, or the projects found in a folder. */
export type PickFrom = { options: readonly string[] } | { projectsIn: string }

export type Ask =
  /** Two bubbles, one each side of hobkin. */
  | { kind: 'choice'; field: ChoiceField; options: readonly [Option, Option] }
  /** A cloud of bubbles to pick as many from as one likes, for one of the questions, by its id. A note may go under it. */
  | { kind: 'pick'; question: string; from: PickFrom; note?: string }
  /** A field at the bottom, in the middle. */
  | { kind: 'input'; field: InputField; type: 'text' | 'email'; placeholder: string; optional: boolean; suggestions?: readonly string[]; note?: string }
  /** One bubble that only goes on. Going on by key passes it too. */
  | { kind: 'go'; label: string }
  /** Install Pi and its packages, or put it off. */
  | { kind: 'pi' }
  /** Sign in to the subscription, or put it off. */
  | { kind: 'connect' }
  /** The review of everything hobkin needs on this Mac, with a way to fix each thing missing. */
  | { kind: 'needs' }
  /** Main hobkin's own question, by its id: bubbles to pick one from, and a field to type an answer when it takes one. */
  | { kind: 'follow-up'; question: string; options: readonly Option[]; typed: boolean }
  /** Main hobkin is thinking of what to ask. Nothing to answer yet, and only saying it is enough goes on. */
  | { kind: 'wait' }
  /** One goal's routine cards, to keep, change or drop. Done goes on. */
  | { kind: 'cards'; goal: Goal }

export interface Beat {
  id: BeatId
  mood: Mood
  lines: readonly string[]
  ask?: Ask
}

/** What of Pi is missing: Pi itself, the version hobkin runs on, or only some packages. Null when nothing is. */
export function piNeeds(pi: PiSetup | null): 'pi' | 'version' | 'packages' | null {
  if (!pi) return null
  if (!pi.installed) return 'pi'
  if (!pi.matches) return 'version'
  return pi.packages.some((entry) => !entry.installed) ? 'packages' : null
}

/**
 * Pi itself is missing, or older than hobkin runs on, so the story cannot go on (the user's word of 2026-11-26: "if pi
 * is not installed it cant move"). It holds at the Pi step until Pi is found, and a setup that ends meanwhile comes
 * back there. Missing packages can wait.
 */
export function piBlocks(pi: PiSetup | null): boolean {
  const missing = piNeeds(pi)
  return missing === 'pi' || missing === 'version'
}

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const CONNECTED = "Great! You're connected! Now I can be even smarter with you!"
const CLAUDE_TOO = 'I also see Claude Code on this Mac. My agents can run on it, and Settings turns that on.'
const withClaude = (lines: string[], { claude }: Facts) => (claude ? [...lines, CLAUDE_TOO] : lines)

/** What hobkin picked to think with, in one bubble. The tiers above fast run on hobkin's own model (`017-model-tiers`). */
function modelsSaid({ lead, tiers }: Extract<FirstModels, { set: true }>): string {
  const helpers = tiers.fast.name === lead.name ? 'and so will my agents' : `and my agents use ${tiers.fast.name} for quick work`
  return `I'll think with ${lead.name}, ${helpers}. You can change that in Settings.`
}

/**
 * The account's bubbles, then what hobkin picked to think with once the host said. It comes last, so a pick that lands
 * while the beat is up adds a bubble and moves none.
 */
const accountLines = (lines: string[], facts: Facts) => {
  const told = withClaude(lines, facts)
  return facts.models?.set ? [...told, modelsSaid(facts.models)] : told
}

/** One thing to install: a Node of hobkin's own, Pi itself, or a package of Pi's, by its name as its id. */
export interface PiStep {
  id: string
  kind: 'node' | 'pi' | 'package'
  name: string
  adds: string
}

/**
 * What is missing, in the order it is installed: without npm a Node of hobkin's own first, when the host can install
 * one, since npm installs Pi and Pi adds its packages through npm; then Pi; then its packages. A host from before
 * says nothing of Node, and gets the steps it always got.
 */
export function piSteps(pi: PiSetup): PiStep[] {
  const missing = piNeeds(pi)
  const needsPi = missing === 'pi' || missing === 'version'
  const packages = pi.packages.filter((entry) => !entry.installed).map((entry): PiStep => ({ id: entry.name, kind: 'package', name: entry.name, adds: entry.adds }))
  const steps: PiStep[] = needsPi ? [{ id: 'pi', kind: 'pi', name: `Pi ${pi.pinned}`, adds: 'What my checks and agents run on.' }, ...packages] : packages
  if (pi.canInstall || !pi.canInstallNode || !pi.node || steps.length === 0) return steps
  return [{ id: 'node', kind: 'node', name: `Node ${pi.node.installs}`, adds: 'Pi runs on it. I keep this copy in my own folder.' }, ...steps]
}

/** Pi has to be installed by hand: it is missing, and there is no npm to install it with nor a Node hobkin can install. */
export function piByHand(pi: PiSetup): boolean {
  const missing = piNeeds(pi)
  return (missing === 'pi' || missing === 'version') && !pi.canInstall && !pi.canInstallNode
}

/** What is missing, said first, then how to get Node, then the line to run. */
export function piHandWords(pi: PiSetup): string {
  let missing = "I can't find npm on this Mac"
  if (pi.node && !pi.node.found) missing = "I can't find Node on this Mac"
  else if (pi.node?.version) missing = `I found Node ${pi.node.version} but no npm`
  return `${missing}, so I can't install Pi myself. Install Node ${PI_NODE} or newer from nodejs.org. It comes with npm. Then run this in Terminal and press Look again:`
}

/** Why Pi cannot be installed with what is here, when npm is missing. A host from before says only that npm is. */
function nodeMissing(pi: PiSetup): string {
  if (!pi.node) return "Pi installs with npm, and I can't find npm on this Mac."
  if (!pi.node.found) return "Pi runs on Node, and Node isn't on this Mac."
  return pi.node.version ? `Pi installs with npm, and the Node on this Mac (${pi.node.version}) has no npm.` : 'Pi installs with npm, and the Node on this Mac has no npm.'
}

function piWords(pi: PiSetup | null): string[] {
  const packagesToo = "I'll add the packages my agents use too."
  const missing = piNeeds(pi)
  // Without npm hobkin says so, and offers its own Node when it can install one, or says what to do when it cannot.
  const noNpm = pi !== null && !pi.canInstall
  const byHand = "I can't install Node for you on this Mac, so I'll show you what to do."

  if (pi && missing === 'version') {
    const found = pi.version ? `Pi ${pi.version}` : 'a Pi that does not say its version'
    const said = `I found ${found} on this Mac, and I am built for ${pi.pinned}.`
    if (!noNpm) return [said, `Want me to install that one? ${packagesToo}`]
    return [said, nodeMissing(pi), pi.canInstallNode ? `Want me to install Node, then Pi ${pi.pinned}? ${packagesToo}` : byHand]
  }
  if (missing === 'packages') {
    const said = 'Pi is here, but some of the packages my agents use are missing.'
    // Without a Node to offer, the window still tries, as it always did, and a failure says why.
    if (!noNpm || !pi?.canInstallNode) return [said, 'Want me to add them?']
    return [said, nodeMissing(pi), 'Want me to install Node, then add them?']
  }
  const said = "I run on Pi, and I can't find it on this Mac."
  if (!noNpm) return [said, `Want me to install it? ${packagesToo}`]
  return [said, nodeMissing(pi), pi.canInstallNode ? `Want me to install Node and Pi? ${packagesToo}` : byHand]
}

/** How a question is asked: typed, picked from bubbles, or chosen between two. */
function askFor(question: Question, replies: Answers['replies']): Ask {
  switch (question.kind) {
    case 'typed':
      return { kind: 'input', field: { kind: 'reply', question: question.id }, type: 'text', placeholder: question.placeholder, optional: true }
    case 'folder':
      return {
        kind: 'input',
        field: { kind: 'reply', question: question.id },
        type: 'text',
        placeholder: question.placeholder,
        optional: true,
        suggestions: question.suggestions,
      }
    case 'projects':
      // The folder is the answer to the question before. Left out, the usual one is looked in.
      return { kind: 'pick', question: question.id, from: { projectsIn: replies[question.in]?.trim() || USUAL_FOLDER } }
    case 'pick':
      return { kind: 'pick', question: question.id, from: { options: question.options } }
    case 'yes':
      return {
        kind: 'choice',
        field: { reply: question.id },
        options: [
          { value: question.yes, label: question.yes },
          { value: question.no, label: question.no },
        ],
      }
  }
}

/**
 * Said once, under the goals question. hobkin keeps the answers in front of every agent's directions, so the model's
 * provider sees them too, as the email question says of the profile.
 */
const ANSWERS_KEPT = 'I keep these answers in my home on this Mac. My agents read them, so your model provider sees them too.'

/** The goals picked, none while the question was not answered. */
const goalsOf = (answers: Answers): readonly Goal[] => answers.goals ?? []

function questionBeat(id: QuestionBeat, { goals = [], replies }: Answers): Omit<Beat, 'id'> {
  const questions = goalQuestions(goals)
  // A beat past the last question is never reached. It says the last one, so it still has words.
  const question = questions[Math.min(QUESTION_BEATS.indexOf(id), questions.length - 1)]
  if (!question) return { mood: 'listening', lines: ['Tell me more about it.'] }
  return { mood: 'listening', lines: [question.ask], ask: askFor(question, replies) }
}

/**
 * The goals that show their cards, in the goals' order: every picked one while the cards are not read yet, and then
 * only those with a card.
 */
function goalsWithCards(answers: Answers, facts: Facts): Goal[] {
  const picked = GOALS.filter((goal) => goalsOf(answers).includes(goal))
  const { cards } = facts
  if (!cards) return picked
  const hasCards = (goal: Goal) => cards.some((group) => group.goal === goal && group.starters.length + group.more.length > 0)
  return picked.filter(hasCards)
}

/** The cards kept so far, in card order. */
const keptOf = (answers: Answers, facts: Facts) => keptCards(cardsInOrder(facts.cards ?? []), answers.cards ?? { marks: {}, changes: {} })

/** The first goal's cards, or the thanks when no goal has any. */
const cardsFrom = (answers: Answers, facts: Facts): BeatId => {
  const [first] = goalsWithCards(answers, facts)
  return first ? cardsBeatOf(first) : 'thanks'
}

/** The beat after one of the goals' questions, by its place, or the cards after the last. */
function questionAfter(index: number, answers: Answers, facts: Facts): BeatId {
  if (index + 1 < goalQuestions(goalsOf(answers)).length) return QUESTION_BEATS[index + 1]!
  return cardsFrom(answers, facts)
}

/** The routine hobkin offers to run first, once the writing is over, or null. */
const firstRunFor = (facts: Facts): NamedRoutine | null => firstRunOf(facts.written ?? [], facts.smart)

/** A beat's words and question, for what was answered and what is on this Mac. */
export function beatOf(id: BeatId, answers: Answers, facts: Facts): Beat {
  return { id, ...wordsOf(id, answers, facts) }
}

const WHOSE_COMPUTER: Ask = {
  kind: 'choice',
  field: 'computer',
  options: [
    { value: 'personal', label: 'My own' },
    { value: 'work', label: 'From work' },
  ],
}

function wordsOf(id: BeatId, answers: Answers, facts: Facts): Omit<Beat, 'id'> {
  if (isCardsBeat(id)) {
    const goal = goalOfCards(id)
    const first = goalsWithCards(answers, facts)[0] === goal
    return { mood: first ? 'happy' : 'wink', lines: cardsLines(goal, first), ask: { kind: 'cards', goal } }
  }

  switch (id) {
    case 'hello':
      return { mood: 'hello', lines: ["Hi there! I'm a hobkin.", 'Yes, all lowercase. Nice to meet you!'] }
    case 'sound':
      return {
        mood: 'wink',
        lines: ['Do you want to hear me, or should I stay quiet?'],
        ask: {
          kind: 'choice',
          field: 'sound',
          options: [
            { value: 'sound-on', label: 'With sound' },
            { value: 'sound-off', label: 'Quiet' },
          ],
        },
      }
    case 'goals':
      return {
        mood: 'listening',
        lines: ["I keep watch over the things you care about, so you don't have to keep checking.", 'What are you working toward right now? Pick everything that fits.'],
        ask: { kind: 'pick', question: 'goals', from: { options: GOAL_BUBBLES }, note: ANSWERS_KEPT },
      }
    case 'goals-said':
      return { mood: 'happy', lines: [goalsSaid(goalsOf(answers))] }
    case 'computer':
    case 'computer-late':
      return { mood: 'listening', lines: ['Is this your own computer, or one from work?'], ask: WHOSE_COMPUTER }
    case 'computer-work':
      return { mood: 'happy', lines: ["Okay. When a routine would read your own mail or money here, I'll say so on it."] }
    case 'name':
      return {
        mood: 'listening',
        lines: ["And who am I helping? What's your name?"],
        ask: { kind: 'input', field: { kind: 'name' }, type: 'text', placeholder: 'Your name', optional: false },
      }
    case 'name-hi':
      return { mood: 'love', lines: [`Hi, ${answers.name ?? 'there'}!`] }
    case 'email':
      return {
        mood: 'listening',
        lines: ['Would you share your e-mail too?', emailWhy(goalsOf(answers))],
        ask: {
          kind: 'input',
          field: { kind: 'email' },
          type: 'email',
          placeholder: 'you@example.com',
          optional: true,
          // hobkin keeps the profile in front of every agent's directions, so the model's provider sees it too.
          note: 'Your name and email stay in my profile on this Mac. My agents read them, so your model provider sees them too.',
        },
      }
    case 'subscription':
      return {
        mood: 'thinking',
        lines: [
          'Perfect! Before we go on, I need something to think with.',
          'I run on Pi, with a subscription you already have. I work with Claude too.',
          'And I will not charge you a single cent for any of this.',
          'If you are signed in already, I will find it myself. If not, I will help you set it up.',
          'Ready?',
        ],
        ask: { kind: 'go', label: 'Ready!' },
      }
    case 'launcher':
      return {
        mood: 'listening',
        lines: [
          'I found no account on this Mac.',
          'On a work computer, Pi often starts through a command the company provides. What is it?',
        ],
        ask: {
          kind: 'input',
          field: { kind: 'launcher' },
          type: 'text',
          placeholder: 'The command that starts Pi',
          optional: true,
          note: 'I run it to ask for its models, and keep it in my config if it lists some. Leave it empty to go on without.',
        },
      }
    case 'pi':
      return { mood: 'surprised', lines: piWords(facts.pi), ask: { kind: 'pi' } }
    case 'pi-ready':
      return { mood: 'celebrating', lines: ['Pi is ready!'] }
    case 'pi-later':
      return { mood: 'idle', lines: ['Okay, later then. My agents run without those packages until they are added.'] }
    case 'found':
      return {
        mood: 'celebrating',
        lines: accountLines([`I found your ${listed(facts.connected)} ${facts.connected.length > 1 ? 'accounts' : 'account'}!`, CONNECTED], facts),
      }
    case 'connect':
      return {
        mood: 'wink',
        lines: ['You have no account yet. Click here and we start! For now I only work with the OpenAI Codex subscription.'],
        ask: { kind: 'connect' },
      }
    case 'connected':
      return { mood: 'celebrating', lines: accountLines([CONNECTED], facts) }
    case 'no-account':
      return { mood: 'idle', lines: ["Okay. I can't answer until a model is connected, so the app will ask you again."] }
    case 'more':
      return {
        mood: 'thinking',
        lines: ['I can take you straight into the app.', "Or stay a few minutes, and I'll set up a few routines for what you're working toward.", 'What do you say?'],
        ask: {
          kind: 'choice',
          field: 'more',
          options: [
            { value: 'yes', label: 'Set them up' },
            { value: 'no', label: 'Take me in' },
          ],
        },
      }
    case 'q1':
    case 'q2':
    case 'q3':
    case 'q4':
    case 'q5':
    case 'q6':
      return questionBeat(id, answers)
    case 'projects-said': {
      // The projects went to work mode as the question was answered. hobkin waits for what was done, then says it.
      const { worked } = facts
      if (!worked) return { mood: 'working', lines: ["One moment. I'm putting them in Work."], ask: { kind: 'wait' } }
      // The quiet line at the bottom says why. The story goes on.
      if (worked === 'failed') return { mood: 'idle', lines: ['I could not put them in Work just now.'] }
      return { mood: 'happy', lines: [workSaid(worked)] }
    }
    case 'routines-need':
      return { mood: 'thinking', lines: ["Before they run, I'll check that I can reach what they look at. I'll ask you before I connect anything."] }
    case 'writing': {
      // Main hobkin writes them in the chat behind the setup. A question it opens is said in its own words.
      const asked = facts.asked
      if (!asked) return { mood: 'working', lines: ["I'm writing your routines now. It takes a minute or two."], ask: { kind: 'wait' } }
      return { mood: 'listening', lines: [asked.words], ask: { kind: 'follow-up', question: asked.id, options: asked.choices, typed: asked.typed } }
    }
    case 'written': {
      const written = facts.written?.length ?? 0
      return { mood: written ? 'celebrating' : 'idle', lines: [routinesSaid(keptOf(answers, facts).length, written)] }
    }
    case 'first-run': {
      // Reached only with a routine to offer. Without one it still has words, and names none.
      const routine = firstRunFor(facts)
      return {
        mood: 'wink',
        lines: firstRunLines(routine ?? { title: 'one' }),
        ask: {
          kind: 'choice',
          field: 'first-run',
          options: [
            { value: 'run', label: 'Run it now' },
            { value: 'later', label: 'Later' },
          ],
        },
      }
    }
    case 'first-run-started':
      return { mood: 'working', lines: ["It's running. Its report will be in Reports soon."] }
    case 'thanks':
      return facts.written?.length
        ? { mood: 'love', lines: ['Thank you! From now on, your routines only speak up when something changes.'] }
        : { mood: 'love', lines: ['Thank you! Ask me for a routine any time.'] }
    case 'usage':
      return { mood: USAGE_MOOD, lines: USAGE_LINES, ask: { kind: 'choice', field: 'usage', options: USAGE_CHOICES } }
    case 'needs':
      return { mood: 'searching', lines: ["One last look. Here's everything I need on this Mac, and how to add what's missing."], ask: { kind: 'needs' } }
    case 'settings':
      return {
        mood: 'wink',
        lines: ['I also have many settings of my own. You start with the best ones.', 'To change any of them, at any time, just press `⌘,`'],
      }
    case 'tour':
      return { mood: 'happy', lines: ["Now come with me. I'll show you around."] }
  }
}

/**
 * With a host, the question about usage counts, then the review of what hobkin needs, come last before the settings.
 * Without one there is nowhere to keep the answer and nothing to read.
 */
const beforeSettings = (facts: Facts): BeatId => (asksUsage(facts) ? 'usage' : 'settings')

/** An account Pi already reaches is found. With none, the setup offers its one sign-in. */
const accounts = (facts: Facts): BeatId => (facts.connected.length > 0 ? 'found' : 'connect')

/** Pi when something of it is missing, else the account. */
const piOrAccounts = (facts: Facts): BeatId => (piNeeds(facts.pi) ? 'pi' : accounts(facts))

/** With a host, no account found and no launcher named, a work computer is asked for the command that starts Pi. */
const launcherMayHelp = (facts: Facts): boolean => facts.host === true && facts.connected.length === 0 && !facts.pi?.launcher

/**
 * A work computer with no account is asked for the command the company provides to start Pi, unless the config already
 * names a launcher. Never on a personal computer, never when an account was found, and never without a host to keep it.
 */
const asksForLauncher = ({ computer }: Answers, facts: Facts): boolean => computer === 'work' && launcherMayHelp(facts)

/** A model answers: an account Pi already reaches, one signed in to in the setup, or a launcher that was kept. */
const hasAccount = (answers: Answers, facts: Facts): boolean =>
  facts.connected.length > 0 || answers.account === 'connected' || answers.launcher === 'saved'

/**
 * Once the goals are said, and whose computer it is when that matters: set them up or go in when an account answers and
 * there is a goal to offer routines for. Main hobkin writes them in the chat, which needs a model, so without one none are offered.
 */
const afterGoals = (answers: Answers, facts: Facts): BeatId =>
  goalsOf(answers).length > 0 && hasAccount(answers, facts) ? 'more' : beforeSettings(facts)

/**
 * Whose computer this is matters only for the goals whose routines read the person's own accounts. Asked already, for
 * the launcher, it is not asked again, and a work computer still hears once that its private cards say so.
 */
function whoseComputer(answers: Answers, facts: Facts): BeatId {
  if (!asksComputer(goalsOf(answers))) return afterGoals(answers, facts)
  if (answers.computer === undefined) return 'computer'
  return answers.computer === 'work' ? 'computer-work' : afterGoals(answers, facts)
}

/**
 * Skip setup shows, and works, only once Pi is in and a model account answers: without them nothing after the setup
 * works (the user's word of 2026-11-26: "\"Skip Setup\" is not an option, honestly ... otherwise wont even work, you can
 * show that after sub/pi is connected"). Missing packages can wait. With no host there is no Pi, so no skipping.
 */
export const skipShows = (answers: Answers, facts: Facts): boolean => facts.pi !== null && !piBlocks(facts.pi) && hasAccount(answers, facts)

/** Projects were picked for code, with a host to hand them to work mode, so hobkin says what it did with them. */
function handsToWork(index: number, answers: Answers, facts: Facts): boolean {
  const question = goalQuestions(goalsOf(answers))[index]
  return question?.kind === 'projects' && Boolean(answers.replies[question.id]?.trim()) && facts.host === true
}

/** The beat after one, or null when the story is over. Decided as the beat is left, from what is known then. */
export function beatAfter(id: BeatId, answers: Answers, facts: Facts): BeatId | null {
  if (isCardsBeat(id)) {
    const goals = goalsWithCards(answers, facts)
    const next = goals[goals.indexOf(goalOfCards(id)) + 1]
    if (next) return cardsBeatOf(next)
    return keptOf(answers, facts).length > 0 ? 'routines-need' : 'thanks'
  }

  switch (id) {
    case 'hello':
      return 'sound'
    // Pi and a model come first, since nothing after them works without them (the user's word of 2026-11-26: "you
    // should not ask for what to use hobkin BEFORE pi/sub").
    case 'sound':
      return 'subscription'
    // A computer not asked about yet is asked now when the launcher question would need it.
    case 'subscription':
      if (asksForLauncher(answers, facts)) return 'launcher'
      if (answers.computer === undefined && launcherMayHelp(facts)) return 'computer-late'
      return piOrAccounts(facts)
    case 'computer-late':
      return asksForLauncher(answers, facts) ? 'launcher' : piOrAccounts(facts)
    // A launcher that was kept is an account: its models are the app's now. Put off, the story goes on as without it.
    case 'launcher':
      if (answers.launcher === 'saved') return 'connected'
      return piOrAccounts(facts)
    case 'pi':
      return answers.pi === 'installed' ? 'pi-ready' : 'pi-later'
    case 'pi-ready':
    case 'pi-later':
      return accounts(facts)
    // Then who the person is and what they are working toward, with an account or without one.
    case 'found':
    case 'connected':
    case 'no-account':
      return 'name'
    case 'connect':
      return answers.account === 'connected' ? 'connected' : 'no-account'
    case 'name':
      return 'name-hi'
    case 'name-hi':
      return 'email'
    case 'email':
      return 'goals'
    case 'goals':
      return 'goals-said'
    case 'goals-said':
      return whoseComputer(answers, facts)
    case 'computer':
      return answers.computer === 'work' ? 'computer-work' : afterGoals(answers, facts)
    case 'computer-work':
      return afterGoals(answers, facts)
    case 'more':
      if (!answers.more) return beforeSettings(facts)
      return goalQuestions(goalsOf(answers)).length ? 'q1' : cardsFrom(answers, facts)
    case 'q1':
    case 'q2':
    case 'q3':
    case 'q4':
    case 'q5':
    case 'q6': {
      const index = QUESTION_BEATS.indexOf(id)
      // Projects picked go to work mode through the host, and hobkin says what it did with them.
      return handsToWork(index, answers, facts) ? 'projects-said' : questionAfter(index, answers, facts)
    }
    case 'projects-said':
      return questionAfter(goalQuestions(goalsOf(answers)).findIndex(({ kind }) => kind === 'projects'), answers, facts)
    // Only main hobkin on a real model writes them. On the scripted host, or with no host, nothing is sent or written.
    case 'routines-need':
      return facts.smart && facts.host === true ? 'writing' : 'thanks'
    case 'writing':
      return 'written'
    case 'written':
      return firstRunFor(facts) ? 'first-run' : 'thanks'
    case 'first-run':
      return answers.firstRun === 'run' ? 'first-run-started' : 'thanks'
    case 'first-run-started':
      return 'thanks'
    case 'thanks':
      return beforeSettings(facts)
    case 'usage':
      return 'needs'
    case 'needs':
      return 'settings'
    case 'settings':
      return 'tour'
    case 'tour':
      return null
  }
}

const FEW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const few = (count: number) => FEW[count] ?? String(count)
const projectsCounted = (count: number) => `${few(count)} ${count === 1 ? 'project' : 'projects'}`
const capital = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`

/**
 * What hobkin says it did with the projects picked, in one short bubble, true to what work mode did: what it took
 * or only offered, and then what it could not add, or else what it had already.
 */
export function workSaid({ workMode, projects }: SetupWorkDone): string {
  const counted = (outcome: string) => projects.filter((project) => project.outcome === outcome).length
  const [taken, proposed, left] = [counted('taken'), counted('proposed'), counted('left')]
  const skipped = projects.filter(({ outcome }) => outcome === 'skipped')
  const notGit = skipped.every(({ why }) => why === 'not-git')

  let main: string | null = null
  if (proposed) main = `Work mode is running, so I put ${projectsCounted(proposed)} in Work for you to take.`
  else if (taken && !workMode.enabled) main = `I'll work on ${projectsCounted(taken)} once work mode is on.`
  else if (taken) main = `${capital(projectsCounted(taken))} ${taken === 1 ? 'is' : 'are'} in Work now, and nothing runs until you say so.`
  else if (left) main = `I had ${projectsCounted(left)} in Work already, and left ${left === 1 ? 'it as it was' : 'them as they were'}.`

  if (!main) {
    if (!skipped.length) return 'I put nothing in Work.'
    const one = skipped.length === 1
    if (notGit) return one ? 'It is not a git repository, so I left it out.' : 'None of them is a git repository, so I left them out.'
    return `I could not add ${one ? 'it' : 'them'} to Work.`
  }

  if (skipped.length) {
    const tail = notGit ? `${capital(few(skipped.length))} ${skipped.length === 1 ? 'was not a git repository' : 'were not git repositories'}.` : `I could not add ${few(skipped.length)} of them.`
    return `${main} ${tail}`
  }
  return left && (taken || proposed) ? `${main} I had ${few(left)} of them already.` : main
}

/** A piece of a bubble: a word, or a key to press, drawn as a key. */
export interface Piece {
  text: string
  key: boolean
}

/** A bubble's words in order. What sits between backticks is one piece, a key. */
export function piecesOf(line: string): Piece[] {
  return line.split('`').flatMap((part, index): Piece[] => {
    const text = part.trim()
    if (!text) return []
    return index % 2 === 1 ? [{ text, key: true }] : text.split(/\s+/).map((word) => ({ text: word, key: false }))
  })
}

/** A bubble as a screen reader hears it: its words, without the marks around a key. */
export const spokenText = (line: string): string => piecesOf(line).map(({ text }) => text).join(' ')

/** Where the telling is. */
export interface Tale {
  at: BeatId
  /** Which bubble of the beat is up, from 0. */
  line: number
  /** The beats already told, oldest first, for going back. */
  trail: readonly BeatId[]
  /** How the story ended, once it has: told to the end, or skipped. */
  ended: 'done' | 'skipped' | null
}

/** `on`: the next bubble. `answered`: the beat's question was answered, so the next beat. */
export type TaleEvent = 'on' | 'back' | 'skip' | 'answered'

export function startTale(): Tale {
  return { at: 'hello', line: 0, trail: [], ended: null }
}

function nextBeat(tale: Tale, beat: Beat, answers: Answers, facts: Facts): Tale {
  const next = beatAfter(tale.at, answers, facts)
  if (!next) return { ...tale, ended: 'done' }
  // An install or a sign-in happens once, so nothing before it can be gone back to. The writing too: reaching it
  // sends the kept cards to hobkin, so a card changed after that would never reach it. What hobkin says of the
  // projects: they are in Work by then, and picking again would not take them out. And a run that started.
  const once: BeatId[] = ['projects-said', 'writing', 'written', 'first-run-started']
  const sealed = beat.ask?.kind === 'pi' || beat.ask?.kind === 'connect' || once.includes(tale.at) || once.includes(next)
  return { at: next, line: 0, trail: sealed ? [] : [...tale.trail, tale.at], ended: null }
}

/**
 * One move. A question holds the story until it is answered, nothing moves once the story has ended, and skipping does
 * nothing until Skip setup shows.
 */
export function tellOn(tale: Tale, event: TaleEvent, answers: Answers, facts: Facts): Tale {
  if (tale.ended) return tale
  const beat = beatOf(tale.at, answers, facts)

  switch (event) {
    case 'skip':
      return skipShows(answers, facts) ? { ...tale, ended: 'skipped' } : tale
    case 'back': {
      if (tale.line > 0) return { ...tale, line: tale.line - 1 }
      const before = tale.trail.at(-1)
      if (!before) return tale
      return { at: before, line: beatOf(before, answers, facts).lines.length - 1, trail: tale.trail.slice(0, -1), ended: null }
    }
    case 'on':
      if (tale.line < beat.lines.length - 1) return { ...tale, line: tale.line + 1 }
      if (beat.ask && beat.ask.kind !== 'go') return tale
      return nextBeat(tale, beat, answers, facts)
    case 'answered':
      return nextBeat(tale, beat, answers, facts)
  }
}

/** The most an answer to one of the questions may hold. */
export const REPLY_MAX = 600

const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/
/** hobkin's own rule for an email (`src/cli/profile.mjs`), so the host never refuses what this lets through. */
const EMAIL = /^[^\s@]+@[^\s@]+$/

/** What is wrong with a typed answer, in hobkin's words, or null when it can be kept. */
export function checkAnswer(field: InputField['kind'], value: string): string | null {
  const text = value.trim()
  if (field === 'reply') return text.length > REPLY_MAX ? `That is a lot. Keep it under ${REPLY_MAX} characters.` : null

  if (!text) return field === 'name' ? 'I need a name to call you.' : null
  if (field === 'launcher') return CONTROL_CHARACTER.test(text) ? 'One line, please.' : text.length > 500 ? 'That is long for a command. Keep it under 500 characters.' : null
  if (text.length > PROFILE_TEXT_MAX || CONTROL_CHARACTER.test(text)) return `One line of at most ${PROFILE_TEXT_MAX} characters, please.`
  if (field === 'email' && !EMAIL.test(text)) return 'That does not look like an email.'
  return null
}
