import { EFFORTS } from '#shared/tiers/tiers.ts'

/** What the message box asks of an agent that works: a model, a thinking level, or what to write instead. */
export type ChangeLine = { model: string } | { effort: (typeof EFFORTS)[number] } | { problem: string }

const MODEL_HELP = 'Write /model and a model, such as /model opus.'
const EFFORT_HELP = `Write /effort and one of ${EFFORTS.join(', ')}.`

/**
 * Whether a line in an agent's message box changes how it works instead of being a message: `/model` with one model,
 * or `/effort` with one of Pi's thinking levels. Anything else, including a line that only mentions them, is a
 * message (null). Spec: 048-work-mac-fixes entry 33.
 */
export function changeLine(text: string): ChangeLine | null {
  const match = /^\/(model|effort)(?:[ \t]+(.*))?$/.exec(text.trim())
  if (!match) return null
  const words = (match[2] ?? '').trim().split(/\s+/).filter(Boolean)
  if (match[1] === 'model') return words.length === 1 ? { model: words[0]! } : { problem: MODEL_HELP }
  const level = EFFORTS.find((effort) => effort === words[0])
  return words.length === 1 && level ? { effort: level } : { problem: EFFORT_HELP }
}
