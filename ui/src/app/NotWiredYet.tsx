import { Hob } from '@/avatar/Hob.tsx'
import { Hero, Rise } from './Reveal.tsx'
import { SCREENS, type ScreenId } from './screens.ts'

/**
 * Stands in for a screen that can show only sample data so far, while a host is connected: the user's own hobkin
 * must never be shown made-up data. It goes away as soon as the screen reads hobkin.
 */
export function NotWiredYet({ screen }: { screen: ScreenId }) {
  const label = SCREENS.find((entry) => entry.id === screen)?.label ?? screen
  return (
    <div className="grid h-full place-items-center p-8 pt-24">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Hero>
          <Hob mood="working" size={96} stage="var(--hb-surface)" />
        </Hero>
        <Rise>
          <p className="font-heading text-[20px] font-semibold tracking-[-0.02em]">{label} is being connected to your hobkin</p>
        </Rise>
        <Rise>
          <p className="text-[15px] text-pretty text-muted-foreground">
            Until it reads your own data, it stays hidden here rather than show sample data. Without a host it shows the sample, as before.
          </p>
        </Rise>
      </div>
    </div>
  )
}
