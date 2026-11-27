import { QUESTIONS, type Question } from './questions.ts'

/**
 * What the person is working toward, asked right after the sound question: the goals, their bubbles and the words
 * hobkin says about them, the question each goal asks, and when whose computer this is matters. Pure rules only.
 * See _specs/044-goal-first-setup.
 */

/** The goals, in the order their questions are asked and their cards are shown. hobkin's runtime has the same list (`TEMPLATE_GOALS`). */
export const GOALS = ['job', 'business', 'project', 'life', 'code'] as const
export type Goal = (typeof GOALS)[number]

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

/** A question answered in the person's own words, in a field. Its id is kept with the answer, so it never changes. */
export interface TypedQuestion {
  kind: 'typed'
  id: string
  ask: string
  placeholder: string
}

export type GoalQuestion = TypedQuestion | Question

const TYPED: Partial<Record<Goal, TypedQuestion>> = {
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

/** Code asks 025's own questions, as they were: where the projects live, which ones, and validation. */
const CODE_QUESTION_IDS = ['projects-folder', 'projects', 'validation']
const CODE_QUESTIONS: readonly Question[] = CODE_QUESTION_IDS.flatMap((id) => QUESTIONS.personal.filter((question) => question.id === id))

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
