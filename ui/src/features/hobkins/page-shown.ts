import type { HobkinSummary } from '#shared/protocol/hobkins.ts'

/**
 * Whether the window should tell the host a hobkin's page is on screen, so a hobkin that waits has its Pi process
 * ready before the next message (spec 034). Its id when the page is on screen, the window is showing, and the hobkin
 * waits on Pi (a tier or a model; not Claude Code). Otherwise null.
 */
export function pageShownId({ onPage, windowShowing, hobkin }: { onPage: boolean; windowShowing: boolean; hobkin: Pick<HobkinSummary, 'id' | 'state' | 'engine'> | null }): string | null {
  if (!onPage || !windowShowing || !hobkin) return null
  return hobkin.state === 'waiting' && hobkin.engine.kind !== 'claude' ? hobkin.id : null
}
