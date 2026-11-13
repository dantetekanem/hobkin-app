import type { ComputerKind } from '#shared/protocol/setup.ts'

/**
 * The five questions hobkin asks when the user wants their first routines built, by whose computer this is, the
 * message that hands the answers to hobkin in the chat, and when main hobkin's own questions after them are over.
 * See _specs/025-onboarding.
 */

/** What every question has. Its id is kept with the answer, so it never changes once people have answered it. */
interface Asked {
  id: string
  ask: string
}

/**
 * A question hobkin asks for the first routines, by how it is answered: a folder that is typed, the projects found
 * in that folder to pick from, a list of things to pick from, or a yes or a no.
 */
export type Question =
  | (Asked & { kind: 'folder'; placeholder: string; suggestions: readonly string[] })
  /** `in` is the id of the question whose answer is the folder to look in. */
  | (Asked & { kind: 'projects'; in: string })
  | (Asked & { kind: 'pick'; options: readonly string[] })
  /** `yes` and `no` are the words on the two bubbles, and the answer that is kept. */
  | (Asked & { kind: 'yes'; yes: string; no: string })

/** Where projects usually live, for a folder that was never said. */
export const USUAL_FOLDER = '~/Projects'

const WHERE_PROJECTS_LIVE: Question = {
  id: 'projects-folder',
  ask: 'Where do your projects live? Give me the folder.',
  kind: 'folder',
  placeholder: USUAL_FOLDER,
  suggestions: ['~/Projects', '~/Developer', '~/Code', '~/src'],
}

export const QUESTIONS: Record<ComputerKind, readonly Question[]> = {
  // A computer of one's own, as the user runs hobkin: projects in a folder, which ones to run, how work is proven,
  // what to check, and what may be read for context.
  personal: [
    WHERE_PROJECTS_LIVE,
    { id: 'projects', ask: 'Which ones should I run? Pick as many as you like.', kind: 'projects', in: 'projects-folder' },
    {
      id: 'validation',
      ask: 'Should I set up validation for them? That is what I run before I call work done.',
      kind: 'yes',
      yes: 'Set it up',
      no: 'Later',
    },
    {
      id: 'check',
      ask: "What should I check for you, so you don't have to remember?",
      kind: 'pick',
      options: ['Email', 'Calendar', 'Bills', 'Birthdays', 'Pull requests'],
    },
    { id: 'logs', ask: 'May I read your logs and past sessions to get context?', kind: 'yes', yes: 'Yes', no: 'No' },
  ],
  // A computer for a job: the projects, how the team works, its board, its tools, and what to watch.
  work: [
    WHERE_PROJECTS_LIVE,
    { id: 'projects', ask: 'Which ones are yours to work on? Pick as many as you like.', kind: 'projects', in: 'projects-folder' },
    {
      id: 'team',
      ask: 'How does your team work?',
      kind: 'pick',
      options: ['Pull requests', 'Code review', 'CI must pass', 'Staging first', 'Feature flags'],
    },
    { id: 'board', ask: 'Is there a board I should follow?', kind: 'pick', options: ['Linear', 'Jira', 'GitHub', 'Notion', 'None'] },
    {
      id: 'tools',
      ask: 'Which MCPs or local tools should I connect?',
      kind: 'pick',
      options: ['Slack', 'Sentry', 'Datadog', 'GitHub', 'Figma', 'Postgres'],
    },
    {
      id: 'watch',
      ask: 'What should I watch every day?',
      kind: 'pick',
      options: ['Review queue', 'Failing builds', 'Mentions', 'Alerts'],
    },
  ],
}

/** Made-up projects for a browser tab on sample data, which has no folder to look in. More than fit at once, so the filter has something to do. */
export const SAMPLE_PROJECTS: readonly string[] = [
  'my-blog', 'dotfiles', 'recipes', 'home-server', 'cli-tools', 'budget', 'notes', 'garden-sensors', 'photo-wall', 'reading-list',
  'weather-station', 'chess-bot', 'pixel-editor', 'synth', 'trail-maps', 'bookmarks', 'habit-tracker', 'ledger', 'wiki', 'tiny-db',
  'ray-tracer', 'feed-reader', 'card-game', 'api-gateway', 'landing-page', 'design-system', 'docs', 'mobile-app', 'scraper', 'bot',
  'journal', 'timers', 'door-bell', 'plant-care', 'movie-night', 'gift-list', 'run-log', 'pantry', 'tax-helper', 'resume',
  'talks', 'workshop', 'playground', 'sandbox', 'experiments', 'archive', 'backup-scripts', 'fonts', 'icons', 'keyboard',
  'laser-maze', 'lunar-lander', 'music-box', 'night-light', 'origami', 'postcards',
]

/** The questions for a computer. Personal when the kind was never said. */
export const questionsFor = (computer: ComputerKind | undefined): readonly Question[] => QUESTIONS[computer ?? 'personal']

const partsOf = (written: string): string[] => written.split(',').map((part) => part.trim()).filter(Boolean)
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/** The suggestions that are in what is written, however they were typed. */
export function pickedSuggestions(written: string, suggestions: readonly string[]): string[] {
  const parts = partsOf(written)
  return suggestions.filter((suggestion) => parts.some((part) => same(part, suggestion)))
}

/** Picking a suggestion adds it to what is written, after a comma. Picking one that is there takes it out. */
export function toggleSuggestion(written: string, suggestion: string): string {
  const parts = partsOf(written)
  const kept = parts.filter((part) => !same(part, suggestion))
  return (kept.length < parts.length ? kept : [...parts, suggestion]).join(', ')
}

interface Answered {
  computer?: ComputerKind
  more?: boolean
  replies: Readonly<Record<string, string | undefined>>
}

/** Each question that was answered, with its answer under it. */
function answeredOf(kind: ComputerKind, replies: Answered['replies']): string[] {
  return questionsFor(kind).flatMap((question) => {
    const reply = replies[question.id]?.trim()
    return reply ? [`- ${question.ask}\n  ${reply}`] : []
  })
}

const PROPOSE = 'Propose two or three first routines that fit this, with one line each on why. Ask before you create or connect anything.'

/**
 * What goes to hobkin in the chat once the setup ends: each question that was answered, with its answer, and what
 * to do with them. Null when the user did not want the questions or answered none, so nothing is sent.
 */
export function routinesRequest({ computer, more, replies }: Answered): string | null {
  if (!more) return null
  const kind = computer ?? 'personal'
  const told = answeredOf(kind, replies)
  if (!told.length) return null

  return [`I just finished the setup. This is my ${kind} computer. Here is what I answered there:`, ...told, PROPOSE].join('\n')
}

/** The most questions main hobkin asks in the setup, after the fixed ones. */
export const FOLLOW_UPS_MAX = 5

/**
 * The message that starts main hobkin's own questions, once a real model can ask them: what the setup knows, and
 * what to do with it. It replaces the routines message, so it goes even with nothing answered.
 */
export function followUpRequest({ computer, replies }: Answered): string {
  const kind = computer ?? 'personal'
  const told = answeredOf(kind, replies)
  const known = told.length
    ? [`I'm in the setup. This is my ${kind} computer. Here is what I answered there:`, ...told]
    : [`I'm in the setup. This is my ${kind} computer. I skipped its questions.`]

  return [
    ...known,
    `Now ask me what else you need to know to build my first routines. Ask one question at a time with your ask_question tool, and give me choices wherever you can. Ask at most ${FOLLOW_UPS_MAX} questions, fewer if you know enough.`,
    `Then, here in the chat: ${PROPOSE}`,
  ].join('\n')
}

/** How long main hobkin gets to start on the message, and how long it may go without asking, in milliseconds. */
export const FOLLOW_UPS_WAIT = { startMs: 5_000, quietMs: 120_000 }

/** Where main hobkin's questions stand, as plain values. Times are in milliseconds. */
export interface FollowUps {
  /** When the host took the message that starts them. Null while it is on its way, or when it failed. */
  takenAt: number | null
  /** The message could not be sent. */
  failed: boolean
  /** Main hobkin is working. */
  busy: boolean
  /** Main hobkin has a question open. */
  open: boolean
  /** How many of its questions were answered. */
  answered: number
  /** The user said it is enough. */
  enough: boolean
  /** When the message was sent, or a question last came or went, whichever is later. */
  stirredAt: number
}

/**
 * Whether main hobkin's questions are over, so the story goes on: the user said it is enough, the message did not
 * go, enough were answered, nothing was asked for two minutes, or hobkin stopped working with nothing open.
 */
export function followUpsOver(state: FollowUps, now: number): boolean {
  if (state.enough || state.failed || state.answered >= FOLLOW_UPS_MAX) return true
  // An open question waits for the user, however long they take.
  if (state.open) return false
  if (now - state.stirredAt >= FOLLOW_UPS_WAIT.quietMs) return true
  if (state.takenAt === null) return false
  // Right after the message is taken hobkin may not be working yet, so idle only counts after a few seconds.
  return !state.busy && now - state.takenAt >= FOLLOW_UPS_WAIT.startMs
}
