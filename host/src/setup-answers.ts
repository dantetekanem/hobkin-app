import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETUP_FACTS_MAX, SETUP_TEXT_MAX, writeSetupFacts, type SetupFact } from 'hobkin/src/cli/setup-facts.mjs'
import { COMPUTER_KINDS, type ProjectFolder, type SetupAnswer, type SetupAnswers, type SetupSaved } from '#shared/protocol/setup.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The first context (025-onboarding): what the user answered in the setup, kept twice. The app keeps it whole in
 * `client/setup.json`, to show again when the setup runs again (014-continuity). hobkin keeps each answer as one
 * short line in its own `setup.json`, which it puts in front of its directions, so the main chat, its checks and
 * its work agents know them from the first conversation.
 */

const fileIn = (root: string) => join(root, 'client', 'setup.json')

// Line and paragraph separators break a line too, and hobkin refuses a fact with any of these in it.
const BREAKS = /[\s\x00-\x1f\x7f-\x9f\p{Zl}\p{Zp}]+/gu

/** One line, at most `most` long. A longer one ends at its last whole word, with an ellipsis, rather than being refused. */
export function oneLine(text: string, most: number): string {
  const flat = text.replace(BREAKS, ' ').trim()
  if (flat.length <= most) return flat
  const room = flat.slice(0, most - 1)
  const whole = flat[most - 1] === ' ' ? room : room.replace(/\s*\S*$/, '')
  return `${(whole || room).replace(/[\s,;:]+$/, '')}…`
}

/**
 * The answers as hobkin's facts: each question in the words it was asked with, and what the user said. Whose
 * computer this is stays out, since hobkin's profile already says it in front of the same directions.
 */
export function factsOf({ answers }: Pick<SetupAnswers, 'answers'>): SetupFact[] {
  return answers
    .map(({ ask, answer }) => ({ about: oneLine(ask, SETUP_TEXT_MAX), said: oneLine(answer, SETUP_TEXT_MAX) }))
    .filter(({ about, said }) => about && said)
    .slice(0, SETUP_FACTS_MAX)
}

const isText = (value: unknown): value is string => typeof value === 'string'
const isAnswer = (value: unknown): value is SetupAnswer => {
  const { id, ask, answer } = (value ?? {}) as Record<string, unknown>
  return isText(id) && isText(ask) && isText(answer)
}
const isProject = (value: unknown): value is ProjectFolder => {
  const { name, path, git } = (value ?? {}) as Record<string, unknown>
  return isText(name) && isText(path) && typeof git === 'boolean'
}

/** What the app saved, or null when it never saved anything or the file is not one it wrote. */
export function readSetupSaved(root: string): SetupSaved | null {
  try {
    const saved = JSON.parse(readFileSync(fileIn(root), 'utf8')) as Record<string, unknown> | null
    if (saved?.version !== 1) return null
    const { computer, answers, projects, savedAt } = saved
    const kind = COMPUTER_KINDS.find((one) => one === computer) ?? null
    if ((computer !== null && !kind) || !isText(savedAt)) return null
    if (!Array.isArray(answers) || !answers.every(isAnswer) || !Array.isArray(projects) || !projects.every(isProject)) return null
    return { computer: kind, answers, projects, savedAt }
  } catch {
    // No file yet, or one that cannot be read: the setup starts with empty fields, and nothing else depends on it.
    return null
  }
}

/** Saves both copies, hobkin's first: when it refuses, nothing is written at all and its words say why. */
export function saveSetup(root: string, { computer, answers, projects }: SetupAnswers, now = new Date()): SetupSaved {
  const saved: SetupSaved = { computer: computer ?? null, answers, projects, savedAt: now.toISOString() }
  try {
    writeSetupFacts(root, factsOf(saved))
  } catch (error) {
    throw new Unavailable(error instanceof Error ? error.message : String(error))
  }

  const file = fileIn(root)
  mkdirSync(join(root, 'client'), { recursive: true, mode: 0o700 })
  const draft = `${file}.${process.pid}.tmp`
  writeFileSync(draft, `${JSON.stringify({ version: 1, ...saved })}\n`, { mode: 0o600 })
  renameSync(draft, file)
  return saved
}

export interface SetupAnswerOptions {
  /** The folder the home's data is in. */
  root: () => string
}

export function setupAnswerHandlers({ root }: SetupAnswerOptions): HostHandlers {
  return {
    'setup.save': (answers) => saveSetup(root(), answers),
    'setup.saved': () => readSetupSaved(root()),
  }
}
