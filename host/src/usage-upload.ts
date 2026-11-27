import { telemetryUploadEnabled } from 'hobkin/src/cli/config.mjs'
import { runUploadCommand } from 'hobkin/src/cli/telemetry/sender.mjs'
import type { UsageUpload } from '#shared/protocol/setup.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * hobkin's usage upload, for the setup's question and Settings' Usage events switch (025-onboarding, 020-settings).
 * Both change it as `hobkin telemetry upload on` and `off` do: on is the user's yes, and the next pass enrolls; off also
 * forgets where upload was and what waited. Only a live host on the real home, the one the user runs, changes it.
 */

/** Where hobkin's setting may change: a live host on the real home. */
export interface UsageHere {
  live: boolean
  real: boolean
}

export const savesUsage = ({ live, real }: UsageHere): boolean => live && real

/** Sets hobkin's own upload setting, as its command does. */
export function setUsageUpload(root: string, upload: boolean): void {
  runUploadCommand(root, [upload ? 'on' : 'off'])
}

export interface UsageUploadOptions extends UsageHere {
  /** The folder the home's data is in. */
  root: () => string
}

export function usageUploadHandlers({ root, ...here }: UsageUploadOptions): Pick<HostHandlers, 'usage.read' | 'usage.apply'> {
  const saves = savesUsage(here)
  const read = (): UsageUpload => ({ upload: saves && telemetryUploadEnabled(root()), saves })

  return {
    'usage.read': read,
    'usage.apply': ({ upload }) => {
      if (!saves) throw new Unavailable("This host is not the one on your Mac's own hobkin home, so it does not change whether usage counts are sent.")
      setUsageUpload(root(), upload)
      return read()
    },
  }
}
