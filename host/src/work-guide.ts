import type { RunGuide, RunGuideAsked } from '#shared/protocol/work.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The run guide (068-run-guide): a code project's steps to run it, kept in hobkin's home, and the press that asks for a
 * look to write it. Both are hobkin's own functions in `run-guide.mjs`; the host only passes them on.
 */

/** hobkin's functions for the guide. Only a hobkin that has them has them. */
export interface GuideRuntime {
  readRunGuide?: (root: string, slug: string) => Promise<RunGuide> | RunGuide
  requestRunGuide?: (root: string, slug: string) => Promise<RunGuideAsked> | RunGuideAsked
}

/**
 * Loaded when asked, never at start, so an older hobkin without the module still lets the host start. The functions are
 * looked up on the module, not imported by name, so a module without one of them still loads.
 */
export async function loadHobkinGuide(): Promise<GuideRuntime> {
  try {
    return (await import('hobkin/src/cli/work/run-guide.mjs')) as GuideRuntime
  } catch {
    return {}
  }
}

export interface GuideSeat {
  /** The folder the home's data is in. Throws, with the reason, while hobkin is not open in this host. */
  root: () => string
  /** Reads hobkin's state again, so the window shows the look at once. */
  refresh?: () => Promise<unknown>
  runtime?: () => Promise<GuideRuntime> | GuideRuntime
}

const UNAVAILABLE = 'This hobkin cannot keep run guides yet. Update hobkin.'

export function guideHandlers({ root, refresh, runtime = loadHobkinGuide }: GuideSeat): Pick<HostHandlers, 'work.guide.read' | 'work.guide.write'> {
  return {
    'work.guide.read': async ({ slug }) => {
      const { readRunGuide } = await runtime()
      if (!readRunGuide) throw new Unavailable(UNAVAILABLE)
      return readRunGuide(root(), slug)
    },
    'work.guide.write': async ({ slug }) => {
      const { requestRunGuide } = await runtime()
      if (!requestRunGuide) throw new Unavailable(UNAVAILABLE)
      // hobkin's refusal is passed on as it said it.
      const asked = await requestRunGuide(root(), slug)
      // The look is in hobkin's queue either way. Without the read the window catches up at hobkin's next change.
      await refresh?.().catch(() => {})
      return { message: asked.message }
    },
  }
}
