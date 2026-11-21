import type { CSSProperties, ReactNode, Ref } from 'react'
import { ART_BOX, originAt, type ArtPoint } from './pets.ts'

const VIEW_BOX = `${ART_BOX.min} ${ART_BOX.min} ${ART_BOX.size} ${ART_BOX.size}`

/** A drawing that fills one of a face's boxes, in the art's units. */
export function Art({ children }: { children: ReactNode }) {
  return <svg viewBox={VIEW_BOX}>{children}</svg>
}

/**
 * One of a face's boxes: the art's square, stacked over the boxes before it. Its classes in hob.css move it, about `at`,
 * and WebKit moves an HTML box on the compositor.
 */
export function Layer({ className, at, style, ref, children }: { className: string; at?: ArtPoint; style?: CSSProperties; ref?: Ref<HTMLSpanElement>; children: ReactNode }) {
  return (
    <span ref={ref} className={`hob-layer ${className}`} style={at ? { transformOrigin: originAt(at), ...style } : style}>
      {children}
    </span>
  )
}
