import { PET_PARTS, type Paint, type Pet } from './pets.ts'

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

  return (
    <g className={paint ? undefined : `hob-acc hob-acc-${pet}`}>
      {shapes.map((shape) => {
        const color = paint ? (shape.paint === 'eye' ? paint.eye : paint.mark) : undefined
        return (
          <path
            key={shape.name}
            className={paint ? undefined : `${PAINT_CLASS[shape.paint]} ${shape.name}`}
            d={shape.d}
            fill={paint ? (shape.paint === 'stroke' ? 'none' : color) : undefined}
            stroke={paint && shape.paint === 'stroke' ? color : undefined}
            strokeWidth={shape.strokeWidth}
            strokeLinecap={paint && shape.paint === 'stroke' ? 'round' : undefined}
          />
        )
      })}
    </g>
  )
}
