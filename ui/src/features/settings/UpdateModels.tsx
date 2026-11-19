import { useState } from 'react'
import type { ModelsUpdate } from '#shared/protocol/models.ts'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/client.ts'

const SHOWN = 3

/** What an update found, in one line: the new models (up to three named), none, or what failed by provider. */
export function updateLine(result: ModelsUpdate): string {
  const named = (provider: string) => result.providers.find(({ id }) => id === provider)?.name ?? provider
  const failed = result.errors.map(({ provider, message }) => `${named(provider)}: ${message}`).join('; ')
  const { added } = result
  const found = added.length
    ? `${added.length} new ${added.length === 1 ? 'model' : 'models'}: ${added.slice(0, SHOWN).join(', ')}${added.length > SHOWN ? ` and ${added.length - SHOWN} more` : ''}`
    : 'No new models'
  return failed ? `${found}. Could not update ${failed}` : found
}

/** Pi's own catalog refresh from the Models tile. The slice carries the new list, so the pickers show it at once. */
export function UpdateModels() {
  const [state, setState] = useState<{ running: boolean; line: string | null }>({ running: false, line: null })

  const update = () => {
    if (state.running) return
    setState({ running: true, line: null })
    runCommand('models.update').then(
      (result) => setState({ running: false, line: updateLine(result) }),
      (error: unknown) => setState({ running: false, line: error instanceof Error ? error.message : String(error) }),
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" className="w-fit" data-stop="" disabled={state.running} onClick={update}>
        {state.running ? 'Updating models…' : 'Update models'}
      </Button>
      {state.line && (
        <p role="status" className="text-[12px] text-muted-foreground">
          {state.line}
        </p>
      )}
    </div>
  )
}
