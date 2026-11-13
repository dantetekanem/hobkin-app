import type { ComputerKind } from '#shared/protocol/setup.ts'

/**
 * The five questions hobkin asks when the user wants their first routines built, by whose computer this is, and
 * the message that hands the answers to hobkin in the chat. See _specs/025-onboarding.
 */

export interface Question {
  /** Kept with the answer. It never changes once people have answered it. */
  id: string
  ask: string
  placeholder: string
  /** Common answers, to pick instead of typing. Picking one adds it to what is written. */
  suggestions?: readonly string[]
}

export const QUESTIONS: Record<ComputerKind, readonly Question[]> = {
  // A computer of one's own: projects in a folder, and a life to keep on top of.
  personal: [
    {
      id: 'projects-folder',
      ask: "Where do your projects live? Give me the folder and I'll look for what I can work on.",
      placeholder: '~/Projects',
      suggestions: ['~/Projects', '~/Developer', '~/Code', '~/src'],
    },
    {
      id: 'projects-mine',
      ask: 'Which of them should I work on by myself, and which should I leave alone?',
      placeholder: 'Work on my blog and my CLI. Leave client work alone.',
    },
    {
      id: 'validation',
      ask: 'How do I prove my work before I call it done?',
      placeholder: 'Run the tests and the type check',
      suggestions: ['Run the tests', 'Type check', 'Lint', 'Build it', 'Open a pull request'],
    },
    {
      id: 'watch',
      ask: "What should I keep an eye on, so you don't have to remember to check?",
      placeholder: 'Email from my accountant, bills, birthdays',
      suggestions: ['Email', 'Calendar', 'Pull requests', 'Bills', 'Birthdays'],
    },
    {
      id: 'context',
      ask: 'Where can I read to understand your days? Logs, notes, past sessions.',
      placeholder: 'My notes folder and my Pi sessions',
      suggestions: ['My notes', 'Pi sessions', 'Claude Code sessions', 'App logs'],
    },
  ],
  // A computer for a job: a team, a board, a way of shipping, and tools that are already there.
  work: [
    {
      id: 'team',
      ask: 'What does your team build, and what is your part in it?',
      placeholder: 'The payments API. I own billing.',
    },
    {
      id: 'board',
      ask: 'Where is the work tracked? Is there a board I should read first?',
      placeholder: 'Linear, the Platform team board',
      suggestions: ['Linear', 'Jira', 'GitHub Issues', 'GitHub Projects', 'Notion'],
    },
    {
      id: 'shipping',
      ask: 'How does a change ship here, from a branch to production?',
      placeholder: 'A pull request, one review, CI green, then deploy',
      suggestions: ['Pull requests', 'Code review', 'CI must pass', 'Staging first', 'Feature flags'],
    },
    {
      id: 'tools',
      ask: 'Which tools should I connect to? MCP servers or command-line tools you already use.',
      placeholder: 'Slack, Sentry and the gh CLI',
      suggestions: ['Slack', 'Sentry', 'Datadog', 'GitHub', 'Figma'],
    },
    {
      id: 'watch',
      ask: 'What should I watch every day, so nothing slips?',
      placeholder: 'My review queue and failing builds',
      suggestions: ['My review queue', 'Failing builds', 'Mentions', 'On-call alerts'],
    },
  ],
}

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

/**
 * What goes to hobkin in the chat once the setup ends: each question that was answered, with its answer, and what
 * to do with them. Null when the user did not want the questions or answered none, so nothing is sent.
 */
export function routinesRequest({ computer, more, replies }: Answered): string | null {
  if (!more) return null
  const kind = computer ?? 'personal'
  const told = questionsFor(kind).flatMap((question) => {
    const reply = replies[question.id]?.trim()
    return reply ? [`- ${question.ask}\n  ${reply}`] : []
  })
  if (!told.length) return null

  return [
    `I just finished the setup. This is my ${kind} computer. Here is what I answered there:`,
    ...told,
    'Propose two or three first routines that fit this, with one line each on why. Ask before you create or connect anything.',
  ].join('\n')
}
