import { useState } from 'react'
import { Rise } from '@/app/Reveal.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx'
import { NeedsReview } from '@/features/onboarding/NeedsReview.tsx'
import { useSetup } from '@/features/onboarding/store.ts'
import { useTour } from '@/features/tour/store.ts'
import { useHasHost } from '@/lib/host/index.ts'

/**
 * The way back into the first-run setup and the tour that follows it (025-onboarding). Each opens over the app, from
 * its start. Check this Mac opens the setup's review of what hobkin needs on its own.
 */
export function SetupAgainTile() {
  const openSetup = useSetup((state) => state.openSetup)
  const startTour = useTour((state) => state.start)
  const hasHost = useHasHost()
  const [checking, setChecking] = useState(false)

  return (
    <Rise className="col-span-6 @max-[820px]:col-span-2">
      <section aria-label="Setup" className="flex h-full items-center justify-between gap-4 rounded-3xl bg-background p-5">
        <header>
          <h2 className="eyebrow">Setup</h2>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">Meet hobkin again</p>
          <p className="mt-1 max-w-[60ch] text-[13px] text-muted-foreground">
            hobkin introduces itself, checks Pi and your account, and asks what to set up. The tour says what each part of the app does. Check this Mac shows what hobkin needs and what is missing.
          </p>
        </header>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" data-stop="" onClick={startTour}>
            Take the tour
          </Button>
          <Button variant="ghost" data-stop="" disabled={!hasHost} onClick={() => setChecking(true)}>
            Check this Mac
          </Button>
          <Button variant="outline" data-stop="" onClick={openSetup}>
            Run setup again
          </Button>
        </div>
      </section>
      <Dialog open={checking} onOpenChange={setChecking}>
        {/* The review mounts as the dialog opens, so each opening reads the Mac afresh. */}
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>What hobkin needs</DialogTitle>
          </DialogHeader>
          {/* Without a model the app shows Connect a model in its canvas, under this dialog. */}
          <NeedsReview onSignIn={() => setChecking(false)} listClassName="max-h-[60vh]" />
        </DialogContent>
      </Dialog>
    </Rise>
  )
}
