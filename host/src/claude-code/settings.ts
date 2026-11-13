import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { changeClaudeCode, claudeCodeSettings, type ClaudeCodeChange, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'

/** How hobkin's other agents use Claude Code, kept in `<data root>/client/claude-code.json`. Only the window changes it. */
export class ClaudeCodeSettingsFile {
  private readonly directory: string
  private readonly path: string

  constructor(root: string) {
    this.directory = join(root, 'client')
    this.path = join(this.directory, 'claude-code.json')
  }

  /** What is saved. A missing or unreadable file gives the defaults. */
  read(): ClaudeCodeSettings {
    try {
      return claudeCodeSettings(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      return claudeCodeSettings(null)
    }
  }

  apply(change: ClaudeCodeChange): ClaudeCodeSettings {
    const settings = changeClaudeCode(this.read(), change)
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
