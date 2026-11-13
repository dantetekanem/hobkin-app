import { PROFILE_TEXT_MAX, type ComputerKind, type PiSetup } from '#shared/protocol/setup.ts'
import type { Mood } from '../../avatar/moods.tsx'
import { questionsFor } from './questions.ts'

/**
 * The first-run setup as a story hobkin tells in speech bubbles: what it says, what it asks, and what comes next
 * for what the user answered and what is on this Mac. Pure rules only. See _specs/025-onboarding.
 *
 * A beat is a few bubbles said in a row. Its question, when it has one, is asked with the last bubble. A word
 * between backticks, such as `⌘,`, is drawn as a key.
 */

export const QUESTION_BEATS = ['q1', 'q2', 'q3', 'q4', 'q5'] as const
export type QuestionBeat = (typeof QUESTION_BEATS)[number]

export type BeatId =
  | 'hello'
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
}

/** What the user answered so far. */
export interface Answers {
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

export type Ask =
  /** Two bubbles, one each side of hobkin. */
  | { kind: 'choice'; field: 'computer' | 'more'; options: readonly [Option, Option] }
  /** A field at the bottom, in the middle. */
  | { kind: 'input'; field: InputField; type: 'text' | 'email'; placeholder: string; optional: boolean; suggestions?: readonly string[]; note?: string }
  /** One bubble that only goes on. Going on by key passes it too. */
  | { kind: 'go'; label: string }
  /** Install Pi and its packages, or put it off. */
  | { kind: 'pi' }
  /** Sign in to the subscription, or put it off. */
  | { kind: 'connect' }

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

function questionBeat(id: QuestionBeat, { computer }: Answers): Omit<Beat, 'id'> {
  const question = questionsFor(computer)[QUESTION_BEATS.indexOf(id)]!
  return {
    mood: 'listening',
    lines: [question.ask],
    ask: {
      kind: 'input',
      field: { kind: 'reply', question: question.id },
      type: 'text',
      placeholder: question.placeholder,
      optional: true,
      ...(question.suggestions ? { suggestions: question.suggestions } : {}),
    },
  }
}

/** A beat's words and question, for what was answered and what is on this Mac. */
export function beatOf(id: BeatId, answers: Answers, facts: Facts): Beat {
  return { id, ...wordsOf(id, answers, facts) }
}

function wordsOf(id: BeatId, answers: Answers, facts: Facts): Omit<Beat, 'id'> {
  switch (id) {
    case 'hello':
      return { mood: 'hello', lines: ["Hi there! I'm a hobkin.", 'Yes, all lowercase. Nice to meet you!'] }
    case 'computer':
      return {
        mood: 'listening',
        lines: ["I'm here to push your development to the next level.", 'First things first, is this your personal or work computer?'],
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
      return { mood: 'happy', lines: ['Fantastic! I need this so I can help you set up the next steps.'] }
    case 'name':
      return {
        mood: 'listening',
        lines: ['Talking about next steps, what is your name?'],
        ask: { kind: 'input', field: { kind: 'name' }, type: 'text', placeholder: 'Your name', optional: false },
      }
    case 'name-hi':
      return { mood: 'love', lines: [`Hi, ${answers.name ?? 'there'}!`] }
    case 'email':
      return {
        mood: 'listening',
        lines: ['Do you want to share your e-mail too?', 'I will use it for any MCP connections.'],
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
          "Perfect! I have many more questions, but first, let's continue.",
          'You need to add an existing subscription now. I run under Pi, and I also support Claude.',
          'I will not charge you a single cent for any of this.',
          'If you are already a user, I can detect it automatically. Otherwise I will help you set it up.',
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
        lines: ['I see you have no accounts, click here so we can start! For now I only support the OpenAI Codex subscription.'],
        ask: { kind: 'connect' },
      }
    case 'connected':
      return { mood: 'celebrating', lines: withClaude([CONNECTED], facts) }
    case 'no-account':
      return { mood: 'idle', lines: ["Okay. I can't answer until a model is connected, so the app will ask you again."] }
    case 'more':
      return {
        mood: 'thinking',
        lines: ['I can take you to the app right away.', 'Or give me a minute and five more questions, so I can build your first routines. What do you say?'],
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
      return questionBeat(id, answers)
    case 'questions-thanks':
      return { mood: 'love', lines: ["Thank you! I'll bring this to our chat and propose your first routines there."] }
    case 'settings':
      return {
        mood: 'wink',
        lines: ['I also have many custom settings! You will have the best by default.', 'If you want to change them at any time, just press `⌘,`'],
      }
    case 'tour':
      return { mood: 'happy', lines: ['Now come with me. Let me show you around.'] }
  }
}

/** An account Pi already reaches is found. With none, the setup offers its one sign-in. */
const accounts = (facts: Facts): BeatId => (facts.connected.length > 0 ? 'found' : 'connect')

/** The beat after one, or null when the story is over. Decided as the beat is left, from what is known then. */
export function beatAfter(id: BeatId, answers: Answers, facts: Facts): BeatId | null {
  switch (id) {
    case 'hello':
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
      return QUESTION_BEATS[QUESTION_BEATS.indexOf(id) + 1]!
    case 'q5':
      return 'questions-thanks'
    case 'questions-thanks':
      return 'settings'
    case 'settings':
      return 'tour'
    case 'tour':
      return null
  }
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
  // An install or a sign-in happens once, so nothing before it can be gone back to.
  const sealed = beat.ask?.kind === 'pi' || beat.ask?.kind === 'connect'
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
