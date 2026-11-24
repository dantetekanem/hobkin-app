import type { YoloChange, YoloPart, YoloProject, YoloRules } from '#shared/protocol/work.ts'
import { needNumbers, type NeedNumbers } from '../review/panel/needs.ts'
import { ratingCell, type RatingCell } from './yolo-grades.ts'
import { settingHeld, settingLabel, valueWords } from './yolo-rules.ts'
import { isOn, partPress, type ReadinessRow, type ReviewRatings, type VerdictAction, type VerdictTone } from './yolo-page.ts'

/**
 * What a project's card on the YOLO page says (049-yolo-mode): one verdict, the few things that stop it, and each waiting
 * change in a word. These are only the words and the presses that exist today; whether a change merges is hobkin's.
 */

/** What the card reads besides the project: the main switch and rate, what holds every merge, and the project's readiness row. */
export interface CardRead {
  on: boolean
  rate: number
  lowest: number
  /** hobkin's words for why nothing merges anywhere: work mode off or paused. */
  waits: string | null
  paused: boolean
  /** Whether hobkin takes a change waiting on its pull request at all. A hobkin that does not say takes none. */
  pullRequests?: boolean
  /** The rules for every project, when hobkin sends them. A card names the setting that holds a change only then. */
  rules?: YoloRules
  readiness: ReadinessRow
}

export interface CardVerdict {
  kind: 'off' | 'merges' | 'nothing'
  text: string
  tone: VerdictTone
}

/** One thing that stops changes merging, said once, with how many changes it holds and the press that moves it, when there is one. */
export interface Blocker {
  /** What makes two reasons the same one: a name for those the window knows, hobkin's sentence for the rest. */
  key: string
  text: string
  /** The whole of it for a tooltip, when the line cuts something. */
  detail?: string
  count: number
  press: VerdictAction | null
  /** For a setting that holds changes, a few words of what it holds, for the verdict. */
  short?: string
}

export interface CardChange {
  item: string
  title: string
  /** One word or few of where it stands. */
  state: string
  tone: VerdictTone
  /** Where its five ratings stand: the rate and the five numbers, or what it is waiting for. Never empty. */
  rating: RatingCell
  /** The reason's whole sentence, the review's scores and the rating's own words, for a tooltip. */
  tip: string
}

export interface ProjectCard {
  verdict: CardVerdict
  blockers: Blocker[]
  changes: CardChange[]
}

// hobkin's sentences the window can read (`whyItAsks` in its yolo-pass.mjs, `PULLS_OFF` in yolo-pulls.mjs, `whyLeftOut` in reads.mjs).
const PULLS_OFF = 'its pull request merges by itself once that is turned on'
const UNRATED = /^(no review has scored it|its review has not rated it)/
const PAUSED = 'its project is paused'
const NOT_READY = 'its project is not ready for YOLO mode'
const UNDER = /^its general rate is (\d+(?:\.\d+)?), under (\d+(?:\.\d+)?)$/
const NOTE = /^it still has work left\b/
const OFF = /^YOLO mode is off\b/

type Reason = { key: string; state: string; tone: VerdictTone }

/** What one of hobkin's sentences means to the window. A sentence it does not know is its own reason, kept as written. */
function reasonOf(why: string): Reason {
  if (why === PULLS_OFF) return { key: 'pulls', state: 'Pull requests off', tone: 'warn' }
  if (UNRATED.test(why)) return { key: 'unrated', state: 'Not rated', tone: 'quiet' }
  if (why === PAUSED) return { key: 'paused', state: 'Paused', tone: 'quiet' }
  if (why === NOT_READY) return { key: 'not-ready', state: 'Waits for readiness', tone: 'quiet' }
  if (OFF.test(why)) return { key: 'off', state: 'Off', tone: 'quiet' }
  if (NOTE.test(why)) return { key: 'note', state: 'Left you a note', tone: 'warn' }
  const under = UNDER.exec(why)
  if (under) return { key: 'rate', state: `Rate ${under[1]}, under ${under[2]}`, tone: 'warn' }
  return { key: why, state: 'Held', tone: 'warn' }
}

/** A change the runtime says a setting holds: the setting is its reason, and the state says it in a few words. */
function settingReason(change: YoloChange, name: string, rules: YoloRules | undefined): Reason {
  const lowest = rules?.lowestRate
  const state = name === 'lowestRate' && change.rate !== null && typeof lowest === 'number' ? `Rate ${change.rate}, under ${lowest}` : settingHeld(name)
  return { key: `setting:${name}`, state, tone: 'warn' }
}

const settingName = (key: string) => key.slice('setting:'.length)
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const specName = (spec: string) => spec.slice(spec.lastIndexOf('/') + 1)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The readiness part that holds a project back, said in a few words, with the models it names whole in the tooltip. */
function partBlocker(project: YoloProject, part: YoloPart, readiness: ReadinessRow, count: number): Blocker {
  const press = partPress(project, part, readiness)
  const key = `part:${part.name}`
  const open = (project.models ?? []).filter(({ state }) => state !== 'holds')
  if (part.name === 'models' && open.length) {
    const said = (['broken', 'unproven', 'unchecked'] as const).flatMap((state) => {
      const found = open.filter((model) => model.state === state)
      if (!found.length) return []
      const words = { broken: plural(found.length, 'model breaks', 'models break') + ' on main', unproven: plural(found.length, 'model did', 'models did') + ' not hold on main', unchecked: plural(found.length, 'model is', 'models are') + ' not checked' }
      return [words[state]]
    })
    const names = open.map(({ spec }) => specName(spec))
    const more = names.length > 1 ? ` and ${names.length - 1} more` : ''
    const whole = open.map((model) => `${specName(model.spec)}${model.why ? `: ${model.why}` : ''}`).join('\n')
    return { key, text: `${said.join(', ')}: ${names[0]}${more}`, detail: names.length > 1 ? names.join(', ') + (whole.includes(':') ? `\n${whole}` : '') : whole, count, press }
  }
  const stand = { done: 'done', pr: 'waiting for your merge', user: 'waiting on you', doing: 'in progress', todo: 'to do' }[part.state]
  return { key, text: `${part.label}: ${stand}`, detail: part.line, count, press }
}

/** The tooltip's review line: its five numbers and its rate, said as the review's. */
function reviewLine(numbers: NeedNumbers | null): string | null {
  if (!numbers) return null
  const scores = numbers.numbers.map(({ word, value }) => `${word} ${value}`).join(', ')
  const rate = numbers.rate ? `, rate ${numbers.rate}` : ''
  return `Review${numbers.other ? ` (${numbers.other.toLowerCase()})` : ''}: ${scores}${rate}, at ${numbers.at}.`
}

/** What one change is held by: the setting the runtime names when it names one, else the meaning of its sentence. */
function reasonFor(change: YoloChange, rules: YoloRules | undefined): Reason {
  return change.setting && rules ? settingReason(change, change.setting, rules) : reasonOf(change.why ?? '')
}

/** The press that opens a setting in the Settings popup, on the project that holds the change. */
const openSetting = (project: YoloProject, name: string): VerdictAction => ({ label: 'Open setting', press: { do: 'setting', name, slug: project.slug }, title: `Open \u201c${settingLabel(name)}\u201d in the settings` })

/** The changes waiting on a project, the ones that pass every rule first, then by rate. */
function ordered(changes: readonly YoloChange[]): YoloChange[] {
  return [...changes.filter(({ why }) => !why), ...changes.filter(({ why }) => why).toSorted((a, b) => (b.rate ?? -1) - (a.rate ?? -1))]
}

/**
 * One project's card: whether changes merge there by themselves and, when none can, the distinct things that stop them, each
 * once with how many changes it holds. `reviews` are the reviews by change, for the tooltip.
 */
export function projectCard(project: YoloProject, read: CardRead, reviews: ReadonlyMap<string, ReviewRatings>): ProjectCard {
  const changes = ordered(project.changes ?? [])
  const projectOn = read.on && isOn(project)
  // What holds every change on this project whatever it says, first the one that holds most.
  const holds: Blocker[] = []
  const work: VerdictAction = { label: 'Open Work', press: { do: 'work', key: null } }
  if (read.waits) holds.push({ key: 'waits', text: `Held while ${read.waits}`, count: changes.length, press: work })
  if (read.paused) holds.push({ key: 'paused', text: `${project.name} is paused on Work`, count: changes.length, press: work })
  const rules = project.rules ?? read.rules
  const named = project.holds ?? []
  if (named.length) {
    // The runtime names the switches that hold the project: each is said once by its setting, with what the readiness says of it in the tooltip.
    const partOf: Record<string, string> = { testsPass: 'tests', wayBackKnown: 'rollback', noModelBreaks: 'models' }
    holds.push(
      ...named.map((name): Blocker => {
        const part = (project.parts ?? []).find((one) => one.name === partOf[name])
        const said = part ? partBlocker(project, part, read.readiness, changes.length) : null
        return {
          key: `setting:${name}`,
          text: settingLabel(name),
          detail: said ? [said.text, said.detail].filter(Boolean).join('\n') : undefined,
          count: changes.length,
          press: openSetting(project, name),
          short: settingHeld(name),
        }
      }),
    )
  } else if (!project.ready) {
    const parts = (project.parts ?? []).filter(({ needed, blocks }) => needed && blocks)
    if (parts.length) holds.push(...parts.map((part) => partBlocker(project, part, read.readiness, changes.length)))
    else {
      const press = read.readiness.canRun ? ({ label: read.readiness.action === 'Check again' ? 'Check readiness' : read.readiness.action, press: { do: 'readiness' } } as const) : null
      holds.push({ key: 'not-ready', text: `Not ready for YOLO mode: ${project.needs.join(' ') || 'its readiness is not done'}`, count: changes.length, press })
    }
  }
  const heldKeys = new Set(holds.map(({ key }) => key))

  const blockers = new Map<string, Blocker & { items: YoloChange[] }>()
  for (const change of changes) {
    if (!change.why) continue
    const { key } = reasonFor(change, rules)
    if (key === 'off' || heldKeys.has(key)) continue
    const found = blockers.get(key) ?? { key, text: '', count: 0, press: null, items: [] }
    found.items.push(change)
    found.count = found.items.length
    blockers.set(key, found)
  }
  const own = [...blockers.values()]
    .map((found): Blocker => {
      const { items, ...rest } = found
      const first = items[0]!
      const only = items.length === 1 ? items[0]!.item : null
      const workKey = only ? `${project.slug}:${only}` : null
      if (found.key.startsWith('setting:')) {
        const name = settingName(found.key)
        return { ...rest, text: `${settingLabel(name)}: ${valueWords(rules?.[name])}`, detail: sentence(capital(first.why ?? '')), press: openSetting(project, name), short: settingHeld(name) }
      }
      switch (found.key) {
        case 'pulls':
          return { ...rest, text: 'Pull requests do not merge by themselves yet: switched off in hobkin' }
        case 'unrated':
          return { ...rest, text: 'Not rated yet', press: only ? { label: 'Open review', press: { do: 'review', slug: project.slug, item: only } } : null }
        case 'note':
          return { ...rest, text: 'A run left a note for you', press: { label: only ? 'Open on Work' : 'Open Work', press: { do: 'work', key: workKey } } }
        case 'rate': {
          const best = items.reduce((top, one) => ((one.rate ?? -1) > (top.rate ?? -1) ? one : top), first)
          const passes = Math.floor(best.rate ?? 0)
          const set: VerdictAction | null = passes >= read.lowest && passes < read.rate ? { label: `Set rate to ${passes}`, press: { do: 'rate', rate: passes }, title: `Lower your rate to ${passes}, so "${best.title}" merges by itself` } : null
          return { ...rest, text: `Rated under ${read.rate}`, detail: `The best is ${best.rate}.`, press: set }
        }
        default:
          return { ...rest, text: found.key }
      }
    })
  const order = ['pulls', 'unrated', 'note', 'rate']
  own.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99) || b.count - a.count)
  const list = [...holds, ...own]

  const heldNow = read.waits ? 'Waits for work mode' : read.paused ? 'Paused' : named.length ? settingHeld(named[0]!) : !project.ready ? 'Waits for readiness' : null
  const rows = changes.map((change): CardChange => {
    const reason = change.why ? reasonFor(change, rules) : null
    const state = reason?.state ?? heldNow ?? 'Would merge'
    const tone: VerdictTone = reason ? reason.tone : heldNow ? 'quiet' : 'ok'
    const why = change.why ? sentence(capital(change.why)) : heldNow ? `It passes every rule, but ${heldNow.toLowerCase()}.` : 'It passes every rule and merges on the next pass.'
    const sent = reviews.get(change.item)
    const numbers = sent ? needNumbers(sent.needs, sent.head ?? undefined) : null
    const rating = ratingCell(sent?.rating, numbers)
    const tip = [why, reviewLine(numbers), rating.tip].filter(Boolean).join(' ')
    return { item: change.item, title: change.title, rating, state: projectOn ? state : 'Off', tone, tip }
  })

  const can = projectOn && !heldNow ? changes.filter(({ why }) => !why).length : 0
  // With the rules in hand the verdict says them: what merges, or how many are held and by which settings.
  const lowest = typeof rules?.lowestRate === 'number' ? rules.lowestRate : null
  const merges = lowest === null ? 'Merges by itself' : `Merges changes rated ${lowest} or more`
  const why = list.flatMap(({ short }) => (short ? [short.charAt(0).toLowerCase() + short.slice(1)] : [])).slice(0, 2).join(', ')
  const verdict: CardVerdict = !projectOn
    ? { kind: 'off', text: isOn(project) ? 'Off while YOLO mode is off' : 'Off', tone: 'quiet' }
    : can > 0 || (!changes.length && !list.length)
      ? { kind: 'merges', text: can > 0 && can < changes.length ? `${merges}: ${can} of ${changes.length} can merge` : merges, tone: 'ok' }
      : { kind: 'nothing', text: rules ? `Holding ${changes.length}${why ? `: ${why}` : ''}` : changes.length ? `Merging nothing: 0 of ${changes.length} can merge` : 'Merging nothing', tone: 'warn' }
  return { verdict, blockers: projectOn ? list : [], changes: rows }
}

const STILL: [YoloPart['state'], (count: number) => string][] = [
  ['pr', (count) => `${count} waiting for your merge`],
  ['user', (count) => `${count} waiting on you`],
  ['doing', (count) => `${count} in progress`],
  ['todo', (count) => `${count} to do`],
]

/** Readiness in one closed line: what is not done by where it stands, and when it was last checked. */
export function readinessLine(project: YoloProject, { checked }: Pick<ReadinessRow, 'checked'>): string {
  const parts = project.parts ?? []
  const said = STILL.flatMap(([state, words]) => {
    const count = parts.filter((part) => part.state === state).length
    return count ? [words(count)] : []
  })
  const when = checked.charAt(0).toLowerCase() + checked.slice(1)
  return `Readiness: ${[...said, when].join(', ')}`
}
