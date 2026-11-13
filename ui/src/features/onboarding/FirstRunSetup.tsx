import { createPortal } from 'react-dom'
import { HomeTour } from '@/features/tour/HomeTour.tsx'
import { Storyteller } from './Storyteller.tsx'
import { useSetup } from './store.ts'

/**
 * The first-run setup, over the whole window, and the tour of the app that follows it. The setup is a story hobkin
 * tells (`Storyteller`), and the tour says what each part of the app does (`HomeTour`). See _specs/025-onboarding.
 *
 * Mount it once, inside the frame. The setup shows itself on the first run, with `?setup=1`, and after "Run setup
 * again". The tour opens when the setup was told to the end, and from Settings.
 */
export function FirstRunSetup() {
  const open = useSetup((state) => state.open)
  const run = useSetup((state) => state.run)
  return (
    <>
      {open ? createPortal(<Storyteller key={run} />, document.body) : null}
      <HomeTour />
    </>
  )
}
