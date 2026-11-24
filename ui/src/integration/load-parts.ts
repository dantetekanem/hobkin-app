import { registerIntegration, unregisterIntegration } from '#shared/commands/registry.ts'
import type { IntegrationManifest } from '#shared/integration/manifest.ts'
import type { WindowPart } from './contract.ts'
import { setWindowParts } from './registry.ts'

type Folders = Record<string, () => Promise<{ default?: unknown }>>

/** The manifests the last load added to the registry, kept on `globalThis` so a hot update of this module still finds them. */
const slot = globalThis as { __hobkinRegisteredManifests?: readonly IntegrationManifest[] }

/**
 * Loads each folder's window part and hands them to the registry. A folder that fails to load, or whose file does
 * not default-export a part, is logged and left out: the rest of the app runs.
 */
export async function loadWindowParts(folders: Folders, log: (message: string, error?: unknown) => void = console.error): Promise<readonly WindowPart[]> {
  const loaded = await Promise.all(
    Object.entries(folders).map(async ([path, load]): Promise<WindowPart | null> => {
      try {
        const part = (await load()).default as WindowPart | undefined
        if (!part?.manifest?.id) throw new Error('no window part is its default export')
        return part
      } catch (error) {
        log(`integration window part ${path} was left out`, error)
        return null
      }
    }),
  )
  const parts = loaded.filter((part) => part !== null)
  // Its commands and screens join the registry the window knows, in place of what the last load added: a hot update
  // loads the parts again. A refusal is logged and the part stays, so it never loses its screen over a name.
  for (const manifest of slot.__hobkinRegisteredManifests ?? []) unregisterIntegration(manifest)
  const registered: IntegrationManifest[] = []
  for (const { manifest } of parts) {
    try {
      registerIntegration(manifest)
      registered.push(manifest)
    } catch (error) {
      log(`integration ${manifest.id} was not added to the command registry`, error)
    }
  }
  slot.__hobkinRegisteredManifests = registered
  setWindowParts(parts)
  return parts
}
