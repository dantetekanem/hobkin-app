import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { changeClaudeCodeSettings, claudeCodeWithTiers, type ClaudeCodeWithTiers, type ClaudeCodeWithTiersChange } from '#shared/tiers/claude-code.ts'

/**
 * How hobkin's other agents use Claude Code, and which tiers run there, kept in `<data root>/client/claude-code.json`.
 * Only the window changes it.
 */
export class ClaudeCodeSettingsFile {
  private readonly directory: string
  private readonly path: string

  constructor(root: string) {
    this.directory = join(root, 'client')
    this.path = join(this.directory, 'claude-code.json')
  }

  /** What is saved. A missing or unreadable file gives the defaults, and one from before tiers ran on Claude Code has none there. */
  read(): ClaudeCodeWithTiers {
    try {
      return claudeCodeWithTiers(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      return claudeCodeWithTiers(null)
    }
  }

  apply(change: ClaudeCodeWithTiersChange): ClaudeCodeWithTiers {
    const settings = changeClaudeCodeSettings(this.read(), change)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    // A temporary file in the same folder, then a rename, so a crash never leaves half a file.
    const temporary = join(this.directory, `.claude-code.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, this.path)
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {
        // Never written.
      }
      throw error
    }
    return settings
  }
}
