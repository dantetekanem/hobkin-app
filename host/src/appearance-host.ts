import { Appearance } from './appearance.ts'
import { AppearanceFile } from './appearance-file.ts'
import type { AppearanceRequest } from '#shared/protocol/appearance.ts'

const admittedRoot = async (root: string): Promise<string> => {
  const { resolveDataRoot } = await import('hobkin/src/cli/migration/admission.mjs')
  return resolveDataRoot(root)
}

/** Optional theme failures do not stop the app; root admission failures never fall back to another directory. */
export async function loadHostAppearance(root: string, onChange: () => void, log: (line: string) => void, resolveRoot = admittedRoot): Promise<Appearance> {
  const file = new AppearanceFile(await resolveRoot(root))
  let ready = false
  const appearance = new Appearance({ file, onChange: () => { if (ready) onChange() } })
  try { appearance.load() }
  catch (error) {
    // An uninitialized home has no root yet. The owner creates it later, not the theme loader.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`Could not load custom theme: ${error instanceof Error ? error.message : String(error)}`)
  }
  ready = true
  return appearance
}

/** The file's validated optional colors join the existing appearance receipt, never raw CSS. */
export function appearanceRequest(appearance: Appearance): AppearanceRequest | null {
  return appearance.state && { ...appearance.state, border: appearance.style?.border, borderStrong: appearance.style?.borderStrong }
}
