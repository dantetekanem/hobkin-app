import type { ActivityEntry } from '#shared/protocol/activity.ts'

/**
 * The skills an agent loaded (_specs/070-load-skill), read from its activity alone: a call to hobkin's `load_skill` tool
 * with the skill's `name`, a read of a file named `SKILL.md` (named by its folder), and Claude Code's own `Skill` tool
 * with its `skill`, as a run on Claude Code reaches hobkin (host/src/claude-code/stream.ts keeps its tool names and
 * inputs). A failed load counts for nothing. One still running counts, as a task call does, so it never shows as a step
 * and then leaves the transcript.
 *
 * Pure, so its rules are tested without a window. Each entry is read once: the list is read again on every step.
 */

/** The names steps.ts's `familyOf` reads as a read, Pi's `read` and Claude Code's `Read` among them. */
const READ = /^(read|read_?file|view)$/i

type Args = Record<string, unknown>

function argsOf(entry: ActivityEntry): Args {
  try {
    const value: unknown = entry.input ? JSON.parse(entry.input) : null
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Args) : {}
  } catch {
    return {}
  }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** A read's file, as Pi's and Claude Code's read tools take it. */
const pathOf = (args: Args) => text(args.path) ?? text(args.file_path) ?? text(args.filePath) ?? text(args.file)

/** The folder a `SKILL.md` sits in, which is its skill's name. */
const SKILL_FILE = /([^/]+)\/SKILL\.md$/

function nameOf(entry: ActivityEntry): string | null {
  if (entry.kind !== 'tool' || entry.state === 'failed') return null
  if (entry.name === 'load_skill') return text(argsOf(entry).name) ?? null
  if (entry.name === 'Skill') return text(argsOf(entry).skill) ?? null
  if (!READ.test(entry.name ?? '')) return null
  return SKILL_FILE.exec(pathOf(argsOf(entry)) ?? '')?.[1] ?? null
}

const named = new WeakMap<ActivityEntry, string | null>()

/** The skill this entry loaded, or null. */
export function skillOf(entry: ActivityEntry): string | null {
  let name = named.get(entry)
  if (name === undefined) named.set(entry, (name = nameOf(entry)))
  return name
}

/** The entry loaded a skill, so a page that shows the loaded skills in their own line does not draw it as a step. */
export const isSkillLoad = (entry: ActivityEntry): boolean => skillOf(entry) !== null

/** Every skill the agent loaded, each once, in the order it first loaded them. */
export function skillsOf(entries: readonly ActivityEntry[]): readonly string[] {
  const skills = new Set<string>()
  for (const entry of entries) {
    const name = skillOf(entry)
    if (name !== null) skills.add(name)
  }
  return [...skills]
}

export const sameSkills = (left: readonly string[], right: readonly string[]): boolean => left === right || (left.length === right.length && left.every((name, index) => name === right[index]))

/** The line's words: "1 loaded skill", "3 loaded skills". */
export const skillsCount = (count: number): string => (count === 1 ? '1 loaded skill' : `${count} loaded skills`)
