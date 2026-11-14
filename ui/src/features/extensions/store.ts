import { create } from 'zustand'
import type { ExtensionEntry, ExtensionsState } from '#shared/pi-resources/wire.ts'
import { runCommand, useHasHost } from '@/lib/host/index.ts'
import { SAMPLE_EXTENSIONS } from './sample-data.ts'

/**
 * The Pi extensions page's state (039-skills-and-extensions): what the host last read from Pi, and the sample for a
 * window with no host. The host answers each command with Pi's packages and extensions as they stand.
 */
interface ExtensionsStore {
  /** What the host last read from Pi. Null until it answers. */
  live: ExtensionsState | null
  /** The sample. A switch changes only this. */
  sample: ExtensionsState
  /** The extensions being turned off or on now, by path. */
  turning: readonly string[]
  /** This window asked Pi to check for updates and waits for the answer. */
  checking: boolean
}

export const useExtensions = create<ExtensionsStore>()(() => ({ live: null, sample: SAMPLE_EXTENSIONS, turning: [], checking: false }))

/** What the page can do. Each rejects with the reason it did not happen, in words the page shows. */
export interface ExtensionActions {
  refresh(): Promise<void>
  checkUpdates(): Promise<void>
  turn(path: string, on: boolean): Promise<void>
}

async function turning(path: string, work: () => Promise<void>): Promise<void> {
  useExtensions.setState(({ turning: now }) => ({ turning: [...now, path] }))
  try {
    await work()
  } finally {
    useExtensions.setState(({ turning: now }) => ({ turning: now.filter((one) => one !== path) }))
  }
}

/** Every answer is the host's whole reading as it stands then, with what Pi's last check found, so the latest is kept. */
const keep = (state: ExtensionsState) => useExtensions.setState({ live: state })

const hostActions: ExtensionActions = {
  refresh: async () => keep(await runCommand('extensions.refresh')),
  checkUpdates: async () => {
    useExtensions.setState({ checking: true })
    try {
      keep(await runCommand('extensions.check-updates'))
    } finally {
      useExtensions.setState({ checking: false })
    }
  },
  turn: (path, on) => turning(path, async () => keep(await (on ? runCommand('extensions.turn-on', { path }) : runCommand('extensions.turn-off', { path })))),
}

const flip = (entries: ExtensionEntry[], path: string, on: boolean) => entries.map((entry) => (entry.path === path ? { ...entry, on } : entry))

const sampleActions: ExtensionActions = {
  refresh: async () => {},
  checkUpdates: async () => {
    useExtensions.setState(({ sample }) => ({ sample: { ...sample, updates: { checking: false, checkedAt: new Date().toISOString() } } }))
  },
  turn: async (path, on) => {
    useExtensions.setState(({ sample }) => ({
      sample: {
        ...sample,
        packages: sample.packages.map((pkg) => ({ ...pkg, extensions: flip(pkg.extensions, path, on) })),
        own: flip(sample.own, path, on),
        builtIn: flip(sample.builtIn, path, on),
      },
    }))
  },
}

export const extensionActions = (live: boolean): ExtensionActions => (live ? hostActions : sampleActions)

/** What the page draws: with a host, only what it read from Pi, and null until it answers. Without one, the sample. */
export function useShownExtensions(): { live: boolean; state: ExtensionsState | null } {
  const live = useHasHost()
  const fromHost = useExtensions((store) => store.live)
  const sample = useExtensions((store) => store.sample)
  return { live, state: live ? fromHost : sample }
}
