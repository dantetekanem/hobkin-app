import type { Static } from 'typebox'
import type { CommandName } from '#shared/commands/registry.ts'
import type { IntegrationManifest } from '#shared/integration/manifest.ts'
import { runCommand } from '../lib/host/client.ts'

/** What an integration's command takes, from its manifest's schema. */
export type IntegrationArgs<Manifest extends IntegrationManifest, Name extends keyof Manifest['commands']> = Static<Manifest['commands'][Name]['args']>

/**
 * A runner for an integration's own commands, typed from its manifest and the results it declares. The command is sent
 * as any other, so the host checks its arguments again.
 *
 *     const run = runnerFor<GitHubResults>()(manifest)
 *     await run('github.issue.close', { repo, number, reason })
 */
export function runnerFor<Results extends object>() {
  return <Manifest extends IntegrationManifest>(_manifest: Manifest) =>
    <Name extends keyof Results & keyof Manifest['commands'] & string>(
      name: Name,
      ...args: {} extends IntegrationArgs<Manifest, Name> ? [args?: IntegrationArgs<Manifest, Name>] : [args: IntegrationArgs<Manifest, Name>]
    ): Promise<Results[Name]> =>
      // The window's registry type lists only the app's own commands: an integration's join it when the host starts.
      runCommand(name as CommandName, (args[0] ?? {}) as never) as Promise<Results[Name]>
}
