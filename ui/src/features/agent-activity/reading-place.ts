import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/** A drawn step, by its key, with where it sits in its list and how tall it is. */
export interface PlacedStep {
  key: string
  top: number
  height: number
}

/** The step the view reads from: the first that still shows below the view's top. */
export const readFrom = (steps: readonly PlacedStep[], scrollTop: number): PlacedStep | null => steps.find((step) => step.top + step.height > scrollTop) ?? null

/**
 * Keeps the reading place while a page of earlier steps comes in above it. `hold` takes the step the view reads from as
 * the page is asked for. Once `page`, the older steps held, has changed, the view moves by as much as that step moved,
 * so the step stays where it was. A step drawn with `data-step-key` can be held. WebKit anchors no scroll by itself.
 */
export function useReadingPlace(scroller: RefObject<HTMLElement | null>, page: unknown): () => void {
  const held = useRef<{ key: string; top: number; page: unknown } | null>(null)

  useLayoutEffect(() => {
    const element = scroller.current
    const place = held.current
    if (!element || !place || place.page === page) return
    held.current = null
    const step = [...element.querySelectorAll<HTMLElement>('[data-step-key]')].find((drawn) => drawn.dataset.stepKey === place.key)
    if (step) element.scrollTop += step.offsetTop - place.top
  })

  return useCallback(() => {
    const element = scroller.current
    if (!element) return
    const drawn = [...element.querySelectorAll<HTMLElement>('[data-step-key]')]
    const steps = drawn.map((step) => ({ key: step.dataset.stepKey ?? '', top: step.offsetTop, height: step.offsetHeight }))
    const step = readFrom(steps, element.scrollTop)
    held.current = step ? { key: step.key, top: step.top, page } : null
  }, [scroller, page])
}
