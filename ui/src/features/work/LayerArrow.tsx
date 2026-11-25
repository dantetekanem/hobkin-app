import { CornerDownRight } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

/**
 * The quiet gutter in front of a stack's layer over the bottom: an arrow that comes down from the layer under it and
 * points right, at this one. It sits in one row with the layer's line, so it points at the line's middle, and it takes
 * the place of a row between layers, so they sit as close as the rows of any list. Work, the Review list and the GitHub
 * page draw it the same.
 */
export function LayerArrow({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex w-7 shrink-0 justify-center text-muted-foreground/60', className)}>
      <CornerDownRight className="size-4" />
    </span>
  )
}
