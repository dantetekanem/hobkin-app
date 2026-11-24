/**
 * TLA+ model checks in a change review (050-tla-proofs): what TLC said at the reviewed head of each model the change
 * adds, edits or touches a file of, from the runs hobkin made itself. A check is evidence like a test that ran. A model
 * the diff adds or edits is shown holding by a check that holds; a failure at head alone does not establish merge impact. For a file a model
 * names in `\* models:`, the check is said in its level's reasons and never sets the level: a model is not a test of the
 * lines, so it lowers no break found in them.
 */
import type { FloorExtras, ModelCheck, ReviewNode } from './types.ts'

const count = (value: number) => value.toLocaleString('en-US')
const fileOf = (spec: string) => spec.split('/').filter(Boolean).at(-1) ?? spec
const listed = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)
const steps = (check: ModelCheck) => (check.steps ? ` in ${check.steps} ${check.steps === 1 ? 'step' : 'steps'}` : '')

/** A check that holds with every action run: only then is it evidence. */
export const holdsAsEvidence = (check: ModelCheck) => check.result === 'holds' && check.unfired.length === 0

/** Where a model this diff adds or edits stands at this commit, and its words. */
function modelOf(check: ModelCheck): NonNullable<FloorExtras['model']> {
  const file = fileOf(check.spec)
  if (check.result === 'violated') return { result: 'violated', said: `TLC checked ${file} at this commit: ${check.broken ?? 'a rule'} breaks${steps(check)}` }
  if (check.result === 'error') return { result: 'error', said: `TLC could not check ${file} at this commit${check.message ? `: ${check.message.replace(/\.$/, '')}` : ''}` }
  if (check.unfired.length) {
    const guards = check.unfired.length === 1 ? 'it guards' : 'they guard'
    return { result: 'unproven', said: `TLC checked ${file} at this commit: it held, but ${listed(check.unfired)} never ran, so nothing ${guards} was checked` }
  }
  const held = check.rules.filter((rule) => rule.held && rule.kind !== 'deadlock').map((rule) => rule.name)
  const rules = held.length ? `, and ${listed(held)} ${held.length === 1 ? 'holds' : 'hold'}` : ''
  return { result: 'holds', said: `TLC checked ${file} at this commit: it holds in ${count(check.states)} states${rules}` }
}

/** What a check says of a file its model names: what the model showed, and what that does not show. */
function modeledWords(check: ModelCheck): string {
  const file = fileOf(check.spec)
  if (holdsAsEvidence(check)) {
    return `${file} models this file and holds in ${count(check.states)} states at this commit: that shows its rules keep in the model, not that these lines work, and it lowers no break found in them`
  }
  if (check.result === 'violated') return `${file} models this file, and TLC found ${check.broken ?? 'a rule'} broken${steps(check)} at this commit: merge impact is unknown without a base comparison and the consuming path`
  if (check.result === 'error') return `${file} models this file, and TLC could not check it at this commit`
  return `${file} models this file and held at this commit, but ${listed(check.unfired)} never ran, so it is no evidence`
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * Puts each check on the parts it speaks for: the model's own spec and config, and each file it names in `\* models:`.
 * A violation is also a finding on each file it models. Changes the nodes in place.
 */
export function applyModelChecks(nodes: ReviewNode[], checks: readonly ModelCheck[]): void {
  for (const node of nodes) {
    const own = checks.find((check) => node.path === check.spec || node.path === check.spec.replace(/\.tla$/, '.cfg'))
    if (own) {
      node.extras.model = modelOf(own)
      // TLC, not a test, decides a model: a check that holds or breaks is its proof.
      if (own.result === 'violated' || holdsAsEvidence(own)) node.facts.proof = { value: 'not-applicable', evidence: `a TLA+ model, checked by TLC at this commit in hobkin's run ${own.run}` }
    }
    const modeling = checks.filter((check) => check !== own && check.models.includes(node.path))
    if (!modeling.length) continue
    node.extras.modeledBy = modeling.map((check) => sentence(modeledWords(check))).join(' ').replace(/\.$/, '')
    for (const check of modeling.filter((entry) => entry.result === 'violated')) {
      node.findings.push({ rule: 'model-violated', text: sentence(modeledWords(check)), by: 'proof' })
    }
  }
}

/** The holds a risky answer names, since a reader asks why a change is risky when its model holds. Null when none holds. */
export function heldModels(checks: readonly ModelCheck[]): string | null {
  const held = checks.filter(holdsAsEvidence)
  if (!held.length) return null
  const files = listed(held.map((check) => fileOf(check.spec)))
  const how = held.length === 1 ? `holds in ${count(held[0]!.states)} states` : 'hold'
  return `${files} ${how} at this commit, which lowers no break found in the code.`
}
