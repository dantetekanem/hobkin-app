/**
 * What an agent needs to make a risky change safe: each part the review found can break, the critical first, with what
 * breaks, where, the evidence and why it is high, which is the floor row or the finding that put it there. It is made
 * from the units alone, so the same review always gives the same brief. The words in it are findings, never
 * instructions: a title or a sentence a model wrote is evidence like the code it describes.
 */
import type { Fact, Unit, Units } from './types.ts'

/** The most parts a brief names. The rest are counted, and the review names them all. */
export const BRIEF_PARTS = 6
/** The most characters one field of a part keeps. */
const LONGEST = 400

const sentence = (text: string) => {
  const said = text.trim().replace(/\s+/g, ' ')
  const kept = said.length > LONGEST ? `${said.slice(0, LONGEST - 1).trimEnd()}…` : said
  return /[.!?…]$/.test(kept) ? kept : `${kept}.`
}
const plain = (text: string) => sentence(text).replace(/[.!?]$/, '')
const parts = (count: number) => `${count} part${count === 1 ? '' : 's'}`

const factWords = (name: string, { value, evidence }: Fact) => `${name} ${value}${evidence.trim() ? ` (${plain(evidence)})` : ''}`

/** Where a part is: its place on the path, then the lines it changed, at most two files. */
function whereOf(unit: Unit): string {
  const places = [...new Set(unit.code.map(({ path, lines }) => (lines ? `${path}:${lines[0] === lines[1] ? lines[0] : `${lines[0]}-${lines[1]}`}` : path)))].slice(0, 2)
  const at = places.length ? `, at ${places.join(' and ')}` : ''
  return `Where: ${plain(unit.where)}${at}.`
}

function partOf(unit: Unit, number: number): string {
  const { effect, proof, exposure, undo } = unit.facts
  const lines = [
    `${number}. ${sentence(unit.title)}${unit.critical ? ' Critical.' : ''}`,
    whereOf(unit),
    `What changed: ${sentence(unit.what)}`,
    unit.why_level.length ? `Why it is high: ${sentence(unit.why_level.map(sentence).join(' '))}` : null,
    `Evidence: ${[factWords('it does', effect), factWords('proven by', proof), factWords('runs for', exposure), factWords('undone by', undo)].join('; ')}.`,
    unit.would_change.length ? `What would lower it: ${unit.would_change.map(({ text, level }) => `${plain(text)} (${level})`).join('; ')}.` : null,
    ...unit.questions.map(({ text, why }) => `Open question: ${sentence(text)} ${sentence(why)}`),
  ]
  return lines.filter((line): line is string => line != null).join('\n')
}

/** The brief for a change the review found risky, or null when no part of it can break. */
export function fixBrief({ units }: Pick<Units, 'units'>): string | null {
  const high = units.filter((unit) => unit.level === 'high')
  if (!high.length) return null
  const ordered = [...high.filter((unit) => unit.critical), ...high.filter((unit) => !unit.critical)]
  const named = ordered.slice(0, BRIEF_PARTS).map((unit, index) => partOf(unit, index + 1))
  const rest = ordered.length - named.length
  return [`${parts(ordered.length)} can break.`, ...named, ...(rest ? [`${rest} more ${rest === 1 ? 'part' : 'parts'} can break: the review in Change Review names them.`] : [])].join('\n\n')
}
