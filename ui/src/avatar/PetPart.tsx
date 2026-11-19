import { PET_PARTS, type Paint, type PartShape, type Pet } from './pets.ts'

const PAINT_CLASS: Record<Paint, string> = { fill: 'hob-fm', stroke: 'hob-sm', eye: 'hob-fe' }

/** Plain colors for a still mark, which carries none of the avatar's classes. */
export interface MarkPaint {
  mark: string
  eye: string
}

/**
 * A pet's part as SVG, to draw before the body. Without `paint` it takes the avatar's classes, so the moods in
 * hob.css move it. With `paint` it is a still drawing in those colors.
 */
export function PetPart({ pet, paint }: { pet: Pet; paint?: MarkPaint }) {
  const shapes = PET_PARTS[pet]
  if (shapes.length === 0) return null

  if (paint) {
    return (
      <g>
        {shapes.map((shape) => (
          <path key={shape.name} d={shape.d} {...stillColors(shape, paint)} />
        ))}
      </g>
    )
  }

  return (
    <g className={`hob-acc hob-acc-${pet}`}>
      {shapes.map((shape) => (
        <path key={shape.name} className={`${PAINT_CLASS[shape.paint]} ${shape.name}`} d={shape.d} strokeWidth={shape.strokeWidth} />
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
