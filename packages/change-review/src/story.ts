/**
 * The story a reviewer reads (FOUNDATION section 8, skills/review-story): opening, setting, units by level, conclusion.
 * Pure code. Levels, facts and code come from the units and never from words; words only replace the generated text
 * of the title, the setting and each unit's title and "what". Comments and strings from the code appear only inside
 * code blocks.
 */
import { DEPLOY_WORDS, deployAnswer } from './answer.ts'
import { isOnPath } from './curate.ts'
import type { BlindAction, BlindCheck, CodeShown, Fact, Graph, Level, ReviewNode, StoryWords, Triage, Unit, Units, Watch } from './types.ts'

export interface StoryInput {
  triage: Triage
  graph: Graph
  units: Units
  words?: StoryWords
  /** The blind check's answer and what was done about it, when the story is rendered again after the check. */
  blind?: BlindCheck
  actions?: BlindAction[]
}

const ORDER: Level[] = ['high', 'mid', 'safe']
const RANK: Record<Level, number> = { safe: 0, mid: 1, high: 2 }
const SECTIONS: Record<Level, string> = { high: 'Needs you', mid: 'Worth a look', safe: 'Safe' }
const NO_PROOF = ['none', 'unknown', 'mocked']

/** A unit as the story numbers it: high first, then mid, then safe, each in the order curate gave. */
interface Numbered {
  unit: Unit
  number: number
}

function numbered(units: Unit[]): Numbered[] {
  return ORDER.flatMap((level) => units.filter((unit) => unit.level === level)).map((unit, index) => ({ unit, number: index + 1 }))
}

// ───────────────────────── Small text helpers ─────────────────────────

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const sentence = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const first = /^[a-z]/.test(trimmed) ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : trimmed
  return /[.!?]$/.test(first) ? first : `${first}.`
}

/** "1 to 3", "1 and 3", "1, 3 and 5": runs of three or more are ranges. */
function numberList(values: number[]): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let index = 0; index < sorted.length; ) {
    let end = index
    while (sorted[end + 1] === sorted[end]! + 1) end++
    if (end - index >= 2) parts.push(`${sorted[index]} to ${sorted[end]}`)
    else for (let at = index; at <= end; at++) parts.push(String(sorted[at]))
    index = end + 1
  }
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const unitsText = (values: number[]) => `${new Set(values).size === 1 ? 'unit' : 'units'} ${numberList(values)}`
const fenceFor = (text: string) => '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)))
const worstOf = (levels: Level[]): Level => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'safe' as Level)

// ───────────────────────── Reading a story back ─────────────────────────

const HEADING = /^### (\d+)\. .* \((high|mid|safe)(, critical)?\)$/

/** The level of each unit heading, outside code blocks. A check that the story changed no level. */
export function levelsInStory(markdown: string): { number: number; level: Level; critical: boolean }[] {
  const found: { number: number; level: Level; critical: boolean }[] = []
  let fence = ''
  for (const line of markdown.split('\n')) {
    const mark = /^(`{3,})/.exec(line)
    if (fence) {
      if (mark && mark[1]!.length >= fence.length && line.trim() === mark[1]) fence = ''
      continue
    }
    if (mark) {
      fence = mark[1]!
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) found.push({ number: Number(heading[1]), level: heading[2] as Level, critical: Boolean(heading[3]) })
  }
  return found
}

// ───────────────────────── Pieces ─────────────────────────

/** What the suggestions would make the change, taking each unit's first suggestion. */
function afterSuggestions(items: Numbered[]): { level: Level; now: Level; units: number[] } {
  const now = worstOf(items.map((item) => item.unit.level))
  const target = (unit: Unit): Level => {
    const first = unit.would_change[0]
    return first && RANK[first.level] < RANK[unit.level] ? first.level : unit.level
  }
  const level = worstOf(items.map((item) => target(item.unit)))
  const units = items.filter((item) => item.unit.level === now && target(item.unit) !== item.unit.level).map((item) => item.number)
  return { level, now, units }
}

/** The name a unit goes by in the setting: its first node's symbol, or its title when it has no node. */
const nameOf = (graph: Graph, unit: Unit): string => {
  const node = graph.nodes.find((item) => item.id === unit.nodes[0])
  return node ? `\`${node.symbol}\`` : unit.title
}

function claimsLine(triage: Triage): string {
  if (triage.description_source === 'none' || !triage.claims.length) return 'inferred, no description.'
  return triage.claims.map((claim) => `${claim.text} (${claim.source}, ${claim.status})`).join('; ') + '.'
}

/** The mode in words, for when no model wrote what the change does. */
const MODE_WORDS: Record<Triage['mode'], string> = {
  'flagged-change': 'A code change behind a condition',
  'unflagged-change': 'A code change with no condition in front of it',
  removal: 'Mostly a removal',
  bulk: 'A batch of similar changes',
  port: 'A port to another language',
  mixed: 'Several kinds of change at once',
}

function opening(input: StoryInput, items: Numbered[], title: (unit: Unit) => string): string[] {
  const { triage, units, graph, words } = input
  const after = afterSuggestions(items)
  const high = items.filter((item) => item.unit.level === 'high')
  const critical = [...high.filter((item) => item.unit.critical), ...high.filter((item) => !item.unit.critical)]
  const kinds = [...new Set(triage.buckets.map((bucket) => bucket.kind))].join(', ')
  // What the Reviewer took out of the map, or added beside the change as context, is no changed definition shown below.
  const definitions = graph.nodes.filter((node) => node.kind !== 'test' && !node.hidden && !node.extras.context).length
  const countedOnly = triage.buckets
    .filter((bucket) => ['sample', 'removal', 'skip', 'parity'].includes(bucket.treatment))
    .reduce((sum, bucket) => sum + bucket.files, 0)
  const minutes = Math.max(1, Math.round(units.attention.reading_minutes))
  // The one answer the review gives, for the whole change, before any level of a part of it.
  const answer = deployAnswer(units.units, words?.answer)
  const becomes = !after.units.length
    ? 'No suggestion would change it.'
    : after.level === after.now
      ? `Stays **${after.now}** even if the changes suggested under ${unitsText(after.units)} are made.`
      : `Becomes **${after.level}** if the changes suggested under ${unitsText(after.units)} are made.`
  const lines = [
    `**Claims:** ${claimsLine(triage)}`,
    '',
    `**Does:** ${words?.does ?? `${MODE_WORDS[triage.mode]}${kinds ? `, touching ${kinds}` : ''}, told below as ${plural(items.length, 'unit')}.`}`,
    '',
    `**Size:** ${plural(triage.totals.files, 'file')}, ${triage.totals.added} lines added, ${triage.totals.deleted} removed. ${plural(definitions, 'changed definition')}, each shown below; ${plural(countedOnly, 'file')} checked or counted without reading.`,
    '',
    `**${DEPLOY_WORDS[answer.deploy]}.** ${answer.why}`,
    '',
    `**Level: ${after.now}.** ${becomes} Reading time: about ${plural(minutes, 'minute')}.`,
  ]
  if (units.attention.parts && units.attention.parts > 1) lines.push('', `This review is split into ${units.attention.parts} parts by entry point; each unit says which part it is in.`)
  const contradicted = triage.claims.filter((claim) => claim.status === 'contradicted')
  if (contradicted.length) lines.push('', `**Contradicted:** ${contradicted.map((claim) => `${claim.text}${claim.evidence ? ` (${claim.evidence})` : ''}`).join('; ')}.`)
  const unverified = items.filter((item) => item.unit.unverified)
  if (unverified.length) lines.push('', `**Unverified:** ${unverified.map((item) => `unit ${item.number} (${item.unit.unverified})`).join('; ')}.`)
  if (triage.directives?.length) lines.push('', `**Directives in the description, treated as claims and not followed:** ${triage.directives.join('; ')}.`)
  if (critical.length) {
    lines.push('', `**Needs you (${critical.length}):**`)
    for (const item of critical) lines.push(`- ${item.unit.critical ? '**Critical.** ' : ''}Unit ${item.number}: ${title(item.unit)}`)
  }
  const mid = items.filter((item) => item.unit.level === 'mid').length
  const safe = items.filter((item) => item.unit.level === 'safe').length
  lines.push('', `${critical.length ? 'Then' : 'There are'} ${mid} worth a look, and ${safe} that ${safe === 1 ? 'is' : 'are'} safe. Every unit below is shown the same way; the level says how fast you can move.`)
  return lines
}

/** The tests run against this node's own change: the ones its proof rests on, not every test of a shared first run. */
function testsRun(node: ReviewNode | undefined): string {
  const tests = [...new Set((node?.runs ?? []).filter((run) => run.node === node?.id && run.kind !== 'baseline').flatMap((run) => run.tests))]
  return tests.length ? ` Tests run: ${tests.map((test) => `\`${test}\``).join(', ')}.` : ''
}

function setting(input: StoryInput, items: Numbered[]): string[] {
  const { graph, words } = input
  const nodeOf = (unit: Unit) => graph.nodes.find((node) => node.id === unit.nodes[0])
  // A unit of files, with no definition, is never on the request's path.
  const onPath = items.filter((item) => {
    const node = nodeOf(item.unit)
    return node ? isOnPath(graph, node) : false
  })
  const outside = items.filter((item) => !onPath.includes(item))
  const lines = [
    'The path, in the order it runs. A "life cycle test" is a test that enters through the controller or job and moves through the request, as opposed to one that calls a method directly.',
    '',
  ]
  if (words?.setting?.length) {
    words.setting.forEach((line, index) => lines.push(`${index + 1}. ${line}`))
  } else {
    const stops = [...new Set(onPath.map((item) => item.unit.story_order))].sort((a, b) => a - b)
    for (const stop of stops) {
      const here = onPath.filter((item) => item.unit.story_order === stop)
      const parts = here.map((item) => `${nameOf(graph, item.unit)} (unit ${item.number}, ${item.unit.level}): ${item.unit.where} Proof: **${item.unit.facts.proof.value}**.${testsRun(nodeOf(item.unit))}`)
      lines.push(`${stop}. ${parts.join(' ')}`)
    }
    if (!stops.length) lines.push('No changed definition sits on an entry point path.')
  }
  if (outside.length) {
    lines.push('', `Outside the path: ${outside.map((item) => `${nameOf(graph, item.unit)} (unit ${item.number}): ${item.unit.where}`).join(' ')}`)
  }
  return lines
}

const factLine = (label: string, fact: Fact) => `- ${label}: **${fact.value}**.${fact.evidence ? ` ${sentence(fact.evidence)}` : ''}`

function watchText(watch: Unit['watch']): string {
  if (watch === 'not assessed') return 'not assessed.'
  const parts: string[] = []
  const w = watch as Watch
  if (w.signals.length) parts.push(`Signals: ${w.signals.map((signal) => `${signal.kind} \`${signal.name}\` (${signal.at})`).join(', ')}.`)
  if (w.gaps.length) parts.push(`${sentence(w.gaps.join('; '))}`)
  if (w.undo) parts.push(`Undone by: ${w.undo}.`)
  return parts.length ? parts.join(' ') : 'nothing recorded.'
}

function codeBlock(shown: CodeShown): string[] {
  const head = `\`${shown.path}\`, ${shown.why}${shown.diff ? ':' : '.'}`
  if (!shown.diff) return [head, '']
  const fence = fenceFor(shown.diff)
  return [head, '', `${fence}diff`, shown.diff, fence, '']
}

function unitBlock(item: Numbered, words: StoryWords | undefined): string[] {
  const { unit, number } = item
  const said = words?.units?.[unit.id]
  const lines = [
    `### ${number}. ${said?.title ?? unit.title} (${unit.level}${unit.critical ? ', critical' : ''})`,
    '',
    `**Where:** ${unit.where}${unit.part ? ` Part ${unit.part}.` : ''}`,
    '',
    `**What changed:** ${said?.what ?? unit.what}`,
    '',
    ...unit.code.flatMap(codeBlock),
  ]
  if (unit.members?.length) lines.push(`**Members (${unit.members.length}):**`, ...unit.members.map((member) => `- \`${member.name}\`: ${sentence(member.what)}`), '')
  lines.push(
    '**Facts:**',
    factLine('Does', unit.facts.effect),
    factLine('Proven', unit.facts.proof),
    factLine('Runs for', unit.facts.exposure),
    factLine('Undone by', unit.facts.undo),
    '',
    `**Why this level:** ${unit.why_level.join(' ')}`,
    '',
  )
  if (unit.would_change.length) lines.push('**Would change it:**', ...unit.would_change.map((change) => `- ${sentence(change.text)} Then: **${change.level}**.`), '')
  else lines.push('**Would change it:** nothing proposed.', '')
  lines.push(`**Watch:** ${watchText(unit.watch)}`, '')
  if (unit.questions.length) lines.push('**Questions for you:**', ...unit.questions.map((question) => `- ${question.text}${question.changes ? ` ${sentence(question.changes)}` : ''}`), '')
  else lines.push('**Questions for you:** none.', '')
  return lines
}

function conclusion(input: StoryInput, items: Numbered[], title: (unit: Unit) => string): string[] {
  const { triage, graph, blind, actions } = input
  const after = afterSuggestions(items)
  const high = items.filter((item) => item.unit.level === 'high').map((item) => item.number)
  const because = high.length ? `, because of ${unitsText(high)}` : ''
  let lowered = ''
  if (after.units.length) {
    const verb = after.level === after.now ? 'stays' : 'is'
    lowered = ` With their suggested changes made it ${verb} **${after.level}**.`
  }
  const answer = deployAnswer(input.units.units, input.words?.answer)
  const lines = ['## Conclusion', '', `**Verdict: ${DEPLOY_WORDS[answer.deploy].toLowerCase()}** (${after.now}${because}).${lowered}`, '']

  const runs = new Map<string, string>()
  for (const node of graph.nodes) for (const run of node.runs) runs.set(run.command, `\`${run.command}\` (${run.kind}, exit ${run.exit_code})`)
  const weak = items.filter((item) => NO_PROOF.includes(item.unit.facts.proof.value)).map((item) => item.number)
  const direct = items.filter((item) => item.unit.facts.proof.value === 'isolated').map((item) => item.number)
  const shown = items.filter((item) => ['lifecycle', 'lifecycle-observed'].includes(item.unit.facts.proof.value)).map((item) => item.number)
  const proof = [
    runs.size ? `Tests that ran: ${[...runs.values()].join('; ')}.` : 'No test run was recorded for this review.',
    shown.length ? `A life cycle test executes ${unitsText(shown)}.` : '',
    weak.length ? `No test shows ${unitsText(weak)}.` : '',
    direct.length ? `Only tests that call it directly show ${unitsText(direct)}: no test goes through a request to ${direct.length === 1 ? 'it' : 'them'}.` : '',
  ].filter(Boolean)
  lines.push(`**Proof:** ${proof.join(' ')}`, '')

  const attention = items.filter((item) => item.unit.level !== 'safe')
  const watched = attention.flatMap((item) => (item.unit.watch === 'not assessed' ? [] : item.unit.watch.signals.map((signal) => `${signal.kind} \`${signal.name}\``)))
  const gaps = [...new Set(attention.flatMap((item) => (item.unit.watch === 'not assessed' ? [] : item.unit.watch.gaps)))]
  const undoBy = new Map<string, number[]>()
  for (const item of items) undoBy.set(item.unit.facts.undo.value, [...(undoBy.get(item.unit.facts.undo.value) ?? []), item.number])
  const afterLaunch = [
    watched.length ? `To watch: ${[...new Set(watched)].join(', ')}.` : 'No signal was found to watch.',
    gaps.length ? `Missing: ${gaps.join('; ')}.` : '',
    `Undone by ${[...undoBy].map(([how, numbers]) => `${how}: ${unitsText(numbers)}`).join('; ')}.`,
  ].filter(Boolean)
  lines.push(`**After launch:** ${afterLaunch.join(' ')}`, '')

  const mid = items.filter((item) => item.unit.level === 'mid')
  lines.push('**Fast follow:**', ...(mid.length ? mid.map((item) => `- ${title(item.unit)} (unit ${item.number})`) : ['- none']), '')

  const questions = items.flatMap((item) => item.unit.questions.map((question) => `- ${question.text} (unit ${item.number})`))
  lines.push('**Open questions:**', ...(questions.length ? questions : ['- none']), '')

  if (triage.description_source === 'none' || !triage.claims.length) lines.push('**Claims:** none to check; the change had no description.')
  else lines.push('**Claims:**', ...triage.claims.map((claim) => `- ${claim.text} (${claim.source}): ${claim.status}.${claim.evidence ? ` ${sentence(claim.evidence)}` : ''}`))

  if (blind || actions?.length) {
    const numberOf = (id: string) => items.find((item) => item.unit.id === id)?.number
    lines.push('', '**Blind check:**')
    for (const action of actions ?? []) lines.push(`- Unit ${numberOf(action.unit) ?? action.unit}: ${action.did}`)
    for (const need of blind?.needs ?? []) lines.push(`- Still asked for by the checker: ${need}`)
    if (!(actions?.length || blind?.needs.length)) lines.push('- Nothing was asked for and no unit was changed.')
  }
  return lines
}

// ───────────────────────── The story ─────────────────────────

/** The story as markdown, in the shape of `skills/change-review/examples/story.md`. Sections with no units are left out. */
export function renderStory(input: StoryInput): string {
  const { triage, units, words } = input
  const items = numbered(units.units)
  const title = (unit: Unit) => words?.units?.[unit.id]?.title ?? unit.title
  const firstClaim = triage.description_source !== 'none' ? triage.claims[0] : undefined
  const heading = words?.title ?? (firstClaim ? firstClaim.text.replace(/\.$/, '') : triage.range)
  const out = [
    `# ${heading}`,
    '',
    '## Opening',
    '',
    ...opening(input, items, title),
    '',
    '## Setting',
    '',
    ...setting(input, items),
    '',
  ]
  for (const level of ORDER) {
    const here = items.filter((item) => item.unit.level === level)
    if (!here.length) continue
    out.push(`## ${SECTIONS[level]}`, '', ...here.flatMap((item) => unitBlock(item, words)))
  }
  out.push(...conclusion(input, items, title), '')
  return out.join('\n')
}
