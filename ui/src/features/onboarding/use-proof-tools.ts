import { useEffect, useRef, useState } from 'react'
import { runCommand, useHost } from '@/lib/host/index.ts'

/** What the quiet line says while the tools are set up. */
const SETTING_UP = "I'm setting up the TLA+ tools in the background, so my agents can check their models and proofs."
/** Said after a failure, since the YOLO page's button is the way to try again. */
const RETRY = 'Set up TLA+ tools on the YOLO page tries again.'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The TLA+ tools, set up by default once the setup opens on a live host (050-tla-proofs): one more step beside Pi,
 * through `setup.install-proof-tools`, while the story goes on. Nothing waits on it. The quiet line says it is running,
 * then hobkin's own line. A failure goes to `onTrouble` with where to try again. On the scripted host, or with no host,
 * nothing is set up and nothing is said.
 */
export function useProofTools(onTrouble: (words: string) => void): string | null {
  const live = useHost((state) => state.link === 'open' && state.model === 'live')
  const asked = useRef(false)
  const [line, setLine] = useState<string | null>(null)

  useEffect(() => {
    if (!live || asked.current) return
    asked.current = true
    setLine(SETTING_UP)
    runCommand('setup.install-proof-tools').then(
      ({ ok, message }) => {
        if (ok) return setLine(message)
        setLine(null)
        onTrouble(`${message} ${RETRY}`)
      },
      (error: unknown) => {
        setLine(null)
        onTrouble(`I could not set up the TLA+ tools: ${reasonOf(error)} ${RETRY}`)
      },
    )
    // Once per setup, as soon as a live host answers.
  }, [live])

  return line
}
