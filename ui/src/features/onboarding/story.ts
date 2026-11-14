import type { PendingQuestion } from '#shared/protocol/question.ts'
import { PROFILE_TEXT_MAX, type ComputerKind, type PiSetup, type SetupWorkDone } from '#shared/protocol/setup.ts'
import type { Mood } from '../../avatar/moods.tsx'
import { questionsFor, USUAL_FOLDER, type Question } from './questions.ts'

/**
 * The first-run setup as a story hobkin tells in speech bubbles: what it says, what it asks, and what comes next
 * for what the user answered and what is on this Mac. Pure rules only. See _specs/025-onboarding.
 *
 * A beat is a few bubbles said in a row. Its question, when it has one, is asked with the last bubble. A word
 * between backticks, such as `⌘,`, is drawn as a key.
 */

/** One beat for each question. A computer's questions may be fewer than these. */
export const QUESTION_BEATS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const
export type QuestionBeat = (typeof QUESTION_BEATS)[number]

export type BeatId =
  | 'hello'
  | 'sound'
  | 'computer'
  | 'computer-thanks'
  | 'name'
  | 'name-hi'
  | 'email'
  | 'subscription'
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
  | 'follow-ups'
  | 'questions-thanks'
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

/** What the user answered so far. */
export interface Answers {
  /** hobkin may make its sounds. */
  sound?: boolean
  computer?: ComputerKind
  name?: string
  email?: string
  /** Pi was installed from the setup, or put off. */
  pi?: 'installed' | 'later'
  /** The sign-in the setup offered connected, or was put off. */
  account?: 'connected' | 'later'
  /** The user wants the five questions. */
  more?: boolean
  /** The answers to the questions, by question id. */
  replies: Readonly<Record<string, string | undefined>>
}

export interface Option {
  value: string
  label: string
}

/** What is typed into: the name, the email, or the answer to one of the questions, by its id. */
export type InputField = { kind: 'name' } | { kind: 'email' } | { kind: 'reply'; question: string }

/** What a choice between two answers: one of the setup's own facts, or one of the questions, by its id. */
export type ChoiceField = 'sound' | 'computer' | 'more' | { reply: string }

/** Where the bubbles to pick from come from: a list that is given, or the projects found in a folder. */
export type PickFrom = { options: readonly string[] } | { projectsIn: string }

export type Ask =
  /** Two bubbles, one each side of hobkin. */
  | { kind: 'choice'; field: ChoiceField; options: readonly [Option, Option] }
  /** A cloud of bubbles to pick as many from as one likes, for one of the questions, by its id. */
  | { kind: 'pick'; question: string; from: PickFrom }
  /** A field at the bottom, in the middle. */
  | { kind: 'input'; field: InputField; type: 'text' | 'email'; placeholder: string; optional: boolean; suggestions?: readonly string[]; note?: string }
  /** One bubble that only goes on. Going on by key passes it too. */
  | { kind: 'go'; label: string }
  /** Install Pi and its packages, or put it off. */
  | { kind: 'pi' }
  /** Sign in to the subscription, or put it off. */
  | { kind: 'connect' }
  /** Main hobkin's own question, by its id: bubbles to pick one from, and a field to type an answer when it takes one. */
  | { kind: 'follow-up'; question: string; options: readonly Option[]; typed: boolean }
  /** Main hobkin is thinking of what to ask. Nothing to answer yet, and only saying it is enough goes on. */
  | { kind: 'wait' }

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

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const CONNECTED = "Great! You're connected! Now I can be even smarter with you!"
const CLAUDE_TOO = 'I also see Claude Code on this Mac. My agents can run on it, and Settings turns that on.'
const withClaude = (lines: string[], { claude }: Facts) => (claude ? [...lines, CLAUDE_TOO] : lines)

function piWords(pi: PiSetup | null): string[] {
  const packagesToo = "I'll add the packages my agents use too."
  const missing = piNeeds(pi)

  if (pi && missing === 'version') {
    const found = pi.version ? `Pi ${pi.version}` : 'a Pi that does not say its version'
    return [`I found ${found} on this Mac, and I am built for ${pi.pinned}.`, `Want me to install that one? ${packagesToo}`]
  }
  if (missing === 'packages') {
    return ['Pi is here, but some of the packages my agents use are missing.', 'Want me to add them?']
  }
  return ["I run on Pi, and I can't find it on this Mac.", `Want me to install it? ${packagesToo}`]
}

/** How a question is asked: typed, picked from bubbles, or chosen between two. */
function askFor(question: Question, replies: Answers['replies']): Ask {
  switch (question.kind) {
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
 * Said once, under the first of the questions. hobkin keeps the answers in front of every agent's directions, so the
 * model's provider sees them too, as the email question says of the profile.
 */
const ANSWERS_KEPT = 'I keep these answers in my home on this Mac. My agents read them, so your model provider sees them too.'

function questionBeat(id: QuestionBeat, { computer, replies }: Answers): Omit<Beat, 'id'> {
  const questions = questionsFor(computer)
  // A beat past a computer's last question is never reached. It says the last one, so it still has words.
  const index = Math.min(QUESTION_BEATS.indexOf(id), questions.length - 1)
  const question = questions[index]!
  const ask = askFor(question, replies)
  const keptNoted = index === 0 && ask.kind === 'input' ? { ...ask, note: ANSWERS_KEPT } : ask
  return { mood: 'listening', lines: [question.ask], ask: keptNoted }
}

/** The beat for the question after one of this computer's, by its place, or what comes after the last. */
function questionAfter(index: number, answers: Answers, facts: Facts): BeatId {
  if (index + 1 < questionsFor(answers.computer).length) return QUESTION_BEATS[index + 1]!
  return facts.smart ? 'follow-ups' : 'questions-thanks'
}

/** A beat's words and question, for what was answered and what is on this Mac. */
export function beatOf(id: BeatId, answers: Answers, facts: Facts): Beat {
  return { id, ...wordsOf(id, answers, facts) }
}

function wordsOf(id: BeatId, answers: Answers, facts: Facts): Omit<Beat, 'id'> {
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
    case 'computer':
      return {
        mood: 'listening',
        lines: ["I'm here to push your development to the next level.", 'So tell me, is this your personal computer or your work one?'],
        ask: {
          kind: 'choice',
          field: 'computer',
          options: [
            { value: 'personal', label: 'Personal' },
            { value: 'work', label: 'Work' },
          ],
        },
      }
    case 'computer-thanks':
      return { mood: 'happy', lines: ['Fantastic! That tells me how to help you with what comes next.'] }
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
        lines: ['Would you share your e-mail too?', 'It tells me which commits, mail and accounts are yours, and which are someone else\'s.'],
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
          'Perfect! I have many more questions, but before them I need something to think with.',
          'I run on Pi, with a subscription you already have. I work with Claude too.',
          'And I will not charge you a single cent for any of this.',
          'If you are signed in already, I will find it myself. If not, I will help you set it up.',
          'Ready?',
        ],
        ask: { kind: 'go', label: 'Ready!' },
      }
    case 'pi':
      return { mood: 'surprised', lines: piWords(facts.pi), ask: { kind: 'pi' } }
    case 'pi-ready':
      return { mood: 'celebrating', lines: ['Pi is ready!'] }
    case 'pi-later':
      return { mood: 'idle', lines: ["Okay, later then. My routines and agents can't run until Pi is here."] }
    case 'found':
      return {
        mood: 'celebrating',
        lines: withClaude([`I found your ${listed(facts.connected)} ${facts.connected.length > 1 ? 'accounts' : 'account'}!`, CONNECTED], facts),
      }
    case 'connect':
      return {
        mood: 'wink',
        lines: ['You have no account yet. Click here and we start! For now I only work with the OpenAI Codex subscription.'],
        ask: { kind: 'connect' },
      }
    case 'connected':
      return { mood: 'celebrating', lines: withClaude([CONNECTED], facts) }
    case 'no-account':
      return { mood: 'idle', lines: ["Okay. I can't answer until a model is connected, so the app will ask you again."] }
    case 'more':
      return {
        mood: 'thinking',
        lines: ['I can take you straight into the app.', 'Or stay a minute and answer five questions, and I will build your first routines from them.', 'What do you say?'],
        ask: {
          kind: 'choice',
          field: 'more',
          options: [
            { value: 'yes', label: 'Ask me' },
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
    case 'follow-ups': {
      // Main hobkin asks these itself, in the chat behind the setup. Its question is said in its own words.
      const asked = facts.asked
      if (!asked) return { mood: 'thinking', lines: ["Give me a moment. I'm thinking about what else I need to know."], ask: { kind: 'wait' } }
      return { mood: 'listening', lines: [asked.words], ask: { kind: 'follow-up', question: asked.id, options: asked.choices, typed: asked.typed } }
    }
    case 'questions-thanks':
      // True both ways: after the follow-ups hobkin is already at it in the chat, and without them the answers go there next.
      return { mood: 'love', lines: ["Thank you! I'll propose your first routines in our chat."] }
    case 'settings':
      return {
        mood: 'wink',
        lines: ['I also have many settings of my own. You start with the best ones.', 'To change any of them, at any time, just press `⌘,`'],
      }
    case 'tour':
      return { mood: 'happy', lines: ["Now come with me. I'll show you around."] }
  }
}

/** An account Pi already reaches is found. With none, the setup offers its one sign-in. */
const accounts = (facts: Facts): BeatId => (facts.connected.length > 0 ? 'found' : 'connect')

/** The beat after one, or null when the story is over. Decided as the beat is left, from what is known then. */
export function beatAfter(id: BeatId, answers: Answers, facts: Facts): BeatId | null {
  switch (id) {
    case 'hello':
      return 'sound'
    case 'sound':
      return 'computer'
    case 'computer':
      return 'computer-thanks'
    case 'computer-thanks':
      return 'name'
    case 'name':
      return 'name-hi'
    case 'name-hi':
      return 'email'
    case 'email':
      return 'subscription'
    case 'subscription':
      return piNeeds(facts.pi) ? 'pi' : accounts(facts)
    case 'pi':
      return answers.pi === 'installed' ? 'pi-ready' : 'pi-later'
    case 'pi-ready':
    case 'pi-later':
      return accounts(facts)
    case 'found':
    case 'connected':
      return 'more'
    case 'connect':
      return answers.account === 'connected' ? 'connected' : 'no-account'
    // The questions are handed to hobkin in the chat, which needs a model, so without one they are not asked.
    case 'no-account':
      return 'settings'
    case 'more':
      return answers.more ? 'q1' : 'settings'
    case 'q1':
    case 'q2':
    case 'q3':
    case 'q4':
    case 'q5':
    case 'q6': {
      // One beat for each of this computer's questions, then main hobkin's own when a real model can ask them.
      const index = QUESTION_BEATS.indexOf(id)
      const question = questionsFor(answers.computer)[index]
      // Projects picked go to work mode through the host, and hobkin says what it did with them.
      const handed = question?.kind === 'projects' && Boolean(answers.replies[question.id]?.trim()) && facts.host === true
      return handed ? 'projects-said' : questionAfter(index, answers, facts)
    }
    case 'projects-said':
      return questionAfter(questionsFor(answers.computer).findIndex(({ kind }) => kind === 'projects'), answers, facts)
    case 'follow-ups':
      return 'questions-thanks'
    case 'questions-thanks':
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
  // An install or a sign-in happens once, so nothing before it can be gone back to. The follow-ups too: reaching
  // them sends the answers to hobkin, so an answer changed after that, or a second visit, would never reach it. And
  // what hobkin says of the projects: they are in Work by then, and picking again would not take them out.
  const once: BeatId[] = ['follow-ups', 'projects-said']
  const sealed = beat.ask?.kind === 'pi' || beat.ask?.kind === 'connect' || once.includes(tale.at) || once.includes(next)
  return { at: next, line: 0, trail: sealed ? [] : [...tale.trail, tale.at], ended: null }
}

/** One move. A question holds the story until it is answered, and nothing moves once the story has ended. */
export function tellOn(tale: Tale, event: TaleEvent, answers: Answers, facts: Facts): Tale {
  if (tale.ended) return tale
  const beat = beatOf(tale.at, answers, facts)

  switch (event) {
    case 'skip':
      return { ...tale, ended: 'skipped' }
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
  if (text.length > PROFILE_TEXT_MAX || CONTROL_CHARACTER.test(text)) return `One line of at most ${PROFILE_TEXT_MAX} characters, please.`
  if (field === 'email' && !EMAIL.test(text)) return 'That does not look like an email.'
  return null
}
