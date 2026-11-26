import { MotionConfig } from 'motion/react'
import { Suspense, useEffect, useSyncExternalStore } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip.tsx'
import { LinkLayer } from '@/features/viewer/LinkLayer.tsx'
import { startHostConnection } from '@/lib/host/index.ts'
import { Frame } from './Frame.tsx'
import { PhotoCredit } from './PhotoCredit.tsx'
// Carries out the window moves and composer drafts hobkin drives for the user (013-hobkin-access).
import './nudge.ts'
import { lazyScreen } from './lazy-screen.ts'
import { installFunctionKeyGuard } from './function-key-guard.ts'

// No text box takes an arrow or another function key as a character (the crossed square WebKit can type).
installFunctionKeyGuard(document)

// A page for development: its code loads only when its address is opened.
const AvatarGallery = lazyScreen(() => import('./dev/AvatarGallery.tsx').then((module) => ({ default: module.AvatarGallery })))

function useHash(): string {
  return useSyncExternalStore(
    (listener) => {
      addEventListener('hashchange', listener)
      return () => removeEventListener('hashchange', listener)
    },
    () => location.hash,
  )
}

export function App() {
  const hash = useHash()
  // The connection to the host lives as long as the window, and comes back by itself when the host restarts.
  useEffect(() => startHostConnection(), [])

  return (
    // "user" keeps opacity changes and drops movement when the system asks for reduced motion.
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <LinkLayer />
        <PhotoCredit />
        {hash === '#/dev/avatar' ? (
          <Suspense fallback={null}>
            <AvatarGallery />
          </Suspense>
        ) : (
          <Frame />
        )}
      </TooltipProvider>
    </MotionConfig>
  )
}
