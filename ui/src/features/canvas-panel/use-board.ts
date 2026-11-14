import { useEffect, useMemo, useState } from 'react'
import { CANVAS_CLOSED, MAIN_CANVAS, type CanvasState } from '#shared/protocol/canvas.ts'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'
import { useStill } from '@/app/still.ts'
import { splitSizes, useView } from '@/app/view-store.ts'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { splitOwner, windowCanvas } from './rules.ts'
import { useCanvasBoards } from './store.ts'

/**
 * What the views read of each canvas: straight from the host's state, with the window's own part (`store.ts`) over it.
 * Each canvas is its owner's: `main` for the main hobkin's, a durable hobkin's id for its own.
 */

/** `owner`'s canvas as the window shows it (`windowCanvas`), or null while the host has not said. A window with no host at all knows it is closed. */
export function useBoard(owner: string | null): CanvasState | null {
  const host = useHost((state) => {
    if (owner === null) return null
    if (owner === MAIN_CANVAS) return state.canvas
    // A host that tells the canvases and has none for this hobkin has its canvas closed.
    return state.canvases ? (state.canvases[owner] ?? CANVAS_CLOSED) : null
  })
  const closed = useCanvasBoards((state) => (owner === null ? null : (state.boards[owner]?.closed ?? null)))
  const dev = useCanvasBoards((state) => (owner === MAIN_CANVAS ? state.dev : null))
  const hasHost = useHasHost()
  return useMemo(() => {
    if (owner === null) return null
    return windowCanvas(host, { closed, dev }) ?? (hasHost ? null : CANVAS_CLOSED)
  }, [owner, host, closed, dev, hasHost])
}

/** The durable hobkin whose split shows now, with its canvas: its page is on screen and its canvas is open. */
export function useSplit(): { owner: string; canvas: CanvasState & { url: string } } | null {
  const screen = useView((view) => view.screen)
  const openAgent = useView((view) => view.openAgent)
  const id = screen === 'agent' ? hobkinOfAgent(openAgent) : null
  const canvas = useBoard(id)
  return useMemo(() => {
    const owner = splitOwner({ screen, openAgent }, () => canvas)
    if (!owner || !canvas?.url) return null
    return { owner, canvas: { ...canvas, url: canvas.url } }
  }, [screen, openAgent, canvas])
}

/** The split's sizes now, from the window's width as it is resized and the chat's width. */
export function useSplitSizes(): ReturnType<typeof splitSizes> {
  const conversationWidth = useView((view) => view.conversationWidth)
  const [width, setWidth] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 0))
  useEffect(() => {
    const resize = () => setWidth(innerWidth)
    addEventListener('resize', resize)
    return () => removeEventListener('resize', resize)
  }, [])
  return useMemo(() => splitSizes(width, conversationWidth), [width, conversationWidth])
}

/**
 * True once the canvas has arrived where it shows: `seconds` after it mounted, the time its travel takes, or at once
 * under Still. A drawing plays its first entrance only then.
 */
export function useArrival(seconds: number): boolean {
  const still = useStill()
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setArrived(true), seconds * 1000)
    return () => clearTimeout(timer)
  }, [seconds])
  return arrived || still
}
