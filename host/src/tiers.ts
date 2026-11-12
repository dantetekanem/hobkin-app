/**
 * hobkin's tiers for delegated work (`017-model-tiers`), read and saved through hobkin's own code: they live in its
 * `config.json`, and the terminal app sees the same ones. A tier is a model and a thinking level; the two tiers a
 * change review uses, Reviewer and Quick, are kept with them.
 */
import type { HostTiers, TiersChange } from '#shared/tiers/tiers.ts'

/** The tiers as hobkin holds them now: the chat's model, each tier as it runs, and the review's two tiers. */
export async function readHostTiers(root: string): Promise<HostTiers> {
  const { readTiers } = await import('hobkin/src/cli/settings.mjs')
  const { main, tiers, review } = readTiers(root)
  return { lead: main, tiers, review }
}

/**
 * Saves a change in one write, or nothing: hobkin checks every model against Pi's catalog and credentials, and every
 * thinking level against what its model offers. `modelRuntime` is that catalog, as the open conversation has it.
 */
export async function applyHostTiers(root: string, change: TiersChange, modelRuntime: unknown): Promise<HostTiers> {
  const { updateTiers } = await import('hobkin/src/cli/settings.mjs')
  const { main, tiers, review } = await updateTiers(root, change, { modelRuntime })
  return { lead: main, tiers, review }
}
