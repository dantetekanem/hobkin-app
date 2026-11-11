import { motion, type Transition } from 'motion/react'
import { cn } from '@/lib/utils.ts'

type Mode = 'transcript' | 'code'

type ActivityModeSwitchProps = {
  mode: Mode
  onChange: (mode: Mode) => void
  label: string
  layoutId: string
  transition: Transition
}

/** The shared controlled choice between an activity transcript and its tool calls. */
export function ActivityModeSwitch({ mode, onChange, label, layoutId, transition }: ActivityModeSwitchProps) {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-surface-2 p-0.5 text-[12px] font-medium">
      {(['transcript', 'code'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
          className={cn('relative rounded-full px-3 py-1 transition-colors duration-[160ms] ease-[ease]', mode === option ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {mode === option ? <motion.span layoutId={layoutId} transition={transition} className="absolute inset-0 rounded-full bg-background shadow-panel" /> : null}
          <span className="relative">{option === 'transcript' ? 'Transcript' : 'Code'}</span>
        </button>
      ))}
    </div>
  )
}
