import {
  CLAUDE_AGENT_KINDS,
  type ClaudeAgentKind,
  type ClaudeEffort,
  type ClaudeModel,
  type ClaudePermission,
} from '#shared/protocol/claude-code.ts'
import { Switch } from '@/components/ui/switch.tsx'
import { useHasHost } from '@/lib/host/index.ts'
import { saveClaudeCode, useClaudeCode, useReadClaudeCode } from './claude-code-store.ts'
import { Choice, Tile } from './SettingsScreen.tsx'
import { claudeCodeValue } from './subscriptions.ts'

const KINDS: Record<ClaudeAgentKind, string> = { work: 'Work', sessions: 'Delegated jobs', routines: 'Routines' }

const MODELS: readonly { value: ClaudeModel; label: string }[] = [
  { value: 'default', label: 'Account default' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
]

const EFFORTS: readonly { value: ClaudeEffort; label: string }[] = [
  { value: 'tier', label: 'Follow the tier' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
]

const PERMISSIONS: readonly { value: ClaudePermission; label: string; says: string }[] = [
  { value: 'auto', label: 'Auto', says: 'A reviewer approves safe actions and asks you when unsure.' },
  { value: 'ask', label: 'Ask me', says: 'Every action that needs approval asks you.' },
  { value: 'edits', label: 'Edits', says: 'File edits go ahead, commands ask.' },
  { value: 'all', label: 'Everything', says: 'No approval, as Pi’s agents work today.' },
]

/**
 * Which of hobkin's other agents run on Claude Code instead of Pi, and how (033-claude-code-agents). A change is
 * saved at once through the host and the tile shows what the host answers. The main chat stays on Pi.
 */
export function ClaudeCodeTile() {
  const hasHost = useHasHost()
  const claude = useReadClaudeCode()
  const problem = useClaudeCode((store) => store.saveProblem)
  const readProblem = useClaudeCode((store) => store.readProblem)
  const apply = saveClaudeCode

  const settings = claude?.settings
  const missing = claude !== null && !claude.status.installed
  const className = 'col-span-6 @max-[820px]:col-span-2'

  if (!settings || missing) {
    return (
      <Tile name="Claude Code" value={settings ? claudeCodeValue(settings) : 'Agents run on Pi'} className={className}>
        <p className="text-[13px] text-muted-foreground">{whyNoChoices(hasHost, missing, readProblem)}</p>
      </Tile>
    )
  }

  return (
    <Tile name="Claude Code" value={claudeCodeValue(settings)} className={className}>
      <label className="flex items-start gap-3">
        <Switch
          checked={settings.enabled}
          onCheckedChange={(enabled) => void apply({ enabled })}
          data-stop=""
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">Run agents on Claude Code</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">Work, delegated jobs and routines. The chat stays on Pi.</span>
        </span>
      </label>
      {settings.enabled ? (
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Agents on Claude Code" className="flex flex-wrap gap-x-6 gap-y-2">
            {CLAUDE_AGENT_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-[13px]">
                <Switch
                  checked={settings.kinds[kind]}
                          onCheckedChange={(on) => void apply({ kinds: { [kind]: on } })}
                  data-stop=""
                />
                {KINDS[kind]}
              </label>
            ))}
          </div>
          <Setting label="Model">
            <Choice label="Model" value={settings.model} options={MODELS} onChoose={(model) => void apply({ model })} />
          </Setting>
          <Setting label="Effort">
            <Choice label="Effort" value={settings.effort} options={EFFORTS} onChoose={(effort) => void apply({ effort })} />
          </Setting>
          <Setting label="Permissions">
            <Choice label="Permissions" value={settings.permissions} options={PERMISSIONS} onChoose={(permissions) => void apply({ permissions })} />
            <p className="text-[12px] text-muted-foreground">{PERMISSIONS.find((choice) => choice.value === settings.permissions)!.says}</p>
          </Setting>
        </div>
      ) : null}
      <p className="text-[12px] text-muted-foreground">Agents on Claude Code spend your Claude subscription.</p>
      {problem ? (
        <p role="alert" className="text-[12px] text-destructive">
          Not saved. {problem}
        </p>
      ) : null}
    </Tile>
  )
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-medium">{label}</h3>
      {children}
    </div>
  )
}

/** What the tile says while it has no choices to offer. */
function whyNoChoices(hasHost: boolean, missing: boolean, readProblem: string | null): string {
  if (!hasHost) return 'Connect to hobkin to run its agents on Claude Code.'
  if (missing) return 'Claude Code is not installed on this Mac. Get it in Subscriptions.'
  if (readProblem) return `Could not look for Claude Code. ${readProblem}`
  return 'Looking for Claude Code…'
}
