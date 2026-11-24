import type { WindowPart } from './contract.ts'
import { setWindowParts } from './registry.ts'

type Folders = Record<string, () => Promise<{ default?: unknown }>>

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
  setWindowParts(parts)
  return parts
}
