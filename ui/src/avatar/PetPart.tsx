import { Art, Layer } from './Layer.tsx'
import { PART_PIVOT, PET_PARTS, type Paint, type PartShape, type Pet } from './pets.ts'

const PAINT_CLASS: Record<Paint, string> = { fill: 'hob-fm', stroke: 'hob-sm', eye: 'hob-fe' }

/** A pet's part as boxes, to stack before the body: the whole part turns in one, and each piece that moves on its own in another. */
export function PetLayers({ pet }: { pet: Pet }) {
  const shapes = PET_PARTS[pet]
  if (shapes.length === 0) return null

  return (
    <Layer className={`hob-acc hob-acc-${pet}`} at={PART_PIVOT[pet] ?? undefined}>
      {shapes.map((shape) => {
        const art = (
          <Art key={shape.name}>
            <path className={PAINT_CLASS[shape.paint]} d={shape.d} strokeWidth={shape.strokeWidth} />
          </Art>
        )
        return shape.pivot ? (
          <Layer key={shape.name} className={shape.name} at={shape.pivot}>
            {art}
          </Layer>
        ) : (
          art
        )
      })}
    </Layer>
  )
}

/** Plain colors for a still mark, which carries none of the avatar's classes. */
export interface MarkPaint {
  mark: string
  eye: string
}

/** A pet's part as SVG, to draw before the body of a still mark, in the colors given. */
export function PetPart({ pet, paint }: { pet: Pet; paint: MarkPaint }) {
  const shapes = PET_PARTS[pet]
  if (shapes.length === 0) return null

  return (
    <g>
      {shapes.map((shape) => (
        <path key={shape.name} d={shape.d} {...stillColors(shape, paint)} />
      ))}
    </g>
  )
}

function stillColors(shape: PartShape, paint: MarkPaint) {
  const color = shape.paint === 'eye' ? paint.eye : paint.mark

  if (shape.paint === 'stroke') {
    return {
      fill: 'none',
      stroke: color,
      strokeWidth: shape.strokeWidth,
      strokeLinecap: 'round' as const,
    }
  }

  return { fill: color }
}
