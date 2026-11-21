/**
 * What the review panel tells, top to bottom, in its own words (spec 032): the overall risk beside the title, what the
 * change does, the same on every step, the units that need a look with the words their quick links ask hobkin, how
 * many questions are open, and where a note opens on the canvas. The step itself is told on the canvas, in its card,
 * never again here (the user, 2026-11-12: "step is just duplicating side bar", "Sidebar should be a constant
 * explanation of what this does. not long."). Nothing here draws, so all of it can be tested without a screen.
 */
import { riskFixWords, type AssessmentStatus, type ChangeAssessment, type Deploy, type Level, type RiskFix, type Unit } from '#shared/review/assessment.ts'
import type { Note } from '#shared/review/notes.ts'
import type { Review, ReviewLevel, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { changeDescription, riskBadge, unitInFocus } from '../reading/model.ts'
import { unitAsk } from './ask.ts'

/**
 * The badge beside the title, which is always there. `rated`: the review's one answer for the whole change, risky or
 * safe to deploy, why, what happened since the review before it, and whether anything is critical, with `again` while
 * it is reviewed once more, and `fix` for what hobkin does about a risky answer on its own change. `reviewing`: none yet,
 * how far along the first one is and what it is doing. `failed`: it stopped, and why. `none`: there is none.
 */
export type HeaderBadge =
  | { kind: 'rated'; deploy: Deploy; label: string; why: string; since: string | null; critical: boolean; again: string | null; fix?: HeaderFix }
  | { kind: 'reviewing'; label: string; percent: number | null; now: string | null }
  | { kind: 'failed'; label: string; reason: string }
  | { kind: 'none'; label: string }

/** What hobkin does about a risky answer on its own change, as the header says it, and the Action Item it opens once the change is the user's. */
export interface HeaderFix {
  state: RiskFix['state']
  words: string
  /** Waiting on the user: the Action Item that says what to do, or null for Action Items as a whole. */
  opens: { action: string | null } | null
}

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`
const percentOf = (status: AssessmentStatus | null | undefined) => (status?.state === 'running' && status.percent != null ? ` ${Math.round(status.percent)}%` : '')

function headerFix(fix: RiskFix): HeaderFix {
  return {
    state: fix.state,
    words: riskFixWords(fix),
    opens: fix.state === 'waiting' ? { action: fix.action ?? null } : null,
  }
}

export function headerBadge(assessment: Pick<ChangeAssessment, 'summary'> | null | undefined, status: AssessmentStatus | null | undefined): HeaderBadge {
  const badge = riskBadge(assessment, status)
  if (badge?.kind === 'rated') {
    const { deploy, label, why, since, critical, fix } = badge
    const again = badge.again ? `Reviewing again…${percentOf(status)}` : null
    return { kind: 'rated', deploy, label, why, since, critical, again, ...(fix ? { fix: headerFix(fix) } : {}) }
  }
  if (badge?.kind === 'rating') {
    const { percent } = badge
    return { kind: 'reviewing', label: `Reviewing…${percent != null ? ` ${percent}%` : ''}`, percent, now: badge.queued ? 'Waiting for its turn' : badge.now ? capitalized(badge.now) : null }
  }
  if (badge?.kind === 'failed') return { kind: 'failed', label: 'Review failed', reason: badge.error?.trim() || 'The change review stopped without saying why.' }
  return { kind: 'none', label: 'Not reviewed' }
}

/** The sentences of some words. A stop ends one only where a space follows it, and never inside code, so `amount.round(2)` stays whole. */
function sentencesOf(text: string): string[] {
  const words = text.trim().replace(/\s+/g, ' ')
  const sentences: string[] = []
  let code = false
  let start = 0
  for (let index = 0; index < words.length; index += 1) {
    const character = words[index]!
    if (character === '`') code = !code
    else if (!code && '.!?'.includes(character) && words[index + 1] === ' ') {
      sentences.push(words.slice(start, index + 1))
      start = index + 2
    }
  }
  if (start < words.length) sentences.push(words.slice(start))
  return sentences
}

/** The change review's working words, which are no explanation: "Floor rule 3: …", and a fact named as a field, "Effect: …". */
const WORKING = /^(?:floor rule \d+\b|(?:effect|proof|proven|exposure|runs for|undo|undone by):)/i
/** What the change does is said in this many sentences at most. */
const SENTENCES = 3

type NodeUnit = Pick<ReviewNode, 'id' | 'unit'>

/** The unit a step tells: the one it names, else the most worrying unit of its nodes. */
function unitOfStep(step: StoryStep, units: readonly Unit[] | null | undefined, nodes: readonly NodeUnit[]): Unit | undefined {
  if (!units?.length) return undefined
  const named = step.unit ? units.find((unit) => unit.id === step.unit) : undefined
  return named ?? unitInFocus(units, nodes.filter((node) => step.focus.includes(node.id)), null)
}

/** A unit that needs a look: its claim, its level, and where it is told, by the step's place in the story on screen or a node. */
export interface UnitMatter {
  key: string
  text: string
  level: Level
  critical: boolean
  step: number | null
  node: string | null
  /** What its quick link sends to hobkin. */
  asks: string
}

/**
 * What the panel says about the change under its header. `does`: what it does, the same for every step. `units`:
 * the high and mid units, each said in its claim. `questions`: how many the change leaves for the reviewer, which are
 * read on their steps, and the place in the story on screen of the step where the first is read.
 */
export interface WhatMatters {
  does: string | null
  units: UnitMatter[]
  questions: { count: number; step: number | null }
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
 * What the change does, in three sentences at most: the change review's own sentence, else the review's summary,
 * without the change review's working words. Then its high and mid units, the most worrying first and along the story
 * within a level, and its open questions: those of its units, else the spec's, which the closing step reads.
 */
export function whatMatters(
  review: Pick<Review, 'summary' | 'change' | 'spec'>,
  assessment: Pick<ChangeAssessment, 'story' | 'summary' | 'units'> | null | undefined,
  steps: readonly StoryStep[],
  nodes: readonly NodeUnit[],
): WhatMatters {
  const said = changeDescription(review, assessment)
  const does = said ? sentencesOf(said).filter((sentence) => !WORKING.test(sentence)).slice(0, SENTENCES).join(' ') || null : null
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
  // The same question from two units is one question.
  const asked = rated.flatMap((unit) => unit.questions.map((question) => ({ text: question.text.trim(), unit: unit.id })))
  const distinct = asked.filter((question, index) => asked.findIndex((other) => other.text === question.text) === index)
  const closing = steps.findIndex((step) => step.kind === 'closing')
  const open = review.spec?.openQuestions.length ?? 0
  const questions = rated.length
    ? { count: distinct.length, step: distinct[0] ? stepOfUnit(distinct[0].unit, steps, nodes) : null }
    : { count: open, step: open > 0 && closing >= 0 ? closing : null }
  return { does, units, questions }
}

/** A title short enough to sit inside an example. */
const SHORT = 32

/**
 * A concrete example of what to ask hobkin about the step on screen, for the box: the question its unit leaves, else
 * why it has its level, else one about the node the reviewer is on, by its kind.
 */
export function askExample(step: StoryStep | undefined, units: readonly Unit[] | null | undefined, nodes: readonly NodeUnit[], on: Pick<ReviewNode, 'title' | 'kind'> | undefined): string {
  const unit = step ? unitOfStep(step, units, nodes) : undefined
  const question = unit?.questions[0]?.text.trim()
  if (question && question.length <= 110) return question
  const level: ReviewLevel | undefined = unit?.level ?? step?.level
  if (level) return level === 'high' ? 'What breaks in this step, and how would I see it?' : 'What does this step change, and is it tested?'
  switch (on?.kind) {
    case 'test':
      return 'What does this test prove, and what does it miss?'
    case 'criterion':
      return 'Which test proves this, and is it enough?'
    case 'context':
      return 'Why does this unchanged code matter here?'
    case 'code':
    case 'file':
      return on.title.length <= SHORT ? `What does ${on.title} do, and what calls it?` : `What does this ${on.kind} do, and what calls it?`
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
