import { GOALS, type ComputerKind, type Goal, type ProjectFolder, type SetupAnswer, type SetupAnswers, type SetupCardPick } from '#shared/protocol/setup.ts'
import { CODE_QUESTIONS, type Question } from './questions.ts'

/**
 * What the person is working toward, asked right after the sound question: the goals, their bubbles and the words
 * hobkin says about them, the question each goal asks, and when whose computer this is matters. Pure rules only.
 * See _specs/044-goal-first-setup.
 */

/** The goals, in the order their questions are asked and their cards are shown, as the setup protocol lists them. */
export { GOALS, type Goal }

interface GoalWords {
  /** Its bubble in the goals question. */
  bubble: string
  /** How hobkin names it when it says the goals back. */
  said: string
  /** How the cards for it are introduced, after "For" or "And". */
  cards: string
}

export const GOAL_WORDS: Record<Goal, GoalWords> = {
  job: { bubble: 'Finding a job', said: 'a new job', cards: 'for your job search' },
  business: { bubble: 'Starting a business', said: 'a business', cards: 'for your business' },
  project: { bubble: 'A project of my own', said: 'a project', cards: 'for your project' },
  life: { bubble: 'Keeping life in order', said: 'keeping life in order', cards: 'to keep life in order' },
  code: { bubble: 'Writing code', said: 'writing code', cards: 'for your code' },
}

/** The bubbles of the goals question, in the goals' order. */
export const GOAL_BUBBLES: readonly string[] = GOALS.map((goal) => GOAL_WORDS[goal].bubble)

export interface GoalsPicked {
  /** In the goals' order, whatever order they were picked in. */
  goals: Goal[]
  /** Bubbles of the person's own words. They count as a project. */
  own: string[]
}

/** The goals for what was picked in the cloud: each goal's bubble, and the person's own words, which count as a project. */
export function goalsOf(picked: readonly string[]): GoalsPicked {
  const own = picked.filter((label) => !GOAL_BUBBLES.includes(label))
  const named = new Set(GOALS.filter((goal) => picked.includes(GOAL_WORDS[goal].bubble)))
  if (own.length) named.add('project')

  return { goals: GOALS.filter((goal) => named.has(goal)), own }
}

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const capital = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`

/** What hobkin says back once the goals are picked, in one bubble. */
export function goalsSaid(goals: readonly Goal[]): string {
  if (!goals.length) return "That's fine. You can tell me later."
  const named = capital(listed(goals.map((goal) => GOAL_WORDS[goal].said)))
  // A long list is said with a short ending, so the bubble stays one glance long.
  if (goals.length > 2) return `${named}. Got it.`
  return `${named}. Got it. I'll come back to ${goals.length === 1 ? 'that' : 'those'} in a minute.`
}

/** The goals whose routines read the person's own mail, money, calendar or health. */
const PRIVATE_GOALS: readonly Goal[] = ['job', 'business', 'life']

/** Whose computer this is is asked only when a goal was picked whose routines read the person's own accounts. */
export const asksComputer = (goals: readonly Goal[]): boolean => goals.some((goal) => PRIVATE_GOALS.includes(goal))

/** The email question's second bubble: commits count only for someone who writes code. */
export function emailWhy(goals: readonly Goal[]): string {
  const whose = goals.includes('code') ? 'commits, mail and accounts' : 'mail and accounts'
  return `It tells me which ${whose} are yours, and which are someone else's.`
}

/** A goal's question: one typed in the person's own words, or code's, as 025 asked them. */
export type GoalQuestion = Question

const TYPED: Partial<Record<Goal, Question>> = {
  job: {
    kind: 'typed',
    id: 'job',
    ask: 'What kind of job are you after, and where? Name the companies or job boards I should watch, if you have some.',
    placeholder: 'A role, a place, companies or job boards',
  },
  business: {
    kind: 'typed',
    id: 'business',
    ask: 'Tell me about the business in a line. What do you sell, and to whom?',
    placeholder: 'What you sell, and to whom',
  },
  project: {
    kind: 'typed',
    id: 'project',
    ask: "What's the project, and is there a date it has to be done by?",
    placeholder: 'The project, and its date',
  },
}

/** The questions of the goals picked, in the goals' order. Life asks none: its cards are clear enough. */
export function goalQuestions(goals: readonly Goal[]): GoalQuestion[] {
  const picked = GOALS.filter((goal) => goals.includes(goal))

  return picked.flatMap((goal): GoalQuestion[] => {
    if (goal === 'code') return [...CODE_QUESTIONS]
    const typed = TYPED[goal]
    return typed ? [typed] : []
  })
}

/** The person's own words for a goal start the project question's answer. */
export const projectStart = (own: readonly string[]): string => own.join(', ')

type Replies = Readonly<Record<string, string | undefined>>

/** Each goal question that was answered, with the words it was asked with. */
export function goalAnswersOf(goals: readonly Goal[], replies: Replies): SetupAnswer[] {
  return goalQuestions(goals).flatMap(({ id, ask }) => {
    const answer = replies[id]?.trim()
    return answer ? [{ id, ask, answer }] : []
  })
}

/** Projects were picked for code, so there is something to put in Work and to check. */
export const projectsPicked = (goals: readonly Goal[], replies: Replies): boolean =>
  goals.includes('code') && Boolean(replies.projects?.trim())

/** Code's validation was said yes to with projects picked, so hobkin proposes each project its checks. */
export function checksWanted(goals: readonly Goal[], replies: Replies): boolean {
  const validation = CODE_QUESTIONS.find(({ id }) => id === 'validation')
  const yes = validation?.kind === 'yes' && replies.validation?.trim() === validation.yes
  return projectsPicked(goals, replies) && yes
}

interface Picked {
  computer?: ComputerKind
  goals?: readonly Goal[]
  replies: Replies
}

/**
 * What the setup saves after each answer (`setup.save`): whose computer this is, the goals, each answered goal question
 * with its words, the projects picked by path, and the cards kept or turned down. hobkin keeps them in front of its
 * directions from then on.
 */
export function setupAnswersOf({ computer, goals = [], replies }: Picked, projects: readonly ProjectFolder[], cards: readonly SetupCardPick[]): SetupAnswers {
  return {
    ...(computer ? { computer } : {}),
    answers: goalAnswersOf(goals, replies),
    projects: projectsPicked(goals, replies) ? [...projects] : [],
    goals: [...goals],
    cards: [...cards],
  }
}
