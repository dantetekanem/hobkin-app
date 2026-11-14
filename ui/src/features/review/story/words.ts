/**
 * What a step's card says about its unit, in plain words (the user, 2026-11-12: a card that only says "4 lines added" is
 * useless): how the change is proven, who it reaches, how it is undone, and what to watch once it ships. Pure.
 */
import type { Unit } from '#shared/review/assessment.ts'

type Facts = Unit['facts']

const PROOF: Record<Facts['proof']['value'], string> = {
  'lifecycle-observed': 'Proven end to end, and seen running',
  lifecycle: 'Proven end to end',
  isolated: 'Proven by tests of this code alone',
  mocked: 'Proven against stand-ins',
  none: 'No test proves it',
  unknown: 'Not known what proves it',
  'not-applicable': 'Nothing to prove: it does not run',
}
const EXPOSURE: Record<Facts['exposure']['value'], string> = {
  'nobody-yet': 'Nobody runs it yet',
  subset: 'Runs for some requests',
  everyone: 'Runs for everyone',
  'at-load': 'Runs as the app loads',
}
const UNDO: Record<Facts['undo']['value'], string> = {
  flag: 'A flag turns it off',
  'flag-with-residue': 'A flag turns it off, and leaves some of it behind',
  rollback: 'Undone by a rollback',
  none: 'Nothing undoes it',
}
const SIGNAL: Record<'metric' | 'log' | 'trace' | 'error-report', string> = { metric: 'a metric', log: 'a log line', trace: 'a trace', 'error-report': 'an error report' }

/** A fact as a sentence: what it means, then the evidence for it. */
function said(words: string, evidence: string): string {
  const reason = evidence.trim().replace(/\.+$/, '')
  return reason ? `${words}: ${reason}.` : `${words}.`
}

export const proofWords = (facts: Facts): string => said(PROOF[facts.proof.value], facts.proof.evidence)
export const exposureWords = (facts: Facts): string => said(EXPOSURE[facts.exposure.value], facts.exposure.evidence)
export const undoWords = (facts: Facts): string => said(UNDO[facts.undo.value], facts.undo.evidence)
/** Who it reaches and how it is undone, short: "Runs for everyone. Undone by a rollback." */
export const reachWords = (facts: Facts): string => `${EXPOSURE[facts.exposure.value]}. ${UNDO[facts.undo.value]}.`

/** What to watch once it ships, for a unit that needs a look: each signal, each gap nothing watches, and the way back. */
export function watchWords(unit: Pick<Unit, 'level' | 'watch'>): string[] {
  if (unit.level === 'safe' || unit.watch === 'not assessed') return []
  const { signals, gaps, undo } = unit.watch
  return [
    ...signals.map((signal) => `Watch ${signal.name}, ${SIGNAL[signal.kind]} at ${signal.at}.`),
    ...gaps.map((gap) => `Not watched: ${gap.trim().replace(/\.+$/, '')}.`),
    ...(undo ? [`If it goes wrong: ${undo.trim().replace(/\.+$/, '')}.`] : []),
  ]
}

// ───────────────────────────── The step's TL;DR ─────────────────────────────

/**
 * Sentences the change review's engine writes for itself, never for a reader (the user, 2026-11-12: a card full of
 * "Effect: behaviour (from patterns)" and "Stop 1." is trash): what it matched by pattern, and the stop it is on with
 * where it was reached from.
 */
const ENGINE_SENTENCE = /^(?:Effect|Proof|Exposure|Undo): |^Stop \d+\.?$|^Reached from /i
/** A rule's number before its words: "Floor rule 3: no test..." reads "No test...". */
const RULE_PREFIX = /^Floor rule \d+:\s*/i
/** A sentence ends at a stop, outside brackets, before a space. */
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9"'`(])/

/** The sentences of some words a reader is meant to read: the engine's own left out, a rule's number taken off. */
export function plainSentences(text: string): string[] {
  return text
    .trim()
    .split(SENTENCE_END)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !ENGINE_SENTENCE.test(sentence))
    .map((sentence) => {
      // Only words that lost their rule's number start again with a capital: a sentence can start with a name in code.
      const plain = sentence.replace(RULE_PREFIX, '')
      return plain === sentence ? sentence : plain.charAt(0).toUpperCase() + plain.slice(1)
    })
}

/** The most a step's TL;DR says, and the most sentences it takes. */
/**
 * What a step says in place of a rating: that the change has none yet, or that it was rated and nothing that runs
 * changed (only comments or blank lines, say). Null once the review has units to tell.
 */
export function ratingGap(units: readonly unknown[] | null | undefined): string | null {
  if (units == null) return 'No change review yet.'
  return units.length === 0 ? 'Nothing that runs changed.' : null
}

export const TLDR = { characters: 300, sentences: 3 } as const
const LINE_COUNT = /^(?:(?:New|Removed) in this change\. )?(?:[\d,]+ lines? (?:added|removed)(?: and [\d,]+ lines? removed)?|No lines changed)\.$/

/**
 * A step told in one short paragraph (the user, 2026-11-12: "a TLDR of 1 paragraph, TOP"): the step's own words first,
 * which the host writes from the model's when it has them, else the first sentence of what its unit says changed. Two
 * or three sentences, about 300 characters at most. Never a count of lines, never the engine's own sentences.
 */
export function tldrOf(step: { text: string }, unit: { what: string } | null | undefined): string {
  const own = LINE_COUNT.test(step.text.trim()) ? [] : plainSentences(step.text)
  const sentences = own.length > 0 ? own : plainSentences(unit?.what ?? '').slice(0, 1)
  let said = ''
  for (const sentence of sentences.slice(0, TLDR.sentences)) {
    const next = said ? `${said} ${sentence}` : sentence
    if (next.length > TLDR.characters) break
    said = next
  }
  if (said || sentences.length === 0) return said
  // One sentence longer than all of it: cut at a word, and say it goes on.
  const cut = sentences[0]!.slice(0, TLDR.characters - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), TLDR.characters / 2)).trimEnd()}…`
}

/** A note the blind check left on a unit, as a question it could not settle: told apart from the reviewer's own questions. */
export function isBlindNote(question: { text: string; why?: string }): boolean {
  return /^The blind check\b/.test(question.text) || /^The blind check\b/.test(question.why ?? '')
}
