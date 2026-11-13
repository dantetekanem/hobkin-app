import { Rise } from '@/app/Reveal.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useSetup } from '@/features/onboarding/store.ts'
import { useTour } from '@/features/tour/store.ts'

/** The way back into the first-run setup and the tour that follows it (025-onboarding). Each opens over the app, from its start. */
export function SetupAgainTile() {
  const openSetup = useSetup((state) => state.openSetup)
  const startTour = useTour((state) => state.start)

  return (
    <Rise className="col-span-6 @max-[820px]:col-span-2">
      <section aria-label="Setup" className="flex h-full items-center justify-between gap-4 rounded-3xl bg-background p-5">
        <header>
          <h2 className="eyebrow">Setup</h2>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">Meet hobkin again</p>
          <p className="mt-1 max-w-[60ch] text-[13px] text-muted-foreground">hobkin introduces itself, checks Pi and your account, and asks what to set up. The tour says what each part of the app does.</p>
        </header>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" data-stop="" onClick={startTour}>
            Take the tour
          </Button>
          <Button variant="outline" data-stop="" onClick={openSetup}>
            Run setup again
          </Button>
        </div>
      </section>
    </Rise>
  )
}
