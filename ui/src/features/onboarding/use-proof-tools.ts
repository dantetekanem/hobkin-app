import { useEffect, useRef, useState } from 'react'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { FAILED, lineAfterProofTools, SETTING_UP } from './proof-tools-line.ts'


/**
 * The TLA+ tools, set up by default once the setup opens on a live host (050-tla-proofs): one more step beside Pi,
 * through `setup.install-proof-tools`, while the story goes on. Nothing waits on it. The quiet line says it is running
 * and clears when it is done. A failure goes to `onTrouble` as one short line. On the scripted host, or with no host,
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
      (said) => {
        setLine(null)
        const trouble = lineAfterProofTools(said)
        if (trouble) onTrouble(trouble)
      },
      () => {
        setLine(null)
        onTrouble(FAILED)
      },
    )
    // Once per setup, as soon as a live host answers.
  }, [live])

  return line
}
