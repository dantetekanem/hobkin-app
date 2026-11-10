import { MotionConfig } from 'motion/react'
import { useEffect, useSyncExternalStore } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip.tsx'
import { LinkLayer } from '@/features/viewer/LinkLayer.tsx'
import { startHostConnection } from '@/lib/host/index.ts'
import { AvatarGallery } from './dev/AvatarGallery.tsx'
import { Frame } from './Frame.tsx'

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
        {hash === '#/dev/avatar' ? (
          <AvatarGallery />
        ) : (
          <Frame />
        )}
      </TooltipProvider>
    </MotionConfig>
  )
}
