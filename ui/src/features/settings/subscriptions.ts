import { CLAUDE_AGENT_KINDS, type ClaudeAgentKind, type ClaudeCodeSettings, type ClaudeCodeState } from '#shared/protocol/claude-code.ts'
import type { ProviderAccess } from '#shared/protocol/models.ts'
import { claudeTiersOf } from '#shared/tiers/claude-code.ts'
import { TIER_IDS, TIER_INFO } from '#shared/tiers/tiers.ts'

/** One line of the Subscriptions tile. */
export interface SubscriptionRow {
  id: string
  name: string
  /** How Pi or this Mac reaches it. */
  how: string
  /** A second line, such as whether agents use it. */
  note?: string
  /** Offer the install link. */
  install?: true
}

const CONNECTED_BY = {
  key: 'API key',
  environment: 'Key from the environment',
  cloud: 'Cloud credentials',
  launcher: 'Through the launcher',
} as const

/** How Pi reaches a connected provider. Falls back on the routes it offers when Pi cannot tell. */
function howConnected(provider: ProviderAccess): string {
  const by = provider.connectedBy ?? (provider.signIn ? 'sign-in' : provider.apiKey ? 'key' : provider.cloud ? 'cloud' : null)
  if (by === 'sign-in') return provider.signIn?.subscription ? 'Subscription' : 'Signed in'
  return by ? CONNECTED_BY[by] : 'Connected'
}

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

const NOT_SIGNED_IN = 'Not signed in: run claude once in a terminal to sign in'

/** The kinds of agent the tile's switches send to Claude Code at every tier. */
const kindsOn = (settings: ClaudeCodeSettings) => (settings.enabled ? CLAUDE_AGENT_KINDS.filter((kind) => settings.kinds[kind]) : [])

/** The tiers that run on Claude Code by themselves, as the host reported them. */
const tiersOn = (settings: ClaudeCodeSettings) => {
  const tiers = claudeTiersOf(settings) ?? {}
  return TIER_IDS.filter((tier) => tiers[tier])
}

function claudeRow(state: ClaudeCodeState): SubscriptionRow {
  const { status, settings } = state
  const row = { id: 'claude-code', name: 'Claude Code' }
  if (!status.installed) return { ...row, how: 'Not installed', install: true }
  const version = status.version ? `Claude Code ${status.version}` : 'Claude Code'
  if (status.signedIn === false) return { ...row, how: version, note: NOT_SIGNED_IN }
  // A key in the environment wins over a claude.ai sign-in, and then agents bill the API.
  const via = status.authMethod === 'api_key' ? 'API key' : status.plan ? capitalized(status.plan) : null
  return {
    ...row,
    how: via ? `${version}, ${via}` : version,
    note: kindsOn(settings).length > 0 || tiersOn(settings).length > 0 ? 'Used by agents' : 'Available',
  }
}

/** The providers Pi can reach, then Claude Code once the host has said what it found. */
export function subscriptionRows(providers: readonly ProviderAccess[], claude: ClaudeCodeState | null): SubscriptionRow[] {
  const rows = providers
    .filter((provider) => provider.connected)
    .map((provider) => ({ id: provider.id, name: provider.name, how: howConnected(provider) }))
  return claude ? [...rows, claudeRow(claude)] : rows
}

/** What the tile's heading says: how many ways in, counting only what works. */
export function subscriptionsValue(rows: readonly SubscriptionRow[]): string {
  const count = rows.filter((row) => !row.install && row.note !== NOT_SIGNED_IN).length
  return count === 0 ? 'Nothing connected' : `${count} connected`
}

const KIND_WORDS: Record<ClaudeAgentKind, string> = { work: 'Work', sessions: 'delegated jobs', routines: 'routines' }

const listed = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]!)

/** What the Claude Code tile's heading says: which agents run on Claude Code, or with no kind switched on, which tiers. */
export function claudeCodeValue(settings: ClaudeCodeSettings): string {
  const kinds = kindsOn(settings).map((kind) => KIND_WORDS[kind])
  if (kinds.length > 0) return `${capitalized(listed(kinds))} on Claude Code`
  const tiers = tiersOn(settings).map((tier) => TIER_INFO[tier].label)
  return tiers.length > 0 ? `${listed(tiers)} on Claude Code` : 'Agents run on Pi'
}
