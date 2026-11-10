import { Rise } from '@/app/Reveal.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useSetup } from '@/features/onboarding/store.ts'

/** The way back into the first-run setup (025-onboarding). It opens over the app, from its first step. */
export function SetupAgainTile() {
  const openSetup = useSetup((state) => state.openSetup)

  return (
    <Rise className="col-span-6 @max-[820px]:col-span-2">
      <section aria-label="Setup" className="flex h-full items-center justify-between gap-4 rounded-3xl bg-background p-5">
        <header>
          <h2 className="eyebrow">Setup</h2>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">The first-run walkthrough</p>
          <p className="mt-1 max-w-[60ch] text-[13px] text-muted-foreground">Connect a model and get good defaults for its tiers, the way it ran the first time.</p>
        </header>
        <Button variant="outline" className="shrink-0" data-stop="" onClick={openSetup}>
          Run setup again
        </Button>
      </section>
    </Rise>
  )
}
