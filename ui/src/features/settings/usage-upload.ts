import { useEffect, useState } from 'react'
import type { UsageUpload } from '#shared/protocol/setup.ts'
import { runCommand, useHasHost } from '@/lib/host/index.ts'

/**
 * Settings' Usage events switch (020-settings, 025-onboarding). On the real home, through a live host, it is hobkin's
 * own upload setting: on is a yes, and the next pass enrolls; off forgets what waited. Anywhere else it stays in this
 * window, as it always did, and says so.
 */

const SAYS = 'Which parts of hobkin were used and how runs ended, as counts and fixed words. Never a message, a report, a name or a path.'
const NOT_HERE = "This hobkin is not your Mac's own, so the switch stays in this window and nothing is sent."
const NOT_YET = 'Until hobkin answers, the switch stays in this window.'

export interface UsageSwitch {
  checked: boolean
  /** The switch changes hobkin's own setting through the host. */
  onHost: boolean
  says: string
}

/** The switch as it shows: hobkin's setting where the host keeps it, and otherwise the window's own, which says so. */
export function usageSwitch(host: UsageUpload | null, local: boolean): UsageSwitch {
  if (host?.saves) return { checked: host.upload, onHost: true, says: SAYS }
  return { checked: local, onHost: false, says: `${SAYS} ${host ? NOT_HERE : NOT_YET}` }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** hobkin's upload setting as the host says it, null without a host or from one that does not say, and the way to change it. */
export function useUsageUpload() {
  const hasHost = useHasHost()
  const [host, setHost] = useState<UsageUpload | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  useEffect(() => {
    if (!hasHost) {
      setHost(null)
      return
    }
    let current = true
    runCommand('usage.read').then(
      (read) => {
        if (current) setHost(read)
      },
      () => {
        if (current) setHost(null)
      },
    )
    return () => {
      current = false
    }
  }, [hasHost])

  const apply = async (upload: boolean) => {
    try {
      setHost(await runCommand('usage.apply', { upload }))
      setTrouble(null)
    } catch (error) {
      setTrouble(`I could not change it: ${reasonOf(error)}`)
    }
  }

  return { host, trouble, apply }
}
