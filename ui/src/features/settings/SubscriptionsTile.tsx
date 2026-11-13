import { CLAUDE_CODE_INSTALL_URL } from '#shared/protocol/claude-code.ts'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/client.ts'
import { useModels } from '@/lib/host/hooks.ts'
import { useReadClaudeCode } from './claude-code-store.ts'
import { Tile } from './SettingsScreen.tsx'
import { subscriptionRows, subscriptionsValue } from './subscriptions.ts'

/** Every way Pi reaches a model provider, and Claude Code, with how each is connected (033-claude-code-agents). */
export function SubscriptionsTile() {
  const { providers, sample } = useModels()
  const claude = useReadClaudeCode()
  const rows = subscriptionRows(providers, claude)

  return (
    <Tile name="Subscriptions" value={sample ? 'Sample values' : subscriptionsValue(rows)} className="col-span-6 @max-[820px]:col-span-2">
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-surface px-4 py-2.5">
            <span className="text-[14px] font-medium">{row.name}</span>
            <span className="flex items-center gap-3 text-[13px] text-muted-foreground">
              <span>
                {row.how}
                {row.note ? `. ${row.note}` : ''}
              </span>
              {row.install ? (
                <Button variant="outline" size="sm" data-stop="" onClick={openInstallPage}>
                  Get Claude Code
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Tile>
  )
}

/** Claude Code's install page, in the browser. */
function openInstallPage() {
  void runCommand('system.open', { url: CLAUDE_CODE_INSTALL_URL }).catch(() => {})
}
