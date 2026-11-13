/**
 * Claude Code on this Mac, and how hobkin's other agents use it (`033-claude-code-agents`). The main chat always runs
 * on Pi. Work runs, the jobs hobkin delegates and routines may run on the `claude` CLI in headless mode instead.
 */

/** Where to get Claude Code when this Mac has none. */
export const CLAUDE_CODE_INSTALL_URL = 'https://code.claude.com/docs/en/quickstart'

/** What the host found when it last looked for the `claude` CLI. */
export interface ClaudeCodeStatus {
  installed: boolean
  /** Such as "2.1.323", from `claude --version`. */
  version: string | null
  /** Signed in, as `claude auth status` says. Null when it could not tell. */
  signedIn: boolean | null
  /** How it reaches Claude, such as "claude.ai" for a subscription. Null when not signed in or unknown. */
  authMethod: string | null
  /** The plan of a claude.ai sign-in, such as "pro" or "max". */
  plan: string | null
}

export const CLAUDE_AGENT_KINDS = ['work', 'sessions', 'routines'] as const
export type ClaudeAgentKind = (typeof CLAUDE_AGENT_KINDS)[number]

/** `default` passes no model, so Claude Code uses its own default for the account. The rest are its aliases. */
export const CLAUDE_MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable'] as const
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]

/** `tier` follows the thinking level the agent's tier gives it. The rest are Claude Code's `--effort` levels. */
export const CLAUDE_EFFORTS = ['tier', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number]

/**
 * What an agent may do without asking. `auto`: Claude Code's reviewer approves safe actions and the user is asked
 * when it is unsure. `ask`: every action that needs approval asks the user. `edits`: file edits go ahead, commands ask.
 * `all`: everything goes ahead, as Pi's agents do today.
 */
export const CLAUDE_PERMISSIONS = ['auto', 'ask', 'edits', 'all'] as const
export type ClaudePermission = (typeof CLAUDE_PERMISSIONS)[number]

/** The `--permission-mode` each choice passes to Claude Code. */
export const PERMISSION_MODE: Record<ClaudePermission, string> = {
  auto: 'auto',
  ask: 'default',
  edits: 'acceptEdits',
  all: 'bypassPermissions',
}

export interface ClaudeCodeSettings {
  /** hobkin's other agents run on Claude Code instead of Pi. */
  enabled: boolean
  /** Which of them: Work runs, the jobs hobkin delegates with `hobkin session`, and routines. */
  kinds: Record<ClaudeAgentKind, boolean>
  model: ClaudeModel
  effort: ClaudeEffort
  permissions: ClaudePermission
}

export const CLAUDE_CODE_DEFAULTS: ClaudeCodeSettings = {
  enabled: false,
  kinds: { work: true, sessions: true, routines: true },
  model: 'default',
  effort: 'tier',
  permissions: 'auto',
}

/** What `claude-code.read` and `claude-code.apply` answer with. */
export interface ClaudeCodeState {
  status: ClaudeCodeStatus
  settings: ClaudeCodeSettings
}

/** A change to the settings. Whatever is left out stays as it is. */
export interface ClaudeCodeChange {
  enabled?: boolean
  kinds?: Partial<Record<ClaudeAgentKind, boolean>>
  model?: ClaudeModel
  effort?: ClaudeEffort
  permissions?: ClaudePermission
}

const oneOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/** Settings read from a file or a message, with anything missing or unknown back at its default. */
export function claudeCodeSettings(value: unknown): ClaudeCodeSettings {
  const given = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const kinds = given.kinds && typeof given.kinds === 'object' ? (given.kinds as Record<string, unknown>) : {}
  return {
    enabled: given.enabled === true,
    kinds: Object.fromEntries(
      CLAUDE_AGENT_KINDS.map((kind) => [kind, flag(kinds[kind], CLAUDE_CODE_DEFAULTS.kinds[kind])]),
    ) as Record<ClaudeAgentKind, boolean>,
    model: oneOf(CLAUDE_MODELS, given.model, CLAUDE_CODE_DEFAULTS.model),
    effort: oneOf(CLAUDE_EFFORTS, given.effort, CLAUDE_CODE_DEFAULTS.effort),
    permissions: oneOf(CLAUDE_PERMISSIONS, given.permissions, CLAUDE_CODE_DEFAULTS.permissions),
  }
}

/** The settings after a change. */
export function changeClaudeCode(settings: ClaudeCodeSettings, change: ClaudeCodeChange): ClaudeCodeSettings {
  return claudeCodeSettings({ ...settings, ...change, kinds: { ...settings.kinds, ...change.kinds } })
}
