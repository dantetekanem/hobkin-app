/**
 * The Review screen's story view (spec 032): the change review of a finished change, read top to bottom, with the graph
 * one key away. Which view a review opens on, the units as the story numbers them, and what the panel says about the
 * unit in focus. Nothing here draws, so all of it can be tested without a screen.
 */
import type { AssessmentStatus, ChangeAssessment, Level, Unit } from '#shared/review/assessment.ts'
import type { StepUnit } from '../panel/Matters.tsx'

/** The story of the change review, read top to bottom, or the graph of the change. */
export type ReviewMode = 'story' | 'graph'

/**
 * Whether the review has a story to read: one is ready, one is on its way (its progress shows meanwhile), or one failed
 * and can be run again. A pull request has none, and neither does a change none is coming for.
 */
export function hasStory(assessment: ChangeAssessment | null | undefined, status: AssessmentStatus | null | undefined): boolean {
  if (assessment) return true
  return status?.state === 'queued' || status?.state === 'running' || status?.state === 'failed'
}

/** The view a review opens on: the story when there is one, the graph when none is coming. */
export function openingMode(assessment: ChangeAssessment | null | undefined, status: AssessmentStatus | null | undefined): ReviewMode {
  return hasStory(assessment, status) ? 'story' : 'graph'
}

const ORDER: Level[] = ['high', 'mid', 'safe']
const RANK: Record<Level, number> = { safe: 0, mid: 1, high: 2 }

/** The units as the story numbers them: high first, then mid, then safe, each in the order the review gave. */
export function numberedUnits(units: readonly Unit[]): Unit[] {
  return ORDER.flatMap((level) => units.filter((unit) => unit.level === level))
}

export interface UnitHeading {
  number: number
  title: string
  level: Level
  critical: boolean
}

const HEADING = /^(\d+)\.\s+(.+?)\s+\((high|mid|safe)(, critical)?\)$/

/** A unit's heading as the story writes it, `N. Title (level[, critical])`. Null for any other heading. */
export function readUnitHeading(text: string): UnitHeading | null {
  const found = HEADING.exec(text.trim())
  return found ? { number: Number(found[1]), title: found[2]!, level: found[3] as Level, critical: Boolean(found[4]) } : null
}

/** The unit a heading tells: by the number the story gave it, or else by its title. */
export function unitOfHeading(units: readonly Unit[], heading: UnitHeading): Unit | undefined {
  const byNumber = numberedUnits(units)[heading.number - 1]
  if (byNumber && byNumber.level === heading.level) return byNumber
  return units.find((unit) => unit.title === heading.title)
}

/** One fact in a line: its value, then the evidence for it. */
const factText = (fact: { value: string; evidence: string }) => (fact.evidence ? `${fact.value}. ${fact.evidence.charAt(0).toUpperCase()}${fact.evidence.slice(1).replace(/\.+$/, '')}.` : fact.value)

/** What the panel says about a unit: its level, the four facts, why this level, what would change it, its questions. */
export function toStepUnit(unit: Unit): StepUnit {
  return {
    title: unit.title,
    level: unit.level,
    critical: unit.critical,
    facts: [
      { name: 'Does', text: factText(unit.facts.effect) },
      { name: 'Proven', text: factText(unit.facts.proof) },
      { name: 'Runs for', text: factText(unit.facts.exposure) },
      { name: 'Undone by', text: factText(unit.facts.undo) },
    ],
    why: unit.why_level,
    wouldChange: unit.would_change,
    questions: unit.questions.map(({ text, why }) => ({ text, why })),
  }
}

/** The unit of what is in focus: the node the reviewer points at, else the most worrying of the focus. */
export function unitInFocus(units: readonly Unit[] | null | undefined, nodes: readonly { id: string; unit?: string }[], pointed: string | null): Unit | undefined {
  if (!units?.length) return undefined
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const of = (node: { unit?: string } | undefined) => (node?.unit ? byId.get(node.unit) : undefined)
  const chosen = of(nodes.find((node) => node.id === pointed))
  if (chosen) return chosen
  return nodes
    .map(of)
    .filter((unit): unit is Unit => unit != null)
    .reduce<Unit | undefined>((worst, unit) => (!worst || RANK[unit.level] > RANK[worst.level] ? unit : worst), undefined)
}
