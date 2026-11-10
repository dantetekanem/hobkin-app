import { useEffect } from 'react'
import { reportPresence, useHost } from '@/lib/host/index.ts'

/** hobkin counts the user as there for two minutes after a sign of them, so a sign this often is enough. */
const AT_MOST_EVERY_MS = 20000

/**
 * Tells hobkin whether the user is here: the window has focus, and they pressed a key or clicked lately.
 * hobkin opens a question only to someone who is there, and keeps a question nobody waits on out of the way
 * of a message being written.
 */
export function usePresence(typing: boolean): void {
  const connected = useHost((state) => state.link === 'open')

  useEffect(() => {
    if (!connected) return
    let reportedAt = 0
    const report = () => {
      reportedAt = Date.now()
      reportPresence({ focused: document.hasFocus(), typing })
    }
    const seen = () => {
      if (Date.now() - reportedAt > AT_MOST_EVERY_MS) report()
    }

    report()
    addEventListener('focus', report)
    addEventListener('blur', report)
    addEventListener('keydown', seen, true)
    addEventListener('pointerdown', seen, true)
    return () => {
      removeEventListener('focus', report)
      removeEventListener('blur', report)
      removeEventListener('keydown', seen, true)
      removeEventListener('pointerdown', seen, true)
    }
  }, [connected, typing])
}
