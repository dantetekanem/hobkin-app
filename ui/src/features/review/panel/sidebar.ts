/**
 * What the review panel tells, top to bottom, in its own words (spec 032): the overall risk beside the title, the step
 * the reviewer is on, and what matters in the change, each with the words its quick link asks hobkin, and where a note
 * opens on the canvas. Nothing here draws, so all of it can be tested without a screen.
 */
import type { AssessmentStatus, ChangeAssessment, Level, Unit } from '#shared/review/assessment.ts'
import type { Note } from '#shared/review/notes.ts'
import type { Review, ReviewLevel, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { changeDescription, RISK_WORDS, riskBadge, unitInFocus } from '../reading/model.ts'
import { claimAsk, questionAsk, unitAsk } from './ask.ts'

/**
 * The badge beside the title, which is always there. `rated`: the change review's level, whether anything is
 * critical, and how many units sit at each level, with `again` while it is reviewed once more. `reviewing`: none yet,
 * how far along the first one is and what it is doing. `failed`: it stopped, and why. `none`: there is none.
 */
export type HeaderBadge =
  | { kind: 'rated'; level: Level; label: string; critical: boolean; counts: Record<Level, number>; again: string | null }
  | { kind: 'reviewing'; label: string; percent: number | null; now: string | null }
  | { kind: 'failed'; label: string; reason: string }
  | { kind: 'none'; label: string }

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`
const percentOf = (status: AssessmentStatus | null | undefined) => (status?.state === 'running' && status.percent != null ? ` ${Math.round(status.percent)}%` : '')

export function headerBadge(assessment: Pick<ChangeAssessment, 'summary'> | null | undefined, status: AssessmentStatus | null | undefined): HeaderBadge {
  const badge = riskBadge(assessment, status)
  if (badge?.kind === 'rated') {
    const { level, label, critical, counts } = badge
    return { kind: 'rated', level, label, critical, counts, again: badge.again ? `Reviewing again…${percentOf(status)}` : null }
  }
  if (badge?.kind === 'rating') {
    const { percent } = badge
    return { kind: 'reviewing', label: `Reviewing…${percent != null ? ` ${percent}%` : ''}`, percent, now: badge.queued ? 'Waiting for its turn' : badge.now ? capitalized(badge.now) : null }
  }
  if (badge?.kind === 'failed') return { kind: 'failed', label: 'Review failed', reason: badge.error?.trim() || 'The change review stopped without saying why.' }
  return { kind: 'none', label: 'Not reviewed' }
}

/**
 * The first sentences of some words, at most `count`. A stop ends a sentence only where a space follows it, and never
 * inside code, so `amount.round(2)` stays whole.
 */
function firstSentences(text: string | undefined, count: number): string | null {
  const words = text?.trim()
  if (!words) return null
  let code = false
  let found = 0
  for (let index = 0; index < words.length; index += 1) {
    const character = words[index]!
    if (character === '`') code = !code
    else if (!code && '.!?'.includes(character) && /\s/.test(words[index + 1] ?? '')) {
      found += 1
      if (found === count) return words.slice(0, index + 1)
    }
  }
  return words
}

type NodeUnit = Pick<ReviewNode, 'id' | 'unit'>

/** The unit a step tells: the one it names, else the most worrying unit of its nodes. */
function unitOfStep(step: StoryStep, units: readonly Unit[] | null | undefined, nodes: readonly NodeUnit[]): Unit | undefined {
  if (!units?.length) return undefined
  const named = step.unit ? units.find((unit) => unit.id === step.unit) : undefined
  return named ?? unitInFocus(units, nodes.filter((node) => step.focus.includes(node.id)), null)
}

/** The step the reviewer is on, as the panel tells it. */
export interface StepBrief {
  /** Its place in the story on screen, from 0, and how many steps that story has. */
  index: number
  total: number
  /** The claim of the unit it tells, else the step's own title. */
  title: string
  /** What changed, in a sentence or two: the unit's own words, else the start of the step's. */
  what: string | null
  level: ReviewLevel | null
  critical: boolean
  /** The change review's unit it tells, once one is ready. */
  unit: Unit | null
}

/** The step at `index` of the story on screen (`session.view.story`, which can fold steps together). Null past its end. */
export function stepBrief(steps: readonly StoryStep[], index: number, units: readonly Unit[] | null | undefined, nodes: readonly NodeUnit[]): StepBrief | null {
  const step = steps[index]
  if (!step) return null
  const unit = unitOfStep(step, units, nodes)
  return {
    index,
    total: steps.length,
    title: unit?.title || step.title,
    what: firstSentences(unit?.what || step.text, 2),
    level: unit?.level ?? step.level ?? null,
    critical: unit?.critical ?? false,
    unit: unit ?? null,
  }
}

/** One thing that matters, and what its quick link sends to hobkin. */
export interface Matter {
  key: string
  text: string
  asks: string
}

/** A unit that needs a look: its level, and where it is told, by the step's place in the story on screen or a node. */
export interface UnitMatter extends Matter {
  level: Level
  critical: boolean
  step: number | null
  node: string | null
}

/** A question for the reviewer: why the code cannot answer it, and the claim of the unit it belongs to. */
export interface QuestionMatter extends Matter {
  why: string | null
  about: string | null
}

export interface WhatMatters {
  claim: Matter | null
  units: UnitMatter[]
  questions: QuestionMatter[]
}

const RANK: Record<Level, number> = { high: 0, mid: 1, safe: 2 }

/** The step that tells a unit: the one that names it, else the first whose focus holds a node it rates. */
function stepOfUnit(id: string, steps: readonly StoryStep[], nodes: readonly NodeUnit[]): number | null {
  const named = steps.findIndex((step) => step.unit === id)
  if (named >= 0) return named
  const rated = new Set(nodes.filter((node) => node.unit === id).map((node) => node.id))
  const shown = steps.findIndex((step) => step.focus.some((node) => rated.has(node)))
  return shown >= 0 ? shown : null
}

/**
 * What matters in the change, for "What matters": what it says it does, then its high and mid units, the most worrying
 * first and along the story within a level, then the questions those units leave for the reviewer. Before a change
 * review, the questions are the spec's open ones, asked as they are written.
 */
export function whatMatters(
  review: Pick<Review, 'summary' | 'change' | 'spec'>,
  assessment: Pick<ChangeAssessment, 'story' | 'summary' | 'units'> | null | undefined,
  steps: readonly StoryStep[],
  nodes: readonly NodeUnit[],
): WhatMatters {
  const does = changeDescription(review, assessment)
  const rated = [...(assessment?.units?.units ?? [])].sort((a, b) => RANK[a.level] - RANK[b.level] || a.story_order - b.story_order)
  const units = rated
    .filter((unit) => unit.level !== 'safe')
    .map((unit): UnitMatter => ({
      key: unit.id,
      text: unit.title,
      level: unit.level,
      critical: unit.critical,
      step: stepOfUnit(unit.id, steps, nodes),
      node: nodes.find((node) => node.unit === unit.id)?.id ?? null,
      asks: unitAsk(unit),
    }))
  const asked = rated.length
    ? rated.flatMap((unit) => unit.questions.map((question, index): QuestionMatter => ({ key: `${unit.id}:${index}`, text: question.text, why: question.why || null, about: unit.title || null, asks: questionAsk(unit, question) })))
    : (review.spec?.openQuestions ?? []).map((text, index): QuestionMatter => ({ key: `open:${index}`, text, why: null, about: null, asks: text }))
  // The same question from two units is asked once.
  const questions = asked.filter((question, index) => asked.findIndex((other) => other.text === question.text) === index)
  return { claim: does ? { key: 'claim', text: does, asks: claimAsk() } : null, units, questions }
}

/** A title short enough to sit inside an example. */
const SHORT = 32

/**
 * A concrete example of what to ask hobkin about the step, for the box: the question the step's unit leaves, else why
 * the step has its level, else one about its node, by its kind.
 */
export function askExample(brief: StepBrief | null, node: Pick<ReviewNode, 'title' | 'kind'> | undefined): string {
  const question = brief?.unit?.questions[0]?.text.trim()
  if (question && question.length <= 110) return question
  if (brief?.level) return `Why is this step ${RISK_WORDS[brief.level].toLowerCase()}?`
  switch (node?.kind) {
    case 'test':
      return 'What does this test prove, and what does it miss?'
    case 'criterion':
      return 'Which test proves this, and is it enough?'
    case 'context':
      return 'Why does this unchanged code matter here?'
    case 'code':
    case 'file':
      return node.title.length <= SHORT ? `What does ${node.title} do, and what calls it?` : `What does this ${node.kind} do, and what calls it?`
    default:
      return 'What does this step change, and how is it tested?'
  }
}

/** Where the canvas lists the notes beside what they are about (`session.showNotes`): a node, or a step by its place. */
export type NotesPlace = { node: string } | { step: number }

/**
 * Where a note opens on the canvas: beside the node it is about, or the node whose lines it is on, else on its step,
 * by its place in the story on screen. `nodes` are the nodes on screen: a node that is not one, such as a test folded
 * into a group, opens on its step. A wire is between two nodes, so a note on one opens on its step too. Null for a
 * step the story on screen no longer has.
 */
export function noteShown(nodes: readonly ReviewNode[], note: Pick<Note, 'step' | 'target'>, steps: readonly Pick<StoryStep, 'id' | 'focus'>[]): NotesPlace | null {
  const { target } = note
  if (target.kind === 'node' && nodes.some((node) => node.id === target.node)) return { node: target.node }
  const at = steps.findIndex((step) => step.id === note.step)
  if (target.kind === 'lines') {
    const inStep = new Set(at >= 0 ? steps[at]!.focus : [])
    const holds = (node: ReviewNode) =>
      node.anchors.some((anchor) => anchor.fileId === target.fileId && anchor.side === target.side && anchor.startLine <= target.endLine && target.startLine <= anchor.endLine)
    const owner = nodes.find((node) => inStep.has(node.id) && holds(node)) ?? nodes.find(holds)
    if (owner) return { node: owner.id }
  }
  return at >= 0 ? { step: at } : null
}
