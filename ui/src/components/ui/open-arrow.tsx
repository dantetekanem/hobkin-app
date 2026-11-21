import { ArrowRight } from 'lucide-react'
import { cn } from 'cn'

/**
 * The arrow at the end of a row or card that opens something (spec 053). Its place is always kept, so nothing moves:
 * it shows while the `pressable` it sits in is under the pointer or holds the keyboard.
 */
export function OpenArrow({ className }: { className?: string }) {
  return <ArrowRight aria-hidden="true" className={cn('open-arrow size-4 shrink-0 text-muted-foreground', className)} />
}
