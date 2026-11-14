import { useEffect, useRef } from 'react'
import { MAIN_CANVAS, type CanvasKind } from '#shared/protocol/canvas.ts'
import { focusInput, keyboardInCanvas } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { hostStore } from '@/lib/host/index.ts'
import { isOpen, placeMove } from './rules.ts'
import { useCanvasBoards } from './store.ts'
import { useBoard } from './use-board.ts'

declare global {
  interface Window {
    /** Development only: opens and closes the main canvas by hand, for checks. */
    __canvasDev?: {
      show: (url: string, title?: string, drawing?: { kind?: CanvasKind; revision?: number }) => void
      close: () => void
    }
  }
}

/**
 * The view follows the main hobkin's canvas (`040-canvas-board`): opening takes the right side to it, closing goes back
 * to the place it was opened over (`placeMove`). A revision counts as seen while its canvas is in front. Used once, by
 * the right side (`Canvas.tsx`), so its effects live and go with it.
 *
 * `covered`: the right side covers the chat now, so an opening leaves the view where it is. `split`: the durable
 * hobkin's canvas in front, if any.
 */
export function useCanvasPlace({ covered, split }: { covered: boolean; split: { owner: string; revision: number | undefined } | null }): void {
  const main = useBoard(MAIN_CANVAS)
  const screen = useView((view) => view.screen)
  const now = main === null ? null : isOpen(main)
  const before = useRef<boolean | null>(null)

  useEffect(() => {
    const move = placeMove({ before: before.current, now, onPlace: screen === 'canvas', covered })
    if (now !== null) before.current = now
    if (move === 'open') {
      useView.getState().openCanvasPlace()
    } else if (move === 'back') {
      // Read before the canvas goes: where the keyboard is decides whether it goes home.
      const inCanvas = keyboardInCanvas()
      useView.getState().closeCanvasPlace()
      if (inCanvas) focusInput()
    }
  }, [now, screen, covered])

  const revision = main?.revision ?? 0
  useEffect(() => {
    if (screen === 'canvas' && now) useView.getState().seeCanvas(MAIN_CANVAS, revision)
  }, [screen, now, revision])

  const splitOwner = split?.owner ?? null
  const splitRevision = split?.revision ?? 0
  useEffect(() => {
    if (splitOwner) useView.getState().seeCanvas(splitOwner, splitRevision)
  }, [splitOwner, splitRevision])

  // A way to show the main canvas by hand while developing, with or without a host.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__canvasDev = {
      show: (url, title, drawing) =>
        useCanvasBoards.getState().showDev({ open: true, url, title: title ?? null, kind: drawing?.kind ?? 'page', revision: drawing?.revision }, hostStore.getState().canvas),
      close: () => useCanvasBoards.getState().closeHere(MAIN_CANVAS, hostStore.getState().canvas),
    }
    return () => {
      delete window.__canvasDev
    }
  }, [])
}
