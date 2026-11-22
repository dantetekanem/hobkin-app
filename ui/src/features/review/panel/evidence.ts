/**
 * The evidence above the verdict (053-work-control-room, "The review of a large change"): one line each, in this order,
 * for the tests, the AI review's answer, the models and proofs, and how many of the nodes that need the reviewer are
 * seen. Each says what it counts, and where it goes when there is something to open. What did not run never reads as a
 * pass: no tests, no models or no answer yet are said in plain words, in a quiet tone. Pure.
 */
import type { AssessmentStatus, ChangeAssessment } from '#shared/review/assessment.ts'
import type { ReviewNode } from '#shared/review/types.ts'
import type { Tone } from '../../proofs/run/run-view.ts'
import type { ModelRow } from '../story/node-models.ts'
import { headerBadge, type UnitMatter } from './sidebar.ts'

export interface EvidenceFacts {
  /** Every node of the review, the folded ones too. */
  nodes: readonly Pick<ReviewNode, 'id' | 'kind' | 'status' | 'supports' | 'attention'>[]
  /** The change review, once it is ready. */
  assessment: Pick<ChangeAssessment, 'summary'> | null
  /** How the change review stands, as the host says. */
  status: AssessmentStatus | null | undefined
  /** The parts the panel lists as needing a look, with the step or node each goes to. */
  parts: readonly Pick<UnitMatter, 'level' | 'step' | 'node'>[]
  /** The change's models, as the panel lists them. */
  models: readonly Pick<ModelRow, 'run' | 'tone'>[]
  seen: ReadonlySet<string>
}

/** What a line opens: a node of the graph, a step, the proof beside the review, or the next node that needs the reviewer and is not seen. */
export type EvidenceOpens = { to: 'node'; id: string } | { to: 'step'; index: number } | { to: 'proof' } | { to: 'unseen' }

export interface EvidenceLine {
  key: 'tests' | 'answer' | 'models' | 'seen'
  label: string
  text: string
  tone: Tone
  /** Null when there is nothing to open: the line is plain text. */
  opens: EvidenceOpens | null
}

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const joined = (parts: readonly (string | null)[]) => parts.filter((part) => part != null).join(' · ')

function testsLine(nodes: EvidenceFacts['nodes']): EvidenceLine {
  // A helper the tests use is a test node, and no test of its own.
  const tests = nodes.filter((node) => node.kind === 'test' && !node.supports?.length)
  if (tests.length === 0) return { key: 'tests', label: 'Tests', text: 'None in this change', tone: 'quiet', opens: null }
  const passed = tests.filter((node) => node.status === 'passed' || node.status === 'proves-change')
  const failed = tests.filter((node) => node.status === 'failed')
  const unran = tests.filter((node) => !passed.includes(node) && !failed.includes(node))
  const text = joined([
    passed.length ? counted(passed.length, 'passes', 'pass') : null,
    failed.length ? counted(failed.length, 'fails', 'fail') : null,
    unran.length ? `${unran.length} did not run` : null,
  ])
  const tone: Tone = failed.length ? 'bad' : unran.length ? (passed.length ? 'warn' : 'quiet') : 'ok'
  // A test that failed is the one to read first, then one that did not run.
  const first = failed[0] ?? unran[0] ?? passed[0]!
  return { key: 'tests', label: 'Tests', text, tone, opens: { to: 'node', id: first.id } }
}

function answerLine({ assessment, status, parts }: EvidenceFacts): EvidenceLine {
  const line = (text: string, tone: Tone, opens: EvidenceOpens | null = null): EvidenceLine => ({ key: 'answer', label: 'AI review', text, tone, opens })
  const badge = headerBadge(assessment, status)
  if (badge.kind === 'reviewing') return line(badge.now === 'Waiting for its turn' ? badge.now : badge.label, 'live')
  if (badge.kind === 'failed') return line('Stopped before its answer', 'warn')
  if (badge.kind === 'none') return line('No answer yet', 'quiet')
  const summary = assessment?.summary ?? (status?.state === 'ready' ? status.summary : undefined)
  const needs = summary?.needsYou ?? 0
  const first = parts.find((part) => part.level === 'high' && (part.step != null || part.node != null))
  const opens: EvidenceOpens | null = !needs || !first ? null : first.step != null ? { to: 'step', index: first.step } : { to: 'node', id: first.node! }
  // The header says "Risky to deploy" in full right above: here the line keeps to a narrow panel's width.
  const text = `${badge.deploy === 'risky' ? 'Risky' : 'Safe'} · ${needs ? `${counted(needs, 'part needs', 'parts need')} you` : 'nothing needs you'}`
  return line(text, badge.deploy === 'risky' ? 'bad' : 'ok', opens)
}

function modelsLine(models: EvidenceFacts['models']): EvidenceLine {
  const line = (text: string, tone: Tone, opens: EvidenceOpens | null): EvidenceLine => ({ key: 'models', label: 'Models and proofs', text, tone, opens })
  if (models.length === 0) return line('None in this change', 'quiet', null)
  const of = (...tones: Tone[]) => models.filter((model) => tones.includes(model.tone)).length
  const hold = of('ok', 'warn')
  const fail = of('bad')
  const checking = of('live')
  const unchecked = of('quiet')
  const text =
    hold === models.length
      ? `${hold} of ${counted(hold, 'holds', 'hold')}`
      : joined([
          hold ? counted(hold, 'holds', 'hold') : null,
          fail ? counted(fail, 'fails', 'fail') : null,
          checking ? `${checking} still checking` : null,
          unchecked ? `${unchecked} not checked` : null,
        ])
  const tone: Tone = fail ? 'bad' : checking ? 'live' : hold === 0 ? 'quiet' : unchecked || of('warn') ? 'warn' : 'ok'
  return line(text, tone, models.some((model) => model.run) ? { to: 'proof' } : null)
}

/** How many of the nodes that need the reviewer are not seen yet. */
export function unseenNeeds(nodes: EvidenceFacts['nodes'], seen: ReadonlySet<string>): number {
  return nodes.filter((node) => node.attention?.tier === 'needs-you' && !seen.has(node.id)).length
}

function seenLine({ nodes, seen }: EvidenceFacts): EvidenceLine {
  const line = (text: string, tone: Tone, opens: EvidenceOpens | null = null): EvidenceLine => ({ key: 'seen', label: 'Needs you', text, tone, opens })
  // A review from an older host says nothing of what needs the reviewer.
  if (!nodes.some((node) => node.attention)) return line('Not said in this review', 'quiet')
  const needs = nodes.filter((node) => node.attention?.tier === 'needs-you').length
  if (needs === 0) return line('Nothing', 'quiet')
  const unseen = unseenNeeds(nodes, seen)
  return line(`${needs - unseen} of ${needs} seen`, unseen ? 'warn' : 'ok', unseen ? { to: 'unseen' } : null)
}

export function evidenceLines(facts: EvidenceFacts): EvidenceLine[] {
  return [testsLine(facts.nodes), answerLine(facts), modelsLine(facts.models), seenLine(facts)]
}

/** What the first press of a yes says while nodes that need the reviewer are not seen. Null when every one is. */
export function unseenWords(unseen: number): string | null {
  if (unseen <= 0) return null
  return unseen === 1 ? '1 node that needs you is not seen yet. U goes to it.' : `${unseen} nodes that need you are not seen yet. U goes to the next.`
}
