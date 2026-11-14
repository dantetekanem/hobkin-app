import { homedir } from 'node:os'
import { sep } from 'node:path'
import { scrubText } from '#shared/integrations/redact.ts'
import { SKILLS_UNKNOWN, type PackageRef, type SkillEntry, type SkillFile, type SkillsState } from '#shared/pi-resources/wire.ts'
import { Unavailable } from './commands.ts'

/**
 * Skills (_specs/039-skills-and-extensions): every skill Pi has, as `pi config` lists them for the user, with Pi's own
 * reading of each file. Turning one off or on runs the code `pi config` runs (pi-resources.ts), so the terminal and
 * this page always agree. Nothing is read until a page asks, nothing changes but on a click, and no skill file is
 * ever moved, edited or deleted here.
 */

/** One skill as Pi has it, with its paths as they are on disk. They are shown with ~ only on the way out. */
export interface PiSkill {
  path: string
  /** Where the file really is, through any link. */
  file: string
  enabled: boolean
  from: SkillEntry['from']
  package: PackageRef | null
  name: string
  description: string
  commandOnly: boolean
  shadowedBy: string | null
  problem: string | null
}

/** Pi's skills over its own code, or a stand-in in tests. */
export interface SkillSource {
  /** The settings file that turning a skill off or on writes. */
  readonly settingsPath: string
  /** Every skill as `pi config` lists it, in Pi's order, and what Pi could not read. It installs nothing. */
  list(): Promise<{ skills: PiSkill[]; problems: string[] }>
  /** Turns one skill off or on through `pi config`'s own code. Throws with Pi's reason when it could not write. */
  setEnabled(path: string, on: boolean): Promise<void>
  /** The start of a skill's file, at most `limit` bytes of it. */
  read(path: string, limit: number): { text: string; cut: boolean }
}

/** The most of one skill's file that View more shows. */
export const SKILL_READ_LIMIT = 256 * 1024

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A path the way the window shows it: ~ for the home folder. */
export function shownPath(path: string): string {
  const home = homedir()
  if (path === home) return '~'
  if (path.startsWith(`${home}${sep}`)) return `~${path.slice(home.length)}`
  return path
}

/** A file's text after its frontmatter, the way Pi splits a skill file (`utils/frontmatter.js`). */
export function afterFrontmatter(text: string): string {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---')) return normalized.trim()
  const end = normalized.indexOf('\n---', 3)
  return end === -1 ? normalized.trim() : normalized.slice(end + 4).trim()
}

const entryOf = (skill: PiSkill): SkillEntry => ({
  path: skill.path,
  file: shownPath(skill.file),
  name: skill.name,
  description: skill.description,
  on: skill.enabled,
  from: skill.from,
  package: skill.package ? { source: scrubText(skill.package.source), name: skill.package.name } : null,
  shadowedBy: skill.shadowedBy === null ? null : shownPath(skill.shadowedBy),
  commandOnly: skill.commandOnly,
  problem: skill.problem === null ? null : scrubText(skill.problem),
})

export interface SkillsOptions {
  /** Pi's skills. Opened when first needed, since it loads Pi. */
  source: () => Promise<SkillSource>
  log?: (line: string) => void
}

export class Skills {
  private current: SkillsState = SKILLS_UNKNOWN
  private opened: Promise<SkillSource> | null = null
  private reading: Promise<SkillsState> | null = null
  /** Each skill as Pi listed it last, by its path. It never leaves the host as it is. */
  private listed = new Map<string, PiSkill>()
  private readonly options: SkillsOptions

  constructor(options: SkillsOptions) {
    this.options = options
  }

  get state(): SkillsState {
    return this.current
  }

  /** Reads Pi's skills again. A read already under way answers this one too. */
  refresh(): Promise<SkillsState> {
    this.reading ??= this.look().finally(() => {
      this.reading = null
    })
    return this.reading
  }

  /** One skill in full: its description and the rest of its file. Only a file on Pi's list is read. */
  async read(path: string): Promise<SkillFile> {
    const { source, skill } = await this.known(path)
    let start: { text: string; cut: boolean }
    try {
      start = source.read(path, SKILL_READ_LIMIT)
    } catch (error) {
      throw new Unavailable(`Could not read ${skill.name}: ${scrubText(messageOf(error))}`)
    }

    return {
      path,
      name: skill.name,
      description: skill.description,
      body: afterFrontmatter(start.text),
      cut: start.cut,
    }
  }

  turnOff(path: string): Promise<SkillsState> {
    return this.turn(path, false)
  }

  turnOn(path: string): Promise<SkillsState> {
    return this.turn(path, true)
  }

  /** Writes the change through Pi, then reads Pi's list again, so what the page shows is what Pi now has. */
  private async turn(path: string, on: boolean): Promise<SkillsState> {
    const { source, skill } = await this.known(path)
    try {
      await source.setEnabled(path, on)
    } catch (error) {
      throw new Unavailable(`Pi could not turn ${skill.name} ${on ? 'on' : 'off'}: ${scrubText(messageOf(error))}`)
    }

    const state = await this.relist(source)
    const unchanged = this.listed.get(path)?.enabled === !on
    if (unchanged) throw new Unavailable(`Pi still has ${skill.name} ${on ? 'off' : 'on'}. Its settings are in ${state.settings ?? 'settings.json'}.`)
    return state
  }

  private async look(): Promise<SkillsState> {
    const source = await this.source().catch(() => null)
    return source ? this.relist(source) : this.current
  }

  /** Pi's code, loaded once. When this Pi does not have what Skills uses, the page says so. */
  private source(): Promise<SkillSource> {
    this.opened ??= this.options.source().catch((error: unknown) => {
      this.opened = null
      const message = `Skills could not load Pi's code: ${scrubText(messageOf(error))}`
      this.options.log?.(message)
      this.change({ error: message })
      throw new Unavailable(message)
    })
    return this.opened
  }

  /** The source and the skill at this path, reading Pi's list again when the last one does not have it. */
  private async known(path: string): Promise<{ source: SkillSource; skill: PiSkill }> {
    const source = await this.source()
    if (!this.listed.has(path)) await this.relist(source)
    const skill = this.listed.get(path)
    if (!skill) throw new Unavailable(`That file is not one of Pi's skills: ${shownPath(path)}.`)
    return { source, skill }
  }

  private async relist(source: SkillSource): Promise<SkillsState> {
    let listed: Awaited<ReturnType<SkillSource['list']>>
    try {
      listed = await source.list()
    } catch (error) {
      const message = `Could not read Pi's skills: ${scrubText(messageOf(error))}`
      this.options.log?.(message)
      return this.change({ settings: shownPath(source.settingsPath), error: message })
    }
    this.listed = new Map(listed.skills.map((skill) => [skill.path, skill]))
    return this.change({
      settings: shownPath(source.settingsPath),
      skills: listed.skills.map(entryOf),
      problems: listed.problems.map((problem) => scrubText(problem)),
      readAt: new Date().toISOString(),
      error: null,
    })
  }

  private change(change: Partial<SkillsState>): SkillsState {
    this.current = { ...this.current, ...change }
    return this.current
  }
}
