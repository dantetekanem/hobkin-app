import { Unavailable, type HostHandlers } from './commands.ts'
import { refuseInstall } from './pi/install.ts'
import { loadProofRuntime, type ProofRuntime } from './proofs.ts'

/**
 * The TLA+ tools in the first-run setup (050-tla-proofs, 025-onboarding). The setup sets them up by default, as one
 * more step beside Pi, through hobkin's own `setupProof`, the one the YOLO page's Set up button runs: on a Mac without
 * Java 11 or newer it installs the pinned Java runtime into the home's tools folder, then the pinned TLC and, on an
 * Apple-silicon Mac, the pinned TLAPS that checks proofs. What is there
 * already is kept, so a setup run again is cheap. A failure is an answer with hobkin's line, so it never holds the setup up.
 */

export interface ProofToolsSaid {
  ok: boolean
  message: string
}

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** What hobkin's setup answered, as the window shows it. One that says nothing still says whether the tools are ready. */
function saidOf(value: unknown): ProofToolsSaid {
  const { ok, message } = asObject(value)
  const ready = ok === true
  const line = typeof message === 'string' ? oneLine(message) : ''
  return { ok: ready, message: line || (ready ? 'The TLA+ tools are ready.' : 'hobkin could not set up the TLA+ tools.') }
}

/** The entry's installer: hobkin's own proof setup, found the way the proof commands find theirs, run with its home. */
export async function setupProofTools(home: string, runtime: () => Promise<ProofRuntime> = loadProofRuntime): Promise<unknown> {
  const { setup } = await runtime()
  if (!setup) throw new Unavailable('The hobkin running now cannot set up the TLA+ tools. Restart hobkin so it loads the version with TLA+ proofs.')
  return setup({ home })
}

export interface ProofToolsOptions {
  /** The host runs the real model. A scripted development host installs nothing, so a check never changes the Mac. */
  live: boolean
  /** hobkin's home, where the tools go. */
  home: () => string
  /** Sets the tools up in the home and answers as hobkin's `setupProof` does. Only the entry hands in the real one. */
  install?: (home: string) => Promise<unknown>
  /** Looks for the tools again, so the proofs slice and the YOLO page see them. */
  found: () => Promise<void>
}

export function proofToolsHandlers({ live, home, install = refuseInstall, found }: ProofToolsOptions): Pick<HostHandlers, 'setup.install-proof-tools'> {
  // A setup opened again while the first one still downloads waits on that one, so two never unpack into the same folder.
  let running: Promise<ProofToolsSaid> | null = null

  const setUp = async (): Promise<ProofToolsSaid> => {
    let said: ProofToolsSaid
    try {
      said = saidOf(await install(home()))
    } catch (error) {
      said = { ok: false, message: oneLine(error instanceof Error ? error.message : String(error)) || 'hobkin could not set up the TLA+ tools.' }
    }
    await found().catch(() => {})
    return said
  }

  return {
    'setup.install-proof-tools': () => {
      if (!live) throw new Unavailable('This is the scripted development host, so nothing is installed on this Mac. Start the host with --live to set up the TLA+ tools.')
      running ??= setUp().finally(() => {
        running = null
      })
      return running
    },
  }
}
