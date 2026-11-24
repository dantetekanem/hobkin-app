import type { YoloProject, YoloRules, YoloRuleValue, YoloState } from '#shared/protocol/work.ts'

/**
 * The block "What YOLO mode may do" (063-yolo-settings-and-grades): every rule the runtime holds as one row, what the closed
 * block says in a sentence, how a row's save goes (saving, saved, refused) and the command each change sends. The values are
 * always the host's; the ranges here only say what a row offers, and the runtime checks every value again. Pure.
 */

export type RuleGroup = 'project' | 'change' | 'ratings'

interface RuleBase {
  name: string
  group: RuleGroup
  /** The setting in plain words. */
  label: string
  /** What it does, in one line. */
  line: string
  /** A few words for a change it holds, on a card. */
  held: string
}

export type RuleDef = RuleBase &
  (
    | { kind: 'switch' }
    | { kind: 'number'; min: number; max?: number; step: number; none: boolean }
    | { kind: 'kinds' }
    | { kind: 'words' }
    | { kind: 'choice'; choices: readonly { value: string; label: string }[] }
  )

export const GROUPS: readonly { group: RuleGroup; title: string; line: string }[] = [
  { group: 'project', title: 'The project', line: 'What a project must have before anything merges there.' },
  { group: 'change', title: 'The change', line: 'What a change must be to merge by itself.' },
  { group: 'ratings', title: 'Ratings', line: 'How changes and pull requests get their five ratings.' },
]

/** The kinds a review gives a change, as the runtime names them. */
export const KINDS: readonly { value: string; label: string; plural: string }[] = [
  { value: 'performance', label: 'Performance', plural: 'performance work' },
  { value: 'bug-fix', label: 'Bug fix', plural: 'bug fixes' },
  { value: 'state-machine', label: 'State machine', plural: 'state machine changes' },
  { value: 'package-update', label: 'Package update', plural: 'package updates' },
  { value: 'small-change', label: 'Small change', plural: 'small changes' },
  { value: 'feature', label: 'Feature', plural: 'features' },
  { value: 'unclear', label: 'Unclear', plural: 'unclear changes' },
]

const floor = (name: string, question: string, label: string, held: string): RuleDef => ({
  name,
  group: 'change',
  label: `Lowest ${label} score`,
  line: `A change scored lower for ${question} asks you.`,
  held,
  kind: 'number',
  min: 1,
  max: 10,
  step: 1,
  none: false,
})

/** Every rule, in the order the block shows them. */
export const RULES: readonly RuleDef[] = [
  { name: 'testsPass', group: 'project', label: 'Tests pass on the default branch', line: 'Nothing merges while the tests fail there.', held: 'Tests failing', kind: 'switch' },
  { name: 'wayBackKnown', group: 'project', label: 'A way back is known', line: 'Nothing merges until hobkin knows how to roll the project back.', held: 'No way back', kind: 'switch' },
  { name: 'noModelBreaks', group: 'project', label: 'No model breaks on the default branch', line: 'Nothing merges while one of the project’s models breaks there.', held: 'A model breaks', kind: 'switch' },
  { name: 'brokenModelFixMayMerge', group: 'project', label: 'A change that makes a broken model hold may merge', line: 'Lets that change merge while the model still breaks on the default branch.', held: 'Model still breaks', kind: 'switch' },
  { name: 'holdAfterRegression', group: 'project', label: 'Hold a project after a regression', line: 'Stops merging where a deploy showed a regression, until it is checked again.', held: 'Regression', kind: 'switch' },
  { name: 'mergePulls', group: 'project', label: 'Merge hobkin’s own pull requests', line: 'Lets YOLO mode merge a pull request hobkin opened, when GitHub allows it.', held: 'Pull requests off', kind: 'switch' },
  { name: 'mergeWhenChecksUnlisted', group: 'project', label: 'Merge when GitHub’s required checks cannot be listed', line: 'Merges a pull request even when hobkin cannot read which checks are required.', held: 'Checks not listed', kind: 'switch' },

  { name: 'lowestRate', group: 'change', label: 'Lowest general rate', line: 'A change rated lower asks you. One decimal is fine.', held: 'Rate too low', kind: 'number', min: 1, max: 10, step: 0.1, none: false },
  floor('floorCoverage', 'whether tests cover it', 'coverage', 'Coverage too low'),
  floor('floorProof', 'tests that prove it', 'proof', 'Proof too low'),
  floor('floorSafety', 'the risk to the deploy and data', 'deploy and data', 'Safety too low'),
  floor('floorVisibility', 'showing a regression in monitoring', 'visibility', 'Visibility too low'),
  floor('floorRollback', 'rolling it back', 'rollback', 'Rollback too low'),
  { name: 'kinds', group: 'change', label: 'Kinds that may merge', line: 'A change of any other kind asks you. At least one stays on.', held: 'Kind not allowed', kind: 'kinds' },
  { name: 'mostLines', group: 'change', label: 'Largest change, in changed lines', line: 'A bigger change asks you. None lifts the limit.', held: 'Too large', kind: 'number', min: 1, step: 1, none: true },
  { name: 'mostAreas', group: 'change', label: 'Most areas a change may touch', line: 'A change that touches more asks you. None lifts the limit.', held: 'Too many areas', kind: 'number', min: 1, step: 1, none: true },
  { name: 'deletedTestsMayMerge', group: 'change', label: 'A change that deletes tests may merge', line: 'Off, a change that removes tests asks you.', held: 'Deletes tests', kind: 'switch' },
  { name: 'oneWayUndoMayMerge', group: 'change', label: 'A change whose way back is one way may merge', line: 'Off, a change that cannot be undone cleanly asks you.', held: 'One-way undo', kind: 'switch' },
  { name: 'earlierBranchesMayMerge', group: 'change', label: 'A change that brings earlier branches may merge', line: 'Off, a change that carries other branches with it asks you.', held: 'Brings branches', kind: 'switch' },
  { name: 'leftNoteMayMerge', group: 'change', label: 'A change whose run left a note for me may merge', line: 'Off, a change with a note from its run asks you first.', held: 'Left a note', kind: 'switch' },
  { name: 'askPaths', group: 'change', label: 'Paths that always ask me', line: 'A change that touches a path with one of these words asks you. Separate words with commas.', held: 'Path asks you', kind: 'words' },
  { name: 'mergesAPass', group: 'change', label: 'Most merges on a project in one pass', line: 'Each merge after the first rests on a survey older than it.', held: 'Waits for the next pass', kind: 'number', min: 1, max: 5, step: 1, none: false },

  {
    name: 'reviewPulls',
    group: 'ratings',
    label: 'Rate other pull requests',
    line: 'Which pull requests get their five ratings by themselves.',
    held: 'Pull request unrated',
    kind: 'choice',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'mine', label: 'Mine' },
      { value: 'waiting', label: 'Waiting for me' },
      { value: 'both', label: 'Both' },
    ],
  },
  { name: 'keptCurrent', group: 'ratings', label: 'Reviews kept current for a repository', line: 'More changes wait their turn. None lifts the cap.', held: 'Waits its turn', kind: 'number', min: 1, step: 1, none: true },
  { name: 'backgroundADay', group: 'ratings', label: 'Background reviews a day', line: 'Each review is a model call. None lifts the cap.', held: 'Waits its turn', kind: 'number', min: 1, step: 1, none: true },
  { name: 'tries', group: 'ratings', label: 'Tries to get all five ratings', line: 'After the last try a change says it is not rated.', held: 'Not rated', kind: 'number', min: 1, max: 10, step: 1, none: false },
]

const BY_NAME = new Map(RULES.map((rule) => [rule.name, rule]))
export const ruleOf = (name: string): RuleDef | undefined => BY_NAME.get(name)

/** A setting's plain name. A name this window does not know is shown as the runtime sent it. */
export const settingLabel = (name: string): string => BY_NAME.get(name)?.label ?? name

/** A few words for a change a setting holds. */
export const settingHeld = (name: string): string => BY_NAME.get(name)?.held ?? 'Held'

/** Whether a setting can be set for one project: the first two groups. The last group is for every project. */
export const forOneProject = (rule: RuleDef): boolean => rule.group !== 'ratings'

/** A value in a few words. */
export function valueWords(value: YoloRuleValue | undefined): string {
  if (value === undefined) return 'not sent'
  if (value === null) return 'none'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'no words'
  return String(value)
}

const join = (words: string[]): string => (words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`)

const CONDITIONS: [string, string][] = [
  ['testsPass', 'tests pass'],
  ['wayBackKnown', 'a way back is known'],
  ['noModelBreaks', 'no model breaks'],
  ['holdAfterRegression', 'the last deploy did not regress'],
]

/** What the closed block says: the rules in force in one sentence, built only from the values sent. */
export function rulesSentence(rules: YoloRules): string {
  const rate = typeof rules.lowestRate === 'number' ? ` rated ${rules.lowestRate} or more` : ''
  const chosen = Array.isArray(rules.kinds) ? rules.kinds : null
  let kinds = ''
  if (chosen) {
    const left = KINDS.filter(({ value }) => !chosen.includes(value))
    kinds = !left.length ? ', of any kind' : left.length <= 3 ? `, except ${join(left.map(({ plural }) => plural))}` : `, only ${join(KINDS.filter(({ value }) => chosen.includes(value)).map(({ plural }) => plural))}`
  }
  const size = []
  if (rules.mostLines !== undefined) size.push(rules.mostLines === null ? 'of any size' : `up to ${rules.mostLines} lines`)
  if (rules.mostAreas !== undefined) size.push(rules.mostAreas === null ? 'in any number of areas' : `in ${rules.mostAreas} ${rules.mostAreas === 1 ? 'area' : 'areas'} or fewer`)
  const kept = CONDITIONS.filter(([name]) => rules[name] === true).map(([, words]) => words)
  const where = rules.testsPass === undefined && !kept.length ? '' : kept.length ? `, on projects where ${join(kept)}` : ', on any project'
  const first = `Merges changes${rate}${kinds}${size.length ? `, ${size.join(' and ')}` : ''}${where}.`
  const pulls = typeof rules.mergePulls === 'boolean' ? ` Pull requests: ${rules.mergePulls ? 'on' : 'off'}.` : ''
  return first + pulls
}

/** The rules a scope shows: every project's, or one project's own over them. */
export function rulesIn(yolo: YoloState, slug: string | null): YoloRules | undefined {
  if (!slug) return yolo.rules
  return yolo.projects.find((project) => project.slug === slug)?.rules ?? yolo.rules
}

export const overridesIn = (yolo: YoloState, slug: string | null): string[] => (slug ? (yolo.projects.find((project) => project.slug === slug)?.overrides ?? []) : [])

/** How one setting's save stands. A refusal keeps the host's value and says why. */
export type Save = { phase: 'idle' } | { phase: 'saving'; value: YoloRuleValue } | { phase: 'saved'; value: YoloRuleValue } | { phase: 'refused'; text: string }

export const IDLE: Save = { phase: 'idle' }
export const saving = (value: YoloRuleValue): Save => ({ phase: 'saving', value })
export const saved = (value: YoloRuleValue): Save => ({ phase: 'saved', value })
export const refused = (text: string): Save => ({ phase: 'refused', text })

/** What a row's control shows: the value just chosen while it saves, then the host's own. */
export const shownValue = (held: YoloRuleValue | undefined, save: Save): YoloRuleValue | undefined => (save.phase === 'saving' || save.phase === 'saved' ? save.value : held)

export interface RowSay {
  /** The line under the setting: its own words, or the runtime's refusal in their place. */
  words: string
  refused: boolean
  /** Beside the control. The slot keeps its width, so nothing moves. */
  status: 'Saving' | 'Saved' | ''
}

export const rowSay = (rule: RuleDef, save: Save): RowSay => ({
  words: save.phase === 'refused' ? save.text : rule.line,
  refused: save.phase === 'refused',
  status: save.phase === 'saving' ? 'Saving' : save.phase === 'saved' ? 'Saved' : '',
})

/** The arguments of `work.yolo.rules` for one change: for every project, or for one project, which then differs. */
export const changeArgs = (slug: string | null, name: string, value: YoloRuleValue) => ({ ...(slug ? { slug } : {}), rules: { [name]: value } })

/** A project hands one of its own settings back to the rest. */
export const clearArgs = (slug: string, name: string) => ({ slug, clear: [name] })

/** A number the user typed, or why it is not one. Empty and "none" mean none where the setting allows it. The runtime checks the range. */
export function numberFrom(rule: Extract<RuleDef, { kind: 'number' }>, text: string): { value: number | null } | { refused: string } {
  const typed = text.trim().toLowerCase()
  if (rule.none && (typed === '' || typed === 'none')) return { value: null }
  const value = Number(typed.replace(',', '.'))
  if (typed === '' || !Number.isFinite(value)) return { refused: `Give a number${rule.none ? ' or none' : ''}.` }
  return { value }
}

/** The range a number row offers, in words. */
export function rangeWords(rule: Extract<RuleDef, { kind: 'number' }>): string {
  return rule.max === undefined ? `${rule.min} or more` : `${rule.min} to ${rule.max}`
}

/** The words a user typed, one by one: commas, spaces and new lines part them. */
export const wordsFrom = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean)

/** A list of words as the field shows it. */
export const wordsText = (words: readonly string[]): string => words.join(', ')

/** The kinds with one switched on or off. */
export const toggleKind = (kinds: readonly string[], kind: string): string[] => (kinds.includes(kind) ? kinds.filter((one) => one !== kind) : KINDS.map(({ value }) => value).filter((value) => value === kind || kinds.includes(value)))

/** The rules of an older runtime are not sent, and the block says so in one quiet line. */
export const NO_RULES = 'This hobkin has no YOLO settings yet.'

/** A project's own settings, said once. */
export const overrideWords = (project: YoloProject): string => {
  const count = project.overrides?.length ?? 0
  return count ? `${count} ${count === 1 ? 'setting differs' : 'settings differ'} from the rest` : 'Same as the rest'
}

// What the page draws with no host.
const SAMPLE_RULES: YoloRules = {
  testsPass: true,
  wayBackKnown: true,
  noModelBreaks: true,
  brokenModelFixMayMerge: false,
  holdAfterRegression: true,
  mergePulls: false,
  mergeWhenChecksUnlisted: false,
  lowestRate: 8,
  floorCoverage: 5,
  floorProof: 5,
  floorSafety: 8,
  floorVisibility: 7,
  floorRollback: 7,
  kinds: ['performance', 'bug-fix', 'state-machine', 'package-update', 'small-change'],
  mostLines: 300,
  mostAreas: 2,
  deletedTestsMayMerge: false,
  oneWayUndoMayMerge: false,
  earlierBranchesMayMerge: false,
  leftNoteMayMerge: false,
  askPaths: ['migrat', 'schema', 'auth', 'session', 'token', 'secret', 'payment', 'billing', 'deploy', 'dockerfile', '.github/'],
  mergesAPass: 1,
  keptCurrent: 3,
  backgroundADay: 20,
  tries: 3,
  reviewPulls: 'none',
}

/** The sample given rules: all projects', one project's own (billing-api keeps a larger limit for itself) and the setting that holds each waiting change. */
export function withSampleRules(yolo: YoloState): YoloState {
  const held: Record<string, string> = { s2: 'leftNoteMayMerge', s3: 'leftNoteMayMerge', s4: 'mergePulls' }
  return {
    ...yolo,
    rules: SAMPLE_RULES,
    projects: yolo.projects.map((project): YoloProject => {
      const own: YoloRules = project.slug === 'billing-api' ? { mostLines: 600 } : {}
      return {
        ...project,
        rules: { ...SAMPLE_RULES, ...own },
        overrides: Object.keys(own),
        ...(project.slug === 'billing-api' ? { holds: ['testsPass'] } : {}),
        changes: project.changes?.map((change) => (held[change.item] ? { ...change, setting: held[change.item]! } : change)),
      }
    }),
  }
}

/** The sample after a change, so the block answers with no host as the runtime would. */
export function sampleRulesAfter(yolo: YoloState, args: { slug?: string; rules?: Record<string, YoloRuleValue>; clear?: string[] }): YoloState {
  const { slug, rules = {}, clear = [] } = args
  if (!slug) return { ...yolo, rules: { ...yolo.rules, ...rules }, projects: yolo.projects.map((project) => ({ ...project, rules: { ...project.rules, ...rules, ...Object.fromEntries((project.overrides ?? []).map((name) => [name, project.rules?.[name] ?? null])) } })) }
  return {
    ...yolo,
    projects: yolo.projects.map((project) => {
      if (project.slug !== slug) return project
      const overrides = [...new Set([...(project.overrides ?? []), ...Object.keys(rules)])].filter((name) => !clear.includes(name))
      const back = Object.fromEntries(clear.map((name) => [name, yolo.rules?.[name] ?? null]))
      return { ...project, rules: { ...project.rules, ...rules, ...back }, overrides }
    }),
  }
}
