import { useRef } from 'react'
import type { HobkinSummary } from '#shared/protocol/hobkins.ts'
import { useNewHobkin } from './store.ts'

/**
 * Whether a durable hobkin's page draws the crab pal beside its face: it runs on Claude Code. Known from the moment this
 * window starts one, before the host lists it, and kept once it has ended, so the header never changes its width.
 */
export function useOnClaudeCode(id: string, hobkin: HobkinSummary | undefined): boolean {
  const startedOnClaude = useNewHobkin((store) => store.started?.id === id && store.last.engine?.kind === 'claude')
  const known = useRef<{ id: string; onClaude: boolean } | null>(null)
  if (hobkin) known.current = { id, onClaude: hobkin.engine.kind === 'claude' }
  return known.current?.id === id ? known.current.onClaude : startedOnClaude
}
