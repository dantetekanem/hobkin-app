import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTelemetryUpload, telemetryUploadEnabled } from 'hobkin/src/cli/config.mjs'
import { SETUP_FACTS_MAX, SETUP_TEXT_MAX, writeSetupFacts, type SetupFact } from 'hobkin/src/cli/setup-facts.mjs'
import { COMPUTER_KINDS, GOALS, type ProjectFolder, type SetupAnswer, type SetupAnswers, type SetupCardPick, type SetupSaved, type SetupTelemetry } from '#shared/protocol/setup.ts'
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

const named = (cards: readonly SetupCardPick[]) => cards.map(({ id, version, title }) => `${title} (${id}@${version})`).join(', ')

/**
 * The answers as hobkin's facts: each question in the words it was asked with, and what the user said. Whose
 * computer this is stays out, since hobkin's profile already says it in front of the same directions. The goals come
 * first, and the routines kept and turned down last (044-goal-first-setup): the answers make room for them.
 */
export function factsOf({ answers, goals = [], cards = [] }: Pick<SetupAnswers, 'answers' | 'goals' | 'cards'>): SetupFact[] {
  const kept = cards.filter(({ mark }) => mark === 'kept')
  const dropped = cards.filter(({ mark }) => mark === 'dropped')
  const first: SetupFact[] = goals.length ? [{ about: 'What are you working toward right now?', said: goals.join(', ') }] : []
  const last: SetupFact[] = [
    ...(kept.length ? [{ about: 'Routines kept in the setup', said: named(kept) }] : []),
    ...(dropped.length ? [{ about: 'Routine templates turned down in the setup', said: named(dropped) }] : []),
  ]
  const answered = answers.map(({ ask, answer }) => ({ about: ask, said: answer }))
  const flat = ({ about, said }: SetupFact): SetupFact => ({ about: oneLine(about, SETUP_TEXT_MAX), said: oneLine(said, SETUP_TEXT_MAX) })

  const told = [...first, ...answered]
    .map(flat)
    .filter(({ about, said }) => about && said)
    .slice(0, SETUP_FACTS_MAX - last.length)
  return [...told, ...last.map(flat)]
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
const isCard = (value: unknown): value is SetupCardPick => {
  const { id, version, title, mark, changes } = (value ?? {}) as Record<string, unknown>
  const changed = typeof changes === 'object' && changes !== null && Object.values(changes).every(isText)
  return isText(id) && Number.isInteger(version) && isText(title) && (mark === 'kept' || mark === 'dropped') && changed
}
const isGoal = (value: unknown) => GOALS.some((goal) => goal === value)

/** What the app saved, or null when it never saved anything or the file is not one it wrote. */
export function readSetupSaved(root: string): SetupSaved | null {
  try {
    const saved = JSON.parse(readFileSync(fileIn(root), 'utf8')) as Record<string, unknown> | null
    if (saved?.version !== 1) return null
    // A file from before goals and cards has none of them, and one from before the usage question has no answer to it.
    const { computer, answers, projects, goals = [], cards = [], telemetry, savedAt } = saved
    const kind = COMPUTER_KINDS.find((one) => one === computer) ?? null
    if ((computer !== null && !kind) || !isText(savedAt)) return null
    if (!Array.isArray(answers) || !answers.every(isAnswer) || !Array.isArray(projects) || !projects.every(isProject)) return null
    if (!Array.isArray(goals) || !goals.every(isGoal) || !Array.isArray(cards) || !cards.every(isCard)) return null
    if (telemetry !== undefined && typeof telemetry !== 'boolean') return null
    return { computer: kind, answers, projects, goals, cards, ...(telemetry === undefined ? {} : { telemetry }), savedAt }
  } catch {
    // No file yet, or one that cannot be read: the setup starts with empty fields, and nothing else depends on it.
    return null
  }
}

/** The app's own copy, whole, written under another name and moved into place, private to the user. */
function writeSaved(root: string, saved: SetupSaved): void {
  const file = fileIn(root)
  mkdirSync(join(root, 'client'), { recursive: true, mode: 0o700 })
  const draft = `${file}.${process.pid}.tmp`
  writeFileSync(draft, `${JSON.stringify({ version: 1, ...saved })}\n`, { mode: 0o600 })
  renameSync(draft, file)
}

/**
 * Saves both copies, hobkin's first: when it refuses, nothing is written at all and its words say why. The answer to
 * the usage question is not one of the window's answers, so the one kept before stays.
 */
export function saveSetup(root: string, { computer, answers, projects, goals = [], cards = [] }: SetupAnswers, now = new Date()): SetupSaved {
  const telemetry = readSetupSaved(root)?.telemetry
  const saved: SetupSaved = {
    computer: computer ?? null,
    answers,
    projects,
    goals,
    cards,
    ...(telemetry === undefined ? {} : { telemetry }),
    savedAt: now.toISOString(),
  }
  try {
    writeSetupFacts(root, factsOf(saved))
  } catch (error) {
    throw new Unavailable(error instanceof Error ? error.message : String(error))
  }

  writeSaved(root, saved)
  return saved
}

/** Where the usage answer may change hobkin's setting: only a live host on the real home, the one the user runs. */
interface TelemetryHere {
  live: boolean
  real: boolean
}

/**
 * The answer to the setup's question about usage counts (025-onboarding). A live host on the real home saves it as
 * hobkin's own setting, which nothing changes until the user answers. Any other host leaves the setting alone. Either
 * keeps the answer with the setup's, and says whether usage counts go from this home now.
 */
export function keepTelemetryAnswer(root: string, upload: boolean, { live, real }: TelemetryHere, now = new Date()): SetupTelemetry {
  if (live && real) setTelemetryUpload(root, upload)

  const before = readSetupSaved(root)
  const base = before ?? { computer: null, answers: [], projects: [], goals: [], cards: [] }
  writeSaved(root, { ...base, telemetry: upload, savedAt: now.toISOString() })

  return { upload: live && real && telemetryUploadEnabled(root) }
}

export interface SetupAnswerOptions {
  /** The folder the home's data is in. */
  root: () => string
  /** The host runs the real model. Without it the usage answer is kept, and hobkin's setting is left alone. */
  live?: boolean
  /** The host runs on the real home, the one the user runs. Without it the same. */
  real?: boolean
}

export function setupAnswerHandlers({ root, live = false, real = false }: SetupAnswerOptions): HostHandlers {
  return {
    'setup.save': (answers) => saveSetup(root(), answers),
    'setup.saved': () => readSetupSaved(root()),
    'setup.telemetry': ({ upload }) => keepTelemetryAnswer(root(), upload, { live, real }),
  }
}
