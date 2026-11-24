/**
 * The user's questions in every review (spec 058 A11): five ratings from 1 to 10 the Reviewer gives in its one answer,
 * held to what the review measured. A rating says how well a question is answered, never how risky the change is, so
 * it sets no level and no fact; and no level sets a rating, except through the caps here, each said in the score's
 * evidence when it bites.
 */
import { isTestPath } from './triage.ts'
import { changesOnlyModels, isModelFile, modelsOf } from './tla.ts'
import type { Answered, ChangedFile, ModelCheck, NeedCriterion, NeedScore, ReviewNeeds, ReviewNode } from './types.ts'

/** What the caps read, as the review measured it. */
export interface NeedsFacts {
  /** Changed definitions no test that ran proves, by name. */
  unproven: string[]
  /** How many changed definitions a test that ran proves. */
  proven: number
  /** Test files the change adds or edits. */
  testsChanged: number
  /** Parts that are high. */
  high: string[]
  /** Parts nothing undoes. */
  undoNone: string[]
  /** Parts that write data or take effect at load. */
  dataOrLoad: string[]
  /** The project's monitoring was handed in. */
  monitoring: boolean
  /** The change is TLA+ models and their configs, and nothing else. */
  onlyModels: boolean
  /** Models of the change whose check broke a rule at this commit. */
  brokenModels: string[]
  /** Models of the change with no check that held or broke at this commit. */
  uncheckedModels: string[]
}

/** The longest evidence hobkin keeps for a score. */
export const LONGEST_EVIDENCE = 400
const PROVEN = new Set(['lifecycle-observed', 'lifecycle', 'isolated'])
const fileOf = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

/** "a", "a and b", "a, b, c and 2 more". */
function named(names: readonly string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : [...names]
  return shown.length < 2 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

/** What the caps read, from the review's parts as rated, the change's files, the model checks and the monitoring given. */
export function needsFacts({ nodes, files, checks, monitoring }: { nodes: readonly ReviewNode[]; files: readonly ChangedFile[]; checks: readonly ModelCheck[]; monitoring: boolean }): NeedsFacts {
  const paths = files.map((file) => file.path)
  const parts = nodes.filter((node) => !node.hidden && node.kind !== 'test' && node.change !== 'none')
  const definitions = parts.filter((node) => node.kind === 'function' && node.change !== 'removed' && node.facts.effect.value !== 'text')
  const modelPaths = [...paths, ...checks.map((check) => check.spec)]
  const specs = modelsOf(paths.filter((path) => isModelFile(path, modelPaths)))
  const checkOf = (spec: string) => checks.find((check) => check.spec === spec)
  return {
    unproven: definitions.filter((node) => !PROVEN.has(node.facts.proof.value)).map((node) => node.symbol),
    proven: definitions.filter((node) => PROVEN.has(node.facts.proof.value)).length,
    testsChanged: files.filter((file) => isTestPath(file.path) && file.status !== 'deleted').length,
    high: parts.filter((node) => node.level?.current === 'high').map((node) => node.symbol),
    undoNone: parts.filter((node) => node.facts.undo.value === 'none').map((node) => node.symbol),
    dataOrLoad: parts.filter((node) => ['data', 'load'].includes(node.facts.effect.value) || node.facts.exposure.value === 'at-load').map((node) => node.symbol),
    monitoring,
    onlyModels: changesOnlyModels(paths),
    brokenModels: specs.filter((spec) => checkOf(spec)?.result === 'violated').map(fileOf),
    uncheckedModels: specs.filter((spec) => !['holds', 'violated'].includes(checkOf(spec)?.result ?? '')).map(fileOf),
  }
}

/** The most each score may be, by the facts, with why: the lowest cap that applies. */
function capsOf(facts: NeedsFacts): Partial<Record<NeedCriterion, { most: number; why: string }>> {
  const caps: Partial<Record<NeedCriterion, { most: number; why: string }>> = {}
  // A change of only TLA+ models is proven by its model check, not by tests: the test caps do not apply to it.
  if (!facts.onlyModels && facts.proven === 0 && facts.unproven.length) caps.coverage = { most: 3, why: `no test that ran proves a changed definition (${named(facts.unproven)})` }
  if (facts.brokenModels.length) caps.proof = { most: 3, why: `the model check of ${named(facts.brokenModels)} breaks a rule at this commit` }
  else if (facts.onlyModels && facts.uncheckedModels.length) caps.proof = { most: 4, why: `the model check of ${named(facts.uncheckedModels)} was not run at this commit` }
  else if (!facts.onlyModels && facts.testsChanged === 0) caps.proof = { most: 4, why: 'no test was added or changed with the change' }
  if (facts.high.length) caps.safety = { most: 5, why: `${named(facts.high)} ${facts.high.length === 1 ? 'is' : 'are'} rated high` }
  if (facts.undoNone.length) caps.rollback = { most: 4, why: `nothing undoes ${named(facts.undoNone)}` }
  if (!facts.monitoring && facts.dataOrLoad.length) caps.visibility = { most: 4, why: `no monitoring is known for a part that writes data or runs at load (${named(facts.dataOrLoad)})` }
  return caps
}

/** A score held to its cap, the cap said at the end of its evidence, within the length hobkin keeps. */
function held(kept: NeedScore, cap: { most: number; why: string } | undefined): NeedScore {
  if (!cap || kept.score <= cap.most) return kept
  const said = ` Capped at ${cap.most}: ${cap.why}.`
  const room = LONGEST_EVIDENCE - said.length
  const evidence = kept.evidence.length <= room ? kept.evidence : `${kept.evidence.slice(0, Math.max(0, room - 1)).trimEnd()}…`
  return { ...kept, score: cap.most, evidence: `${evidence}${said}`, capped: { from: kept.score, why: cap.why } }
}

/** The Reviewer's answers to the user's questions, held to what the review measured, at the review's commit. */
export function capNeeds(answered: Answered, facts: NeedsFacts, head: string): ReviewNeeds {
  const caps = capsOf(facts)
  const scores = Object.fromEntries(Object.entries(answered.scores).map(([criterion, kept]) => [criterion, held(kept!, caps[criterion as NeedCriterion])]))
  return { ...answered, scores, head, by: 'change-review', monitoring: facts.monitoring ? 'given' : 'unknown' }
}
