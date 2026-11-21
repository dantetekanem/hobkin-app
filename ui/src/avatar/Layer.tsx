import type { CSSProperties, ReactNode, Ref } from 'react'
import { ART_BOX, originAt, type ArtPoint } from './pets.ts'

const VIEW_BOX = `${ART_BOX.min} ${ART_BOX.min} ${ART_BOX.size} ${ART_BOX.size}`

/** A drawing that fills one of a face's boxes, in the art's units. */
export function Art({ children }: { children: ReactNode }) {
  return <svg viewBox={VIEW_BOX}>{children}</svg>
}

interface LayerProps {
  /** Classes in hob.css that pose or loop this box. */
  className: string
  /** The point of the art the box turns and grows about. */
  at?: ArtPoint
  style?: CSSProperties
  ref?: Ref<HTMLSpanElement>
  children: ReactNode
}

/**
 * One of a face's boxes: the art's square, stacked over the boxes before it. Its classes in hob.css move it, about `at`,
 * and WebKit moves an HTML box on the compositor.
 */
export function Layer({ className, at, style, ref, children }: LayerProps) {
  const origin = at ? { transformOrigin: originAt(at) } : undefined

  return (
    <span ref={ref} className={`hob-layer ${className}`} style={{ ...origin, ...style }}>
      {children}
    </span>
  )
}
